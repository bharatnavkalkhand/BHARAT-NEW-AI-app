export enum AspectFormat {
  PORTRAIT_3_4 = 'PORTRAIT_3_4',
  REEL_9_16 = 'REEL_9_16',
  CINEMA_16_9 = 'CINEMA_16_9',
}

export const ASPECT_CONFIG: Record<
  AspectFormat,
  { label: string; shortLabel: string; width: number; height: number }
> = {
  [AspectFormat.PORTRAIT_3_4]: {
    label: '3:4 Vertical Feed (720×960)',
    shortLabel: '3:4 Feed',
    width: 720,
    height: 960,
  },
  [AspectFormat.REEL_9_16]: {
    label: '9:16 Reels / Shorts (720×1280)',
    shortLabel: '9:16 Reels',
    width: 720,
    height: 1280,
  },
  [AspectFormat.CINEMA_16_9]: {
    label: '16:9 Cinema (1280×720)',
    shortLabel: '16:9 Cinema',
    width: 1280,
    height: 720,
  },
};

export enum CameraFraming {
  CLOSE_UP = 'CLOSE_UP',
  PRESENTER = 'PRESENTER',
  FULL_BODY = 'FULL_BODY',
}

export const FRAMING_LABELS: Record<CameraFraming, string> = {
  [CameraFraming.CLOSE_UP]: 'Close-Up',
  [CameraFraming.PRESENTER]: 'Waist-Up',
  [CameraFraming.FULL_BODY]: 'Full Body',
};

export enum VoiceLang {
  HINDI = 'hi-IN',
  ENGLISH = 'en-IN',
}

export const VOICE_LANG_LABELS: Record<VoiceLang, string> = {
  [VoiceLang.HINDI]: 'Hindi (हिन्दी)',
  [VoiceLang.ENGLISH]: 'English (India)',
};

export enum EnvBiome {
  AVATAR_NIGHT = 0,
  FIRE_BATTLE = 1,
  MONSOON_RAIN = 2,
  DESERT_MYSTERY = 3,
  SACRED_RIVER = 4,
  ROYAL_PALACE = 5,
  CYBER_CITY = 6,
  STUDIO_CYCLORAMA = 7,
}

export const BIOME_LABELS: Record<EnvBiome, string> = {
  [EnvBiome.AVATAR_NIGHT]: 'Avatar Mystic Glow',
  [EnvBiome.FIRE_BATTLE]: 'Fire & Embers',
  [EnvBiome.MONSOON_RAIN]: 'Monsoon Storm',
  [EnvBiome.DESERT_MYSTERY]: 'Jaisalmer / Desert',
  [EnvBiome.SACRED_RIVER]: 'Himalayan River',
  [EnvBiome.ROYAL_PALACE]: 'Royal Palace Courtyard',
  [EnvBiome.CYBER_CITY]: 'Cyber Neon Skyline',
  [EnvBiome.STUDIO_CYCLORAMA]: 'Clean Studio Cyclorama',
};

export interface VoiceProfilePreset {
  id: string;
  label: string;
  pitch: number;
  speechRate: number;
  isFemale: boolean;
  defaultActorId?: string;
}

export const VOICE_PROFILES: VoiceProfilePreset[] = [
  {
    id: 'arjun-heroic',
    label: 'Arjun · Heroic Baritone',
    pitch: 0.9,
    speechRate: 0.94,
    isFemale: false,
    defaultActorId: 'actor-arjun',
  },
  {
    id: 'meera-expressive',
    label: 'Meera · Expressive Alto',
    pitch: 1.2,
    speechRate: 0.96,
    isFemale: true,
    defaultActorId: 'actor-meera',
  },
  {
    id: 'vikram-narrator',
    label: 'Vikram · Deep Narrator',
    pitch: 0.84,
    speechRate: 0.92,
    isFemale: false,
    defaultActorId: 'actor-vikram',
  },
  {
    id: 'warm-storyteller',
    label: 'Kavya · Warm Storyteller',
    pitch: 1.12,
    speechRate: 0.95,
    isFemale: true,
  },
  {
    id: 'studio-crisp',
    label: 'Studio · Crisp Anchor',
    pitch: 1.0,
    speechRate: 1.02,
    isFemale: false,
  },
];

export enum GestureAction {
  TALK_WAVE = 'TALK_WAVE',
  HERO_RAISE = 'HERO_RAISE',
  POINTING = 'POINTING',
  WALKING = 'WALKING',
  THINKING = 'THINKING',
}

export const GESTURE_LABELS: Record<GestureAction, string> = {
  [GestureAction.TALK_WAVE]: 'Explaining / Hand Gesture',
  [GestureAction.HERO_RAISE]: 'Heroic Raise',
  [GestureAction.POINTING]: 'Pointing Forward',
  [GestureAction.WALKING]: 'Walking Path (A → B)',
  [GestureAction.THINKING]: 'Calm / Contemplating',
};

export enum EmotionMood {
  CALM = 'CALM',
  HEROIC = 'HEROIC',
  INTENSE = 'INTENSE',
  MYSTERIOUS = 'MYSTERIOUS',
}

export const EMOTION_LABELS: Record<EmotionMood, string> = {
  [EmotionMood.CALM]: 'Calm',
  [EmotionMood.HEROIC]: 'Heroic',
  [EmotionMood.INTENSE]: 'Intense / Urgent',
  [EmotionMood.MYSTERIOUS]: 'Mysterious',
};

export enum DressStyle {
  EXPEDITION_JACKET = 'EXPEDITION_JACKET',
  ROYAL_KURTA = 'ROYAL_KURTA',
  FESTIVE_SAREE = 'FESTIVE_SAREE',
  WARRIOR_ARMOR = 'WARRIOR_ARMOR',
  FORMAL_COAT = 'FORMAL_COAT',
}

export const DRESS_LABELS: Record<DressStyle, string> = {
  [DressStyle.EXPEDITION_JACKET]: 'Expedition Jacket',
  [DressStyle.ROYAL_KURTA]: 'Royal Kurta & Shawl',
  [DressStyle.FESTIVE_SAREE]: 'Banarasi Silk Saree',
  [DressStyle.WARRIOR_ARMOR]: 'Warrior Armor',
  [DressStyle.FORMAL_COAT]: 'Formal Trench Coat',
};

export const DRESS_STUDIO_IMAGES: Record<DressStyle, string> = {
  [DressStyle.EXPEDITION_JACKET]: '/src/assets/images/avatar_arjun_human_1795263152433.jpg',
  [DressStyle.ROYAL_KURTA]: '/src/assets/images/dress_royal_kurta_1795263375839.jpg',
  [DressStyle.FESTIVE_SAREE]: '/src/assets/images/dress_festive_saree_1795263377544.jpg',
  [DressStyle.WARRIOR_ARMOR]: '/src/assets/images/dress_warrior_armor_1795263377597.jpg',
  [DressStyle.FORMAL_COAT]: '/src/assets/images/dress_formal_coat_1795263377215.jpg',
};

export type AvatarMode = 'REAL_HUMAN_FULL' | 'PORTRAIT_RIG' | 'ANATOMY_RIG' | 'GLB_3D';

export type BodyBuild = 'SLIM' | 'ATHLETIC' | 'BROAD';

export type HairStyle = 'SHORT_TEXTURED' | 'WAVY_LONG' | 'SWEPT_BACK' | 'SIDE_PART';

export type FacialHair = 'NONE' | 'STUBBLE' | 'BEARD';

export interface HumanAvatarPreset {
  id: string;
  label: string;
  isFemale: boolean;
  defaultDress: DressStyle;
  hairStyle: HairStyle;
  facialHair: FacialHair;
  skinTone: string;
  imageUrl: string;
  sideImageUrl: string;
  eyeLineOffset: number;
  mouthLineOffset: number;
}

export const HUMAN_AVATAR_PRESETS: HumanAvatarPreset[] = [
  {
    id: 'preset-arjun',
    label: 'Arjun',
    isFemale: false,
    defaultDress: DressStyle.ROYAL_KURTA,
    hairStyle: 'SHORT_TEXTURED',
    facialHair: 'BEARD',
    skinTone: '#D99B72',
    imageUrl: '/src/assets/images/avatar_arjun_human_1795263152433.jpg',
    sideImageUrl: '/src/assets/images/avatar_arjun_side_1795418126665.jpg',
    eyeLineOffset: -0.02,
    mouthLineOffset: -0.02,
  },
  {
    id: 'preset-meera',
    label: 'Meera',
    isFemale: true,
    defaultDress: DressStyle.FESTIVE_SAREE,
    hairStyle: 'WAVY_LONG',
    facialHair: 'NONE',
    skinTone: '#E0AC82',
    imageUrl: '/src/assets/images/avatar_meera_human_1795263151996.jpg',
    sideImageUrl: '/src/assets/images/avatar_meera_side_1795418127227.jpg',
    eyeLineOffset: 0.06,
    mouthLineOffset: 0.05,
  },
  {
    id: 'preset-vikram',
    label: 'Vikram',
    isFemale: false,
    defaultDress: DressStyle.FORMAL_COAT,
    hairStyle: 'SWEPT_BACK',
    facialHair: 'STUBBLE',
    skinTone: '#C88B63',
    imageUrl: '/src/assets/images/avatar_vikram_human_1795263153150.jpg',
    sideImageUrl: '/src/assets/images/avatar_vikram_side_1795418127166.jpg',
    eyeLineOffset: 0.06,
    mouthLineOffset: 0.09,
  },
];

export interface RigProportions {
  shoulderWidthRatio: number;
  hipWidthRatio: number;
  torsoLengthRatio: number;
  armLengthRatio: number;
  legLengthRatio: number;
  autoRigSummary?: string;
}

export type MotionRetargetStyle =
  | 'NATURAL_HUMAN'
  | 'PRESENTER_CALM'
  | 'CINEMATIC_HERO'
  | 'ENERGETIC_CREATOR';

export interface MotionRetargetConfig {
  style: MotionRetargetStyle;
  strideScale: number;
  armAmplitude: number;
  expressiveness: number;
  phaseLag: number;
}

export interface IkCalibrationConfig {
  kneeBendBias: number;
  elbowBendBias: number;
  ankleLiftGain: number;
  hipStanceWidth: number;
  ikSoftLimit: number;
}

export interface BlendShapeConfig {
  jawOpenGain: number;
  mouthWidthGain: number;
  lipSmileBias: number;
  browLiftGain: number;
  cheekSquint: number;
  blinkRateGain: number;
}

export function createDefaultRigProportions(isFemale = false): RigProportions {
  return {
    shoulderWidthRatio: isFemale ? 0.94 : 1.0,
    hipWidthRatio: isFemale ? 1.04 : 1.0,
    torsoLengthRatio: 1.0,
    armLengthRatio: 1.0,
    legLengthRatio: 1.0,
  };
}

export function createDefaultMotionRetarget(): MotionRetargetConfig {
  return {
    style: 'NATURAL_HUMAN',
    strideScale: 1.0,
    armAmplitude: 1.0,
    expressiveness: 1.0,
    phaseLag: 1.0,
  };
}

export function createDefaultIkCalibration(): IkCalibrationConfig {
  return {
    kneeBendBias: 0.25,
    elbowBendBias: 0.18,
    ankleLiftGain: 1.0,
    hipStanceWidth: 1.0,
    ikSoftLimit: 0.97,
  };
}

export function createDefaultBlendShapes(): BlendShapeConfig {
  return {
    jawOpenGain: 1.0,
    mouthWidthGain: 1.0,
    lipSmileBias: 0.08,
    browLiftGain: 1.0,
    cheekSquint: 0.25,
    blinkRateGain: 1.0,
  };
}

export type CaptionPosition = 'bottom' | 'lower_third' | 'top' | 'hidden';

export interface ActorProfile {
  id: string;
  name: string;
  isFemale: boolean;
  avatarMode: AvatarMode;
  dressStyle: DressStyle;
  bodyBuild: BodyBuild;
  heightScale: number;
  hairStyle: HairStyle;
  facialHair: FacialHair;
  accentColor: string;
  robeColor: string;
  skinTone: string;
  voicePresetId: string;
  pitch: number;
  speechRate: number;
  portraitDataUrl?: string;
  sidePortraitDataUrl?: string;
  eyeLineOffset: number;
  mouthLineOffset: number;
  faceZoom: number;
  rig: RigProportions;
  retarget: MotionRetargetConfig;
  ik: IkCalibrationConfig;
  blendShapes: BlendShapeConfig;
  glbModelUrl?: string;
  glbFileName?: string;
  glbBoneCount?: number;
  glbMorphCount?: number;
}

export type CharacterPoseMode = 'AUTO' | 'SIDE_RIGHT' | 'SIDE_LEFT' | 'FRONT';

export type PoseSide = 'left' | 'right' | 'front';

export interface WalkingDestination {
  startXNorm: number;
  targetXNorm: number;
  label?: string;
}

export type SceneTransition = 'cut' | 'fade';

export interface CameraMotionSpec {
  zoomMax: number;
  swayX: number;
  swayY: number;
  freqX: number;
  freqY: number;
}

export interface CaptionCue {
  startSec: number;
  endSec: number;
  lines: string[];
  text: string;
}

export interface OverlayTemplateConfig {
  enabled: boolean;
  brandText: string;
  stripText: string;
  showNamePill: boolean;
}

export interface VideoQaCheck {
  id: string;
  label: string;
  actual: string;
  target: string;
  passed: boolean;
}

export interface VideoQaReport {
  width: number;
  height: number;
  fps: number;
  videoCodec: string;
  videoProfile: string;
  pixFmt: string;
  videoBitrateKbps: number;
  targetBitrateKbps: number;
  audioCodec: string;
  audioSampleRate: number;
  audioChannels: number;
  audioBitrateKbps: number;
  integratedLufs: number | null;
  loudnessRangeLu: number | null;
  truePeakDbtp: number | null;
  durationSec: number;
  fileSizeMb: number;
  estimatedSizeMb: number;
  detectedCuts: number;
  expectedCuts: number;
  motionVerified: boolean;
  passedAll: boolean;
  checks: VideoQaCheck[];
}

export interface DirectedScene {
  id: string;
  index: number;
  locationTitle: string;
  hookBanner: string;
  dialogue: string;
  captionText?: string;
  captionPosition?: CaptionPosition;
  captionScale?: number;
  captionCues?: CaptionCue[];
  directorNote?: string;
  actorId: string;
  biome: EnvBiome;
  gesture: GestureAction;
  emotion: EmotionMood;
  poseMode?: CharacterPoseMode;
  poseSide?: PoseSide;
  walkingDestination?: WalkingDestination;
  dressOverride?: DressStyle;
  transitionIn?: SceneTransition;
  cameraMotion?: CameraMotionSpec;
  cameraZoomStart: number;
  cameraZoomEnd: number;
  cameraPanRange: number;
  durationMs: number;
  narrationSeconds?: number;
  ttsVoiceName?: string;
  lipSyncEnvelope: number[];
  visemeWidths: number[];
  voiceAudioUrl?: string;
  voiceAudioLabel?: string;
  voiceAudioBase64?: string;
  voiceAudioMime?: string;
  clipVideoBase64?: string;
  clipVideoName?: string;
}

export const DEFAULT_STORY_HINDI =
  '1987 में राजस्थान के जैसलमेर बॉर्डर पर आसमान से एक रहस्यमयी रोशनी उतरी। अचानक तेज आंधी और आग की चिंगारियां फैल गईं। अब अर्जुन और मीरा इस अनसुलझे रहस्य का सच खोजने निकल पड़े हैं!';

export const DEFAULT_STORY_ENGLISH =
  'In 2026 inside a glowing Himalayan valley, Arjun walks toward the sacred river. Suddenly monsoon thunder strikes across the mountains. Together with Meera we must protect the ancient light!';

export const INITIAL_CAST: ActorProfile[] = [
  {
    id: 'actor-arjun',
    name: 'Arjun',
    isFemale: false,
    avatarMode: 'REAL_HUMAN_FULL',
    dressStyle: DressStyle.ROYAL_KURTA,
    bodyBuild: 'ATHLETIC',
    heightScale: 1.0,
    hairStyle: 'SHORT_TEXTURED',
    facialHair: 'BEARD',
    accentColor: '#00D4FF',
    robeColor: '#1B3B6F',
    skinTone: '#D99B72',
    voicePresetId: 'arjun-heroic',
    pitch: 0.9,
    speechRate: 0.94,
    portraitDataUrl: HUMAN_AVATAR_PRESETS[0].imageUrl,
    sidePortraitDataUrl: HUMAN_AVATAR_PRESETS[0].sideImageUrl,
    eyeLineOffset: HUMAN_AVATAR_PRESETS[0].eyeLineOffset,
    mouthLineOffset: HUMAN_AVATAR_PRESETS[0].mouthLineOffset,
    faceZoom: 1.0,
    rig: createDefaultRigProportions(false),
    retarget: createDefaultMotionRetarget(),
    ik: createDefaultIkCalibration(),
    blendShapes: createDefaultBlendShapes(),
  },
  {
    id: 'actor-meera',
    name: 'Meera',
    isFemale: true,
    avatarMode: 'REAL_HUMAN_FULL',
    dressStyle: DressStyle.FESTIVE_SAREE,
    bodyBuild: 'SLIM',
    heightScale: 0.96,
    hairStyle: 'WAVY_LONG',
    facialHair: 'NONE',
    accentColor: '#FF7B00',
    robeColor: '#5A189A',
    skinTone: '#E0AC82',
    voicePresetId: 'meera-expressive',
    pitch: 1.2,
    speechRate: 0.96,
    portraitDataUrl: HUMAN_AVATAR_PRESETS[1].imageUrl,
    sidePortraitDataUrl: HUMAN_AVATAR_PRESETS[1].sideImageUrl,
    eyeLineOffset: HUMAN_AVATAR_PRESETS[1].eyeLineOffset,
    mouthLineOffset: HUMAN_AVATAR_PRESETS[1].mouthLineOffset,
    faceZoom: 1.0,
    rig: createDefaultRigProportions(true),
    retarget: {
      style: 'PRESENTER_CALM',
      strideScale: 0.92,
      armAmplitude: 0.95,
      expressiveness: 1.05,
      phaseLag: 1.12,
    },
    ik: createDefaultIkCalibration(),
    blendShapes: {
      ...createDefaultBlendShapes(),
      lipSmileBias: 0.18,
    },
  },
  {
    id: 'actor-vikram',
    name: 'Vikram',
    isFemale: false,
    avatarMode: 'REAL_HUMAN_FULL',
    dressStyle: DressStyle.FORMAL_COAT,
    bodyBuild: 'BROAD',
    heightScale: 1.04,
    hairStyle: 'SWEPT_BACK',
    facialHair: 'STUBBLE',
    accentColor: '#34D399',
    robeColor: '#1E293B',
    skinTone: '#C88B63',
    voicePresetId: 'vikram-narrator',
    pitch: 0.84,
    speechRate: 0.92,
    portraitDataUrl: HUMAN_AVATAR_PRESETS[2].imageUrl,
    sidePortraitDataUrl: HUMAN_AVATAR_PRESETS[2].sideImageUrl,
    eyeLineOffset: HUMAN_AVATAR_PRESETS[2].eyeLineOffset,
    mouthLineOffset: HUMAN_AVATAR_PRESETS[2].mouthLineOffset,
    faceZoom: 1.0,
    rig: {
      shoulderWidthRatio: 1.08,
      hipWidthRatio: 1.02,
      torsoLengthRatio: 1.02,
      armLengthRatio: 1.04,
      legLengthRatio: 1.03,
    },
    retarget: {
      style: 'CINEMATIC_HERO',
      strideScale: 1.08,
      armAmplitude: 1.12,
      expressiveness: 1.1,
      phaseLag: 0.95,
    },
    ik: createDefaultIkCalibration(),
    blendShapes: createDefaultBlendShapes(),
  },
];
