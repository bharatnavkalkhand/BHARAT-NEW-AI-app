import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  Activity,
  Box,
  Crosshair,
  Download,
  ImagePlus,
  Plus,
  RotateCcw,
  Sliders,
  Sparkles,
  Trash2,
  Upload,
  Volume2,
  X,
} from 'lucide-react';
import {
  ActorProfile,
  AvatarMode,
  BodyBuild,
  CameraFraming,
  createDefaultBlendShapes,
  createDefaultIkCalibration,
  createDefaultMotionRetarget,
  createDefaultRigProportions,
  DirectedScene,
  DRESS_LABELS,
  DRESS_STUDIO_IMAGES,
  DressStyle,
  EmotionMood,
  EnvBiome,
  FacialHair,
  GestureAction,
  HairStyle,
  HUMAN_AVATAR_PRESETS,
  MotionRetargetStyle,
  PoseSide,
  VOICE_PROFILES,
  VoiceLang,
} from '../engine/types';
import { WebAudioMixEngine } from '../engine/audioMixEngine';
import {
  loadDressCutoutCanvas,
  loadPortraitImage,
  resolveActorSidePortraitUrl,
  WebGlSceneRenderer,
} from '../engine/gpuSceneRenderer';
import {
  autoRigActorFromImage,
  RETARGET_PRESETS,
} from '../engine/rigAndCalibration';
import {
  generateSelfieRiggedGlb,
  inspectGlbUrl,
  ThreeGlbStageRenderer,
} from '../engine/glbAvatarEngine';

interface CastManagerViewProps {
  cast: ActorProfile[];
  language: VoiceLang;
  audioEngine: WebAudioMixEngine;
  onChangeCast: (next: ActorProfile[]) => void;
}

type CalibrationTab = 'AUTO_RIG' | 'RETARGET' | 'IK' | 'BLEND_SHAPES';

const ACCENT_PRESETS = ['#00D4FF', '#FF7B00', '#34D399', '#F43F5E', '#FBBF24'];
const ROBE_PRESETS = ['#1B3B6F', '#5A189A', '#14532D', '#7C2D12', '#1E293B'];
const SKIN_PRESETS = ['#F0C5A3', '#E0AC82', '#D99B72', '#C88B63', '#8D583B'];

const WORKBENCH_GESTURES: { value: GestureAction; label: string }[] = [
  { value: GestureAction.WALKING, label: 'Walk' },
  { value: GestureAction.TALK_WAVE, label: 'Talk' },
  { value: GestureAction.POINTING, label: 'Point' },
  { value: GestureAction.HERO_RAISE, label: 'Hero' },
  { value: GestureAction.THINKING, label: 'Calm' },
];

export const CastManagerView: React.FC<CastManagerViewProps> = ({
  cast,
  language,
  audioEngine,
  onChangeCast,
}) => {
  const fileInputRefs = useRef<Record<string, HTMLInputElement | null>>({});
  const glbInputRefs = useRef<Record<string, HTMLInputElement | null>>({});
  const castRef = useRef<ActorProfile[]>(cast);
  castRef.current = cast;

  const workbenchRef = useRef<HTMLDivElement | null>(null);
  const previewCanvasRef = useRef<HTMLCanvasElement | null>(null);
  const previewRendererRef = useRef<WebGlSceneRenderer | null>(null);
  const previewGlbRendererRef = useRef<ThreeGlbStageRenderer | null>(null);
  const previewPortraitRef = useRef<HTMLImageElement | null>(null);
  const previewSidePortraitRef = useRef<HTMLImageElement | null>(null);
  const previewDressCutoutRef = useRef<HTMLCanvasElement | null>(null);
  const dragStateRef = useRef<{ active: boolean; lastX: number }>({
    active: false,
    lastX: 0,
  });

  const [selectedActorId, setSelectedActorId] = useState<string>(
    () => cast[0]?.id ?? ''
  );
  const [activeTab, setActiveTab] = useState<CalibrationTab>('AUTO_RIG');
  const [previewGesture, setPreviewGesture] = useState<GestureAction>(
    GestureAction.WALKING
  );
  const [previewFraming, setPreviewFraming] = useState<CameraFraming>(
    CameraFraming.FULL_BODY
  );
  const [showRigOverlay, setShowRigOverlay] = useState(true);
  const [talkTestActive, setTalkTestActive] = useState(true);
  const [previewYaw, setPreviewYaw] = useState(0);
  const [isAutoRigging, setIsAutoRigging] = useState(false);
  const [isBuildingGlb, setIsBuildingGlb] = useState(false);
  const [autoRigNotice, setAutoRigNotice] = useState<string | null>(null);
  const [use2dFallback, setUse2dFallback] = useState(false);

  const selectedActor = useMemo(
    () => cast.find((a) => a.id === selectedActorId) ?? cast[0],
    [cast, selectedActorId]
  );

  useEffect(() => {
    if (cast.length > 0 && !cast.some((a) => a.id === selectedActorId)) {
      setSelectedActorId(cast[0].id);
    }
  }, [cast, selectedActorId]);

  const updateActor = (id: string, patch: Partial<ActorProfile>) => {
    const latest = castRef.current;
    onChangeCast(latest.map((a) => (a.id === id ? { ...a, ...patch } : a)));
  };

  const runAutoRigScan = async (actor: ActorProfile, imageSource?: string) => {
    const targetImage =
      imageSource ||
      actor.portraitDataUrl ||
      DRESS_STUDIO_IMAGES[actor.dressStyle];
    if (!targetImage) {
      setAutoRigNotice('Attach a face photo or select a dress preset first.');
      return;
    }

    setIsAutoRigging(true);
    setAutoRigNotice(null);
    try {
      const analysis = await autoRigActorFromImage(targetImage, actor);
      updateActor(actor.id, {
        eyeLineOffset: analysis.eyeLineOffset,
        mouthLineOffset: analysis.mouthLineOffset,
        faceZoom: analysis.faceZoom,
        skinTone: analysis.skinTone,
        rig: analysis.rig,
      });
      setAutoRigNotice(
        analysis.rig.autoRigSummary ??
          `Auto-rigged ${actor.name} successfully.`
      );
    } catch {
      setAutoRigNotice(
        'Could not sample pixels from this image; keeping current rig calibration.'
      );
    } finally {
      setIsAutoRigging(false);
    }
  };

  const handleAddActor = () => {
    const idx = cast.length;
    const preset = HUMAN_AVATAR_PRESETS[idx % HUMAN_AVATAR_PRESETS.length];
    const defaultVoiceId = preset.isFemale ? 'meera-expressive' : 'arjun-heroic';
    const voicePreset =
      VOICE_PROFILES.find((v) => v.id === defaultVoiceId) ?? VOICE_PROFILES[0];
    const newActor: ActorProfile = {
      id: `actor-${Date.now()}`,
      name: `Character ${idx + 1}`,
      isFemale: preset.isFemale,
      avatarMode: 'REAL_HUMAN_FULL',
      dressStyle: preset.defaultDress,
      bodyBuild: 'ATHLETIC',
      heightScale: 1.0,
      hairStyle: preset.hairStyle,
      facialHair: preset.facialHair,
      accentColor: ACCENT_PRESETS[idx % ACCENT_PRESETS.length],
      robeColor: ROBE_PRESETS[idx % ROBE_PRESETS.length],
      skinTone: preset.skinTone,
      voicePresetId: voicePreset.id,
      pitch: voicePreset.pitch,
      speechRate: voicePreset.speechRate,
      portraitDataUrl: preset.imageUrl,
      sidePortraitDataUrl: preset.sideImageUrl,
      eyeLineOffset: preset.eyeLineOffset,
      mouthLineOffset: preset.mouthLineOffset,
      faceZoom: 1.0,
      rig: createDefaultRigProportions(preset.isFemale),
      retarget: createDefaultMotionRetarget(),
      ik: createDefaultIkCalibration(),
      blendShapes: createDefaultBlendShapes(),
    };
    onChangeCast([...cast, newActor]);
    setSelectedActorId(newActor.id);
  };

  const handleUploadPortrait = (id: string, file: File) => {
    const reader = new FileReader();
    reader.onload = () => {
      if (typeof reader.result === 'string') {
        const dataUrl = reader.result;
        updateActor(id, {
          portraitDataUrl: dataUrl,
          avatarMode: 'REAL_HUMAN_FULL',
        });
        const target = castRef.current.find((a) => a.id === id);
        if (target) {
          setSelectedActorId(id);
          void runAutoRigScan({ ...target, portraitDataUrl: dataUrl }, dataUrl);
        }
      }
    };
    reader.readAsDataURL(file);
  };

  const handleTestVoice = (actor: ActorProfile) => {
    const line =
      language === VoiceLang.HINDI
        ? `नमस्ते, मैं ${actor.name} हूँ।`
        : `Hello, I am ${actor.name}.`;
    audioEngine.speakDialogue(line, actor, language);
  };

  const handleImportGlb = async (actorId: string, file: File) => {
    const objectUrl = URL.createObjectURL(file);
    setSelectedActorId(actorId);
    setIsBuildingGlb(true);
    setAutoRigNotice(null);
    try {
      const info = await inspectGlbUrl(objectUrl);
      const prevActor = castRef.current.find((a) => a.id === actorId);
      if (prevActor?.glbModelUrl?.startsWith('blob:')) {
        URL.revokeObjectURL(prevActor.glbModelUrl);
      }
      updateActor(actorId, {
        avatarMode: 'GLB_3D',
        glbModelUrl: objectUrl,
        glbFileName: file.name,
        glbBoneCount: info.boneCount,
        glbMorphCount: info.morphCount,
      });
      setAutoRigNotice(
        `Loaded ${file.name} · ${info.boneCount} bones · ${info.morphCount} morph targets`
      );
      workbenchRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' });
    } catch {
      URL.revokeObjectURL(objectUrl);
      setAutoRigNotice(
        'Could not parse this .glb file. Please select a valid binary glTF (.glb) avatar.'
      );
    } finally {
      setIsBuildingGlb(false);
    }
  };

  const handleGenerateSelfieGlb = async (actor: ActorProfile) => {
    setSelectedActorId(actor.id);
    setIsBuildingGlb(true);
    setAutoRigNotice(null);
    try {
      const result = await generateSelfieRiggedGlb(actor);
      if (actor.glbModelUrl?.startsWith('blob:')) {
        URL.revokeObjectURL(actor.glbModelUrl);
      }
      updateActor(actor.id, {
        avatarMode: 'GLB_3D',
        glbModelUrl: result.url,
        glbFileName: result.fileName,
        glbBoneCount: result.boneCount,
        glbMorphCount: result.morphCount,
      });
      setAutoRigNotice(
        `Generated ${result.fileName} from single selfie · ${result.boneCount} humanoid bones · ${result.morphCount} facial morph targets`
      );
      workbenchRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' });
    } catch {
      setAutoRigNotice('Unable to generate rigged .glb from this portrait.');
    } finally {
      setIsBuildingGlb(false);
    }
  };

  const openActorWorkbench = (actorId: string) => {
    setSelectedActorId(actorId);
    workbenchRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  };

  // Initialize mini-stage WebGL renderer + 3D GLB stage renderer
  useEffect(() => {
    const canvas = previewCanvasRef.current;
    if (!canvas) return;
    let renderer: WebGlSceneRenderer | null = null;
    let glbRenderer: ThreeGlbStageRenderer | null = null;
    try {
      renderer = new WebGlSceneRenderer(canvas, use2dFallback);
      if (!renderer.isWebGlActive() && !use2dFallback) {
        renderer.dispose();
        setUse2dFallback(true);
        return;
      }
      renderer.resize(480, 620);
      previewRendererRef.current = renderer;
    } catch {
      renderer?.dispose();
      previewRendererRef.current = null;
      if (!use2dFallback) {
        setUse2dFallback(true);
      }
      return;
    }

    try {
      glbRenderer = new ThreeGlbStageRenderer(480, 620);
      previewGlbRendererRef.current = glbRenderer;
    } catch {
      previewGlbRendererRef.current = null;
    }

    return () => {
      renderer?.dispose();
      previewRendererRef.current = null;
      glbRenderer?.dispose();
      previewGlbRendererRef.current = null;
    };
  }, [use2dFallback]);

  useEffect(() => {
    if (selectedActor?.avatarMode === 'GLB_3D' && selectedActor.glbModelUrl) {
      void previewGlbRendererRef.current?.ensureLoaded(selectedActor.glbModelUrl);
    }
  }, [selectedActor?.avatarMode, selectedActor?.glbModelUrl]);

  // Load selected actor portrait & outfit cutout for mini-stage preview
  useEffect(() => {
    if (!selectedActor) return;
    let cancelled = false;

    void (async () => {
      const portrait = await loadPortraitImage(selectedActor.portraitDataUrl);
      const sidePortrait = await loadPortraitImage(
        resolveActorSidePortraitUrl(selectedActor)
      );
      const dressImgUrl = DRESS_STUDIO_IMAGES[selectedActor.dressStyle];
      const dressCanvas = dressImgUrl
        ? await loadDressCutoutCanvas(dressImgUrl)
        : null;
      if (!cancelled) {
        previewPortraitRef.current = portrait;
        previewSidePortraitRef.current = sidePortrait;
        previewDressCutoutRef.current = dressCanvas;
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [
    selectedActor?.id,
    selectedActor?.portraitDataUrl,
    selectedActor?.sidePortraitDataUrl,
    selectedActor?.dressStyle,
  ]);

  // Animate mini-stage preview with live rig, retarget, IK, and blend shapes
  useEffect(() => {
    if (!selectedActor) return;
    let rafId = 0;
    const epoch = performance.now();

    const previewScene: DirectedScene = {
      id: 'calibration-preview',
      index: 0,
      locationTitle: '',
      hookBanner: '',
      dialogue: '',
      actorId: selectedActor.id,
      biome: EnvBiome.AVATAR_NIGHT,
      gesture: previewGesture,
      emotion: EmotionMood.HEROIC,
      cameraZoomStart: 1.0,
      cameraZoomEnd: 1.02,
      cameraPanRange: 0.01,
      durationMs: 4200,
      lipSyncEnvelope: [],
      visemeWidths: [],
    };

    const tick = () => {
      const renderer = previewRendererRef.current;
      if (renderer) {
        const timeSec = (performance.now() - epoch) / 1000;
        const progress = (timeSec % 4.2) / 4.2;
        const speechPulse = talkTestActive
          ? Math.max(
              0.08,
              0.42 +
                0.34 * Math.sin(timeSec * 11.5) +
                0.22 * Math.sin(timeSec * 19.3 + 0.7)
            )
          : 0.04;
        const visemePulse = talkTestActive
          ? 0.75 + 0.42 * Math.sin(timeSec * 8.4 + 0.4)
          : 0.92;

        let glbRenderCanvas: HTMLCanvasElement | null = null;
        const glbRenderer = previewGlbRendererRef.current;
        if (
          glbRenderer &&
          selectedActor.avatarMode === 'GLB_3D' &&
          selectedActor.glbModelUrl &&
          glbRenderer.isReadyFor(selectedActor.glbModelUrl)
        ) {
          try {
            if (
              glbRenderer.renderFrame({
                actor: selectedActor,
                gesture: previewGesture,
                emotion: EmotionMood.HEROIC,
                framing: previewFraming,
                biome: previewScene.biome,
                timeSec,
                audioAmp: speechPulse,
                visemeWidth: visemePulse,
                showRigOverlay,
                yawOffset: previewYaw,
              })
            ) {
              glbRenderCanvas = glbRenderer.getCanvas();
            }
          } catch {
            glbRenderCanvas = null;
          }
        }

        const previewPoseSide: PoseSide =
          previewGesture === GestureAction.WALKING
            ? previewYaw < -0.15
              ? 'left'
              : 'right'
            : previewYaw > 0.35
              ? 'right'
              : previewYaw < -0.35
                ? 'left'
                : 'front';

        try {
          renderer.renderFrame({
            scene: previewScene,
            actor: selectedActor,
            framing: previewFraming,
            portraitImg: previewPortraitRef.current,
            sidePortraitImg: previewSidePortraitRef.current,
            dressCutoutCanvas: previewDressCutoutRef.current,
            poseSide: previewPoseSide,
            progress,
            timeSec,
            audioAmp: speechPulse,
            visemeWidth: visemePulse,
            showRigOverlay,
            glbRenderCanvas,
          });
        } catch {
          if (!use2dFallback) {
            setUse2dFallback(true);
            return;
          }
          return;
        }
      }
      rafId = requestAnimationFrame(tick);
    };

    rafId = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(rafId);
  }, [
    selectedActor,
    previewGesture,
    previewFraming,
    showRigOverlay,
    talkTestActive,
    previewYaw,
    use2dFallback,
  ]);

  return (
    <div className="max-w-[1280px] mx-auto px-6 py-8 space-y-8">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight text-white">
            Human Avatars, Wardrobe & Rigging Studio
          </h1>
          <p className="text-sm text-slate-400 mt-1">
            Customize outfits and appearance, auto-rig uploaded portraits, retarget gait & gestures, tune 2-bone IK limbs, and calibrate facial blend shapes.
          </p>
        </div>

        <button
          type="button"
          onClick={handleAddActor}
          className="inline-flex items-center gap-2 px-4 py-2.5 text-xs font-semibold text-slate-950 bg-cyan-400 hover:bg-cyan-300 rounded-lg transition-colors whitespace-nowrap shrink-0"
        >
          <Plus className="w-4 h-4" />
          Add Human Avatar
        </button>
      </div>

      {/* Actor Cards */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-5">
        {cast.map((actor) => {
          const isSelectedForRig = selectedActor?.id === actor.id;
          return (
            <div
              key={actor.id}
              className={`bg-[#101520] border rounded-xl p-5 flex flex-col gap-4 transition-colors ${
                isSelectedForRig
                  ? 'border-cyan-400/45'
                  : 'border-white/[0.08]'
              }`}
            >
              {/* Header & Portrait Preview */}
              <div className="flex items-start justify-between gap-4">
                <div className="flex items-center gap-3.5 min-w-0">
                  <div
                    className="w-14 h-14 rounded-full shrink-0 flex items-center justify-center overflow-hidden border-2"
                    style={{
                      backgroundColor: actor.robeColor,
                      borderColor: actor.accentColor,
                    }}
                  >
                    {actor.portraitDataUrl ? (
                      <img
                        src={actor.portraitDataUrl}
                        alt={actor.name}
                        referrerPolicy="no-referrer"
                        className="w-full h-full object-cover object-top"
                      />
                    ) : (
                      <span className="text-lg font-bold text-white">
                        {actor.name.slice(0, 1).toUpperCase()}
                      </span>
                    )}
                  </div>

                  <div className="min-w-0">
                    <input
                      type="text"
                      value={actor.name}
                      onChange={(e) =>
                        updateActor(actor.id, { name: e.target.value })
                      }
                      aria-label="Actor name"
                      className="w-full bg-transparent text-base font-semibold text-white border-b border-transparent hover:border-white/15 focus:border-cyan-400 focus:outline-none pb-0.5"
                    />
                    <div className="flex items-center gap-2 text-xs text-slate-400 mt-1">
                      <button
                        type="button"
                        onClick={() =>
                          updateActor(actor.id, { isFemale: !actor.isFemale })
                        }
                        className="hover:text-cyan-300 transition-colors"
                      >
                        {actor.isFemale ? 'Female Frame' : 'Male Frame'}
                      </button>
                      <span aria-hidden="true">·</span>
                      <span className="font-mono tabular-nums">
                        {Math.round(actor.heightScale * 100)}% Ht
                      </span>
                    </div>
                  </div>
                </div>

                <div className="flex items-center gap-1 shrink-0">
                  <button
                    type="button"
                    onClick={() => handleTestVoice(actor)}
                    title="Test voice"
                    aria-label={`Test voice for ${actor.name}`}
                    className="p-2 rounded-lg text-cyan-300 hover:bg-cyan-400/10 transition-colors"
                  >
                    <Volume2 className="w-4 h-4" />
                  </button>
                  {cast.length > 1 && (
                    <button
                      type="button"
                      onClick={() => {
                        if (actor.glbModelUrl?.startsWith('blob:')) {
                          URL.revokeObjectURL(actor.glbModelUrl);
                        }
                        onChangeCast(cast.filter((a) => a.id !== actor.id));
                      }}
                      title="Remove actor"
                      aria-label={`Remove ${actor.name}`}
                      className="p-2 rounded-lg text-slate-400 hover:text-rose-400 hover:bg-rose-400/10 transition-colors"
                    >
                      <Trash2 className="w-4 h-4" />
                    </button>
                  )}
                </div>
              </div>

              {/* Avatar Render Mode Toggle */}
              <div>
                <span className="block text-[11px] text-slate-400 mb-1.5">
                  Avatar Realism Mode
                </span>
                <div className="grid grid-cols-4 gap-1 p-1 bg-black/40 rounded-lg border border-white/[0.06]">
                  {(
                    [
                      { mode: 'REAL_HUMAN_FULL', label: 'Real' },
                      { mode: 'PORTRAIT_RIG', label: 'Rig+Face' },
                      { mode: 'ANATOMY_RIG', label: 'Anatomy' },
                      { mode: 'GLB_3D', label: '3D GLB' },
                    ] as { mode: AvatarMode; label: string }[]
                  ).map((opt) => (
                    <button
                      key={opt.mode}
                      type="button"
                      onClick={() =>
                        updateActor(actor.id, { avatarMode: opt.mode })
                      }
                      className={`px-1.5 py-1.5 text-[11px] font-medium rounded-md transition-colors whitespace-nowrap ${
                        actor.avatarMode === opt.mode
                          ? 'bg-slate-800 text-white'
                          : 'text-slate-400 hover:text-slate-200'
                      }`}
                    >
                      {opt.label}
                    </button>
                  ))}
                </div>
              </div>

              {/* Dress / Outfit Selector */}
              <div>
                <label className="block text-[11px] text-slate-400 mb-1.5">
                  Dress / Outfit
                </label>
                <select
                  value={actor.dressStyle}
                  onChange={(e) =>
                    updateActor(actor.id, {
                      dressStyle: e.target.value as DressStyle,
                    })
                  }
                  className="w-full bg-[#090C12] border border-white/[0.08] rounded-lg px-3 py-2 text-xs text-slate-100 focus:border-cyan-400/70 focus:outline-none"
                >
                  {Object.values(DressStyle).map((style) => (
                    <option key={style} value={style}>
                      {DRESS_LABELS[style]}
                    </option>
                  ))}
                </select>
              </div>

              {/* Physical Appearance Controls */}
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <span className="block text-[11px] text-slate-400 mb-1.5">
                    Body Build
                  </span>
                  <div className="grid grid-cols-3 gap-1 p-1 bg-black/35 rounded-lg border border-white/[0.06]">
                    {(['SLIM', 'ATHLETIC', 'BROAD'] as BodyBuild[]).map((b) => (
                      <button
                        key={b}
                        type="button"
                        onClick={() => updateActor(actor.id, { bodyBuild: b })}
                        className={`py-1 text-[11px] font-medium rounded transition-colors ${
                          actor.bodyBuild === b
                            ? 'bg-slate-800 text-white'
                            : 'text-slate-400 hover:text-slate-200'
                        }`}
                      >
                        {b === 'SLIM' ? 'Slim' : b === 'ATHLETIC' ? 'Fit' : 'Broad'}
                      </button>
                    ))}
                  </div>
                </div>

                <div>
                  <div className="flex items-center justify-between text-[11px] mb-1.5">
                    <span className="text-slate-400">Height</span>
                    <span className="font-mono tabular-nums text-slate-200">
                      {Math.round(actor.heightScale * 100)}%
                    </span>
                  </div>
                  <input
                    type="range"
                    min={0.9}
                    max={1.12}
                    step={0.01}
                    value={actor.heightScale}
                    onChange={(e) =>
                      updateActor(actor.id, {
                        heightScale: parseFloat(e.target.value),
                      })
                    }
                    className="w-full accent-cyan-400 cursor-pointer mt-1"
                  />
                </div>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-[11px] text-slate-400 mb-1">
                    Hairstyle
                  </label>
                  <select
                    value={actor.hairStyle}
                    onChange={(e) =>
                      updateActor(actor.id, {
                        hairStyle: e.target.value as HairStyle,
                      })
                    }
                    className="w-full bg-[#090C12] border border-white/[0.08] rounded-lg px-2.5 py-1.5 text-xs text-slate-200 focus:border-cyan-400/70 focus:outline-none"
                  >
                    <option value="SHORT_TEXTURED">Short Textured</option>
                    <option value="SWEPT_BACK">Swept Back</option>
                    <option value="SIDE_PART">Side Part</option>
                    <option value="WAVY_LONG">Wavy Long</option>
                  </select>
                </div>

                <div>
                  <label className="block text-[11px] text-slate-400 mb-1">
                    Facial Hair
                  </label>
                  <select
                    value={actor.facialHair}
                    onChange={(e) =>
                      updateActor(actor.id, {
                        facialHair: e.target.value as FacialHair,
                      })
                    }
                    disabled={actor.isFemale}
                    className="w-full bg-[#090C12] border border-white/[0.08] rounded-lg px-2.5 py-1.5 text-xs text-slate-200 disabled:opacity-40 focus:border-cyan-400/70 focus:outline-none"
                  >
                    <option value="NONE">Clean Shaven</option>
                    <option value="STUBBLE">Light Stubble</option>
                    <option value="BEARD">Trimmed Beard</option>
                  </select>
                </div>
              </div>

              {/* Human Avatar Face Presets */}
              <div>
                <span className="block text-[11px] text-slate-400 mb-1.5">
                  Human Face Preset
                </span>
                <div className="grid grid-cols-3 gap-2">
                  {HUMAN_AVATAR_PRESETS.map((preset) => {
                    const isSelected = actor.portraitDataUrl === preset.imageUrl;
                    return (
                      <button
                        key={preset.id}
                        type="button"
                        onClick={() =>
                          updateActor(actor.id, {
                            portraitDataUrl: preset.imageUrl,
                            sidePortraitDataUrl: preset.sideImageUrl,
                            isFemale: preset.isFemale,
                            hairStyle: preset.hairStyle,
                            facialHair: preset.facialHair,
                            skinTone: preset.skinTone,
                            eyeLineOffset: preset.eyeLineOffset,
                            mouthLineOffset: preset.mouthLineOffset,
                            faceZoom: 1.0,
                          })
                        }
                        className={`flex items-center gap-2 p-1.5 rounded-lg border text-left transition-colors ${
                          isSelected
                            ? 'bg-cyan-400/12 border-cyan-400/50 text-white'
                            : 'bg-black/25 border-white/[0.07] text-slate-300 hover:border-white/20'
                        }`}
                      >
                        <img
                          src={preset.imageUrl}
                          alt={preset.label}
                          referrerPolicy="no-referrer"
                          className="w-6 h-6 rounded object-cover object-top shrink-0"
                        />
                        <span className="text-xs truncate">{preset.label}</span>
                      </button>
                    );
                  })}
                </div>
              </div>

              {/* Voice / Audio Profile Selector */}
              <div>
                <label className="block text-[11px] text-slate-400 mb-1.5">
                  Voice / Audio Profile
                </label>
                <select
                  value={actor.voicePresetId}
                  onChange={(e) => {
                    const preset = VOICE_PROFILES.find(
                      (v) => v.id === e.target.value
                    );
                    if (!preset) return;
                    updateActor(actor.id, {
                      voicePresetId: preset.id,
                      pitch: preset.pitch,
                      speechRate: preset.speechRate,
                    });
                  }}
                  className="w-full bg-[#090C12] border border-white/[0.08] rounded-lg px-3 py-2 text-xs text-slate-100 focus:border-cyan-400/70 focus:outline-none"
                >
                  {VOICE_PROFILES.map((vp) => (
                    <option key={vp.id} value={vp.id}>
                      {vp.label}
                    </option>
                  ))}
                </select>
              </div>

              {/* Pitch & Rate Sliders */}
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <div className="flex items-center justify-between text-[11px] mb-1">
                    <span className="text-slate-400">Pitch</span>
                    <span className="font-mono tabular-nums text-slate-200">
                      {actor.pitch.toFixed(2)}
                    </span>
                  </div>
                  <input
                    type="range"
                    min={0.7}
                    max={1.45}
                    step={0.01}
                    value={actor.pitch}
                    onChange={(e) =>
                      updateActor(actor.id, {
                        pitch: parseFloat(e.target.value),
                      })
                    }
                    className="w-full accent-cyan-400 cursor-pointer"
                  />
                </div>

                <div>
                  <div className="flex items-center justify-between text-[11px] mb-1">
                    <span className="text-slate-400">Speed</span>
                    <span className="font-mono tabular-nums text-slate-200">
                      {actor.speechRate.toFixed(2)}x
                    </span>
                  </div>
                  <input
                    type="range"
                    min={0.7}
                    max={1.35}
                    step={0.01}
                    value={actor.speechRate}
                    onChange={(e) =>
                      updateActor(actor.id, {
                        speechRate: parseFloat(e.target.value),
                      })
                    }
                    className="w-full accent-cyan-400 cursor-pointer"
                  />
                </div>
              </div>

              {/* Skin, Dress Color & Rim Pickers */}
              <div className="grid grid-cols-3 gap-3 pt-2 border-t border-white/[0.06]">
                <div>
                  <span className="block text-[11px] text-slate-400 mb-1.5">
                    Skin Tone
                  </span>
                  <div className="flex flex-wrap items-center gap-1">
                    {SKIN_PRESETS.map((c) => (
                      <button
                        key={c}
                        type="button"
                        onClick={() => updateActor(actor.id, { skinTone: c })}
                        aria-label={`Set skin tone ${c}`}
                        className={`w-5 h-5 rounded border transition-transform ${
                          actor.skinTone === c
                            ? 'border-white scale-110'
                            : 'border-white/20 hover:scale-105'
                        }`}
                        style={{ backgroundColor: c }}
                      />
                    ))}
                  </div>
                </div>

                <div>
                  <span className="block text-[11px] text-slate-400 mb-1.5">
                    Dress Hue
                  </span>
                  <div className="flex flex-wrap items-center gap-1">
                    {ROBE_PRESETS.map((c) => (
                      <button
                        key={c}
                        type="button"
                        onClick={() => updateActor(actor.id, { robeColor: c })}
                        aria-label={`Set dress color ${c}`}
                        className={`w-5 h-5 rounded border transition-transform ${
                          actor.robeColor === c
                            ? 'border-white scale-110'
                            : 'border-white/20 hover:scale-105'
                        }`}
                        style={{ backgroundColor: c }}
                      />
                    ))}
                  </div>
                </div>

                <div>
                  <span className="block text-[11px] text-slate-400 mb-1.5">
                    Rim Glow
                  </span>
                  <div className="flex flex-wrap items-center gap-1">
                    {ACCENT_PRESETS.map((c) => (
                      <button
                        key={c}
                        type="button"
                        onClick={() =>
                          updateActor(actor.id, { accentColor: c })
                        }
                        aria-label={`Set rim glow ${c}`}
                        className={`w-5 h-5 rounded border transition-transform ${
                          actor.accentColor === c
                            ? 'border-white scale-110'
                            : 'border-white/20 hover:scale-105'
                        }`}
                        style={{ backgroundColor: c }}
                      />
                    ))}
                  </div>
                </div>
              </div>

              {/* Custom Face Photo Upload & Rig Workbench Trigger */}
              <div className="flex items-center gap-2 pt-1">
                <input
                  ref={(el) => {
                    fileInputRefs.current[actor.id] = el;
                  }}
                  type="file"
                  accept="image/*"
                  className="hidden"
                  onChange={(e) => {
                    const file = e.target.files?.[0];
                    if (file) handleUploadPortrait(actor.id, file);
                  }}
                />
                <button
                  type="button"
                  onClick={() => fileInputRefs.current[actor.id]?.click()}
                  className="flex-1 inline-flex items-center justify-center gap-1.5 px-3 py-2 text-xs font-medium text-slate-200 bg-white/[0.04] hover:bg-white/[0.08] border border-white/[0.08] rounded-lg transition-colors whitespace-nowrap"
                >
                  <ImagePlus className="w-3.5 h-3.5" />
                  {actor.portraitDataUrl ? 'Custom Face' : 'Attach Face'}
                </button>

                <button
                  type="button"
                  onClick={() => openActorWorkbench(actor.id)}
                  className={`inline-flex items-center justify-center gap-1.5 px-3 py-2 text-xs font-medium rounded-lg border transition-colors whitespace-nowrap ${
                    isSelectedForRig
                      ? 'bg-cyan-400/15 border-cyan-400/45 text-cyan-200'
                      : 'bg-white/[0.04] hover:bg-white/[0.08] border-white/[0.08] text-slate-200'
                  }`}
                >
                  <Crosshair className="w-3.5 h-3.5" />
                  Rig & IK
                </button>

                {actor.portraitDataUrl && (
                  <button
                    type="button"
                    onClick={() =>
                      updateActor(actor.id, {
                        portraitDataUrl: undefined,
                        avatarMode: 'ANATOMY_RIG',
                      })
                    }
                    aria-label="Clear face photo"
                    className="p-2 text-slate-400 hover:text-white bg-white/[0.04] hover:bg-white/[0.08] border border-white/[0.08] rounded-lg transition-colors"
                  >
                    <X className="w-4 h-4" />
                  </button>
                )}
              </div>

              {/* 3D Rigged .glb Import & Single-Selfie Generator Row */}
              <div className="pt-2 border-t border-white/[0.06] space-y-2">
                <div className="flex items-center gap-2">
                  <input
                    ref={(el) => {
                      glbInputRefs.current[actor.id] = el;
                    }}
                    type="file"
                    accept=".glb,.gltf"
                    className="hidden"
                    onChange={(e) => {
                      const file = e.target.files?.[0];
                      if (file) void handleImportGlb(actor.id, file);
                      e.target.value = '';
                    }}
                  />
                  <button
                    type="button"
                    disabled={isBuildingGlb}
                    onClick={() => glbInputRefs.current[actor.id]?.click()}
                    className="flex-1 inline-flex items-center justify-center gap-1.5 px-2.5 py-1.5 text-[11px] font-medium text-slate-200 bg-[#090C12] hover:bg-white/[0.06] border border-white/[0.08] rounded-lg transition-colors whitespace-nowrap disabled:opacity-50"
                  >
                    <Upload className="w-3.5 h-3.5" />
                    Import .glb
                  </button>

                  <button
                    type="button"
                    disabled={isBuildingGlb}
                    onClick={() => void handleGenerateSelfieGlb(actor)}
                    className="flex-1 inline-flex items-center justify-center gap-1.5 px-2.5 py-1.5 text-[11px] font-medium text-cyan-200 bg-cyan-400/10 hover:bg-cyan-400/20 border border-cyan-400/30 rounded-lg transition-colors whitespace-nowrap disabled:opacity-50"
                  >
                    <Box className="w-3.5 h-3.5" />
                    Selfie → .glb
                  </button>

                  {actor.glbModelUrl && (
                    <a
                      href={actor.glbModelUrl}
                      download={actor.glbFileName ?? `${actor.name}-rigged.glb`}
                      title="Download rigged .glb file"
                      aria-label={`Download ${actor.name} GLB`}
                      className="p-1.5 text-cyan-300 hover:text-cyan-200 bg-cyan-400/10 hover:bg-cyan-400/20 border border-cyan-400/30 rounded-lg transition-colors"
                    >
                      <Download className="w-3.5 h-3.5" />
                    </a>
                  )}
                </div>

                {actor.glbModelUrl && (
                  <div className="text-[11px] text-slate-400 font-mono truncate">
                    {actor.glbFileName ?? 'rigged-avatar.glb'} ·{' '}
                    {actor.glbBoneCount ?? 19} bones ·{' '}
                    {actor.glbMorphCount ?? 0} morphs
                  </div>
                )}
              </div>
            </div>
          );
        })}
      </div>

      {/* Auto-Rigging, Motion Retargeting, IK & Blend Shape Calibration Workbench */}
      {selectedActor && (
        <section
          ref={workbenchRef}
          className="bg-[#101520] border border-white/[0.08] rounded-xl p-6 space-y-5"
        >
          <div className="flex flex-wrap items-center justify-between gap-4 border-b border-white/[0.07] pb-4">
            <div>
              <h2 className="text-lg font-semibold text-white">
                Auto-Rig, Motion Retargeting, IK & Blend Shape Calibration
              </h2>
              <p className="text-xs text-slate-400 mt-0.5">
                Calibrating{' '}
                <span className="text-slate-200 font-medium">
                  {selectedActor.name}
                </span>
                {' · '}
                {RETARGET_PRESETS[selectedActor.retarget.style].label}
                {' · '}
                <span className="font-mono tabular-nums">
                  Leg {selectedActor.rig.legLengthRatio.toFixed(2)}x
                </span>
              </p>
            </div>

            <div className="flex flex-wrap items-center gap-2">
              {cast.map((a) => (
                <button
                  key={a.id}
                  type="button"
                  onClick={() => {
                    setSelectedActorId(a.id);
                    setAutoRigNotice(null);
                  }}
                  className={`px-3 py-1.5 text-xs font-medium rounded-lg border transition-colors ${
                    a.id === selectedActor.id
                      ? 'bg-cyan-400/15 border-cyan-400/50 text-cyan-200'
                      : 'bg-black/30 border-white/[0.08] text-slate-400 hover:text-white'
                  }`}
                >
                  {a.name}
                </button>
              ))}

              <button
                type="button"
                disabled={isAutoRigging}
                onClick={() => void runAutoRigScan(selectedActor)}
                className="inline-flex items-center gap-1.5 px-3.5 py-1.5 text-xs font-semibold text-slate-950 bg-cyan-400 hover:bg-cyan-300 disabled:opacity-50 rounded-lg transition-colors whitespace-nowrap"
              >
                <Sparkles className="w-3.5 h-3.5" />
                {isAutoRigging ? 'Scanning Image...' : 'Auto-Rig from Photo'}
              </button>

              <button
                type="button"
                disabled={isBuildingGlb}
                onClick={() => void handleGenerateSelfieGlb(selectedActor)}
                className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-cyan-200 bg-cyan-400/15 hover:bg-cyan-400/25 border border-cyan-400/35 disabled:opacity-50 rounded-lg transition-colors whitespace-nowrap"
              >
                <Box className="w-3.5 h-3.5" />
                {isBuildingGlb ? 'Building .glb...' : 'Selfie → Rigged .glb'}
              </button>

              {selectedActor.glbModelUrl && (
                <a
                  href={selectedActor.glbModelUrl}
                  download={
                    selectedActor.glbFileName ??
                    `${selectedActor.name}-rigged.glb`
                  }
                  className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-slate-200 hover:text-white bg-white/[0.04] hover:bg-white/[0.08] border border-white/[0.08] rounded-lg transition-colors whitespace-nowrap"
                >
                  <Download className="w-3.5 h-3.5" />
                  Export .glb
                </a>
              )}

              <button
                type="button"
                onClick={() => {
                  updateActor(selectedActor.id, {
                    eyeLineOffset: 0,
                    mouthLineOffset: 0,
                    faceZoom: 1.0,
                    rig: createDefaultRigProportions(selectedActor.isFemale),
                    retarget: createDefaultMotionRetarget(),
                    ik: createDefaultIkCalibration(),
                    blendShapes: createDefaultBlendShapes(),
                  });
                  setPreviewYaw(0);
                  setAutoRigNotice('Reset all rig, retarget, IK, and blend shape values.');
                }}
                className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-slate-300 hover:text-white bg-white/[0.04] hover:bg-white/[0.08] border border-white/[0.08] rounded-lg transition-colors whitespace-nowrap"
              >
                <RotateCcw className="w-3.5 h-3.5" />
                Reset All
              </button>
            </div>
          </div>

          {autoRigNotice && (
            <div className="px-3.5 py-2.5 rounded-lg bg-cyan-400/10 border border-cyan-400/25 text-xs text-cyan-200 font-mono">
              {autoRigNotice}
            </div>
          )}

          <div className="grid grid-cols-1 lg:grid-cols-[340px_1fr] gap-6 items-start">
            {/* Live Interactive Rig & Blend Shape Preview Canvas */}
            <div className="space-y-3">
              <div
                className="relative rounded-xl overflow-hidden bg-[#06090F] border border-white/[0.08] aspect-[4/5] select-none"
                onPointerDown={(e) => {
                  dragStateRef.current = { active: true, lastX: e.clientX };
                }}
                onPointerMove={(e) => {
                  if (!dragStateRef.current.active) return;
                  const dx = e.clientX - dragStateRef.current.lastX;
                  dragStateRef.current.lastX = e.clientX;
                  if (selectedActor.avatarMode === 'GLB_3D') {
                    setPreviewYaw((y) => y + dx * 0.012);
                  }
                }}
                onPointerUp={() => {
                  dragStateRef.current.active = false;
                }}
                onPointerLeave={() => {
                  dragStateRef.current.active = false;
                }}
              >
                <canvas
                  key={use2dFallback ? '2d' : 'gl'}
                  ref={previewCanvasRef}
                  width={480}
                  height={620}
                  className={`w-full h-full object-contain ${
                    selectedActor.avatarMode === 'GLB_3D' ? 'cursor-grab active:cursor-grabbing' : ''
                  }`}
                />
                {selectedActor.avatarMode === 'GLB_3D' && !selectedActor.glbModelUrl && (
                  <div className="absolute inset-0 flex items-center justify-center p-4 bg-black/55">
                    <button
                      type="button"
                      onClick={() => void handleGenerateSelfieGlb(selectedActor)}
                      className="inline-flex items-center gap-2 px-3.5 py-2 text-xs font-semibold text-slate-950 bg-cyan-400 hover:bg-cyan-300 rounded-lg transition-colors"
                    >
                      <Box className="w-4 h-4" />
                      Generate Rigged .glb from Selfie
                    </button>
                  </div>
                )}
              </div>

              <div className="flex flex-wrap items-center gap-1.5">
                {WORKBENCH_GESTURES.map((g) => (
                  <button
                    key={g.value}
                    type="button"
                    onClick={() => setPreviewGesture(g.value)}
                    className={`px-2.5 py-1.5 text-[11px] font-medium rounded-md border transition-colors ${
                      previewGesture === g.value
                        ? 'bg-slate-800 border-cyan-400/45 text-white'
                        : 'bg-black/30 border-white/[0.07] text-slate-400 hover:text-slate-200'
                    }`}
                  >
                    {g.label}
                  </button>
                ))}
              </div>

              <div className="grid grid-cols-3 gap-1.5">
                <button
                  type="button"
                  onClick={() => setShowRigOverlay((v) => !v)}
                  className={`inline-flex items-center justify-center gap-1.5 px-2.5 py-1.5 text-[11px] font-medium rounded-md border transition-colors ${
                    showRigOverlay
                      ? 'bg-cyan-400/15 border-cyan-400/45 text-cyan-200'
                      : 'bg-black/30 border-white/[0.07] text-slate-400 hover:text-white'
                  }`}
                >
                  <Crosshair className="w-3.5 h-3.5" />
                  Rig Overlay
                </button>

                <button
                  type="button"
                  onClick={() => setTalkTestActive((v) => !v)}
                  className={`inline-flex items-center justify-center gap-1.5 px-2.5 py-1.5 text-[11px] font-medium rounded-md border transition-colors ${
                    talkTestActive
                      ? 'bg-cyan-400/15 border-cyan-400/45 text-cyan-200'
                      : 'bg-black/30 border-white/[0.07] text-slate-400 hover:text-white'
                  }`}
                >
                  <Activity className="w-3.5 h-3.5" />
                  Talk Test
                </button>

                <button
                  type="button"
                  onClick={() =>
                    setPreviewFraming((f) =>
                      f === CameraFraming.FULL_BODY
                        ? CameraFraming.CLOSE_UP
                        : CameraFraming.FULL_BODY
                    )
                  }
                  className="inline-flex items-center justify-center gap-1.5 px-2.5 py-1.5 text-[11px] font-medium rounded-md border bg-black/30 border-white/[0.07] text-slate-300 hover:text-white transition-colors"
                >
                  <Sliders className="w-3.5 h-3.5" />
                  {previewFraming === CameraFraming.FULL_BODY
                    ? 'Full Body'
                    : 'Face Zoom'}
                </button>
              </div>
            </div>

            {/* 4 Calibration Tabs */}
            <div className="space-y-5">
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-1.5 p-1 bg-black/40 rounded-lg border border-white/[0.06]">
                {(
                  [
                    { id: 'AUTO_RIG', label: '1. Auto-Rig' },
                    { id: 'RETARGET', label: '2. Retargeting' },
                    { id: 'IK', label: '3. IK Calibration' },
                    { id: 'BLEND_SHAPES', label: '4. Blend Shapes' },
                  ] as { id: CalibrationTab; label: string }[]
                ).map((tab) => (
                  <button
                    key={tab.id}
                    type="button"
                    onClick={() => {
                      setActiveTab(tab.id);
                      if (tab.id === 'BLEND_SHAPES') {
                        setPreviewFraming(CameraFraming.CLOSE_UP);
                      } else if (previewFraming === CameraFraming.CLOSE_UP) {
                        setPreviewFraming(CameraFraming.FULL_BODY);
                      }
                    }}
                    className={`px-3 py-2 text-xs font-medium rounded-md transition-colors whitespace-nowrap ${
                      activeTab === tab.id
                        ? 'bg-slate-800 text-white'
                        : 'text-slate-400 hover:text-slate-200'
                    }`}
                  >
                    {tab.label}
                  </button>
                ))}
              </div>

              {activeTab === 'AUTO_RIG' && (
                <div className="space-y-4">
                  <div className="flex flex-wrap items-center justify-between gap-3 p-3.5 rounded-lg bg-black/30 border border-white/[0.06]">
                    <div className="text-xs text-slate-300">
                      <div className="font-medium text-white">
                        YCbCr Portrait & Silhouette Proportion Solver
                      </div>
                      <div className="text-slate-400 mt-0.5 font-mono text-[11px]">
                        {selectedActor.rig.autoRigSummary ??
                          'Run Auto-Rig Scan to fit shoulder, hip, limb, and facial landmark anchors from photo.'}
                      </div>
                    </div>
                    <button
                      type="button"
                      onClick={() =>
                        updateActor(selectedActor.id, {
                          rig: createDefaultRigProportions(
                            selectedActor.isFemale
                          ),
                        })
                      }
                      className="text-xs text-cyan-300 hover:text-cyan-200 transition-colors"
                    >
                      Reset Proportions
                    </button>
                  </div>

                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                    <CalibrationSlider
                      label="Shoulder Width Ratio"
                      value={selectedActor.rig.shoulderWidthRatio}
                      min={0.8}
                      max={1.25}
                      step={0.01}
                      suffix="x"
                      onChange={(val) =>
                        updateActor(selectedActor.id, {
                          rig: { ...selectedActor.rig, shoulderWidthRatio: val },
                        })
                      }
                    />
                    <CalibrationSlider
                      label="Hip Width Ratio"
                      value={selectedActor.rig.hipWidthRatio}
                      min={0.8}
                      max={1.25}
                      step={0.01}
                      suffix="x"
                      onChange={(val) =>
                        updateActor(selectedActor.id, {
                          rig: { ...selectedActor.rig, hipWidthRatio: val },
                        })
                      }
                    />
                    <CalibrationSlider
                      label="Torso Spine Length"
                      value={selectedActor.rig.torsoLengthRatio}
                      min={0.85}
                      max={1.18}
                      step={0.01}
                      suffix="x"
                      onChange={(val) =>
                        updateActor(selectedActor.id, {
                          rig: { ...selectedActor.rig, torsoLengthRatio: val },
                        })
                      }
                    />
                    <CalibrationSlider
                      label="Arm Bone Length"
                      value={selectedActor.rig.armLengthRatio}
                      min={0.85}
                      max={1.2}
                      step={0.01}
                      suffix="x"
                      onChange={(val) =>
                        updateActor(selectedActor.id, {
                          rig: { ...selectedActor.rig, armLengthRatio: val },
                        })
                      }
                    />
                    <CalibrationSlider
                      label="Leg Length (Froude Gait Scaling)"
                      value={selectedActor.rig.legLengthRatio}
                      min={0.85}
                      max={1.2}
                      step={0.01}
                      suffix="x"
                      onChange={(val) =>
                        updateActor(selectedActor.id, {
                          rig: { ...selectedActor.rig, legLengthRatio: val },
                        })
                      }
                    />
                  </div>
                </div>
              )}

              {activeTab === 'RETARGET' && (
                <div className="space-y-4">
                  <div>
                    <div className="flex items-center justify-between text-xs mb-2">
                      <span className="text-slate-300 font-medium">
                        Motion Retargeting Style Profile
                      </span>
                      <button
                        type="button"
                        onClick={() =>
                          updateActor(selectedActor.id, {
                            retarget: createDefaultMotionRetarget(),
                          })
                        }
                        className="text-cyan-300 hover:text-cyan-200 transition-colors"
                      >
                        Reset Retargeting
                      </button>
                    </div>
                    <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
                      {(
                        Object.keys(RETARGET_PRESETS) as MotionRetargetStyle[]
                      ).map((styleKey) => {
                        const preset = RETARGET_PRESETS[styleKey];
                        const active = selectedActor.retarget.style === styleKey;
                        return (
                          <button
                            key={styleKey}
                            type="button"
                            onClick={() =>
                              updateActor(selectedActor.id, {
                                retarget: { ...preset.config },
                              })
                            }
                            className={`px-3 py-2 text-xs font-medium rounded-lg border text-left transition-colors ${
                              active
                                ? 'bg-cyan-400/15 border-cyan-400/50 text-cyan-200'
                                : 'bg-black/30 border-white/[0.08] text-slate-300 hover:border-white/20'
                            }`}
                          >
                            {preset.label}
                          </button>
                        );
                      })}
                    </div>
                  </div>

                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                    <CalibrationSlider
                      label="Stride Length Scale"
                      value={selectedActor.retarget.strideScale}
                      min={0.65}
                      max={1.35}
                      step={0.01}
                      suffix="x"
                      onChange={(val) =>
                        updateActor(selectedActor.id, {
                          retarget: {
                            ...selectedActor.retarget,
                            strideScale: val,
                          },
                        })
                      }
                    />
                    <CalibrationSlider
                      label="Arm Swing Amplitude"
                      value={selectedActor.retarget.armAmplitude}
                      min={0.55}
                      max={1.45}
                      step={0.01}
                      suffix="x"
                      onChange={(val) =>
                        updateActor(selectedActor.id, {
                          retarget: {
                            ...selectedActor.retarget,
                            armAmplitude: val,
                          },
                        })
                      }
                    />
                    <CalibrationSlider
                      label="Upper-Body Expressiveness"
                      value={selectedActor.retarget.expressiveness}
                      min={0.6}
                      max={1.45}
                      step={0.01}
                      suffix="x"
                      onChange={(val) =>
                        updateActor(selectedActor.id, {
                          retarget: {
                            ...selectedActor.retarget,
                            expressiveness: val,
                          },
                        })
                      }
                    />
                    <CalibrationSlider
                      label="Joint Follow-Through Lag"
                      value={selectedActor.retarget.phaseLag}
                      min={0.6}
                      max={1.5}
                      step={0.01}
                      suffix="x"
                      onChange={(val) =>
                        updateActor(selectedActor.id, {
                          retarget: {
                            ...selectedActor.retarget,
                            phaseLag: val,
                          },
                        })
                      }
                    />
                  </div>
                </div>
              )}

              {activeTab === 'IK' && (
                <div className="space-y-4">
                  <div className="flex items-center justify-between p-3.5 rounded-lg bg-black/30 border border-white/[0.06]">
                    <div className="text-xs text-slate-400">
                      Analytical Law-of-Cosines 2-Bone IK Solver with pole vectors & soft-extension locking prevention.
                    </div>
                    <button
                      type="button"
                      onClick={() =>
                        updateActor(selectedActor.id, {
                          ik: createDefaultIkCalibration(),
                        })
                      }
                      className="text-xs text-cyan-300 hover:text-cyan-200 transition-colors shrink-0 ml-4"
                    >
                      Reset IK Solver
                    </button>
                  </div>

                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                    <CalibrationSlider
                      label="Knee Pole / Bend Bias"
                      value={selectedActor.ik.kneeBendBias}
                      min={0.05}
                      max={0.55}
                      step={0.01}
                      onChange={(val) =>
                        updateActor(selectedActor.id, {
                          ik: { ...selectedActor.ik, kneeBendBias: val },
                        })
                      }
                    />
                    <CalibrationSlider
                      label="Resting Elbow Flexion"
                      value={selectedActor.ik.elbowBendBias}
                      min={0.02}
                      max={0.45}
                      step={0.01}
                      onChange={(val) =>
                        updateActor(selectedActor.id, {
                          ik: { ...selectedActor.ik, elbowBendBias: val },
                        })
                      }
                    />
                    <CalibrationSlider
                      label="Ankle Clearance Lift"
                      value={selectedActor.ik.ankleLiftGain}
                      min={0.5}
                      max={1.5}
                      step={0.01}
                      suffix="x"
                      onChange={(val) =>
                        updateActor(selectedActor.id, {
                          ik: { ...selectedActor.ik, ankleLiftGain: val },
                        })
                      }
                    />
                    <CalibrationSlider
                      label="Hip Stance Width"
                      value={selectedActor.ik.hipStanceWidth}
                      min={0.75}
                      max={1.35}
                      step={0.01}
                      suffix="x"
                      onChange={(val) =>
                        updateActor(selectedActor.id, {
                          ik: { ...selectedActor.ik, hipStanceWidth: val },
                        })
                      }
                    />
                    <CalibrationSlider
                      label="Soft-IK Extension Limit"
                      value={selectedActor.ik.ikSoftLimit}
                      min={0.86}
                      max={0.99}
                      step={0.01}
                      onChange={(val) =>
                        updateActor(selectedActor.id, {
                          ik: { ...selectedActor.ik, ikSoftLimit: val },
                        })
                      }
                    />
                  </div>
                </div>
              )}

              {activeTab === 'BLEND_SHAPES' && (
                <div className="space-y-4">
                  <div className="flex items-center justify-between p-3.5 rounded-lg bg-black/30 border border-white/[0.06]">
                    <div className="text-xs text-slate-400">
                      Calibrate jaw displacement, phoneme lip width, smile bias, brow raise, cheek squint, and blink cadence.
                    </div>
                    <button
                      type="button"
                      onClick={() =>
                        updateActor(selectedActor.id, {
                          blendShapes: createDefaultBlendShapes(),
                          eyeLineOffset: 0,
                          mouthLineOffset: 0,
                          faceZoom: 1.0,
                        })
                      }
                      className="text-xs text-cyan-300 hover:text-cyan-200 transition-colors shrink-0 ml-4"
                    >
                      Reset Blend Shapes
                    </button>
                  </div>

                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                    <CalibrationSlider
                      label="Jaw Open Gain"
                      value={selectedActor.blendShapes.jawOpenGain}
                      min={0.55}
                      max={1.6}
                      step={0.01}
                      suffix="x"
                      onChange={(val) =>
                        updateActor(selectedActor.id, {
                          blendShapes: {
                            ...selectedActor.blendShapes,
                            jawOpenGain: val,
                          },
                        })
                      }
                    />
                    <CalibrationSlider
                      label="Mouth Width Gain"
                      value={selectedActor.blendShapes.mouthWidthGain}
                      min={0.65}
                      max={1.4}
                      step={0.01}
                      suffix="x"
                      onChange={(val) =>
                        updateActor(selectedActor.id, {
                          blendShapes: {
                            ...selectedActor.blendShapes,
                            mouthWidthGain: val,
                          },
                        })
                      }
                    />
                    <CalibrationSlider
                      label="Lip Smile Bias"
                      value={selectedActor.blendShapes.lipSmileBias}
                      min={-0.25}
                      max={0.45}
                      step={0.01}
                      onChange={(val) =>
                        updateActor(selectedActor.id, {
                          blendShapes: {
                            ...selectedActor.blendShapes,
                            lipSmileBias: val,
                          },
                        })
                      }
                    />
                    <CalibrationSlider
                      label="Brow Lift Gain"
                      value={selectedActor.blendShapes.browLiftGain}
                      min={0.5}
                      max={1.6}
                      step={0.01}
                      suffix="x"
                      onChange={(val) =>
                        updateActor(selectedActor.id, {
                          blendShapes: {
                            ...selectedActor.blendShapes,
                            browLiftGain: val,
                          },
                        })
                      }
                    />
                    <CalibrationSlider
                      label="Cheek Squint"
                      value={selectedActor.blendShapes.cheekSquint}
                      min={0}
                      max={0.8}
                      step={0.01}
                      onChange={(val) =>
                        updateActor(selectedActor.id, {
                          blendShapes: {
                            ...selectedActor.blendShapes,
                            cheekSquint: val,
                          },
                        })
                      }
                    />
                    <CalibrationSlider
                      label="Blink Rate Gain"
                      value={selectedActor.blendShapes.blinkRateGain}
                      min={0.4}
                      max={1.8}
                      step={0.01}
                      suffix="x"
                      onChange={(val) =>
                        updateActor(selectedActor.id, {
                          blendShapes: {
                            ...selectedActor.blendShapes,
                            blinkRateGain: val,
                          },
                        })
                      }
                    />
                  </div>

                  {selectedActor.portraitDataUrl &&
                    selectedActor.avatarMode !== 'ANATOMY_RIG' && (
                      <div className="pt-3 border-t border-white/[0.06] space-y-3">
                        <div className="text-xs font-medium text-slate-300">
                          Portrait Landmark Alignment
                        </div>
                        <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
                          <CalibrationSlider
                            label="Eye Line Offset"
                            value={selectedActor.eyeLineOffset}
                            min={-0.12}
                            max={0.12}
                            step={0.01}
                            onChange={(val) =>
                              updateActor(selectedActor.id, {
                                eyeLineOffset: val,
                              })
                            }
                          />
                          <CalibrationSlider
                            label="Mouth Line Offset"
                            value={selectedActor.mouthLineOffset}
                            min={-0.12}
                            max={0.12}
                            step={0.01}
                            onChange={(val) =>
                              updateActor(selectedActor.id, {
                                mouthLineOffset: val,
                              })
                            }
                          />
                          <CalibrationSlider
                            label="Face Zoom"
                            value={selectedActor.faceZoom}
                            min={0.75}
                            max={1.35}
                            step={0.01}
                            suffix="x"
                            onChange={(val) =>
                              updateActor(selectedActor.id, { faceZoom: val })
                            }
                          />
                        </div>
                      </div>
                    )}
                </div>
              )}
            </div>
          </div>
        </section>
      )}
    </div>
  );
};

interface CalibrationSliderProps {
  label: string;
  value: number;
  min: number;
  max: number;
  step: number;
  suffix?: string;
  onChange: (value: number) => void;
}

const CalibrationSlider: React.FC<CalibrationSliderProps> = ({
  label,
  value,
  min,
  max,
  step,
  suffix = '',
  onChange,
}) => (
  <div className="p-3 rounded-lg bg-black/30 border border-white/[0.06]">
    <div className="flex items-center justify-between text-xs mb-1.5">
      <span className="text-slate-300">{label}</span>
      <span className="font-mono tabular-nums text-cyan-200">
        {value.toFixed(2)}
        {suffix}
      </span>
    </div>
    <input
      type="range"
      min={min}
      max={max}
      step={step}
      value={value}
      onChange={(e) => onChange(parseFloat(e.target.value))}
      className="w-full accent-cyan-400 cursor-pointer"
    />
  </div>
);
