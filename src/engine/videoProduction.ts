import {
  CameraMotionSpec,
  CaptionCue,
  DirectedScene,
  OverlayTemplateConfig,
} from './types';

export const FADE_TRANSITION_SEC = 0.4;
export const MAX_KEN_BURNS_ZOOM = 1.15;

export function createDefaultOverlayConfig(): OverlayTemplateConfig {
  return {
    enabled: true,
    brandText: 'BHARAT AI',
    stripText: 'POCKET STUDIO',
    showNamePill: true,
  };
}

/**
 * Video-2 target bitrate formula (Part 3.2):
 * video_bitrate = 0.10 * width * height * fps
 */
export function computeTargetVideoBitrateBps(
  width: number,
  height: number,
  fps = 30
): number {
  return Math.round(0.1 * Math.max(2, width) * Math.max(2, height) * Math.max(1, fps));
}

/**
 * Video-2 file size estimate formula (Part 3.2):
 * size_mb = (video_bps + audio_bps) * seconds / 8 / 1,000,000
 */
export function estimateOutputSizeMb(
  videoBps: number,
  audioBps: number,
  seconds: number
): number {
  return Number((((videoBps + audioBps) * Math.max(0.5, seconds)) / 8 / 1_000_000).toFixed(2));
}

/**
 * Shot pacing helper (Part 3.3 / 3.4):
 * clamp(narration_seconds + 0.4, 1.5, 10.0)
 */
export function computeSceneDurationMsFromNarration(narrationSeconds: number): number {
  const clampedSec = Math.min(10.0, Math.max(1.5, narrationSeconds + 0.4));
  return Math.round(clampedSec * 1000);
}

/**
 * Camera Ken Burns + non-repeating handheld sway spec (Part 3.6).
 * Over-zoom cap: strictly <= 1.15.
 */
export function computeDefaultCameraMotion(sceneIdx: number): CameraMotionSpec {
  const zoomMax = Math.min(MAX_KEN_BURNS_ZOOM, 1.1 + (sceneIdx % 3) * 0.02);
  const swayX = 0.0055 + (sceneIdx % 3) * 0.0012;
  const swayY = 0.0035 + ((sceneIdx + 1) % 3) * 0.001;
  const freqX = 0.36 + (sceneIdx % 4) * 0.09;
  const freqY = 0.51 + ((sceneIdx + 2) % 4) * 0.11;
  return {
    zoomMax: Number(zoomMax.toFixed(3)),
    swayX: Number(swayX.toFixed(4)),
    swayY: Number(swayY.toFixed(4)),
    freqX: Number(freqX.toFixed(2)),
    freqY: Number(freqY.toFixed(2)),
  };
}

/**
 * Evaluates instantaneous Ken Burns push-in + handheld sway at progress in [0, 1] and timeSec.
 */
export function evaluateCameraMotionAtFrame(
  motion: CameraMotionSpec | undefined,
  progress: number,
  timeSec: number,
  zoomStart = 1.0,
  zoomEnd = 1.12
): { zoom: number; offsetXNorm: number; offsetYNorm: number } {
  const safeProgress = Math.min(1, Math.max(0, progress));
  const zTarget = Math.min(
    MAX_KEN_BURNS_ZOOM,
    Math.max(1.02, motion?.zoomMax ?? Math.max(zoomStart, zoomEnd, 1.12))
  );
  const zStart = Math.min(MAX_KEN_BURNS_ZOOM, Math.max(1.0, zoomStart));
  const zoom = zStart + (zTarget - zStart) * safeProgress;

  const ax = motion?.swayX ?? 0.0065;
  const ay = motion?.swayY ?? 0.0045;
  const fx = motion?.freqX ?? 0.42;
  const fy = motion?.freqY ?? 0.67;

  return {
    zoom: Math.min(MAX_KEN_BURNS_ZOOM, zoom),
    offsetXNorm: ax * Math.sin(2 * Math.PI * fx * timeSec),
    offsetYNorm: ay * Math.sin(2 * Math.PI * fy * timeSec),
  };
}

/**
 * Wraps a caption chunk into max 2 lines of <= maxCharsPerLine characters (Part 3.5).
 */
function wrapChunkTwoLines(text: string, maxCharsPerLine = 32): string[] {
  const words = text.trim().split(/\s+/).filter(Boolean);
  if (words.length === 0) return [];
  const lines: string[] = [''];

  for (const word of words) {
    const curIdx = lines.length - 1;
    const candidate = lines[curIdx] ? `${lines[curIdx]} ${word}` : word;
    if (candidate.length <= maxCharsPerLine) {
      lines[curIdx] = candidate;
    } else if (lines.length < 2) {
      lines.push(word.slice(0, maxCharsPerLine));
    } else {
      lines[1] = `${lines[1]} ${word}`.slice(0, maxCharsPerLine);
    }
  }
  return lines.filter(Boolean);
}

/**
 * Speech-timed caption slicer (Part 3.5):
 * - Max 2 lines, ~32 chars per line (max 64 chars total per cue)
 * - Reading speed >= 1.2 s or chars / 15 s, proportional to narration duration
 */
export function buildTimedCaptionCues(
  text: string,
  durationMs: number,
  maxCharsPerLine = 32
): CaptionCue[] {
  const clean = text.replace(/\s+/g, ' ').trim();
  const totalSec = Math.max(1.5, durationMs / 1000);
  if (!clean) return [];

  const maxCueChars = maxCharsPerLine * 2;
  const words = clean.split(' ');
  const chunks: string[] = [];
  let buf = '';

  for (const w of words) {
    const candidate = buf ? `${buf} ${w}` : w;
    if (candidate.length <= maxCueChars) {
      buf = candidate;
    } else {
      if (buf) chunks.push(buf);
      buf = w.length > maxCueChars ? w.slice(0, maxCueChars) : w;
    }
  }
  if (buf) chunks.push(buf);
  if (chunks.length === 0) return [];

  const rawWeights = chunks.map((c) => Math.max(1.2, c.length / 15));
  const weightSum = rawWeights.reduce((a, b) => a + b, 0) || 1;
  const cues: CaptionCue[] = [];
  let cursor = 0;

  chunks.forEach((chunk, idx) => {
    const sliceDur =
      idx === chunks.length - 1
        ? Math.max(0.4, totalSec - cursor)
        : (rawWeights[idx] / weightSum) * totalSec;
    const startSec = Number(cursor.toFixed(3));
    const endSec = Number(Math.min(totalSec, cursor + sliceDur).toFixed(3));
    const lines = wrapChunkTwoLines(chunk, maxCharsPerLine);
    cues.push({
      startSec,
      endSec,
      lines,
      text: lines.join('\n'),
    });
    cursor += sliceDur;
  });

  return cues;
}

export function getActiveCaptionCueLines(
  scene: Pick<DirectedScene, 'captionText' | 'dialogue' | 'captionCues' | 'durationMs'>,
  progress: number
): string[] {
  const text = (scene.captionText ?? '').trim() || scene.dialogue.trim();
  if (!text) return [];
  const cues =
    scene.captionCues && scene.captionCues.length > 0
      ? scene.captionCues
      : buildTimedCaptionCues(text, scene.durationMs);
  if (cues.length === 0) return [];
  const tSec = Math.max(0, Math.min(1, progress)) * (scene.durationMs / 1000);
  const found = cues.find((c) => tSec >= c.startSec && tSec <= c.endSec);
  return (found ?? cues[cues.length - 1]).lines;
}

/**
 * Computes effective timeline duration accounting for 0.4s crossfades (Part 3.7):
 * total = sum(shot_lengths) - sum(crossfade_durations)
 */
export function computeEffectiveTimelineSeconds(scenes: DirectedScene[]): number {
  if (scenes.length === 0) return 0;
  let total = 0;
  scenes.forEach((scene, idx) => {
    const dur = Math.max(1.5, scene.durationMs / 1000);
    total += dur;
    if (idx > 0 && scene.transitionIn === 'fade') {
      total -= Math.min(FADE_TRANSITION_SEC, dur * 0.4);
    }
  });
  return Number(Math.max(0, total).toFixed(2));
}
