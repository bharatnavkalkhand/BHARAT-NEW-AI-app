import React, { useEffect, useMemo, useState } from 'react';
import { User } from 'firebase/auth';
import {
  Check,
  CheckCircle2,
  CloudUpload,
  Copy,
  Download,
  ExternalLink,
  FileArchive,
  FileCode2,
  FolderOpen,
  FolderTree,
  Globe,
  LogOut,
  Rocket,
  Sliders,
  Sparkles,
} from 'lucide-react';
import {
  ActorProfile,
  ASPECT_CONFIG,
  AspectFormat,
  CameraFraming,
  DirectedScene,
  FRAMING_LABELS,
  OverlayTemplateConfig,
  VOICE_LANG_LABELS,
  VoiceLang,
} from '../engine/types';
import {
  DriveExportResult,
  ExistingDriveColabFiles,
  exportBundleToGoogleDrive,
  getCachedDriveToken,
  initGoogleDriveAuth,
  inspectExistingDriveColabFiles,
  signInWithGoogleDrive,
  signOutGoogleDrive,
} from '../engine/googleDriveExport';

interface ColabGpuExportViewProps {
  scenes: DirectedScene[];
  cast: ActorProfile[];
  format: AspectFormat;
  framing: CameraFraming;
  language: VoiceLang;
  gestureBoost: number;
  overlayConfig?: OverlayTemplateConfig;
  onChangeGestureBoost: (next: number) => void;
}

type ColabLaunchMode = 'gpu_render' | 'web_app';

export const ColabGpuExportView: React.FC<ColabGpuExportViewProps> = ({
  scenes,
  cast,
  format,
  framing,
  language,
  gestureBoost,
  overlayConfig,
  onChangeGestureBoost,
}) => {
  const [isDownloadingZip, setIsDownloadingZip] = useState(false);
  const [downloadError, setDownloadError] = useState<string | null>(null);
  const [copiedCell, setCopiedCell] = useState(false);
  const [launchMode, setLaunchMode] = useState<ColabLaunchMode>('gpu_render');

  // Google Drive export state (in-memory token only)
  const [driveUser, setDriveUser] = useState<User | null>(null);
  const [driveToken, setDriveToken] = useState<string | null>(() =>
    getCachedDriveToken()
  );
  const [isSigningInDrive, setIsSigningInDrive] = useState(false);
  const [isExportingDrive, setIsExportingDrive] = useState(false);
  const [driveStage, setDriveStage] = useState<string>('');
  const [driveError, setDriveError] = useState<string | null>(null);
  const [driveResult, setDriveResult] = useState<DriveExportResult | null>(null);
  const [pendingOverwrite, setPendingOverwrite] =
    useState<ExistingDriveColabFiles | null>(null);

  useEffect(() => {
    return initGoogleDriveAuth(
      (user, token) => {
        setDriveUser(user);
        setDriveToken(token);
      },
      () => {
        setDriveUser(null);
        setDriveToken(null);
      }
    );
  }, []);

  const bundlePayload = useMemo(() => {
    // Strip large temporary blob: URLs while preserving base64 audio / portraits when present
    const cleanScenes = scenes.map(({ voiceAudioUrl: _blobUrl, ...rest }) => rest);
    return {
      format,
      framing,
      language,
      gestureBoost,
      overlayConfig,
      scenes: cleanScenes,
      cast,
    };
  }, [format, framing, language, gestureBoost, overlayConfig, scenes, cast]);

  const gpuRenderCellCode = useMemo(() => {
    const encodedJson = JSON.stringify(bundlePayload, null, 2);
    return `# Bharat-AI Pocket Engine — 1-Cell Colab / Kaggle 60 FPS GPU Render
!nvidia-smi
!apt-get update -qq && apt-get install -y -qq curl ffmpeg fonts-noto-core fonts-noto-extra libegl1 libgl1 libvulkan1 mesa-vulkan-drivers unzip > /dev/null
!curl -fsSL https://deb.nodesource.com/setup_22.x | bash - > /dev/null && apt-get install -y -qq nodejs > /dev/null
!pip install -q playwright edge-tts && playwright install chromium

import glob, zipfile
from pathlib import Path

zips = glob.glob('/content/*.zip') + glob.glob('/kaggle/input/**/*.zip', recursive=True) + glob.glob('/content/drive/MyDrive/Bharat-AI-Colab/*.zip') + glob.glob('*.zip')
assert zips, 'Upload bharat-ai-pocket-engine-colab-gpu.zip first!'
out_dir = Path('/content/bharat_ai_studio') if Path('/content').exists() else Path('/kaggle/working/bharat_ai_studio')
out_dir.mkdir(parents=True, exist_ok=True)
with zipfile.ZipFile(zips[0], 'r') as zf:
    zf.extractall(out_dir)

%cd {out_dir}
!npm install --silent

Path('colab_kaggle_gpu/scenes_config.json').write_text(r'''${encodedJson.replace(/'''/g, "\\'\\'\\'")}''', encoding='utf-8')
!python colab_kaggle_gpu/gpu_render.py --config colab_kaggle_gpu/scenes_config.json --output bharat_ai_gpu_60fps.mp4 --fps 60 --gesture-boost ${gestureBoost.toFixed(2)}

from IPython.display import Video, display
display(Video('bharat_ai_gpu_60fps.mp4', embed=True, width=420))`;
  }, [bundlePayload, gestureBoost]);

  const webAppCellCode = useMemo(() => {
    return `# Bharat-AI Pocket Engine — Run Full Live Web App in Google Colab / Kaggle
!apt-get update -qq && apt-get install -y -qq curl ffmpeg fonts-noto-core fonts-noto-extra unzip > /dev/null
!curl -fsSL https://deb.nodesource.com/setup_22.x | bash - > /dev/null && apt-get install -y -qq nodejs > /dev/null

import glob, os, subprocess, time, zipfile
from pathlib import Path

zips = glob.glob('/content/*.zip') + glob.glob('/kaggle/input/**/*.zip', recursive=True) + glob.glob('/content/drive/MyDrive/Bharat-AI-Colab/*.zip') + glob.glob('*.zip')
assert zips, 'Upload bharat-ai-pocket-engine-colab-gpu.zip first!'
app_dir = Path('/content/bharat_ai_studio') if Path('/content').exists() else Path('/kaggle/working/bharat_ai_studio')
app_dir.mkdir(parents=True, exist_ok=True)
with zipfile.ZipFile(zips[0], 'r') as zf:
    zf.extractall(app_dir)

%cd {app_dir}
!npm install --silent
!npm run build

# Optional: set your Gemini API key for AI Director & Gemini TTS
os.environ.setdefault('GEMINI_API_KEY', '')
os.environ['NODE_ENV'] = 'production'
os.environ['PORT'] = '3000'
os.environ['DISABLE_HMR'] = 'true'

server_proc = subprocess.Popen(['npx', 'tsx', 'server.ts'], cwd=str(app_dir))
time.sleep(3)

try:
    from google.colab import output
    print('Opening Bharat-AI Pocket Engine in Colab preview...')
    output.serve_kernel_port_as_window(3000)
except ImportError:
    # Kaggle or remote Jupyter: expose via Cloudflare quick tunnel
    !curl -fsSL -o /usr/local/bin/cloudflared https://github.com/cloudflare/cloudflared/releases/latest/download/cloudflared-linux-amd64 && chmod +x /usr/local/bin/cloudflared
    !cloudflared tunnel --url http://127.0.0.1:3000`;
  }, []);

  const activeCode = launchMode === 'gpu_render' ? gpuRenderCellCode : webAppCellCode;

  const handleGoogleSignIn = async () => {
    if (isSigningInDrive) return;
    setDriveError(null);
    setIsSigningInDrive(true);
    try {
      const { user, accessToken } = await signInWithGoogleDrive();
      setDriveUser(user);
      setDriveToken(accessToken);
    } catch (err) {
      setDriveError(
        err instanceof Error ? err.message : 'Unable to sign in with Google.'
      );
    } finally {
      setIsSigningInDrive(false);
    }
  };

  const handleGoogleSignOut = async () => {
    await signOutGoogleDrive();
    setDriveUser(null);
    setDriveToken(null);
    setDriveResult(null);
    setPendingOverwrite(null);
  };

  const executeDriveUpload = async (
    token: string,
    existing: ExistingDriveColabFiles
  ) => {
    setIsExportingDrive(true);
    setDriveError(null);
    setPendingOverwrite(null);
    try {
      const result = await exportBundleToGoogleDrive({
        accessToken: token,
        bundlePayload,
        existing,
        onProgress: setDriveStage,
      });
      setDriveResult(result);
      setDriveStage('');
    } catch (err) {
      setDriveError(
        err instanceof Error
          ? err.message
          : 'Failed to export files to Google Drive.'
      );
      setDriveStage('');
    } finally {
      setIsExportingDrive(false);
    }
  };

  const handleStartDriveExport = async () => {
    if (!driveToken || isExportingDrive) return;
    setDriveError(null);
    setIsExportingDrive(true);
    setDriveStage('Checking Bharat-AI-Colab folder in Google Drive...');
    try {
      const existing = await inspectExistingDriveColabFiles(driveToken);
      if (existing.notebookId || existing.zipId) {
        setPendingOverwrite(existing);
        setIsExportingDrive(false);
        setDriveStage('');
        return;
      }
      await executeDriveUpload(driveToken, existing);
    } catch (err) {
      setDriveError(
        err instanceof Error
          ? err.message
          : 'Unable to check your Google Drive folder.'
      );
      setIsExportingDrive(false);
      setDriveStage('');
    }
  };

  const handleDownloadFullZip = async () => {
    if (isDownloadingZip) return;
    setDownloadError(null);
    setIsDownloadingZip(true);
    try {
      const res = await fetch('/api/export/project-zip', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(bundlePayload),
      });
      if (!res.ok) {
        const msg = await res.text();
        throw new Error(msg || `Export failed (${res.status})`);
      }
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = 'bharat-ai-pocket-engine-colab-gpu.zip';
      a.click();
      URL.revokeObjectURL(url);
    } catch (err) {
      setDownloadError(
        err instanceof Error ? err.message : 'Unable to generate full project ZIP.'
      );
    } finally {
      setIsDownloadingZip(false);
    }
  };

  const handleDownloadScenesJson = () => {
    const blob = new Blob([JSON.stringify(bundlePayload, null, 2)], {
      type: 'application/json',
    });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'scenes_config.json';
    a.click();
    URL.revokeObjectURL(url);
  };

  const handleCopyPasteCell = async () => {
    try {
      await navigator.clipboard.writeText(activeCode);
      setCopiedCell(true);
      setTimeout(() => setCopiedCell(false), 1800);
    } catch {
      // Clipboard blocked fallback
    }
  };

  const totalSec = scenes.reduce((sum, s) => sum + s.durationMs, 0) / 1000;

  return (
    <div className="max-w-[1320px] mx-auto px-6 py-8 space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight text-white">
            Colab & Kaggle Migration & GPU Bundle
          </h1>
          <div className="flex flex-wrap items-center gap-2 text-xs text-slate-400 mt-1">
            <span>Full App Source + Assets + Notebook (.ipynb)</span>
            <span aria-hidden="true">·</span>
            <span className="font-mono tabular-nums">
              {scenes.length} Scenes ({totalSec.toFixed(1)}s)
            </span>
            <span aria-hidden="true">·</span>
            <span>{ASPECT_CONFIG[format].shortLabel}</span>
            <span aria-hidden="true">·</span>
            <span>{FRAMING_LABELS[framing]}</span>
            <span aria-hidden="true">·</span>
            <span>{VOICE_LANG_LABELS[language]}</span>
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-2.5">
          <a
            href="/api/export/colab-notebook"
            download="Bharat_AI_GPU_Studio.ipynb"
            className="inline-flex items-center gap-2 px-3.5 py-2.5 text-xs font-medium text-slate-200 bg-[#101520] hover:bg-[#171E2E] border border-white/[0.1] rounded-lg transition-colors whitespace-nowrap shrink-0"
          >
            <FileCode2 className="w-4 h-4 text-cyan-300" />
            Download Notebook (.ipynb)
          </a>

          <button
            type="button"
            onClick={() => void handleDownloadFullZip()}
            disabled={isDownloadingZip}
            className="inline-flex items-center gap-2 px-4 py-2.5 text-xs font-semibold text-slate-950 bg-cyan-400 hover:bg-cyan-300 disabled:opacity-60 rounded-lg transition-colors whitespace-nowrap shrink-0"
          >
            <Download className="w-4 h-4" />
            {isDownloadingZip
              ? 'Packing All Files...'
              : 'Download Full App & Colab Pack (.zip)'}
          </button>
        </div>
      </div>

      {/* Easiest Path: Direct Google Drive -> Google Colab Export */}
      <div className="bg-gradient-to-r from-[#101A2B] to-[#101520] border border-cyan-400/25 rounded-xl p-5 space-y-4">
        <div className="flex flex-wrap items-center justify-between gap-4">
          <div className="space-y-1">
            <div className="flex items-center gap-2">
              <CloudUpload className="w-5 h-5 text-cyan-300" />
              <h2 className="text-base font-semibold text-white">
                Easy 1-Click Export to Google Drive & Colab
              </h2>
            </div>
            <p className="text-xs text-slate-300 leading-relaxed max-w-2xl">
              No manual file uploads needed. Save your notebook and project bundle straight to a{' '}
              <span className="font-mono text-cyan-200">Bharat-AI-Colab</span> folder in Google Drive, then open it directly in Google Colab and click <span className="text-white font-medium">Run all</span>.
            </p>
          </div>

          {!driveToken ? (
            <button
              type="button"
              onClick={() => void handleGoogleSignIn()}
              disabled={isSigningInDrive}
              className="gsi-material-button inline-flex items-center gap-3 px-4 py-2.5 rounded-lg bg-white hover:bg-slate-100 text-slate-900 text-xs font-medium shadow-sm transition-colors disabled:opacity-60 whitespace-nowrap shrink-0"
            >
              <svg
                version="1.1"
                xmlns="http://www.w3.org/2000/svg"
                viewBox="0 0 48 48"
                className="block w-4 h-4 shrink-0"
              >
                <path
                  fill="#EA4335"
                  d="M24 9.5c3.54 0 6.71 1.22 9.21 3.6l6.85-6.85C35.9 2.38 30.47 0 24 0 14.62 0 6.51 5.38 2.56 13.22l7.98 6.19C12.43 13.72 17.74 9.5 24 9.5z"
                />
                <path
                  fill="#4285F4"
                  d="M46.98 24.55c0-1.57-.15-3.09-.38-4.55H24v9.02h12.94c-.58 2.96-2.26 5.48-4.78 7.18l7.73 6c4.51-4.18 7.09-10.36 7.09-17.65z"
                />
                <path
                  fill="#FBBC05"
                  d="M10.53 28.59c-.48-1.45-.76-2.99-.76-4.59s.27-3.14.76-4.59l-7.98-6.19C.92 16.46 0 20.12 0 24c0 3.88.92 7.54 2.56 10.78l7.97-6.19z"
                />
                <path
                  fill="#34A853"
                  d="M24 48c6.48 0 11.93-2.13 15.89-5.81l-7.73-6c-2.15 1.45-4.92 2.3-8.16 2.3-6.26 0-11.57-4.22-13.47-9.91l-7.98 6.19C6.51 42.62 14.62 48 24 48z"
                />
                <path fill="none" d="M0 0h48v48H0z" />
              </svg>
              <span>
                {isSigningInDrive ? 'Connecting...' : 'Sign in with Google'}
              </span>
            </button>
          ) : (
            <div className="flex flex-wrap items-center gap-2.5">
              <button
                type="button"
                onClick={() => void handleStartDriveExport()}
                disabled={isExportingDrive}
                className="inline-flex items-center gap-2 px-4 py-2.5 text-xs font-semibold text-slate-950 bg-emerald-400 hover:bg-emerald-300 disabled:opacity-60 rounded-lg transition-colors whitespace-nowrap"
              >
                <CloudUpload className="w-4 h-4" />
                {isExportingDrive
                  ? driveStage || 'Saving to Google Drive...'
                  : 'Save All Files to Google Drive for Colab'}
              </button>

              <button
                type="button"
                onClick={() => void handleGoogleSignOut()}
                title={driveUser?.email ?? 'Signed in'}
                className="inline-flex items-center gap-1.5 px-3 py-2.5 text-xs font-medium text-slate-300 hover:text-white bg-black/30 border border-white/[0.1] rounded-lg transition-colors whitespace-nowrap"
              >
                <LogOut className="w-3.5 h-3.5" />
                <span>{driveUser?.email ? driveUser.email.split('@')[0] : 'Sign out'}</span>
              </button>
            </div>
          )}
        </div>

        {driveError && (
          <div
            role="alert"
            className="px-4 py-2.5 rounded-lg bg-rose-500/10 border border-rose-400/30 text-xs text-rose-300"
          >
            {driveError}
          </div>
        )}

        {pendingOverwrite && driveToken && (
          <div
            role="dialog"
            aria-label="Confirm replacing existing Google Drive Colab files"
            className="p-4 rounded-lg bg-amber-500/10 border border-amber-400/35 flex flex-wrap items-center justify-between gap-3"
          >
            <div className="text-xs text-amber-100 space-y-0.5">
              <div className="font-semibold">
                Replace existing files in your Google Drive folder{' '}
                <span className="font-mono">Bharat-AI-Colab</span>?
              </div>
              <div className="text-amber-200/80">
                Existing{' '}
                {[
                  pendingOverwrite.notebookId ? 'Bharat_AI_GPU_Studio.ipynb' : null,
                  pendingOverwrite.zipId ? 'bharat-ai-pocket-engine-colab-gpu.zip' : null,
                ]
                  .filter(Boolean)
                  .join(' & ')}{' '}
                will be updated with your latest project files.
              </div>
            </div>
            <div className="flex items-center gap-2 shrink-0">
              <button
                type="button"
                onClick={() => setPendingOverwrite(null)}
                className="px-3 py-1.5 text-xs font-medium text-slate-200 bg-black/40 hover:bg-black/60 border border-white/15 rounded-lg"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={() => void executeDriveUpload(driveToken, pendingOverwrite)}
                className="px-3.5 py-1.5 text-xs font-semibold text-slate-950 bg-amber-400 hover:bg-amber-300 rounded-lg"
              >
                Confirm Replace
              </button>
            </div>
          </div>
        )}

        {driveResult && (
          <div className="p-4 rounded-lg bg-emerald-500/10 border border-emerald-400/30 flex flex-wrap items-center justify-between gap-4">
            <div className="flex items-start gap-2.5 text-xs text-emerald-100">
              <CheckCircle2 className="w-4 h-4 text-emerald-300 shrink-0 mt-0.5" />
              <div className="space-y-1">
                <div className="font-semibold text-white">
                  Saved to Google Drive (<span className="font-mono">Bharat-AI-Colab</span>)
                </div>
                <div className="text-emerald-100/80">
                  Next: click <strong>Open in Google Colab</strong>, choose <strong>Runtime → Change runtime type → T4 GPU</strong>, then click <strong>Runtime → Run all</strong>.
                </div>
              </div>
            </div>

            <div className="flex flex-wrap items-center gap-2 shrink-0">
              <a
                href={driveResult.folderUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center gap-1.5 px-3 py-2 text-xs font-medium text-slate-100 bg-black/35 hover:bg-black/55 border border-white/15 rounded-lg transition-colors whitespace-nowrap"
              >
                <FolderOpen className="w-3.5 h-3.5 text-cyan-300" />
                Open Drive Folder
              </a>
              <a
                href={driveResult.colabLaunchUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center gap-1.5 px-3.5 py-2 text-xs font-semibold text-slate-950 bg-cyan-400 hover:bg-cyan-300 rounded-lg transition-colors whitespace-nowrap"
              >
                <ExternalLink className="w-3.5 h-3.5" />
                Open in Google Colab
              </a>
            </div>
          </div>
        )}
      </div>

      {downloadError && (
        <div
          role="alert"
          className="px-4 py-3 rounded-lg bg-rose-500/10 border border-rose-400/30 text-xs text-rose-300"
        >
          {downloadError}
        </div>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-start">
        {/* Left Column: Gesture Expressiveness & Bundle Contents */}
        <div className="lg:col-span-5 space-y-5">
          <div className="bg-[#101520] border border-white/[0.08] rounded-xl p-5 space-y-4">
            <div className="flex items-center justify-between gap-3">
              <div className="flex items-center gap-2">
                <Sliders className="w-4 h-4 text-cyan-400" />
                <h2 className="text-sm font-semibold text-white">
                  Gesture Expressiveness Boost
                </h2>
              </div>
              <span className="text-xs font-mono tabular-nums text-cyan-300">
                {gestureBoost.toFixed(2)}x
              </span>
            </div>

            <input
              type="range"
              min={1.0}
              max={1.8}
              step={0.05}
              value={gestureBoost}
              onChange={(e) => onChangeGestureBoost(parseFloat(e.target.value))}
              aria-label="Gesture expressiveness boost"
              className="w-full accent-cyan-400 cursor-pointer"
            />

            <p className="text-xs text-slate-400 leading-relaxed">
              Amplifies dual-hand presenter arcs, wrist rotation, finger spread, torso sway, walking paths, and side-profile poses across both Live WebGL Preview and the 60 FPS Kaggle/Colab GPU renderer.
            </p>

            <div className="flex items-center gap-2 pt-1">
              {[
                { val: 1.0, label: 'Natural (1.0x)' },
                { val: 1.35, label: 'Expressive (1.35x)' },
                { val: 1.6, label: 'High Gesture (1.6x)' },
              ].map((preset) => (
                <button
                  key={preset.label}
                  type="button"
                  onClick={() => onChangeGestureBoost(preset.val)}
                  className={`flex-1 py-1.5 px-2 text-[11px] font-medium rounded-lg border transition-colors whitespace-nowrap ${
                    Math.abs(gestureBoost - preset.val) < 0.04
                      ? 'bg-cyan-400/15 border-cyan-400/50 text-cyan-200'
                      : 'bg-black/30 border-white/[0.08] text-slate-400 hover:text-white'
                  }`}
                >
                  {preset.label}
                </button>
              ))}
            </div>
          </div>

          <div className="bg-[#101520] border border-white/[0.08] rounded-xl p-5 space-y-4">
            <div className="flex items-center gap-2">
              <FolderTree className="w-4 h-4 text-cyan-400" />
              <h2 className="text-sm font-semibold text-white">
                Included App Files (.zip)
              </h2>
            </div>

            <ul className="space-y-2.5 text-xs text-slate-300">
              <li className="flex items-start gap-2.5">
                <FileArchive className="w-4 h-4 text-cyan-300 shrink-0 mt-0.5" />
                <div>
                  <span className="font-mono text-slate-100">colab_kaggle_gpu/</span>
                  <p className="text-slate-400 mt-0.5">
                    Includes <span className="font-mono">Bharat_AI_GPU_Studio.ipynb</span>, <span className="font-mono">gpu_render.py</span> (Playwright Vulkan/SwiftShader + <span className="font-mono">h264_nvenc</span> + ASS captions + <span className="font-mono">-17 LUFS</span> audio), and your live <span className="font-mono">scenes_config.json</span>.
                  </p>
                </div>
              </li>
              <li className="flex items-start gap-2.5">
                <FileArchive className="w-4 h-4 text-cyan-300 shrink-0 mt-0.5" />
                <div>
                  <span className="font-mono text-slate-100">src/ & src/assets/images/</span>
                  <p className="text-slate-400 mt-0.5">
                    Complete React + WebGL shader engine, 3D GLB avatar rig, front + side-profile character assets, dress cutouts, and FFmpeg pipeline.
                  </p>
                </div>
              </li>
              <li className="flex items-start gap-2.5">
                <FileArchive className="w-4 h-4 text-cyan-300 shrink-0 mt-0.5" />
                <div>
                  <span className="font-mono text-slate-100">server.ts, package.json, .env.example</span>
                  <p className="text-slate-400 mt-0.5">
                    Full Express + Vite + FFmpeg backend ready for live web hosting or headless GPU rendering in Colab or Kaggle.
                  </p>
                </div>
              </li>
            </ul>

            <div className="pt-2 border-t border-white/[0.06] flex items-center justify-between gap-2">
              <span className="text-[11px] text-slate-400">
                Need only your scene JSON?
              </span>
              <button
                type="button"
                onClick={handleDownloadScenesJson}
                className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-slate-200 bg-white/[0.04] hover:bg-white/[0.08] border border-white/[0.08] rounded-lg transition-colors whitespace-nowrap"
              >
                <Download className="w-3.5 h-3.5" />
                Download scenes_config.json
              </button>
            </div>
          </div>

          <div className="bg-[#101520] border border-white/[0.08] rounded-xl p-5 space-y-2.5">
            <div className="flex items-center gap-2">
              <Rocket className="w-4 h-4 text-cyan-400" />
              <h2 className="text-sm font-semibold text-white">
                Beginner Guide: Google Colab & Kaggle
              </h2>
            </div>
            <ol className="list-decimal list-inside space-y-1.5 text-xs text-slate-300 leading-relaxed">
              <li>
                Click <span className="text-white font-medium">Sign in with Google</span> above, then click <span className="text-white font-medium">Save All Files to Google Drive for Colab</span>.
              </li>
              <li>
                Click the <span className="font-mono text-cyan-200">Open in Google Colab</span> link that appears.
              </li>
              <li>
                In Colab, click <span className="text-white font-medium">Runtime → Change runtime type → T4 GPU</span>, then <span className="text-white font-medium">Runtime → Run all</span>.
              </li>
              <li>
                For <span className="text-white font-medium">Kaggle</span>: download the <span className="font-mono">.zip</span> & <span className="font-mono">.ipynb</span>, upload the <span className="font-mono">.zip</span> under <span className="text-white font-medium">+ Input</span>, enable <span className="text-white font-medium">GPU T4 x2</span> + <span className="text-white font-medium">Internet On</span>, and run all cells.
              </li>
            </ol>
          </div>
        </div>

        {/* Right Column: Copy-Paste 1-Cell Colab / Kaggle Launcher */}
        <div className="lg:col-span-7 bg-[#0D111A] border border-white/[0.08] rounded-xl overflow-hidden flex flex-col">
          <div className="flex flex-wrap items-center justify-between gap-3 px-5 py-3.5 border-b border-white/[0.08] bg-[#101520]">
            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={() => setLaunchMode('gpu_render')}
                className={`inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-lg border transition-colors whitespace-nowrap ${
                  launchMode === 'gpu_render'
                    ? 'bg-cyan-400/15 border-cyan-400/50 text-cyan-200'
                    : 'bg-black/30 border-white/[0.08] text-slate-400 hover:text-white'
                }`}
              >
                <Sparkles className="w-3.5 h-3.5" />
                60 FPS GPU Render Cell
              </button>
              <button
                type="button"
                onClick={() => setLaunchMode('web_app')}
                className={`inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-lg border transition-colors whitespace-nowrap ${
                  launchMode === 'web_app'
                    ? 'bg-cyan-400/15 border-cyan-400/50 text-cyan-200'
                    : 'bg-black/30 border-white/[0.08] text-slate-400 hover:text-white'
                }`}
              >
                <Globe className="w-3.5 h-3.5" />
                Run Live Web App Cell
              </button>
            </div>

            <button
              type="button"
              onClick={() => void handleCopyPasteCell()}
              className="inline-flex items-center gap-1.5 px-3.5 py-1.5 text-xs font-semibold text-slate-950 bg-cyan-400 hover:bg-cyan-300 rounded-lg transition-colors whitespace-nowrap shrink-0"
            >
              {copiedCell ? (
                <>
                  <Check className="w-3.5 h-3.5" />
                  Copied Cell
                </>
              ) : (
                <>
                  <Copy className="w-3.5 h-3.5" />
                  Copy Cell
                </>
              )}
            </button>
          </div>

          <div className="px-5 py-2.5 border-b border-white/[0.05] bg-black/25 text-[11px] text-slate-400">
            {launchMode === 'gpu_render'
              ? `Headless 60 FPS GPU pipeline · ${scenes.length} scenes · ${ASPECT_CONFIG[format].shortLabel} · ${gestureBoost.toFixed(2)}x gestures · NVENC + ASS Devanagari captions`
              : 'Builds & launches the full Express + Vite + FFmpeg web studio on port 3000 inside Colab preview or Kaggle Cloudflare Tunnel'}
          </div>

          <pre className="p-5 text-xs font-mono leading-relaxed text-slate-200 overflow-auto max-h-[600px]">
            <code>{activeCode}</code>
          </pre>
        </div>
      </div>
    </div>
  );
};
