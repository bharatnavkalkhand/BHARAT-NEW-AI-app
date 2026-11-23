import {
  ActorProfile,
  ASPECT_CONFIG,
  AspectFormat,
  CameraFraming,
  DirectedScene,
  DRESS_STUDIO_IMAGES,
  DressStyle,
  OverlayTemplateConfig,
} from './types';
import {
  loadDressCutoutCanvas,
  loadPortraitImage,
  resolveActorSidePortraitUrl,
  WebGlSceneRenderer,
} from './gpuSceneRenderer';
import { ThreeGlbStageRenderer } from './glbAvatarEngine';

export interface GpuBatchInitPayload {
  scenes: DirectedScene[];
  cast: ActorProfile[];
  format: AspectFormat;
  framing: CameraFraming;
  gestureBoost?: number;
  overlayConfig?: OverlayTemplateConfig;
}

export interface BharatGpuBridge {
  init: (payload: GpuBatchInitPayload) => Promise<void>;
  renderStep: (
    sceneIndex: number,
    progress: number,
    timeSec: number,
    audioAmp: number,
    visemeWidth: number
  ) => boolean;
  dispose: () => void;
}

declare global {
  interface Window {
    __BHARAT_GPU_RENDER__?: BharatGpuBridge;
  }
}

export function mountGpuBatchBridge(canvas: HTMLCanvasElement): () => void {
  let renderer: WebGlSceneRenderer | null = null;
  let glbRenderer: ThreeGlbStageRenderer | null = null;
  let activeScenes: DirectedScene[] = [];
  let activeCast: ActorProfile[] = [];
  let activeFraming: CameraFraming = CameraFraming.FULL_BODY;
  let activeGestureBoost = 1.45;
  let activeOverlayConfig: OverlayTemplateConfig | undefined;
  const portraitCache = new Map<string, HTMLImageElement | null>();
  const sidePortraitCache = new Map<string, HTMLImageElement | null>();
  const cutoutCache = new Map<DressStyle, HTMLCanvasElement | null>();

  const cleanup = () => {
    renderer?.dispose();
    renderer = null;
    glbRenderer?.dispose();
    glbRenderer = null;
    portraitCache.clear();
    sidePortraitCache.clear();
    cutoutCache.clear();
  };

  window.__BHARAT_GPU_RENDER__ = {
    async init(payload: GpuBatchInitPayload) {
      cleanup();
      activeScenes = payload.scenes ?? [];
      activeCast = payload.cast ?? [];
      activeFraming = payload.framing ?? CameraFraming.FULL_BODY;
      activeGestureBoost = payload.gestureBoost ?? 1.45;
      activeOverlayConfig = payload.overlayConfig;

      const dims = ASPECT_CONFIG[payload.format] ?? ASPECT_CONFIG[AspectFormat.REEL_9_16];
      canvas.width = dims.width;
      canvas.height = dims.height;

      renderer = new WebGlSceneRenderer(canvas);
      renderer.resize(dims.width, dims.height);

      for (const actor of activeCast) {
        portraitCache.set(actor.id, await loadPortraitImage(actor.portraitDataUrl));
        sidePortraitCache.set(actor.id, await loadPortraitImage(resolveActorSidePortraitUrl(actor)));
      }
      for (const [style, url] of Object.entries(DRESS_STUDIO_IMAGES)) {
        if (url) {
          cutoutCache.set(style as DressStyle, await loadDressCutoutCanvas(url));
        }
      }

      const hasGlb = activeCast.some((a) => a.avatarMode === 'GLB_3D' && a.glbModelUrl);
      if (hasGlb) {
        glbRenderer = new ThreeGlbStageRenderer(dims.width, dims.height);
        for (const actor of activeCast) {
          if (actor.avatarMode === 'GLB_3D' && actor.glbModelUrl) {
            await glbRenderer.ensureLoaded(actor.glbModelUrl);
          }
        }
      }
    },

    renderStep(
      sceneIndex: number,
      progress: number,
      timeSec: number,
      audioAmp: number,
      visemeWidth: number
    ) {
      if (!renderer || activeScenes.length === 0) return false;
      const scene = activeScenes[sceneIndex] ?? activeScenes[0];
      const actor = activeCast.find((a) => a.id === scene.actorId) ?? activeCast[0];
      if (!scene || !actor) return false;

      const activeDress = scene.dressOverride ?? actor.dressStyle;
      let glbRenderCanvas: HTMLCanvasElement | null = null;
      if (
        glbRenderer &&
        actor.avatarMode === 'GLB_3D' &&
        actor.glbModelUrl &&
        glbRenderer.isReadyFor(actor.glbModelUrl)
      ) {
        if (
          glbRenderer.renderFrame({
            actor,
            gesture: scene.gesture,
            emotion: scene.emotion,
            biome: scene.biome,
            framing: activeFraming,
            timeSec,
            progress,
            audioAmp,
            visemeWidth,
            showRigOverlay: false,
            gestureBoost: activeGestureBoost,
            sceneIndex: scene.index,
            cameraPanRange: scene.cameraPanRange,
            poseMode: scene.poseMode,
            poseSide: scene.poseSide,
            walkingDestination: scene.walkingDestination,
          })
        ) {
          glbRenderCanvas = glbRenderer.getCanvas();
        }
      }

      renderer.renderFrame({
        scene,
        actor,
        framing: activeFraming,
        portraitImg: portraitCache.get(actor.id) ?? null,
        sidePortraitImg: sidePortraitCache.get(actor.id) ?? null,
        dressCutoutCanvas: cutoutCache.get(activeDress) ?? null,
        poseSide: scene.poseSide,
        progress,
        timeSec,
        audioAmp,
        visemeWidth,
        showRigOverlay: false,
        glbRenderCanvas,
        gestureBoost: activeGestureBoost,
        overlayConfig: activeOverlayConfig,
      });
      return true;
    },

    dispose() {
      cleanup();
    },
  };

  return () => {
    cleanup();
    delete window.__BHARAT_GPU_RENDER__;
  };
}
