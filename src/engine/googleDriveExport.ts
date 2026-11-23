import { initializeApp, getApps } from 'firebase/app';
import {
  getAuth,
  GoogleAuthProvider,
  onAuthStateChanged,
  signInWithPopup,
  User,
} from 'firebase/auth';
import firebaseConfig from '../../firebase-applet-config.json';

export const GOOGLE_DRIVE_SCOPES = [
  'https://www.googleapis.com/auth/drive.file',
];

const COLAB_FOLDER_NAME = 'Bharat-AI-Colab';

const app =
  getApps().length > 0 ? getApps()[0] : initializeApp(firebaseConfig);
const auth = getAuth(app);

const provider = new GoogleAuthProvider();
for (const scope of GOOGLE_DRIVE_SCOPES) {
  provider.addScope(scope);
}

let isSigningIn = false;
let cachedAccessToken: string | null = null;

export interface DriveExportResult {
  folderId: string;
  folderUrl: string;
  notebookId: string;
  notebookUrl: string;
  colabLaunchUrl: string;
  zipId: string;
}

export interface ExistingDriveColabFiles {
  folderId: string;
  notebookId?: string;
  zipId?: string;
}

export function initGoogleDriveAuth(
  onAuthReady?: (user: User, token: string) => void,
  onAuthNeeded?: () => void
): () => void {
  return onAuthStateChanged(auth, (user: User | null) => {
    if (user && cachedAccessToken) {
      onAuthReady?.(user, cachedAccessToken);
    } else if (!isSigningIn) {
      cachedAccessToken = null;
      onAuthNeeded?.();
    }
  });
}

export async function signInWithGoogleDrive(): Promise<{
  user: User;
  accessToken: string;
}> {
  isSigningIn = true;
  try {
    const result = await signInWithPopup(auth, provider);
    const credential = GoogleAuthProvider.credentialFromResult(result);
    if (!credential?.accessToken) {
      throw new Error('Google sign-in did not return a Google Drive token.');
    }
    cachedAccessToken = credential.accessToken;
    return { user: result.user, accessToken: cachedAccessToken };
  } finally {
    isSigningIn = false;
  }
}

export function getCachedDriveToken(): string | null {
  return cachedAccessToken;
}

export async function signOutGoogleDrive(): Promise<void> {
  await auth.signOut();
  cachedAccessToken = null;
}

async function driveJsonFetch<T>(
  url: string,
  accessToken: string,
  init?: RequestInit
): Promise<T> {
  const res = await fetch(url, {
    ...init,
    headers: {
      Authorization: `Bearer ${accessToken}`,
      ...(init?.headers ?? {}),
    },
  });
  if (!res.ok) {
    const msg = await res.text();
    throw new Error(`Google Drive API error (${res.status}): ${msg}`);
  }
  return (await res.json()) as T;
}

async function findOrCreateColabFolder(accessToken: string): Promise<string> {
  const query = encodeURIComponent(
    `name='${COLAB_FOLDER_NAME}' and mimeType='application/vnd.google-apps.folder' and trashed=false`
  );
  const search = await driveJsonFetch<{ files?: Array<{ id: string }> }>(
    `https://www.googleapis.com/drive/v3/files?q=${query}&fields=files(id,name)&spaces=drive`,
    accessToken
  );
  if (search.files && search.files.length > 0) {
    return search.files[0].id;
  }

  const created = await driveJsonFetch<{ id: string }>(
    'https://www.googleapis.com/drive/v3/files?fields=id',
    accessToken,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        name: COLAB_FOLDER_NAME,
        mimeType: 'application/vnd.google-apps.folder',
      }),
    }
  );
  return created.id;
}

export async function inspectExistingDriveColabFiles(
  accessToken: string
): Promise<ExistingDriveColabFiles> {
  const folderId = await findOrCreateColabFolder(accessToken);
  const query = encodeURIComponent(
    `'${folderId}' in parents and trashed=false`
  );
  const list = await driveJsonFetch<{
    files?: Array<{ id: string; name: string }>;
  }>(
    `https://www.googleapis.com/drive/v3/files?q=${query}&fields=files(id,name)`,
    accessToken
  );
  const files = list.files ?? [];
  return {
    folderId,
    notebookId: files.find((f) => f.name === 'Bharat_AI_GPU_Studio.ipynb')?.id,
    zipId: files.find(
      (f) => f.name === 'bharat-ai-pocket-engine-colab-gpu.zip'
    )?.id,
  };
}

async function uploadResumableToDrive(params: {
  accessToken: string;
  folderId: string;
  fileName: string;
  mimeType: string;
  blob: Blob;
  existingFileId?: string;
}): Promise<{ id: string; webViewLink?: string }> {
  const { accessToken, folderId, fileName, mimeType, blob, existingFileId } =
    params;

  const endpoint = existingFileId
    ? `https://www.googleapis.com/upload/drive/v3/files/${existingFileId}?uploadType=resumable&fields=id,webViewLink`
    : 'https://www.googleapis.com/upload/drive/v3/files?uploadType=resumable&fields=id,webViewLink';

  const metadata = existingFileId
    ? { name: fileName, mimeType }
    : { name: fileName, mimeType, parents: [folderId] };

  const startRes = await fetch(endpoint, {
    method: existingFileId ? 'PATCH' : 'POST',
    headers: {
      Authorization: `Bearer ${accessToken}`,
      'Content-Type': 'application/json; charset=UTF-8',
      'X-Upload-Content-Type': mimeType,
      'X-Upload-Content-Length': String(blob.size),
    },
    body: JSON.stringify(metadata),
  });

  if (!startRes.ok) {
    const errText = await startRes.text();
    throw new Error(
      `Failed to start Drive upload for ${fileName} (${startRes.status}): ${errText}`
    );
  }

  const uploadUrl = startRes.headers.get('Location');
  if (!uploadUrl) {
    throw new Error(`Missing resumable upload URL for ${fileName}`);
  }

  const putRes = await fetch(uploadUrl, {
    method: 'PUT',
    headers: {
      'Content-Type': mimeType,
    },
    body: blob,
  });

  if (!putRes.ok) {
    const errText = await putRes.text();
    throw new Error(
      `Failed uploading ${fileName} to Google Drive (${putRes.status}): ${errText}`
    );
  }

  return (await putRes.json()) as { id: string; webViewLink?: string };
}

export async function exportBundleToGoogleDrive(params: {
  accessToken: string;
  bundlePayload: unknown;
  existing: ExistingDriveColabFiles;
  onProgress?: (stage: string) => void;
}): Promise<DriveExportResult> {
  const { accessToken, bundlePayload, existing, onProgress } = params;

  onProgress?.('Packing your app & scene files...');
  const [nbRes, zipRes] = await Promise.all([
    fetch('/api/export/colab-notebook'),
    fetch('/api/export/project-zip', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(bundlePayload),
    }),
  ]);

  if (!nbRes.ok) {
    throw new Error(`Could not fetch Colab notebook (${nbRes.status})`);
  }
  if (!zipRes.ok) {
    throw new Error(`Could not build project ZIP (${zipRes.status})`);
  }

  const [nbBlob, zipBlob] = await Promise.all([nbRes.blob(), zipRes.blob()]);

  onProgress?.('Uploading Colab notebook to Google Drive...');
  const nbUploaded = await uploadResumableToDrive({
    accessToken,
    folderId: existing.folderId,
    fileName: 'Bharat_AI_GPU_Studio.ipynb',
    mimeType: 'application/vnd.google.colaboratory',
    blob: nbBlob,
    existingFileId: existing.notebookId,
  });

  onProgress?.('Uploading full project bundle (.zip) to Google Drive...');
  const zipUploaded = await uploadResumableToDrive({
    accessToken,
    folderId: existing.folderId,
    fileName: 'bharat-ai-pocket-engine-colab-gpu.zip',
    mimeType: 'application/zip',
    blob: zipBlob,
    existingFileId: existing.zipId,
  });

  return {
    folderId: existing.folderId,
    folderUrl: `https://drive.google.com/drive/folders/${existing.folderId}`,
    notebookId: nbUploaded.id,
    notebookUrl:
      nbUploaded.webViewLink ||
      `https://drive.google.com/file/d/${nbUploaded.id}/view`,
    colabLaunchUrl: `https://colab.research.google.com/drive/${nbUploaded.id}`,
    zipId: zipUploaded.id,
  };
}
