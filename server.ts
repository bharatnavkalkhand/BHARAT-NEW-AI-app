import 'dotenv/config';
import express from 'express';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { GoogleGenAI, ThinkingLevel, Type } from '@google/genai';
import {
  finalizeMp4RenderJob,
  RenderJobMeta,
  RenderSceneInput,
  synthesizeSceneTtsWav,
} from './src/server/videoRenderPipeline';

const ROOT_DIR = path.dirname(fileURLToPath(import.meta.url));
const PORT = Number(process.env.PORT) || 3000;
const IS_PROD = process.env.NODE_ENV === 'production';

interface CastInput {
  id: string;
  name: string;
  isFemale: boolean;
  dressStyle: string;
  voicePresetId?: string;
}

interface DirectorRequestBody {
  idea?: string;
  language?: string;
  directorInstruction?: string;
  cast?: CastInput[];
}

const VALID_GESTURES = new Set([
  'TALK_WAVE',
  'HERO_RAISE',
  'POINTING',
  'WALKING',
  'THINKING',
]);

const VALID_EMOTIONS = new Set(['CALM', 'HEROIC', 'INTENSE', 'MYSTERIOUS']);

const VALID_DRESSES = new Set([
  'EXPEDITION_JACKET',
  'ROYAL_KURTA',
  'FESTIVE_SAREE',
  'WARRIOR_ARMOR',
  'FORMAL_COAT',
]);

function getGeminiClient(): GoogleGenAI {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    throw new Error(
      'GEMINI_API_KEY is missing. Add your Gemini API key in Settings > Secrets to use the AI Director.'
    );
  }
  return new GoogleGenAI({
    apiKey,
    httpOptions: {
      headers: {
        'User-Agent': 'aistudio-build',
      },
    },
  });
}

function getHttpStatusFromError(err: unknown): number {
  const msg = err instanceof Error ? err.message : String(err);
  if (msg.includes('GEMINI_API_KEY is missing')) return 400;
  if (/403|PERMISSION_DENIED|API_KEY_INVALID/i.test(msg)) return 403;
  if (/429|RESOURCE_EXHAUSTED|quota/i.test(msg)) return 429;
  if (/503|UNAVAILABLE|high demand/i.test(msg)) return 503;
  if (/404|NOT_FOUND/i.test(msg)) return 404;
  return 500;
}

function extractReadableErrorMessage(err: unknown): string {
  const raw = err instanceof Error ? err.message : 'Unable to reach Gemini AI Director.';
  try {
    const parsed = JSON.parse(raw) as { error?: { message?: string } };
    if (parsed?.error?.message) {
      return parsed.error.message;
    }
  } catch {
    // Raw message is already plain text
  }
  return raw;
}

interface ZipEntry {
  name: string;
  data: Buffer;
}

const ZIP_CRC_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let i = 0; i < 256; i++) {
    let c = i;
    for (let k = 0; k < 8; k++) {
      c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    }
    table[i] = c >>> 0;
  }
  return table;
})();

function zipCrc32(buf: Buffer): number {
  let crc = 0xffffffff;
  for (let i = 0; i < buf.length; i++) {
    crc = ZIP_CRC_TABLE[(crc ^ buf[i]) & 0xff] ^ (crc >>> 8);
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function buildZipBuffer(entries: ZipEntry[]): Buffer {
  const localParts: Buffer[] = [];
  const centralParts: Buffer[] = [];
  let offset = 0;

  for (const entry of entries) {
    const nameBytes = Buffer.from(entry.name.replace(/\\/g, '/'), 'utf8');
    const dataBytes = entry.data;
    const crc = zipCrc32(dataBytes);

    const localHeader = Buffer.allocUnsafe(30 + nameBytes.length);
    localHeader.writeUInt32LE(0x04034b50, 0);
    localHeader.writeUInt16LE(20, 4);
    localHeader.writeUInt16LE(0x0800, 6);
    localHeader.writeUInt16LE(0, 8);
    localHeader.writeUInt16LE(0, 10);
    localHeader.writeUInt16LE(0, 12);
    localHeader.writeUInt32LE(crc, 14);
    localHeader.writeUInt32LE(dataBytes.length, 18);
    localHeader.writeUInt32LE(dataBytes.length, 22);
    localHeader.writeUInt16LE(nameBytes.length, 26);
    localHeader.writeUInt16LE(0, 28);
    nameBytes.copy(localHeader, 30);

    const centralHeader = Buffer.allocUnsafe(46 + nameBytes.length);
    centralHeader.writeUInt32LE(0x02014b50, 0);
    centralHeader.writeUInt16LE(20, 4);
    centralHeader.writeUInt16LE(20, 6);
    centralHeader.writeUInt16LE(0x0800, 8);
    centralHeader.writeUInt16LE(0, 10);
    centralHeader.writeUInt16LE(0, 12);
    centralHeader.writeUInt16LE(0, 14);
    centralHeader.writeUInt32LE(crc, 16);
    centralHeader.writeUInt32LE(dataBytes.length, 20);
    centralHeader.writeUInt32LE(dataBytes.length, 24);
    centralHeader.writeUInt16LE(nameBytes.length, 28);
    centralHeader.writeUInt16LE(0, 30);
    centralHeader.writeUInt16LE(0, 32);
    centralHeader.writeUInt16LE(0, 34);
    centralHeader.writeUInt16LE(0, 36);
    centralHeader.writeUInt32LE(0, 38);
    centralHeader.writeUInt32LE(offset, 42);
    nameBytes.copy(centralHeader, 46);

    localParts.push(localHeader, dataBytes);
    centralParts.push(centralHeader);
    offset += localHeader.length + dataBytes.length;
  }

  const centralSize = centralParts.reduce((sum, part) => sum + part.length, 0);
  const eocd = Buffer.allocUnsafe(22);
  eocd.writeUInt32LE(0x06054b50, 0);
  eocd.writeUInt16LE(0, 4);
  eocd.writeUInt16LE(0, 6);
  eocd.writeUInt16LE(entries.length, 8);
  eocd.writeUInt16LE(entries.length, 10);
  eocd.writeUInt32LE(centralSize, 12);
  eocd.writeUInt32LE(offset, 16);
  eocd.writeUInt16LE(0, 20);

  return Buffer.concat([...localParts, ...centralParts, eocd]);
}

const SKIP_DIRS = new Set([
  'node_modules',
  'dist',
  '.git',
  '.aistudio',
  'workspace',
  '__pycache__',
]);
const SKIP_FILES = new Set(['.env', '.env.local', '.DS_Store']);

function collectProjectEntries(
  dir: string,
  baseDir: string,
  out: ZipEntry[]
): void {
  const items = fs.readdirSync(dir, { withFileTypes: true });
  for (const item of items) {
    if (item.isDirectory()) {
      if (SKIP_DIRS.has(item.name)) continue;
      collectProjectEntries(path.join(dir, item.name), baseDir, out);
    } else if (item.isFile()) {
      if (SKIP_FILES.has(item.name) || item.name.endsWith('.log')) continue;
      const fullPath = path.join(dir, item.name);
      const relPath = path.relative(baseDir, fullPath).replace(/\\/g, '/');
      if (relPath === 'colab_kaggle_gpu/scenes_config.json') continue;
      out.push({
        name: relPath,
        data: fs.readFileSync(fullPath),
      });
    }
  }
}

const RENDER_JOBS = new Map<string, RenderJobMeta>();

function cleanupExpiredRenderJobs(): void {
  const cutoff = Date.now() - 25 * 60 * 1000;
  for (const [id, job] of RENDER_JOBS.entries()) {
    if (job.createdAt < cutoff) {
      try {
        fs.rmSync(job.dir, { recursive: true, force: true });
      } catch {
        // Ignore temp dir cleanup errors
      }
      RENDER_JOBS.delete(id);
    }
  }
}

async function startServer(): Promise<void> {
  const app = express();
  app.use(express.json({ limit: '50mb' }));

  app.get('/api/health', (_req, res) => {
    res.json({ ok: true, hasGeminiKey: Boolean(process.env.GEMINI_API_KEY) });
  });

  app.get('/api/export/colab-notebook', (_req, res) => {
    const nbPath = path.resolve(ROOT_DIR, 'colab_kaggle_gpu', 'Bharat_AI_GPU_Studio.ipynb');
    if (!fs.existsSync(nbPath)) {
      res.status(404).json({ error: 'Colab notebook not found.' });
      return;
    }
    res.setHeader('Content-Type', 'application/x-ipynb+json');
    res.setHeader(
      'Content-Disposition',
      'attachment; filename="Bharat_AI_GPU_Studio.ipynb"'
    );
    res.sendFile(nbPath);
  });

  const handleProjectZipDownload = (scenesPayload: unknown, res: express.Response) => {
    try {
      const entries: ZipEntry[] = [];
      collectProjectEntries(ROOT_DIR, ROOT_DIR, entries);

      const defaultScenesConfig = {
        format: 'REEL_9_16',
        framing: 'FULL_BODY',
        language: 'hi-IN',
        gestureBoost: 1.45,
        scenes: [],
        cast: [],
      };
      const configJson = JSON.stringify(
        scenesPayload && typeof scenesPayload === 'object'
          ? scenesPayload
          : defaultScenesConfig,
        null,
        2
      );
      entries.push({
        name: 'colab_kaggle_gpu/scenes_config.json',
        data: Buffer.from(configJson, 'utf8'),
      });

      const zipBuf = buildZipBuffer(entries);
      res.setHeader('Content-Type', 'application/zip');
      res.setHeader(
        'Content-Disposition',
        'attachment; filename="bharat-ai-pocket-engine-colab-gpu.zip"'
      );
      res.setHeader('Content-Length', String(zipBuf.length));
      res.send(zipBuf);
    } catch (err) {
      res.status(500).json({
        error: err instanceof Error ? err.message : 'Failed to build project ZIP bundle.',
      });
    }
  };

  app.get('/api/export/project-zip', (_req, res) => {
    handleProjectZipDownload(null, res);
  });

  app.post('/api/export/project-zip', (req, res) => {
    handleProjectZipDownload(req.body, res);
  });

  app.post('/api/director/plan', async (req, res) => {
    try {
      const body = (req.body ?? {}) as DirectorRequestBody;
      const idea = typeof body.idea === 'string' ? body.idea.trim() : '';
      const language = typeof body.language === 'string' ? body.language : 'hi-IN';
      const directorInstruction =
        typeof body.directorInstruction === 'string'
          ? body.directorInstruction.trim()
          : '';
      const cast = Array.isArray(body.cast) ? body.cast : [];

      if (!idea) {
        res.status(400).json({ error: 'Please enter a story script before running the AI Director.' });
        return;
      }
      if (cast.length === 0) {
        res.status(400).json({ error: 'At least one cast avatar is required.' });
        return;
      }

      const ai = getGeminiClient();

      const castSummary = cast
        .map(
          (a) =>
            `- id="${a.id}", name="${a.name}", gender=${a.isFemale ? 'Female' : 'Male'}, defaultDress="${a.dressStyle}"`
        )
        .join('\n');

      const systemInstruction = [
        'You are an expert cinematic film & reel director for talking-avatar storytelling.',
        'Break the user story into 3 to 10 crisp, cinematic short-form shots averaging ~4.5 seconds each.',
        'For each scene, decide:',
        '1. actorId: Pick the exact cast id matching the speaker or narrative focus.',
        '2. biome (integer 0..7): Pick the most accurate background theme:',
        '   0 = Avatar Mystic Glow (night forest, bioluminescent glow, mystery)',
        '   1 = Fire & Embers (battle, danger, diwali, sparks, flames)',
        '   2 = Monsoon Storm (rain, thunder, storm, dramatic sky)',
        '   3 = Jaisalmer / Desert (desert, border, sand, frontier, dunes)',
        '   4 = Himalayan River (river, mountain water, valley, calm nature)',
        '   5 = Royal Palace Courtyard (palace, fort, heritage, royal celebration)',
        '   6 = Cyber Neon Skyline (futuristic city, tech, neon night, metropolis)',
        '   7 = Clean Studio Cyclorama (clean presenter studio, news, explainer, interview)',
        '3. gesture: Choose accurate character body movement: WALKING (walking/moving forward A->B), TALK_WAVE (explaining/conversing), POINTING (urgent/showing direction), HERO_RAISE (triumph/heroic call), THINKING (calm/reflective).',
        '4. emotion: CALM | HEROIC | INTENSE | MYSTERIOUS.',
        '5. dressOverride: Optional outfit change only when the story strongly implies one (EXPEDITION_JACKET, ROYAL_KURTA, FESTIVE_SAREE, WARRIOR_ARMOR, FORMAL_COAT) or empty string to keep actor default.',
        '6. transitionIn: "cut" for same-location continuation (preferred majority), or "fade" (0.4s crossfade) when location/time changes.',
        '7. dialogue: Concise spoken line (10-18 words) in the requested language (preserve Hindi Devanagari if input/language is Hindi).',
        '8. captionText: Clean punchy on-screen subtitle (max 64 characters) matching the dialogue without clutter.',
        '9. locationTitle: Short cinematic scene header (2-4 words).',
        '10. hookBanner: Optional year/date/short hook (max 3 words) or empty string.',
        '11. cameraZoomStart (1.0), cameraZoomEnd (1.08..1.15), cameraPanRange (-0.12..0.12).',
        '12. directorNote: One short sentence explaining why this theme and movement were chosen.',
      ].join('\n');

      const prompt = [
        `Target Spoken Language: ${language === 'hi-IN' ? 'Hindi (Devanagari)' : 'English (India)'}`,
        directorInstruction ? `Director Guidance: ${directorInstruction}` : '',
        'Available Cast:',
        castSummary,
        'Story Script:',
        idea,
      ]
        .filter(Boolean)
        .join('\n\n');

      const runGenerateWithRetry = async () => {
        const maxAttempts = 3;
        let lastErr: unknown;
        for (let attempt = 0; attempt < maxAttempts; attempt++) {
          try {
            return await ai.models.generateContent({
              model: 'gemini-4-hydrogen',
              contents: prompt,
              config: {
                systemInstruction,
                thinkingConfig: { thinkingLevel: ThinkingLevel.LOW },
                responseMimeType: 'application/json',
                responseSchema: {
                  type: Type.OBJECT,
                  properties: {
                    scenes: {
                      type: Type.ARRAY,
                      items: {
                        type: Type.OBJECT,
                        properties: {
                          actorId: { type: Type.STRING },
                          biome: { type: Type.INTEGER },
                          gesture: { type: Type.STRING },
                          emotion: { type: Type.STRING },
                          dressOverride: { type: Type.STRING },
                          transitionIn: { type: Type.STRING },
                          locationTitle: { type: Type.STRING },
                          hookBanner: { type: Type.STRING },
                          dialogue: { type: Type.STRING },
                          captionText: { type: Type.STRING },
                          cameraZoomStart: { type: Type.NUMBER },
                          cameraZoomEnd: { type: Type.NUMBER },
                          cameraPanRange: { type: Type.NUMBER },
                          directorNote: { type: Type.STRING },
                        },
                        required: [
                          'actorId',
                          'biome',
                          'gesture',
                          'emotion',
                          'locationTitle',
                          'dialogue',
                          'captionText',
                          'directorNote',
                        ],
                      },
                    },
                  },
                  required: ['scenes'],
                },
              },
            });
          } catch (err) {
            lastErr = err;
            const status = getHttpStatusFromError(err);
            const isTransient = status === 503 || status === 429;
            if (!isTransient || attempt === maxAttempts - 1) {
              throw err;
            }
            const delayMs = 600 * Math.pow(2, attempt) + Math.round(Math.random() * 200);
            await new Promise((r) => setTimeout(r, delayMs));
          }
        }
        throw lastErr;
      };

      const response = await runGenerateWithRetry();

      const rawText = (response.text ?? '').trim();
      const parsed = JSON.parse(rawText) as {
        scenes?: Array<Record<string, unknown>>;
      };
      const rawScenes = Array.isArray(parsed.scenes) ? parsed.scenes : [];
      if (rawScenes.length === 0) {
        res.status(502).json({ error: 'AI Director returned an empty storyboard. Please refine the prompt and retry.' });
        return;
      }

      const castIds = new Set(cast.map((c) => c.id));
      const normalized = rawScenes.slice(0, 12).map((item, idx) => {
        const rawActorId = typeof item.actorId === 'string' ? item.actorId : '';
        const matchedByName = cast.find(
          (c) => c.name.toLowerCase() === rawActorId.toLowerCase()
        );
        const actorId = castIds.has(rawActorId)
          ? rawActorId
          : matchedByName?.id ?? cast[idx % cast.length].id;

        const rawBiome = Number(item.biome);
        const biome =
          Number.isFinite(rawBiome) && rawBiome >= 0 && rawBiome <= 7
            ? Math.round(rawBiome)
            : 0;

        const rawGesture = String(item.gesture ?? 'TALK_WAVE');
        const gesture = VALID_GESTURES.has(rawGesture) ? rawGesture : 'TALK_WAVE';

        const rawEmotion = String(item.emotion ?? 'CALM');
        const emotion = VALID_EMOTIONS.has(rawEmotion) ? rawEmotion : 'CALM';

        const rawDress = String(item.dressOverride ?? '');
        const dressOverride = VALID_DRESSES.has(rawDress) ? rawDress : undefined;
        const transitionIn = item.transitionIn === 'fade' ? 'fade' : 'cut';

        const dialogue = String(item.dialogue ?? '').trim() || idea;
        const captionText = String(item.captionText ?? '').trim() || dialogue;
        const locationTitle = String(item.locationTitle ?? '').trim() || 'CINEMA STAGE';
        const hookBanner = String(item.hookBanner ?? '').trim();
        const directorNote = String(item.directorNote ?? '').trim();

        const zStart = Number(item.cameraZoomStart);
        const zEnd = Number(item.cameraZoomEnd);
        const pan = Number(item.cameraPanRange);

        return {
          actorId,
          biome,
          gesture,
          emotion,
          dressOverride,
          transitionIn,
          locationTitle,
          hookBanner,
          dialogue,
          captionText,
          cameraZoomStart:
            Number.isFinite(zStart) ? Math.min(1.06, Math.max(1.0, zStart)) : 1.0,
          cameraZoomEnd:
            Number.isFinite(zEnd) ? Math.min(1.15, Math.max(1.06, zEnd)) : 1.12,
          cameraPanRange:
            Number.isFinite(pan) ? Math.min(0.14, Math.max(-0.14, pan)) : 0.08,
          directorNote,
        };
      });

      res.json({ scenes: normalized });
    } catch (err) {
      const status = getHttpStatusFromError(err);
      const message = extractReadableErrorMessage(err);
      res.status(status).json({ error: message });
    }
  });

  app.post('/api/tts/scene', async (req, res) => {
    try {
      const body = (req.body ?? {}) as {
        dialogue?: string;
        language?: string;
        emotion?: string;
        actor?: {
          id?: string;
          name?: string;
          isFemale?: boolean;
          voicePresetId?: string;
        };
      };
      const dialogue = typeof body.dialogue === 'string' ? body.dialogue.trim() : '';
      if (!dialogue) {
        res.status(400).json({ error: 'Scene dialogue is required for TTS synthesis.' });
        return;
      }
      const ai = getGeminiClient();
      const tts = await synthesizeSceneTtsWav(ai, {
        dialogue,
        language: body.language || 'hi-IN',
        emotion: body.emotion || 'CALM',
        actor: {
          id: body.actor?.id || 'actor-1',
          name: body.actor?.name || 'Narrator',
          isFemale: Boolean(body.actor?.isFemale),
          voicePresetId: body.actor?.voicePresetId,
        },
      });
      res.json(tts);
    } catch (err) {
      const status = getHttpStatusFromError(err);
      const message = extractReadableErrorMessage(err);
      res.status(status).json({ error: message });
    }
  });

  app.post('/api/render/start', (req, res) => {
    try {
      cleanupExpiredRenderJobs();
      const body = (req.body ?? {}) as {
        width?: number;
        height?: number;
        fps?: number;
        overlayEnabled?: boolean;
        captionEnabled?: boolean;
        scenes?: RenderSceneInput[];
      };

      const width = Math.max(2, Math.round(Number(body.width) || 720));
      const height = Math.max(2, Math.round(Number(body.height) || 960));
      const fps = Math.max(15, Math.min(60, Math.round(Number(body.fps) || 30)));
      const scenes = Array.isArray(body.scenes) ? body.scenes : [];
      if (scenes.length === 0) {
        res.status(400).json({ error: 'At least one scene is required to start MP4 render.' });
        return;
      }

      const jobId = `job-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
      const dir = path.join('/tmp', 'bharat-render-jobs', jobId);
      fs.mkdirSync(path.join(dir, 'frames'), { recursive: true });
      scenes.forEach((_, idx) => {
        fs.mkdirSync(path.join(dir, 'frames', `scene_${idx}`), { recursive: true });
      });

      const meta: RenderJobMeta = {
        jobId,
        dir,
        createdAt: Date.now(),
        width: width % 2 === 0 ? width : width + 1,
        height: height % 2 === 0 ? height : height + 1,
        fps,
        overlayEnabled: body.overlayEnabled !== false,
        captionEnabled: body.captionEnabled !== false,
        scenes,
      };
      RENDER_JOBS.set(jobId, meta);
      res.json({ jobId });
    } catch (err) {
      res.status(500).json({
        error: err instanceof Error ? err.message : 'Unable to initialize render job.',
      });
    }
  });

  app.post('/api/render/:jobId/scene-frames', (req, res) => {
    try {
      const job = RENDER_JOBS.get(req.params.jobId);
      if (!job) {
        res.status(404).json({ error: 'Render job not found or expired.' });
        return;
      }
      const body = (req.body ?? {}) as {
        sceneIndex?: number;
        startFrame?: number;
        frames?: string[];
      };
      const sceneIndex = Number(body.sceneIndex ?? -1);
      const startFrame = Math.max(0, Number(body.startFrame ?? 0));
      const frames = Array.isArray(body.frames) ? body.frames : [];
      if (sceneIndex < 0 || sceneIndex >= job.scenes.length) {
        res.status(400).json({ error: 'Invalid sceneIndex for frame upload.' });
        return;
      }
      const sceneDir = path.join(job.dir, 'frames', `scene_${sceneIndex}`);
      fs.mkdirSync(sceneDir, { recursive: true });

      frames.forEach((b64, offset) => {
        const clean = b64.includes(',') ? b64.slice(b64.indexOf(',') + 1) : b64;
        const idx = startFrame + offset;
        const fileName = `frame_${String(idx).padStart(6, '0')}.jpg`;
        fs.writeFileSync(path.join(sceneDir, fileName), Buffer.from(clean, 'base64'));
      });

      res.json({ saved: frames.length });
    } catch (err) {
      res.status(500).json({
        error: err instanceof Error ? err.message : 'Failed to save render frames.',
      });
    }
  });

  app.post('/api/render/:jobId/finalize', async (req, res) => {
    try {
      const job = RENDER_JOBS.get(req.params.jobId);
      if (!job) {
        res.status(404).json({ error: 'Render job not found or expired.' });
        return;
      }
      const { qa } = await finalizeMp4RenderJob(job);
      res.json({
        videoUrl: `/api/render/${job.jobId}/video.mp4`,
        mimeType: 'video/mp4',
        qa,
      });
    } catch (err) {
      res.status(500).json({
        error: err instanceof Error ? err.message : 'FFmpeg MP4 encoding failed.',
      });
    }
  });

  app.get('/api/render/:jobId/video.mp4', (req, res) => {
    const job = RENDER_JOBS.get(req.params.jobId);
    if (!job || !job.finalMp4Path || !fs.existsSync(job.finalMp4Path)) {
      res.status(404).json({ error: 'Rendered MP4 file not found.' });
      return;
    }
    const stat = fs.statSync(job.finalMp4Path);
    const total = stat.size;
    const range = req.headers.range;
    res.setHeader('Content-Type', 'video/mp4');
    res.setHeader('Accept-Ranges', 'bytes');

    if (req.query.download === '1') {
      res.setHeader(
        'Content-Disposition',
        `attachment; filename="BharatAI_Reel_${job.width}x${job.height}.mp4"`
      );
    }

    if (range) {
      const parts = range.replace(/bytes=/, '').split('-');
      const start = parseInt(parts[0], 10);
      const end = parts[1] ? parseInt(parts[1], 10) : total - 1;
      const chunkSize = end - start + 1;
      res.status(206);
      res.setHeader('Content-Range', `bytes ${start}-${end}/${total}`);
      res.setHeader('Content-Length', String(chunkSize));
      fs.createReadStream(job.finalMp4Path, { start, end }).pipe(res);
    } else {
      res.setHeader('Content-Length', String(total));
      fs.createReadStream(job.finalMp4Path).pipe(res);
    }
  });

  app.all('/api/*', (_req, res) => {
    res.status(404).json({ error: 'API route not found.' });
  });

  if (!IS_PROD) {
    const { createServer: createViteServer } = await import('vite');
    const vite = await createViteServer({
      server: {
        middlewareMode: true,
        allowedHosts: true,
        hmr: process.env.DISABLE_HMR !== 'true',
      },
      appType: 'spa',
    });
    app.use(vite.middlewares);
  } else {
    const distDir = path.resolve(ROOT_DIR, 'dist');
    app.use(express.static(distDir));
    app.get('*', (_req, res) => {
      const indexFile = path.join(distDir, 'index.html');
      if (fs.existsSync(indexFile)) {
        res.sendFile(indexFile);
      } else {
        res.status(500).send('Production build missing. Run npm run build first.');
      }
    });
  }

  app.listen(PORT, '0.0.0.0', () => {
    console.log(`Bharat-AI Pocket Engine server listening on http://0.0.0.0:${PORT}`);
  });
}

void startServer();
