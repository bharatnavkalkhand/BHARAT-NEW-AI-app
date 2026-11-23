import {
  ActorProfile,
  DEFAULT_STORY_ENGLISH,
  DEFAULT_STORY_HINDI,
  DirectedScene,
  DressStyle,
  EmotionMood,
  EnvBiome,
  GestureAction,
  PoseSide,
  SceneTransition,
  VoiceLang,
  WalkingDestination,
} from './types';
import {
  buildTimedCaptionCues,
  computeDefaultCameraMotion,
  MAX_KEN_BURNS_ZOOM,
} from './videoProduction';

const YEAR_OR_DATE_REGEX =
  /(\b\d{4}\b|\d{1,2}\s+(?:January|February|March|April|May|June|July|August|September|October|November|December|जनवरी|फरवरी|मार्च|अप्रैल|मई|जून|जुलाई|अगस्त|सितंबर|अक्टूबर|नवंबर|दिसंबर))/i;

/**
 * Generates smoothed 30 FPS phoneme-aware lip-sync amplitude and viseme mouth-width
 * curves from Hindi/English dialogue text.
 */
export function buildSyllableLipSyncEnvelope(
  dialogue: string,
  durationMs: number,
  speechRate: number
): { envelope: number[]; visemeWidths: number[]; effectiveDurationMs: number } {
  const words = dialogue.trim().split(/\s+/).filter(Boolean);
  const estMs = Math.max(
    2400,
    Math.min(7800, Math.round((dialogue.length * 68) / Math.max(0.65, speechRate)) + 450)
  );
  const finalDurationMs = durationMs > 0 ? durationMs : estMs;
  const totalFrames = Math.max(30, Math.round((finalDurationMs * 30) / 1000));
  const pauseFrames = 10;
  const activeFrames = Math.max(12, totalFrames - pauseFrames);

  const rawAmp: number[] = new Array(totalFrames).fill(0);
  const rawWidth: number[] = new Array(totalFrames).fill(0.95);
  const chars = dialogue.replace(/\s+/g, ' ').split('');

  for (let f = 0; f < activeFrames; f++) {
    const tNorm = f / activeFrames;
    const charIdx = Math.min(chars.length - 1, Math.floor(tNorm * chars.length));
    const ch = chars[charIdx] || ' ';

    if (ch === ' ' || ch === ',' || ch === '।' || ch === '.') {
      rawAmp[f] = 0.06;
      rawWidth[f] = 0.9;
      continue;
    }

    // Bilabial consonants (lips press briefly closed: p, b, m, प, फ, ब, भ, म)
    if (/[pbmपफबभम]/i.test(ch)) {
      rawAmp[f] = 0.08;
      rawWidth[f] = 1.02;
      continue;
    }

    // Rounded vowels (o, u, ओ, औ, उ, ऊ, ो, ौ, ु, ू) -> narrower rounded O-shape
    if (/[ouओऔउऊोौुू]/i.test(ch)) {
      const wave = 0.55 + 0.4 * Math.abs(Math.sin(f * 0.58 + words.length * 0.2));
      rawAmp[f] = Math.min(0.95, 0.72 * wave);
      rawWidth[f] = 0.66;
      continue;
    }

    // Open / spread vowels (a, e, i, आ, अ, ए, ऐ, इ, ई, ा, े, ै, ि, ी)
    const isWideVowel = /[aeiआअएऐइईाेैिी]/i.test(ch);
    const syllableWave = 0.5 + 0.45 * Math.abs(Math.sin(f * 0.62 + words.length * 0.3));
    rawAmp[f] = Math.min(1, Math.max(0.16, (isWideVowel ? 0.9 : 0.58) * syllableWave));
    rawWidth[f] = isWideVowel ? 1.16 : 0.94;
  }

  // Temporal 3-tap smoothing for natural muscle inertia
  const envelope = rawAmp.map((v, i) => {
    const prev = rawAmp[Math.max(0, i - 1)];
    const next = rawAmp[Math.min(rawAmp.length - 1, i + 1)];
    return Number((prev * 0.25 + v * 0.5 + next * 0.25).toFixed(3));
  });

  const visemeWidths = rawWidth.map((v, i) => {
    const prev = rawWidth[Math.max(0, i - 1)];
    const next = rawWidth[Math.min(rawWidth.length - 1, i + 1)];
    return Number((prev * 0.25 + v * 0.5 + next * 0.25).toFixed(3));
  });

  return { envelope, visemeWidths, effectiveDurationMs: finalDurationMs };
}

export function directStoryLocally(
  rawIdea: string,
  language: VoiceLang,
  actors: ActorProfile[],
  directorInstruction = ''
): DirectedScene[] {
  if (actors.length === 0) return [];

  const clean =
    rawIdea.trim() ||
    (language === VoiceLang.HINDI ? DEFAULT_STORY_HINDI : DEFAULT_STORY_ENGLISH);
  const instructionHint = directorInstruction.trim();

  const sentences = clean
    .split(/[।.!?\n]+/)
    .map((s) => s.trim())
    .filter((s) => s.length > 2);

  const rawLines = sentences.length > 0 ? sentences : [clean];
  const mapped: DirectedScene[] = [];

  rawLines.slice(0, 12).forEach((line, idx) => {
    const combinedHint = instructionHint ? `${line} ${instructionHint}` : line;
    const actor = matchActorInLine(line, actors, idx);
    const biome = detectBiome(instructionHint ? `${instructionHint} ${line}` : line);
    const emotion = detectEmotion(combinedHint);
    const gesture = detectGesture(combinedHint, emotion, idx);
    const locationTitle = detectLocationTitle(line, biome, language);
    const hookMatch = YEAR_OR_DATE_REGEX.exec(line);
    const hookBanner = hookMatch ? hookMatch[0].toUpperCase() : '';
    const cameraMotion = computeDefaultCameraMotion(idx);
    const prev = mapped[idx - 1];
    const transitionIn: SceneTransition =
      idx > 0 && prev && (prev.biome !== biome || prev.locationTitle !== locationTitle)
        ? 'fade'
        : 'cut';

    const { envelope, visemeWidths, effectiveDurationMs } = buildSyllableLipSyncEnvelope(
      line,
      0,
      actor.speechRate
    );
    const captionCues = buildTimedCaptionCues(line, effectiveDurationMs);

    const isWalkingShot = gesture === GestureAction.WALKING;
    const autoPoseSide: PoseSide = isWalkingShot
      ? idx % 2 === 0
        ? 'right'
        : 'left'
      : 'front';
    const walkingDestination: WalkingDestination | undefined = isWalkingShot
      ? {
          startXNorm: autoPoseSide === 'right' ? -0.26 : 0.26,
          targetXNorm: autoPoseSide === 'right' ? 0.26 : -0.26,
          label: locationTitle,
        }
      : undefined;

    mapped.push({
      id: `scene-${idx + 1}-${Math.random().toString(36).slice(2, 7)}`,
      index: idx + 1,
      locationTitle,
      hookBanner,
      dialogue: line,
      captionText: line,
      captionPosition: 'bottom',
      captionScale: 1.0,
      captionCues,
      actorId: actor.id,
      biome,
      gesture,
      emotion,
      poseMode: isWalkingShot
        ? autoPoseSide === 'right'
          ? 'SIDE_RIGHT'
          : 'SIDE_LEFT'
        : 'AUTO',
      poseSide: isWalkingShot ? autoPoseSide : undefined,
      walkingDestination,
      transitionIn,
      cameraMotion,
      cameraZoomStart: 1.0,
      cameraZoomEnd: Math.min(MAX_KEN_BURNS_ZOOM, cameraMotion.zoomMax),
      cameraPanRange: idx % 3 === 0 ? 0.08 : -0.08,
      durationMs: effectiveDurationMs,
      lipSyncEnvelope: envelope,
      visemeWidths,
    });
  });

  return mapped;
}

interface AiDirectorScenePayload {
  actorId: string;
  biome: number;
  gesture: string;
  emotion: string;
  dressOverride?: string;
  transitionIn?: string;
  locationTitle: string;
  hookBanner: string;
  dialogue: string;
  captionText: string;
  cameraZoomStart: number;
  cameraZoomEnd: number;
  cameraPanRange: number;
  directorNote: string;
}

export async function requestAiDirectedScenes(options: {
  idea: string;
  language: VoiceLang;
  directorInstruction?: string;
  cast: ActorProfile[];
}): Promise<DirectedScene[]> {
  const res = await fetch('/api/director/plan', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      idea: options.idea,
      language: options.language,
      directorInstruction: options.directorInstruction ?? '',
      cast: options.cast.map((a) => ({
        id: a.id,
        name: a.name,
        isFemale: a.isFemale,
        dressStyle: a.dressStyle,
        voicePresetId: a.voicePresetId,
      })),
    }),
  });

  const rawText = await res.text();
  let data: {
    scenes?: AiDirectorScenePayload[];
    error?: string;
  } | null = null;

  try {
    data = JSON.parse(rawText) as {
      scenes?: AiDirectorScenePayload[];
      error?: string;
    };
  } catch {
    const looksLikeHtml = /^\s*</.test(rawText);
    if (looksLikeHtml) {
      throw new Error(
        'AI Director endpoint is unavailable on this host (received HTML instead of JSON). Click Quick Direct for instant on-device scene directing.'
      );
    }
    throw new Error(`AI Director returned an unexpected response (${res.status}).`);
  }

  if (!res.ok) {
    if (res.status === 503) {
      throw new Error(
        data?.error
          ? `${data.error} Click Quick Direct for instant on-device directing.`
          : 'AI Director is temporarily busy. Retry shortly or click Quick Direct.'
      );
    }
    throw new Error(data?.error || `AI Director request failed (${res.status})`);
  }

  const rawScenes = Array.isArray(data?.scenes) ? data.scenes : [];
  if (rawScenes.length === 0) {
    throw new Error('AI Director returned no scenes.');
  }

  const directed: DirectedScene[] = [];
  rawScenes.forEach((item, idx) => {
    const actor =
      options.cast.find((a) => a.id === item.actorId) ??
      options.cast[idx % options.cast.length];
    const { envelope, visemeWidths, effectiveDurationMs } = buildSyllableLipSyncEnvelope(
      item.dialogue,
      0,
      actor?.speechRate ?? 0.95
    );

    const gestureValues = new Set(Object.values(GestureAction));
    const emotionValues = new Set(Object.values(EmotionMood));
    const dressValues = new Set(Object.values(DressStyle));
    const biome = (item.biome >= 0 && item.biome <= 7 ? item.biome : 0) as EnvBiome;
    const locationTitle = item.locationTitle || 'CINEMA STAGE';
    const prev = directed[idx - 1];
    const transitionIn: SceneTransition =
      item.transitionIn === 'fade' ||
      (idx > 0 && prev && (prev.biome !== biome || prev.locationTitle !== locationTitle))
        ? 'fade'
        : 'cut';

    const cameraMotion = computeDefaultCameraMotion(idx);
    const zoomEnd = Math.min(
      MAX_KEN_BURNS_ZOOM,
      Math.max(1.06, Number(item.cameraZoomEnd) || cameraMotion.zoomMax)
    );
    cameraMotion.zoomMax = zoomEnd;
    const captionText = item.captionText || item.dialogue;

    const resolvedGesture = gestureValues.has(item.gesture as GestureAction)
      ? (item.gesture as GestureAction)
      : GestureAction.TALK_WAVE;
    const isWalkingShot = resolvedGesture === GestureAction.WALKING;
    const autoPoseSide: PoseSide = isWalkingShot
      ? idx % 2 === 0
        ? 'right'
        : 'left'
      : 'front';
    const walkingDestination: WalkingDestination | undefined = isWalkingShot
      ? {
          startXNorm: autoPoseSide === 'right' ? -0.26 : 0.26,
          targetXNorm: autoPoseSide === 'right' ? 0.26 : -0.26,
          label: locationTitle,
        }
      : undefined;

    directed.push({
      id: `scene-ai-${idx + 1}-${Math.random().toString(36).slice(2, 7)}`,
      index: idx + 1,
      locationTitle,
      hookBanner: item.hookBanner || '',
      dialogue: item.dialogue,
      captionText,
      captionPosition: 'bottom',
      captionScale: 1.0,
      captionCues: buildTimedCaptionCues(captionText, effectiveDurationMs),
      directorNote: item.directorNote,
      actorId: actor?.id ?? item.actorId,
      biome,
      gesture: resolvedGesture,
      emotion: emotionValues.has(item.emotion as EmotionMood)
        ? (item.emotion as EmotionMood)
        : EmotionMood.CALM,
      dressOverride:
        item.dressOverride && dressValues.has(item.dressOverride as DressStyle)
          ? (item.dressOverride as DressStyle)
          : undefined,
      poseMode: isWalkingShot
        ? autoPoseSide === 'right'
          ? 'SIDE_RIGHT'
          : 'SIDE_LEFT'
        : 'AUTO',
      poseSide: isWalkingShot ? autoPoseSide : undefined,
      walkingDestination,
      transitionIn,
      cameraMotion,
      cameraZoomStart: 1.0,
      cameraZoomEnd: zoomEnd,
      cameraPanRange: item.cameraPanRange ?? 0.08,
      durationMs: effectiveDurationMs,
      lipSyncEnvelope: envelope,
      visemeWidths,
    });
  });
  return directed;
}

export async function requestSceneTtsSynthesis(options: {
  dialogue: string;
  language: VoiceLang;
  actor: ActorProfile;
  emotion: EmotionMood;
}): Promise<{
  audioBase64: string;
  mimeType: string;
  narrationSeconds: number;
  voiceName: string;
}> {
  const res = await fetch('/api/tts/scene', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      dialogue: options.dialogue,
      language: options.language,
      emotion: options.emotion,
      actor: {
        id: options.actor.id,
        name: options.actor.name,
        isFemale: options.actor.isFemale,
        voicePresetId: options.actor.voicePresetId,
      },
    }),
  });

  const rawText = await res.text();
  let data: {
    audioBase64?: string;
    mimeType?: string;
    narrationSeconds?: number;
    voiceName?: string;
    error?: string;
  } | null = null;

  try {
    data = JSON.parse(rawText);
  } catch {
    throw new Error(`TTS endpoint returned unexpected response (${res.status}).`);
  }

  if (!res.ok || !data?.audioBase64) {
    throw new Error(data?.error || `TTS synthesis failed (${res.status}).`);
  }

  return {
    audioBase64: data.audioBase64,
    mimeType: data.mimeType || 'audio/wav',
    narrationSeconds: Number(data.narrationSeconds) || 3.5,
    voiceName: data.voiceName || 'Kore',
  };
}

function matchActorInLine(
  line: string,
  actors: ActorProfile[],
  idx: number
): ActorProfile {
  const lower = line.toLowerCase();
  const explicit = actors.find((a) => lower.includes(a.name.toLowerCase()));
  return explicit ?? actors[idx % actors.length];
}

function detectBiome(text: string): EnvBiome {
  const l = text.toLowerCase();
  if (
    l.includes('fire') ||
    l.includes('diwali') ||
    l.includes('blast') ||
    l.includes('ember') ||
    text.includes('आग') ||
    text.includes('चिंगार') ||
    text.includes('पटाख')
  ) {
    return EnvBiome.FIRE_BATTLE;
  }
  if (
    l.includes('rain') ||
    l.includes('storm') ||
    l.includes('thunder') ||
    l.includes('monsoon') ||
    text.includes('बारिश') ||
    text.includes('तूफान')
  ) {
    return EnvBiome.MONSOON_RAIN;
  }
  if (
    l.includes('desert') ||
    l.includes('jaisalmer') ||
    l.includes('border') ||
    l.includes('sand') ||
    text.includes('जैसलमेर') ||
    text.includes('रेगिस्तान') ||
    text.includes('आंधी')
  ) {
    return EnvBiome.DESERT_MYSTERY;
  }
  if (
    l.includes('river') ||
    l.includes('water') ||
    l.includes('ganga') ||
    text.includes('नदी') ||
    text.includes('झरना') ||
    text.includes('पानी')
  ) {
    return EnvBiome.SACRED_RIVER;
  }
  if (
    l.includes('palace') ||
    l.includes('fort') ||
    l.includes('royal') ||
    l.includes('temple') ||
    text.includes('महल') ||
    text.includes('किला') ||
    text.includes('दरबार')
  ) {
    return EnvBiome.ROYAL_PALACE;
  }
  if (
    l.includes('cyber') ||
    l.includes('neon') ||
    l.includes('city') ||
    l.includes('future') ||
    text.includes('शहर') ||
    text.includes('भविष्य')
  ) {
    return EnvBiome.CYBER_CITY;
  }
  if (
    l.includes('studio') ||
    l.includes('news') ||
    l.includes('podcast') ||
    text.includes('स्टूडियो')
  ) {
    return EnvBiome.STUDIO_CYCLORAMA;
  }
  return EnvBiome.AVATAR_NIGHT;
}

function detectEmotion(text: string): EmotionMood {
  const l = text.toLowerCase();
  if (
    l.includes('!') ||
    l.includes('danger') ||
    l.includes('attack') ||
    l.includes('fire') ||
    text.includes('खतरा') ||
    text.includes('आग')
  ) {
    return EmotionMood.INTENSE;
  }
  if (
    l.includes('protect') ||
    l.includes('rise') ||
    l.includes('warrior') ||
    text.includes('रक्षा') ||
    text.includes('योद्धा')
  ) {
    return EmotionMood.HEROIC;
  }
  if (
    l.includes('secret') ||
    l.includes('mystery') ||
    l.includes('sudden') ||
    text.includes('रहस्य') ||
    text.includes('अचानक')
  ) {
    return EmotionMood.MYSTERIOUS;
  }
  return EmotionMood.CALM;
}

function detectGesture(
  text: string,
  mood: EmotionMood,
  idx: number
): GestureAction {
  const l = text.toLowerCase();
  if (
    l.includes('walk') ||
    l.includes('go') ||
    text.includes('चल') ||
    text.includes('आगे')
  ) {
    return GestureAction.WALKING;
  }
  if (mood === EmotionMood.HEROIC) return GestureAction.HERO_RAISE;
  if (mood === EmotionMood.INTENSE || l.includes('look') || text.includes('देख')) {
    return GestureAction.POINTING;
  }
  if (mood === EmotionMood.MYSTERIOUS && idx % 2 === 1) {
    return GestureAction.THINKING;
  }
  return GestureAction.TALK_WAVE;
}

function detectLocationTitle(
  text: string,
  biome: EnvBiome,
  lang: VoiceLang
): string {
  const l = text.toLowerCase();
  if (l.includes('jaisalmer') || text.includes('जैसलमेर')) return 'JAISALMER BORDER';
  if (l.includes('himalaya') || text.includes('हिमालय')) return 'HIMALAYAN PEAKS';
  if (l.includes('forest') || text.includes('जंगल')) return 'BIOLUMINESCENT FOREST';

  switch (biome) {
    case EnvBiome.FIRE_BATTLE:
      return lang === VoiceLang.HINDI ? 'अग्नि क्षेत्र' : 'EMBER ZONE';
    case EnvBiome.MONSOON_RAIN:
      return lang === VoiceLang.HINDI ? 'तूफानी घाटी' : 'STORM VALLEY';
    case EnvBiome.SACRED_RIVER:
      return lang === VoiceLang.HINDI ? 'पवित्र नदी' : 'SACRED RIVER';
    case EnvBiome.DESERT_MYSTERY:
      return lang === VoiceLang.HINDI ? 'सीमा क्षेत्र' : 'FRONTIER OUTPOST';
    case EnvBiome.ROYAL_PALACE:
      return lang === VoiceLang.HINDI ? 'शाही दरबार' : 'ROYAL PALACE';
    case EnvBiome.CYBER_CITY:
      return lang === VoiceLang.HINDI ? 'नियॉन महानगर' : 'CYBER SKYLINE';
    case EnvBiome.STUDIO_CYCLORAMA:
      return lang === VoiceLang.HINDI ? 'सिनेमा स्टूडियो' : 'CREATOR STUDIO';
    default:
      return lang === VoiceLang.HINDI ? 'रहस्यमयी लोक' : 'MYSTIC REALM';
  }
}
