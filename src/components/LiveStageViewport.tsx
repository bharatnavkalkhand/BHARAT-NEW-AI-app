import React, { useEffect, useRef, useState } from 'react';
import {
  AlertCircle,
  CheckCircle2,
  Crosshair,
  Download,
  Film,
  Pause,
  Play,
  SkipBack,
  SkipForward,
  Volume2,
  VolumeX,
} from 'lucide-react';
import {
  ActorProfile,
  ASPECT_CONFIG,
  AspectFormat,
  BIOME_LABELS,
  CameraFraming,
  DirectedScene,
  DRESS_LABELS,
  DRESS_STUDIO_IMAGES,
  DressStyle,
  FRAMING_LABELS,
  GESTURE_LABELS,
  OverlayTemplateConfig,
  VideoQaReport,
  VoiceLang,
} from '../engine/types';
import { WebAudioMixEngine } from '../engine/audioMixEngine';
import {
  loadDressCutoutCanvas,
  loadPortraitImage,
  resolveActorSidePortraitUrl,
  WebGlSceneRenderer,
} from '../engine/gpuSceneRenderer';
import { ThreeGlbStageRenderer } from '../engine/glbAvatarEngine';

interface LiveStageViewportProps {
  scenes: DirectedScene[];
  cast: ActorProfile[];
  format: AspectFormat;
  framing: CameraFraming;
  language: VoiceLang;
  activeSceneIndex: number;
  onSelectSceneIndex: (index: number) => void;
  audioEngine: WebAudioMixEngine;
  renderedVideoUrl: string | null;
  renderedDownloadUrl?: string | null;
  renderedVideoMime: string;
  renderProgressPct: number | null;
  renderStageLabel: string;
  gestureBoost?: number;
  overlayConfig?: OverlayTemplateConfig;
  qaReport?: VideoQaReport | null;
}

export const LiveStageViewport: React.FC<LiveStageViewportProps> = ({
  scenes,
  cast,
  format,
  framing,
  language,
  activeSceneIndex,
  onSelectSceneIndex,
  audioEngine,
  renderedVideoUrl,
  renderedDownloadUrl,
  renderedVideoMime,
  renderProgressPct,
  renderStageLabel,
  gestureBoost = 1.35,
  overlayConfig,
  qaReport = null,
}) => {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const rendererRef = useRef<WebGlSceneRenderer | null>(null);
  const glbRendererRef = useRef<ThreeGlbStageRenderer | null>(null);
  const portraitMapRef = useRef<Map<string, HTMLImageElement | null>>(new Map());
  const sidePortraitMapRef = useRef<Map<string, HTMLImageElement | null>>(new Map());
  const dressCutoutMapRef = useRef<Map<DressStyle, HTMLCanvasElement | null>>(new Map());
  const stageEpochRef = useRef<number>(performance.now());

  const [isPlaying, setIsPlaying] = useState(false);
  const [isMuted, setIsMuted] = useState(false);
  const [showRigOverlay, setShowRigOverlay] = useState(false);
  const [sceneProgress, setSceneProgress] = useState(0);
  const [showExportPreview, setShowExportPreview] = useState(false);
  const [use2dFallback, setUse2dFallback] = useState(false);
  const [stageRetryKey, setStageRetryKey] = useState(0);
  const [stageError, setStageError] = useState<string | null>(null);

  const dims = ASPECT_CONFIG[format];
  const currentScene = scenes[activeSceneIndex] ?? scenes[0];
  const currentActor =
    cast.find((a) => a.id === currentScene?.actorId) ?? cast[0];

  useEffect(() => {
    if (renderedVideoUrl) {
      setIsPlaying(false);
      audioEngine.stopAmbientDrone();
      audioEngine.stopSpeech();
      setShowExportPreview(true);
    }
  }, [renderedVideoUrl, audioEngine]);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const next = new Map<string, HTMLImageElement | null>();
      const nextSide = new Map<string, HTMLImageElement | null>();
      for (const actor of cast) {
        next.set(actor.id, await loadPortraitImage(actor.portraitDataUrl));
        nextSide.set(actor.id, await loadPortraitImage(resolveActorSidePortraitUrl(actor)));
      }
      if (!cancelled) {
        portraitMapRef.current = next;
        sidePortraitMapRef.current = nextSide;
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [cast]);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const next = new Map<DressStyle, HTMLCanvasElement | null>();
      for (const [style, url] of Object.entries(DRESS_STUDIO_IMAGES)) {
        if (url) {
          next.set(style as DressStyle, await loadDressCutoutCanvas(url));
        }
      }
      if (!cancelled) {
        dressCutoutMapRef.current = next;
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    setStageError(null);
    let renderer: WebGlSceneRenderer | null = null;
    try {
      renderer = new WebGlSceneRenderer(canvas, use2dFallback);
      if (!renderer.isWebGlActive() && !use2dFallback) {
        renderer.dispose();
        setUse2dFallback(true);
        return;
      }
      renderer.resize(dims.width, dims.height);
      rendererRef.current = renderer;
    } catch {
      renderer?.dispose();
      rendererRef.current = null;
      if (!use2dFallback) {
        setUse2dFallback(true);
      } else {
        setStageError('Stage renderer failed to initialize in this browser.');
      }
      return;
    }

    return () => {
      renderer?.dispose();
      rendererRef.current = null;
      glbRendererRef.current?.dispose();
      glbRendererRef.current = null;
    };
  }, [use2dFallback, stageRetryKey]);

  useEffect(() => {
    rendererRef.current?.resize(dims.width, dims.height);
    glbRendererRef.current?.resize(dims.width, dims.height);
  }, [dims.width, dims.height]);

  useEffect(() => {
    if (currentActor?.avatarMode === 'GLB_3D' && currentActor.glbModelUrl) {
      if (!glbRendererRef.current) {
        glbRendererRef.current = new ThreeGlbStageRenderer(dims.width, dims.height);
      }
      glbRendererRef.current.resize(dims.width, dims.height);
      void glbRendererRef.current.ensureLoaded(currentActor.glbModelUrl);
    }
  }, [currentActor?.avatarMode, currentActor?.glbModelUrl, dims.width, dims.height]);

  useEffect(() => {
    if (!isPlaying || !currentScene || !currentActor) {
      audioEngine.stopAmbientDrone();
      audioEngine.stopSpeech();
      return;
    }
    audioEngine.startAmbientDrone(currentScene.biome);
    void audioEngine.playSceneVoice(currentScene, currentActor, language);

    return () => {
      audioEngine.stopSpeech();
    };
  }, [isPlaying, activeSceneIndex, currentScene?.id, currentActor?.id, language, audioEngine]);

  useEffect(() => {
    return () => {
      audioEngine.stopAmbientDrone();
      audioEngine.stopSpeech();
    };
  }, [audioEngine]);

  useEffect(() => {
    if (!currentScene || !currentActor) return;
    let rafId = 0;
    const sceneStart = performance.now();

    const tick = (now: number) => {
      const renderer = rendererRef.current;
      if (renderer) {
        const elapsed = now - sceneStart;
        const duration = currentScene.durationMs || 3500;
        const continuousTimeSec = (now - stageEpochRef.current) / 1000;

        if (isPlaying && elapsed >= duration) {
          if (activeSceneIndex < scenes.length - 1) {
            onSelectSceneIndex(activeSceneIndex + 1);
            return;
          } else {
            setIsPlaying(false);
            setSceneProgress(0);
            audioEngine.stopAmbientDrone();
            audioEngine.stopSpeech();
            return;
          }
        }

        const progress = isPlaying
          ? Math.min(1, elapsed / duration)
          : ((elapsed % duration) / duration);

        const exactFrame = ((elapsed % duration) / 1000) * 30;
        const maxIdx = Math.max(0, currentScene.lipSyncEnvelope.length - 1);
        const f0 = Math.min(maxIdx, Math.floor(exactFrame));
        const f1 = Math.min(maxIdx, f0 + 1);
        const frac = exactFrame - Math.floor(exactFrame);
        const env0 = currentScene.lipSyncEnvelope[f0] ?? 0;
        const env1 = currentScene.lipSyncEnvelope[f1] ?? env0;
        const interpolatedEnv = env0 * (1 - frac) + env1 * frac;

        const w0 = currentScene.visemeWidths?.[f0] ?? 0.95;
        const w1 = currentScene.visemeWidths?.[f1] ?? w0;
        const interpolatedWidth = w0 * (1 - frac) + w1 * frac;

        const audioAmp = isPlaying
          ? interpolatedEnv
          : 0.14 * Math.abs(Math.sin(continuousTimeSec * 3.1));

        const activeDress = currentScene.dressOverride ?? currentActor.dressStyle;
        let glbRenderCanvas: HTMLCanvasElement | null = null;
        const glbRenderer = glbRendererRef.current;
        if (
          glbRenderer &&
          currentActor.avatarMode === 'GLB_3D' &&
          currentActor.glbModelUrl &&
          glbRenderer.isReadyFor(currentActor.glbModelUrl)
        ) {
          try {
            if (
              glbRenderer.renderFrame({
                actor: currentActor,
                gesture: currentScene.gesture,
                emotion: currentScene.emotion,
                framing,
                biome: currentScene.biome,
                timeSec: continuousTimeSec,
                progress,
                audioAmp,
                visemeWidth: isPlaying ? interpolatedWidth : 0.96,
                showRigOverlay,
                gestureBoost,
                sceneIndex: currentScene.index,
                cameraPanRange: currentScene.cameraPanRange,
                poseMode: currentScene.poseMode,
                poseSide: currentScene.poseSide,
                walkingDestination: currentScene.walkingDestination,
              })
            ) {
              glbRenderCanvas = glbRenderer.getCanvas();
            }
          } catch {
            glbRenderCanvas = null;
          }
        }

        try {
          renderer.renderFrame({
            scene: currentScene,
            actor: currentActor,
            framing,
            portraitImg: portraitMapRef.current.get(currentActor.id) ?? null,
            sidePortraitImg: sidePortraitMapRef.current.get(currentActor.id) ?? null,
            dressCutoutCanvas: dressCutoutMapRef.current.get(activeDress) ?? null,
            poseSide: currentScene.poseSide,
            progress,
            timeSec: continuousTimeSec,
            audioAmp,
            visemeWidth: isPlaying ? interpolatedWidth : 0.96,
            showRigOverlay,
            glbRenderCanvas,
            gestureBoost,
            overlayConfig,
          });
        } catch {
          if (!use2dFallback) {
            setUse2dFallback(true);
            return;
          }
          setStageError('Stage render encountered a graphics error.');
          return;
        }

        setSceneProgress(progress);
      }

      rafId = requestAnimationFrame(tick);
    };

    rafId = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(rafId);
  }, [
    currentScene,
    currentActor,
    framing,
    isPlaying,
    showRigOverlay,
    activeSceneIndex,
    scenes.length,
    onSelectSceneIndex,
    audioEngine,
    use2dFallback,
    stageRetryKey,
    gestureBoost,
    overlayConfig,
  ]);

  const handleTogglePlay = () => {
    if (showExportPreview) setShowExportPreview(false);
    setIsPlaying((prev) => !prev);
  };

  const handleToggleMute = () => {
    const next = !isMuted;
    setIsMuted(next);
    audioEngine.setMuted(next);
  };

  const handleDownloadWav = () => {
    if (scenes.length === 0) return;
    const blob = audioEngine.renderMasterWavBlob(scenes);
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `BharatAI_Master_Audio_${Date.now()}.wav`;
    a.click();
    URL.revokeObjectURL(url);
  };

  return (
    <div className="flex flex-col h-full bg-[#0D111A] border border-white/[0.08] rounded-xl overflow-hidden">
      {/* Viewport Header Strip */}
      <div className="flex items-center justify-between gap-4 px-5 py-3.5 border-b border-white/[0.08] bg-[#101520]">
        <div className="flex items-center gap-3 min-w-0">
          <span className="text-sm font-medium text-slate-100 whitespace-nowrap">
            {showExportPreview && renderedVideoUrl ? 'Rendered Film' : 'Live WebGL Stage'}
          </span>
          {currentScene && currentActor && (
            <div className="hidden sm:flex items-center gap-2 text-xs text-slate-400 truncate">
              <span aria-hidden="true">·</span>
              <span className="font-mono tabular-nums text-cyan-300">
                Scene {String(currentScene.index).padStart(2, '0')} / {String(scenes.length).padStart(2, '0')}
              </span>
              <span aria-hidden="true">·</span>
              <span className="truncate">{FRAMING_LABELS[framing]}</span>
              <span aria-hidden="true">·</span>
              <span className="truncate">
                {DRESS_LABELS[currentScene.dressOverride ?? currentActor.dressStyle]}
              </span>
              <span aria-hidden="true">·</span>
              <span className="truncate">{BIOME_LABELS[currentScene.biome]}</span>
              <span aria-hidden="true">·</span>
              <span className="truncate">{GESTURE_LABELS[currentScene.gesture]}</span>
            </div>
          )}
        </div>

        <div className="flex items-center gap-2 shrink-0">
          {renderedVideoUrl && (
            <div className="flex items-center gap-1 p-1 bg-black/40 rounded-lg border border-white/[0.08]">
              <button
                type="button"
                onClick={() => setShowExportPreview(false)}
                className={`px-3 py-1 text-xs font-medium rounded-md transition-colors whitespace-nowrap shrink-0 ${
                  !showExportPreview
                    ? 'bg-slate-800 text-white'
                    : 'text-slate-400 hover:text-slate-200'
                }`}
              >
                Live Stage
              </button>
              <button
                type="button"
                onClick={() => {
                  setIsPlaying(false);
                  setShowExportPreview(true);
                }}
                className={`px-3 py-1 text-xs font-medium rounded-md transition-colors whitespace-nowrap shrink-0 ${
                  showExportPreview
                    ? 'bg-cyan-500/20 text-cyan-300'
                    : 'text-slate-400 hover:text-slate-200'
                }`}
              >
                Exported Video
              </button>
            </div>
          )}
        </div>
      </div>

      {/* Main Canvas / Video Surface */}
      <div className="relative flex-1 min-h-[440px] flex items-center justify-center p-5 bg-[#070A10]">
        {renderProgressPct !== null && (
          <div className="absolute inset-0 z-20 flex flex-col items-center justify-center bg-[#070A10]/85 backdrop-blur-sm px-6">
            <div className="w-full max-w-md space-y-3 text-center">
              <p className="text-sm font-medium text-slate-200">{renderStageLabel}</p>
              <div className="h-2 w-full bg-slate-800 rounded-full overflow-hidden">
                <div
                  className="h-full bg-cyan-400 transition-all duration-150"
                  style={{ width: `${renderProgressPct}%` }}
                />
              </div>
              <p className="text-xs font-mono tabular-nums text-cyan-300">
                {renderProgressPct}% encoded
              </p>
            </div>
          </div>
        )}

        {showExportPreview && renderedVideoUrl ? (
          <div className="flex flex-col items-center gap-4 w-full h-full justify-center overflow-y-auto py-1">
            <video
              key={renderedVideoUrl}
              src={renderedVideoUrl}
              controls
              autoPlay
              playsInline
              className="max-h-[430px] w-auto rounded-lg border border-white/10 bg-black shadow-2xl"
            />
            <div className="flex flex-wrap items-center justify-center gap-3">
              <a
                href={renderedDownloadUrl || renderedVideoUrl}
                download={`BharatAI_Reel_${dims.width}x${dims.height}_${Date.now()}.${
                  renderedVideoMime.includes('mp4') ? 'mp4' : 'webm'
                }`}
                className="inline-flex items-center gap-2 px-4 py-2 text-xs font-semibold text-slate-950 bg-cyan-400 hover:bg-cyan-300 rounded-lg transition-colors whitespace-nowrap"
              >
                <Download className="w-4 h-4" />
                {renderedVideoMime.includes('mp4')
                  ? `Download MP4 (${dims.width}×${dims.height} H.264)`
                  : `Download Video (${renderedVideoMime.includes('vp9') ? 'WebM VP9' : 'WebM'})`}
              </a>
              <button
                type="button"
                onClick={handleDownloadWav}
                className="inline-flex items-center gap-2 px-4 py-2 text-xs font-medium text-slate-200 bg-[#151C2C] hover:bg-[#1C263B] border border-white/10 rounded-lg transition-colors whitespace-nowrap"
              >
                <Film className="w-4 h-4" />
                Download Master Audio (.wav)
              </button>
            </div>

            {qaReport && (
              <div className="w-full max-w-[680px] bg-[#101520] border border-white/[0.08] rounded-xl p-3.5 space-y-2.5 text-left">
                <div className="flex flex-wrap items-center justify-between gap-2 pb-2 border-b border-white/[0.06]">
                  <div className="flex items-center gap-2">
                    {qaReport.passedAll ? (
                      <CheckCircle2 className="w-4 h-4 text-emerald-400 shrink-0" />
                    ) : (
                      <AlertCircle className="w-4 h-4 text-amber-400 shrink-0" />
                    )}
                    <span className="text-xs font-semibold text-white">
                      Export Quality Audit (ffprobe · ebur128)
                    </span>
                  </div>
                  <div className="flex flex-wrap items-center gap-2 text-[11px] font-mono tabular-nums text-slate-400">
                    <span>{qaReport.durationSec.toFixed(1)}s</span>
                    <span aria-hidden="true">·</span>
                    <span>{qaReport.fileSizeMb.toFixed(2)} MB</span>
                    <span aria-hidden="true">·</span>
                    <span>{qaReport.detectedCuts} cuts</span>
                    {qaReport.integratedLufs !== null && (
                      <>
                        <span aria-hidden="true">·</span>
                        <span>{qaReport.integratedLufs.toFixed(1)} LUFS</span>
                      </>
                    )}
                  </div>
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                  {qaReport.checks.map((chk) => (
                    <div
                      key={chk.id}
                      className="flex items-start justify-between gap-2 px-2.5 py-2 rounded-lg bg-black/30 border border-white/[0.06]"
                    >
                      <div className="min-w-0">
                        <div className="text-[11px] font-medium text-slate-200 truncate">
                          {chk.label}
                        </div>
                        <div className="text-[11px] font-mono tabular-nums text-slate-400 truncate mt-0.5">
                          {chk.actual}
                        </div>
                      </div>
                      <span
                        className={`text-[10px] font-semibold uppercase tracking-wider px-1.5 py-0.5 rounded shrink-0 ${
                          chk.passed
                            ? 'bg-emerald-500/15 text-emerald-300'
                            : 'bg-amber-500/15 text-amber-300'
                        }`}
                      >
                        {chk.passed ? 'Pass' : 'Warn'}
                      </span>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
        ) : (
          <div
            className={`relative flex items-center justify-center overflow-hidden rounded-lg border border-white/10 bg-black shadow-2xl ${
              format === AspectFormat.PORTRAIT_3_4
                ? 'h-[520px] aspect-[3/4]'
                : format === AspectFormat.REEL_9_16
                  ? 'h-[520px] aspect-[9/16]'
                  : 'w-full max-w-[780px] aspect-[16/9]'
            }`}
          >
            <canvas
              key={`${use2dFallback ? '2d' : 'gl'}-${stageRetryKey}`}
              ref={canvasRef}
              width={dims.width}
              height={dims.height}
              className="w-full h-full object-contain block"
            />
            {stageError && (
              <div className="absolute inset-0 z-10 flex flex-col items-center justify-center gap-3 bg-[#070A10]/90 p-5 text-center">
                <p className="text-xs text-slate-300 max-w-xs">{stageError}</p>
                <button
                  type="button"
                  onClick={() => {
                    setStageError(null);
                    setStageRetryKey((k) => k + 1);
                  }}
                  className="px-3.5 py-1.5 text-xs font-semibold text-slate-950 bg-cyan-400 hover:bg-cyan-300 rounded-lg transition-colors"
                >
                  Retry Stage
                </button>
              </div>
            )}
          </div>
        )}
      </div>

      {/* Bottom Transport Controls */}
      <div className="flex flex-wrap items-center justify-between gap-4 px-5 py-3.5 border-t border-white/[0.08] bg-[#101520]">
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={() => {
              setShowExportPreview(false);
              onSelectSceneIndex(Math.max(0, activeSceneIndex - 1));
            }}
            disabled={activeSceneIndex <= 0}
            aria-label="Previous scene"
            className="p-2.5 rounded-lg text-slate-300 hover:text-white hover:bg-white/[0.06] disabled:opacity-35 disabled:pointer-events-none transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cyan-400/70"
          >
            <SkipBack className="w-4 h-4" />
          </button>

          <button
            type="button"
            onClick={handleTogglePlay}
            className="inline-flex items-center gap-2 px-4 py-2 text-xs font-semibold text-slate-950 bg-cyan-400 hover:bg-cyan-300 rounded-lg transition-colors whitespace-nowrap shrink-0 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cyan-400"
          >
            {isPlaying ? <Pause className="w-4 h-4" /> : <Play className="w-4 h-4" />}
            {isPlaying ? 'Pause Film' : 'Play Full Film'}
          </button>

          <button
            type="button"
            onClick={() => {
              setShowExportPreview(false);
              onSelectSceneIndex(Math.min(scenes.length - 1, activeSceneIndex + 1));
            }}
            disabled={activeSceneIndex >= scenes.length - 1}
            aria-label="Next scene"
            className="p-2.5 rounded-lg text-slate-300 hover:text-white hover:bg-white/[0.06] disabled:opacity-35 disabled:pointer-events-none transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cyan-400/70"
          >
            <SkipForward className="w-4 h-4" />
          </button>
        </div>

        {/* Scene Progress Scrubber */}
        <div className="flex-1 min-w-[160px] flex items-center gap-3">
          <div className="flex-1 h-1.5 bg-slate-800 rounded-full overflow-hidden">
            <div
              className="h-full bg-cyan-400 transition-[width] duration-75"
              style={{ width: `${Math.round(sceneProgress * 100)}%` }}
            />
          </div>
          <span className="text-xs font-mono tabular-nums text-slate-400 whitespace-nowrap">
            {((currentScene?.durationMs ?? 0) / 1000).toFixed(1)}s
          </span>
        </div>

        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={() => setShowRigOverlay((v) => !v)}
            aria-pressed={showRigOverlay}
            className={`inline-flex items-center gap-1.5 px-3 py-2 text-xs font-medium border rounded-lg transition-colors whitespace-nowrap ${
              showRigOverlay
                ? 'bg-cyan-400/15 border-cyan-400/50 text-cyan-200'
                : 'text-slate-300 hover:text-white bg-white/[0.04] hover:bg-white/[0.08] border-white/[0.08]'
            }`}
          >
            <Crosshair className="w-3.5 h-3.5" />
            Rig Overlay
          </button>

          <button
            type="button"
            onClick={handleToggleMute}
            aria-label={isMuted ? 'Unmute audio' : 'Mute audio'}
            className="inline-flex items-center gap-1.5 px-3 py-2 text-xs font-medium text-slate-300 hover:text-white bg-white/[0.04] hover:bg-white/[0.08] border border-white/[0.08] rounded-lg transition-colors whitespace-nowrap"
          >
            {isMuted ? <VolumeX className="w-4 h-4 text-amber-400" /> : <Volume2 className="w-4 h-4" />}
            {isMuted ? 'Muted' : 'Sound On'}
          </button>

          <button
            type="button"
            onClick={handleDownloadWav}
            className="inline-flex items-center gap-1.5 px-3 py-2 text-xs font-medium text-slate-300 hover:text-white bg-white/[0.04] hover:bg-white/[0.08] border border-white/[0.08] rounded-lg transition-colors whitespace-nowrap"
          >
            <Download className="w-4 h-4" />
            Export WAV
          </button>
        </div>
      </div>
    </div>
  );
};
