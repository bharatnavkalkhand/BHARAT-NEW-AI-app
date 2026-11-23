import { useEffect, useMemo, useRef, useState } from 'react';
import {
  Clapperboard,
  Film,
  Link2,
  Mic,
  MicOff,
  Radio,
  RotateCcw,
  Sparkles,
  Square,
  Trash2,
  Upload,
  Video,
  Volume2,
  Wand2,
} from 'lucide-react';
import {
  ASPECT_CONFIG,
  AspectFormat,
  AvatarMode,
  BIOME_LABELS,
  CameraFraming,
  CaptionPosition,
  DEFAULT_STORY_ENGLISH,
  DEFAULT_STORY_HINDI,
  DirectedScene,
  DRESS_LABELS,
  DressStyle,
  EMOTION_LABELS,
  EnvBiome,
  FRAMING_LABELS,
  GESTURE_LABELS,
  GestureAction,
  INITIAL_CAST,
  OverlayTemplateConfig,
  PoseSide,
  VideoQaReport,
  VOICE_LANG_LABELS,
  VOICE_PROFILES,
  VoiceLang,
} from './engine/types';
import {
  buildSyllableLipSyncEnvelope,
  directStoryLocally,
  requestAiDirectedScenes,
  requestSceneTtsSynthesis,
} from './engine/localDirectorBrain';
import {
  buildTimedCaptionCues,
  computeEffectiveTimelineSeconds,
  computeSceneDurationMsFromNarration,
  createDefaultOverlayConfig,
} from './engine/videoProduction';
import { WebAudioMixEngine } from './engine/audioMixEngine';
import { renderMovieToMp4ViaServer } from './engine/gpuSceneRenderer';
import { mountGpuBatchBridge } from './engine/gpuBatchBridge';
import { ErrorBoundary } from './components/ErrorBoundary';
import { LiveStageViewport } from './components/LiveStageViewport';
import { CastManagerView } from './components/CastManagerView';
import { TimelineChoreographyView } from './components/TimelineChoreographyView';
import { ColabGpuExportView } from './components/ColabGpuExportView';
import { AndroidSourceView } from './components/AndroidSourceView';

type StudioTab = 'studio' | 'cast' | 'timeline' | 'colab' | 'android';

interface SpeechRecognitionAlternativeLike {
  transcript: string;
}

interface SpeechRecognitionResultLike {
  [index: number]: SpeechRecognitionAlternativeLike;
}

interface SpeechRecognitionEventLike {
  results: {
    [index: number]: SpeechRecognitionResultLike;
  };
}

interface SpeechRecognitionLike {
  lang: string;
  interimResults: boolean;
  maxAlternatives: number;
  onresult: ((event: SpeechRecognitionEventLike) => void) | null;
  onerror: ((event: { error?: string }) => void) | null;
  onend: (() => void) | null;
  start: () => void;
  stop: () => void;
}

function GpuExportStage() {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    return mountGpuBatchBridge(canvas);
  }, []);

  return (
    <div className="w-screen h-screen bg-black flex items-center justify-center overflow-hidden">
      <canvas
        id="gpu-export-canvas"
        ref={canvasRef}
        width={720}
        height={1280}
        className="block"
      />
    </div>
  );
}

export default function App() {
  const isGpuExportMode =
    typeof window !== 'undefined' &&
    new URLSearchParams(window.location.search).get('gpuExport') === '1';

  if (isGpuExportMode) {
    return <GpuExportStage />;
  }

  return <StudioWorkspace />;
}

function StudioWorkspace() {
  const audioEngine = useMemo(() => new WebAudioMixEngine(), []);

  const [activeTab, setActiveTab] = useState<StudioTab>('studio');
  const [idea, setIdea] = useState<string>(DEFAULT_STORY_HINDI);
  const [language, setLanguage] = useState<VoiceLang>(VoiceLang.HINDI);
  const [format, setFormat] = useState<AspectFormat>(AspectFormat.REEL_9_16);
  const [framing, setFraming] = useState<CameraFraming>(CameraFraming.FULL_BODY);
  const [cast, setCast] = useState(INITIAL_CAST);

  const [scenes, setScenes] = useState<DirectedScene[]>(() =>
    directStoryLocally(DEFAULT_STORY_HINDI, VoiceLang.HINDI, INITIAL_CAST)
  );
  const [activeSceneIndex, setActiveSceneIndex] = useState<number>(0);

  const [isListening, setIsListening] = useState(false);
  const [micNotice, setMicNotice] = useState<string | null>(null);
  const recognitionRef = useRef<SpeechRecognitionLike | null>(null);

  const [isRecordingVoice, setIsRecordingVoice] = useState(false);
  const [isAnalyzingVoice, setIsAnalyzingVoice] = useState(false);
  const [isSynthesizingTts, setIsSynthesizingTts] = useState(false);
  const [ttsError, setTtsError] = useState<string | null>(null);
  const [voiceError, setVoiceError] = useState<string | null>(null);
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const voiceStreamRef = useRef<MediaStream | null>(null);
  const voiceFileInputRef = useRef<HTMLInputElement | null>(null);
  const clipFileInputRef = useRef<HTMLInputElement | null>(null);
  const voiceBlobUrlsRef = useRef<Set<string>>(new Set());

  const [directorInstruction, setDirectorInstruction] = useState<string>('');
  const [isAiDirecting, setIsAiDirecting] = useState(false);
  const [aiDirectorError, setAiDirectorError] = useState<string | null>(null);
  const [syncVoiceAndActor, setSyncVoiceAndActor] = useState(true);
  const [gestureBoost, setGestureBoost] = useState<number>(1.35);
  const [overlayConfig, setOverlayConfig] = useState<OverlayTemplateConfig>(() =>
    createDefaultOverlayConfig()
  );

  const [renderProgressPct, setRenderProgressPct] = useState<number | null>(null);
  const [renderStageLabel, setRenderStageLabel] = useState<string>('');
  const [renderedVideoUrl, setRenderedVideoUrl] = useState<string | null>(null);
  const [renderedDownloadUrl, setRenderedDownloadUrl] = useState<string | null>(null);
  const [renderedVideoMime, setRenderedVideoMime] = useState<string>('video/mp4');
  const [qaReport, setQaReport] = useState<VideoQaReport | null>(null);
  const [renderError, setRenderError] = useState<string | null>(null);

  useEffect(() => {
    return () => {
      if (renderedVideoUrl && renderedVideoUrl.startsWith('blob:')) {
        URL.revokeObjectURL(renderedVideoUrl);
      }
    };
  }, [renderedVideoUrl]);

  useEffect(() => {
    const urls = voiceBlobUrlsRef.current;
    return () => {
      if (mediaRecorderRef.current && mediaRecorderRef.current.state !== 'inactive') {
        try {
          mediaRecorderRef.current.stop();
        } catch {
          // Ignore recorder stop errors during unmount
        }
      }
      voiceStreamRef.current?.getTracks().forEach((t) => t.stop());
      urls.forEach((url) => URL.revokeObjectURL(url));
      urls.clear();
    };
  }, []);

  const applyVoiceClipToScene = async (
    sceneIdx: number,
    audioUrl: string,
    label: string,
    extraPatch?: Partial<DirectedScene>
  ) => {
    setIsAnalyzingVoice(true);
    setVoiceError(null);
    try {
      const { durationMs: analyzedMs, envelope, visemeWidths } =
        await audioEngine.analyzeAudioUrlToLipSync(audioUrl);
      const finalDurationMs = extraPatch?.durationMs ?? analyzedMs;
      voiceBlobUrlsRef.current.add(audioUrl);
      setScenes((prev) =>
        prev.map((s, idx) => {
          if (idx !== sceneIdx) return s;
          if (
            s.voiceAudioUrl &&
            s.voiceAudioUrl !== audioUrl &&
            voiceBlobUrlsRef.current.has(s.voiceAudioUrl)
          ) {
            URL.revokeObjectURL(s.voiceAudioUrl);
            voiceBlobUrlsRef.current.delete(s.voiceAudioUrl);
          }
          const capSource = (s.captionText ?? '').trim() || s.dialogue;
          return {
            ...s,
            ...extraPatch,
            voiceAudioUrl: audioUrl,
            voiceAudioLabel: label,
            durationMs: finalDurationMs,
            lipSyncEnvelope: envelope,
            visemeWidths,
            captionCues: buildTimedCaptionCues(capSource, finalDurationMs),
          };
        })
      );
    } catch {
      URL.revokeObjectURL(audioUrl);
      setVoiceError('Unable to decode this audio clip. Try WAV, MP3, WebM, or M4A.');
    } finally {
      setIsAnalyzingVoice(false);
    }
  };

  const base64ToBlobUrl = (b64: string, mime = 'audio/wav'): string => {
    const bin = atob(b64);
    const bytes = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) {
      bytes[i] = bin.charCodeAt(i);
    }
    return URL.createObjectURL(new Blob([bytes], { type: mime }));
  };

  const blobUrlToBase64 = async (
    url: string
  ): Promise<{ base64: string; ext: string }> => {
    const res = await fetch(url);
    const buf = await res.arrayBuffer();
    const mime = res.headers.get('content-type') || 'audio/webm';
    const ext = mime.includes('wav')
      ? 'wav'
      : mime.includes('mp4') || mime.includes('m4a')
        ? 'm4a'
        : mime.includes('mpeg') || mime.includes('mp3')
          ? 'mp3'
          : 'webm';
    const bytes = new Uint8Array(buf);
    let bin = '';
    const chunk = 0x8000;
    for (let i = 0; i < bytes.length; i += chunk) {
      bin += String.fromCharCode(...bytes.subarray(i, i + chunk));
    }
    return { base64: btoa(bin), ext };
  };

  const synthesizeSingleSceneTts = async (
    sceneIdx: number,
    targetScene: DirectedScene
  ): Promise<DirectedScene> => {
    const actor = cast.find((a) => a.id === targetScene.actorId) ?? cast[0];
    const tts = await requestSceneTtsSynthesis({
      dialogue: targetScene.dialogue,
      language,
      emotion: targetScene.emotion,
      actor,
    });
    const blobUrl = base64ToBlobUrl(tts.audioBase64, tts.mimeType || 'audio/wav');
    const narrationSec = tts.narrationSeconds;
    const durationMs = computeSceneDurationMsFromNarration(narrationSec);
    const analyzed = await audioEngine.analyzeAudioUrlToLipSync(blobUrl);
    voiceBlobUrlsRef.current.add(blobUrl);

    const capSource = (targetScene.captionText ?? '').trim() || targetScene.dialogue;
    const updated: DirectedScene = {
      ...targetScene,
      voiceAudioBase64: tts.audioBase64,
      voiceAudioMime: tts.mimeType || 'audio/wav',
      voiceAudioUrl: blobUrl,
      voiceAudioLabel: `AI TTS (${tts.voiceName})`,
      ttsVoiceName: tts.voiceName,
      narrationSeconds: narrationSec,
      durationMs,
      lipSyncEnvelope: analyzed.envelope,
      visemeWidths: analyzed.visemeWidths,
      captionCues: buildTimedCaptionCues(capSource, durationMs),
    };

    setScenes((prev) =>
      prev.map((s, idx) => {
        if (idx !== sceneIdx) return s;
        if (s.voiceAudioUrl && s.voiceAudioUrl !== blobUrl && voiceBlobUrlsRef.current.has(s.voiceAudioUrl)) {
          URL.revokeObjectURL(s.voiceAudioUrl);
          voiceBlobUrlsRef.current.delete(s.voiceAudioUrl);
        }
        return updated;
      })
    );
    return updated;
  };

  const handleGenerateSceneTts = async (sceneIdx: number) => {
    const target = scenes[sceneIdx];
    if (!target || isSynthesizingTts) return;
    setTtsError(null);
    setIsSynthesizingTts(true);
    try {
      await synthesizeSingleSceneTts(sceneIdx, target);
    } catch (err) {
      setTtsError(
        err instanceof Error ? err.message : 'Unable to generate AI voice narration.'
      );
    } finally {
      setIsSynthesizingTts(false);
    }
  };

  const handleGenerateAllTts = async () => {
    if (isSynthesizingTts || scenes.length === 0) return;
    setTtsError(null);
    setIsSynthesizingTts(true);
    try {
      for (let i = 0; i < scenes.length; i++) {
        if (scenes[i].voiceAudioBase64 || scenes[i].voiceAudioUrl) continue;
        await synthesizeSingleSceneTts(i, scenes[i]);
      }
    } catch (err) {
      setTtsError(
        err instanceof Error ? err.message : 'Unable to generate AI voiceover for all scenes.'
      );
    } finally {
      setIsSynthesizingTts(false);
    }
  };

  const handleUploadSceneClip = async (file: File | undefined) => {
    if (!file) return;
    const reader = new FileReader();
    reader.onload = async () => {
      const result = typeof reader.result === 'string' ? reader.result : '';
      const base64 = result.includes(',') ? result.slice(result.indexOf(',') + 1) : result;
      if (!base64) return;

      let probedDurMs: number | undefined;
      try {
        const probeUrl = URL.createObjectURL(file);
        const video = document.createElement('video');
        video.preload = 'metadata';
        await new Promise<void>((resolve) => {
          video.onloadedmetadata = () => resolve();
          video.onerror = () => resolve();
          video.src = probeUrl;
        });
        if (Number.isFinite(video.duration) && video.duration > 0.5) {
          probedDurMs = Math.round(Math.min(10, Math.max(1.5, video.duration)) * 1000);
        }
        URL.revokeObjectURL(probeUrl);
      } catch {
        // Keep current scene duration if metadata probe fails
      }

      setScenes((prev) =>
        prev.map((s, idx) => {
          if (idx !== activeSceneIndex) return s;
          const nextDur = probedDurMs ?? s.durationMs;
          const capSource = (s.captionText ?? '').trim() || s.dialogue;
          return {
            ...s,
            clipVideoBase64: base64,
            clipVideoName: file.name,
            durationMs: nextDur,
            captionCues: buildTimedCaptionCues(capSource, nextDur),
          };
        })
      );
    };
    reader.readAsDataURL(file);
  };

  const handleClearSceneClip = (sceneIdx: number) => {
    setScenes((prev) =>
      prev.map((s, idx) =>
        idx === sceneIdx
          ? { ...s, clipVideoBase64: undefined, clipVideoName: undefined }
          : s
      )
    );
  };

  const handleToggleRecordVoice = async () => {
    setVoiceError(null);
    if (isRecordingVoice && mediaRecorderRef.current) {
      mediaRecorderRef.current.stop();
      setIsRecordingVoice(false);
      return;
    }

    if (!navigator.mediaDevices?.getUserMedia || typeof MediaRecorder === 'undefined') {
      setVoiceError('Audio recording is not supported in this browser.');
      return;
    }

    const targetSceneIdx = activeSceneIndex;
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      voiceStreamRef.current = stream;

      const preferredMime = ['audio/webm;codecs=opus', 'audio/webm', 'audio/mp4'].find((m) =>
        MediaRecorder.isTypeSupported(m)
      );
      const recorder = preferredMime
        ? new MediaRecorder(stream, { mimeType: preferredMime })
        : new MediaRecorder(stream);

      const chunks: BlobPart[] = [];
      recorder.ondataavailable = (ev) => {
        if (ev.data.size > 0) chunks.push(ev.data);
      };
      recorder.onerror = () => {
        stream.getTracks().forEach((t) => t.stop());
        voiceStreamRef.current = null;
        setIsRecordingVoice(false);
        setVoiceError('Microphone recording failed.');
      };
      recorder.onstop = () => {
        stream.getTracks().forEach((t) => t.stop());
        voiceStreamRef.current = null;
        mediaRecorderRef.current = null;
        setIsRecordingVoice(false);
        if (chunks.length === 0) return;
        const mimeType = recorder.mimeType || 'audio/webm';
        const blob = new Blob(chunks, { type: mimeType });
        const url = URL.createObjectURL(blob);
        void applyVoiceClipToScene(targetSceneIdx, url, 'Mic Voiceover');
      };

      mediaRecorderRef.current = recorder;
      recorder.start(150);
      setIsRecordingVoice(true);
    } catch (err) {
      const errName = err instanceof Error ? err.name : '';
      if (errName === 'NotAllowedError' || errName === 'PermissionDeniedError') {
        setVoiceError(
          'Microphone permission is blocked in this embedded preview. Open the app directly in Chrome or upload a WAV/MP3 audio clip.'
        );
      } else {
        setVoiceError('Microphone unavailable in this browser. Upload an audio clip or use AI Voice.');
      }
      setIsRecordingVoice(false);
    }
  };

  const handleUploadSceneAudio = (file: File | undefined) => {
    if (!file) return;
    const url = URL.createObjectURL(file);
    void applyVoiceClipToScene(activeSceneIndex, url, file.name);
  };

  const handleClearSceneVoice = (sceneIdx: number) => {
    setVoiceError(null);
    setTtsError(null);
    setScenes((prev) =>
      prev.map((s, idx) => {
        if (idx !== sceneIdx) return s;
        if (s.voiceAudioUrl && voiceBlobUrlsRef.current.has(s.voiceAudioUrl)) {
          URL.revokeObjectURL(s.voiceAudioUrl);
          voiceBlobUrlsRef.current.delete(s.voiceAudioUrl);
        }
        const actor = cast.find((a) => a.id === s.actorId) ?? cast[0];
        const lipSync = buildSyllableLipSyncEnvelope(
          s.dialogue,
          0,
          actor?.speechRate ?? 0.95
        );
        const capSource = (s.captionText ?? '').trim() || s.dialogue;
        return {
          ...s,
          voiceAudioUrl: undefined,
          voiceAudioLabel: undefined,
          voiceAudioBase64: undefined,
          voiceAudioMime: undefined,
          narrationSeconds: undefined,
          ttsVoiceName: undefined,
          durationMs: lipSync.effectiveDurationMs,
          lipSyncEnvelope: lipSync.envelope,
          visemeWidths: lipSync.visemeWidths,
          captionCues: buildTimedCaptionCues(capSource, lipSync.effectiveDurationMs),
        };
      })
    );
  };

  const handleDirectScenes = (
    overrideIdea = idea,
    overrideLang = language
  ): DirectedScene[] => {
    setAiDirectorError(null);
    voiceBlobUrlsRef.current.forEach((url) => URL.revokeObjectURL(url));
    voiceBlobUrlsRef.current.clear();
    const directed = directStoryLocally(
      overrideIdea,
      overrideLang,
      cast,
      directorInstruction
    );
    setScenes(directed);
    setActiveSceneIndex(0);
    return directed;
  };

  const handleAiDirectScenes = async () => {
    if (isAiDirecting) return;
    setAiDirectorError(null);
    setIsAiDirecting(true);
    try {
      const directed = await requestAiDirectedScenes({
        idea: idea.trim() || (language === VoiceLang.HINDI ? DEFAULT_STORY_HINDI : DEFAULT_STORY_ENGLISH),
        language,
        directorInstruction,
        cast,
      });
      voiceBlobUrlsRef.current.forEach((url) => URL.revokeObjectURL(url));
      voiceBlobUrlsRef.current.clear();
      setScenes(directed);
      setActiveSceneIndex(0);
    } catch (err) {
      setAiDirectorError(
        err instanceof Error ? err.message : 'AI Director could not generate scenes.'
      );
    } finally {
      setIsAiDirecting(false);
    }
  };

  const updateActiveScene = (patch: Partial<DirectedScene>) => {
    setScenes((prev) =>
      prev.map((s, idx) => {
        if (idx !== activeSceneIndex) return s;
        const next = { ...s, ...patch };
        if (patch.captionText !== undefined || patch.dialogue !== undefined) {
          const capSource = (next.captionText ?? '').trim() || next.dialogue;
          next.captionCues = buildTimedCaptionCues(capSource, next.durationMs);
        }
        return next;
      })
    );
  };

  const handleAssignActorToActiveScene = (actorId: string) => {
    const targetActor = cast.find((a) => a.id === actorId);
    if (!targetActor) return;
    setScenes((prev) =>
      prev.map((s, idx) => {
        if (idx !== activeSceneIndex) return s;
        if (s.voiceAudioUrl) {
          return { ...s, actorId: targetActor.id };
        }
        const lipSync = buildSyllableLipSyncEnvelope(
          s.dialogue,
          0,
          targetActor.speechRate
        );
        return {
          ...s,
          actorId: targetActor.id,
          durationMs: lipSync.effectiveDurationMs,
          lipSyncEnvelope: lipSync.envelope,
          visemeWidths: lipSync.visemeWidths,
        };
      })
    );
  };

  const handleSelectVoiceForActiveScene = (voicePresetId: string) => {
    const preset = VOICE_PROFILES.find((v) => v.id === voicePresetId);
    if (!preset) return;
    const activeScene = scenes[activeSceneIndex];
    if (!activeScene) return;

    if (syncVoiceAndActor) {
      const matchedActor =
        cast.find((a) => a.voicePresetId === preset.id) ??
        (preset.defaultActorId
          ? cast.find((a) => a.id === preset.defaultActorId)
          : undefined) ??
        cast.find((a) => a.isFemale === preset.isFemale);

      const targetActorId = matchedActor?.id ?? activeScene.actorId;
      setCast((prev) =>
        prev.map((a) =>
          a.id === targetActorId
            ? {
                ...a,
                voicePresetId: preset.id,
                pitch: preset.pitch,
                speechRate: preset.speechRate,
              }
            : a
        )
      );
      setScenes((prev) =>
        prev.map((s, idx) => {
          if (idx !== activeSceneIndex) return s;
          if (s.voiceAudioUrl) return { ...s, actorId: targetActorId };
          const lipSync = buildSyllableLipSyncEnvelope(
            s.dialogue,
            0,
            preset.speechRate
          );
          return {
            ...s,
            actorId: targetActorId,
            durationMs: lipSync.effectiveDurationMs,
            lipSyncEnvelope: lipSync.envelope,
            visemeWidths: lipSync.visemeWidths,
          };
        })
      );
      return;
    }

    const currentActorId = activeScene.actorId;
    setCast((prev) =>
      prev.map((a) =>
        a.id === currentActorId
          ? {
              ...a,
              voicePresetId: preset.id,
              pitch: preset.pitch,
              speechRate: preset.speechRate,
            }
          : a
      )
    );
  };

  const handleSwitchLanguage = (nextLang: VoiceLang) => {
    setLanguage(nextLang);
    const trimmed = idea.trim();
    if (trimmed === DEFAULT_STORY_HINDI || trimmed === DEFAULT_STORY_ENGLISH || !trimmed) {
      const nextIdea =
        nextLang === VoiceLang.HINDI ? DEFAULT_STORY_HINDI : DEFAULT_STORY_ENGLISH;
      setIdea(nextIdea);
      handleDirectScenes(nextIdea, nextLang);
    } else {
      handleDirectScenes(idea, nextLang);
    }
  };

  const handleToggleMic = () => {
    setMicNotice(null);
    if (isListening && recognitionRef.current) {
      recognitionRef.current.stop();
      setIsListening(false);
      return;
    }

    const win = window as unknown as {
      SpeechRecognition?: new () => SpeechRecognitionLike;
      webkitSpeechRecognition?: new () => SpeechRecognitionLike;
    };
    const SpeechRec = win.SpeechRecognition || win.webkitSpeechRecognition;

    if (!SpeechRec) {
      setMicNotice('Speech recognition is not supported in this browser.');
      return;
    }

    try {
      const rec = new SpeechRec();
      rec.lang = language;
      rec.interimResults = false;
      rec.maxAlternatives = 1;
      rec.onresult = (event) => {
        const transcript = event.results?.[0]?.[0]?.transcript;
        if (transcript) {
          const next = idea.trim() ? `${idea.trim()} ${transcript}` : transcript;
          setIdea(next);
          handleDirectScenes(next, language);
        }
      };
      rec.onerror = (err) => {
        if (err.error === 'not-allowed' || err.error === 'service-not-allowed') {
          setMicNotice(
            'Voice dictation is blocked in this embedded preview. Open the app in a Chrome tab with mic permission or type/paste your script.'
          );
        } else {
          setMicNotice(`Microphone error: ${err.error ?? 'unavailable'}`);
        }
        setIsListening(false);
      };
      rec.onend = () => {
        setIsListening(false);
      };
      recognitionRef.current = rec;
      rec.start();
      setIsListening(true);
    } catch {
      setMicNotice('Unable to access microphone.');
      setIsListening(false);
    }
  };

  const handleRenderVideo = async () => {
    if (renderProgressPct !== null) return;
    setRenderError(null);
    setTtsError(null);
    setActiveTab('studio');

    const baseScenes = scenes.length > 0 ? [...scenes] : handleDirectScenes();
    if (baseScenes.length === 0) return;

    if (renderedVideoUrl && renderedVideoUrl.startsWith('blob:')) {
      URL.revokeObjectURL(renderedVideoUrl);
    }
    setRenderedVideoUrl(null);
    setRenderedDownloadUrl(null);
    setQaReport(null);

    try {
      setRenderProgressPct(1);
      const preparedScenes = [...baseScenes];

      // Auto-synthesize Gemini AI voiceover WAV for any scenes without custom/uploaded audio
      for (let i = 0; i < preparedScenes.length; i++) {
        const s = preparedScenes[i];
        if (!s.voiceAudioBase64 && !s.voiceAudioUrl && s.dialogue.trim()) {
          setRenderStageLabel(
            `Synthesizing AI voiceover for Scene ${s.index}/${preparedScenes.length}...`
          );
          try {
            preparedScenes[i] = await synthesizeSingleSceneTts(i, s);
          } catch (err) {
            setTtsError(
              err instanceof Error
                ? `TTS skipped (${err.message}); rendering with ambience audio.`
                : 'TTS skipped; rendering with biome ambience audio.'
            );
          }
        }
      }

      const result = await renderMovieToMp4ViaServer({
        scenes: preparedScenes,
        cast,
        format,
        framing,
        gestureBoost,
        overlayConfig,
        getAudioForScene: async (scene) => {
          if (scene.voiceAudioBase64) {
            return { base64: scene.voiceAudioBase64, ext: 'wav' };
          }
          if (scene.voiceAudioUrl) {
            return blobUrlToBase64(scene.voiceAudioUrl);
          }
          return {};
        },
        onProgress: (pct, label) => {
          setRenderProgressPct(pct);
          setRenderStageLabel(label);
        },
      });

      setRenderedVideoUrl(result.videoUrl);
      setRenderedDownloadUrl(result.downloadUrl);
      setRenderedVideoMime(result.mimeType);
      setQaReport(result.qa);
    } catch (err) {
      setRenderError(
        err instanceof Error ? err.message : 'Unable to encode MP4 video.'
      );
    } finally {
      setRenderProgressPct(null);
      setRenderStageLabel('');
    }
  };

  return (
    <div className="min-h-screen flex flex-col bg-[#090C12] text-[#F3F6FC]">
      {/* Top Bar Contract: 3 zones separated by gap-8 */}
      <header className="sticky top-0 z-30 border-b border-white/[0.08] bg-[#090C12]/90 backdrop-blur-md">
        <div className="max-w-[1440px] mx-auto px-6 h-16 flex items-center justify-between gap-8">
          {/* Zone 1: Brand Wordmark */}
          <a
            href="#studio"
            onClick={(e) => {
              e.preventDefault();
              setActiveTab('studio');
            }}
            className="text-base sm:text-lg font-semibold tracking-tight text-white whitespace-nowrap shrink-0"
          >
            Bharat-AI Pocket Engine
          </a>

          {/* Zone 2: Clean Single-Line Nav Links */}
          <nav
            aria-label="Primary sections"
            className="flex items-center gap-6 overflow-x-auto no-scrollbar"
          >
            {(
              [
                { id: 'studio', label: 'Studio' },
                { id: 'cast', label: 'Cast' },
                { id: 'timeline', label: 'Timeline' },
                { id: 'colab', label: 'Colab GPU' },
                { id: 'android', label: 'Android Code' },
              ] as const
            ).map((item) => {
              const isActive = activeTab === item.id;
              return (
                <button
                  key={item.id}
                  type="button"
                  onClick={() => setActiveTab(item.id)}
                  className={`py-5 text-sm font-medium border-b-2 transition-colors whitespace-nowrap shrink-0 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cyan-400/70 ${
                    isActive
                      ? 'text-white border-cyan-400'
                      : 'text-slate-400 border-transparent hover:text-slate-200'
                  }`}
                >
                  {item.label}
                </button>
              );
            })}
          </nav>

          {/* Zone 3: 1 Primary CTA */}
          <div className="shrink-0">
            <button
              type="button"
              onClick={handleRenderVideo}
              disabled={renderProgressPct !== null}
              className="inline-flex items-center gap-2 px-4 py-2 text-xs font-semibold text-slate-950 bg-cyan-400 hover:bg-cyan-300 disabled:opacity-60 rounded-lg transition-colors whitespace-nowrap shrink-0 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cyan-400"
            >
              <Clapperboard className="w-4 h-4" />
              {renderProgressPct !== null ? `Rendering ${renderProgressPct}%` : 'Render Video'}
            </button>
          </div>
        </div>
      </header>

      {/* Main Content */}
      <main className="flex-1">
        {activeTab === 'studio' && (
          <div className="max-w-[1440px] mx-auto px-6 py-6 grid grid-cols-1 lg:grid-cols-12 gap-6 items-stretch">
            {/* Left Column: Story Director & Directed Scenes */}
            <section className="lg:col-span-5 flex flex-col gap-5">
              <div className="bg-[#101520] border border-white/[0.08] rounded-xl p-5 space-y-4">
                <div className="flex items-center justify-between gap-3">
                  <h1 className="text-base font-semibold text-white">
                    Story Script
                  </h1>
                  <div className="flex items-center gap-1 p-1 bg-black/40 rounded-lg border border-white/[0.06]">
                    {(Object.values(VoiceLang) as VoiceLang[]).map((lang) => (
                      <button
                        key={lang}
                        type="button"
                        onClick={() => handleSwitchLanguage(lang)}
                        className={`px-2.5 py-1 text-xs font-medium rounded-md transition-colors whitespace-nowrap shrink-0 ${
                          language === lang
                            ? 'bg-slate-800 text-white'
                            : 'text-slate-400 hover:text-slate-200'
                        }`}
                      >
                        {VOICE_LANG_LABELS[lang]}
                      </button>
                    ))}
                  </div>
                </div>

                <textarea
                  rows={4}
                  value={idea}
                  onChange={(e) => setIdea(e.target.value)}
                  placeholder="Enter story lines in Hindi or English..."
                  aria-label="Story idea"
                  className="w-full bg-[#090C12] border border-white/[0.08] focus:border-cyan-400/70 rounded-lg p-3.5 text-sm leading-relaxed text-slate-100 placeholder:text-slate-500 focus:outline-none resize-y min-h-[112px]"
                />

                <input
                  type="text"
                  value={directorInstruction}
                  onChange={(e) => setDirectorInstruction(e.target.value)}
                  placeholder="Optional AI direction: e.g. Royal Palace theme, make Arjun walk heroically..."
                  aria-label="AI Director guidance"
                  className="w-full bg-[#090C12] border border-white/[0.08] focus:border-cyan-400/70 rounded-lg px-3 py-2 text-xs text-slate-200 placeholder:text-slate-500 focus:outline-none"
                />

                {micNotice && (
                  <p className="text-xs text-amber-300" role="status">
                    {micNotice}
                  </p>
                )}

                {aiDirectorError && (
                  <p className="text-xs text-rose-400" role="alert">
                    {aiDirectorError}
                  </p>
                )}

                {renderError && (
                  <p className="text-xs text-rose-400" role="alert">
                    {renderError}
                  </p>
                )}

                <div className="flex flex-wrap items-center justify-between gap-2.5 pt-1">
                  {/* Format Segmented Control */}
                  <div className="flex items-center gap-1 p-1 bg-black/40 rounded-lg border border-white/[0.06]">
                    {(Object.values(AspectFormat) as AspectFormat[]).map((fmt) => (
                      <button
                        key={fmt}
                        type="button"
                        onClick={() => setFormat(fmt)}
                        className={`px-2.5 py-1.5 text-xs font-medium rounded-md transition-colors whitespace-nowrap shrink-0 ${
                          format === fmt
                            ? 'bg-slate-800 text-white'
                            : 'text-slate-400 hover:text-slate-200'
                        }`}
                      >
                        {ASPECT_CONFIG[fmt].shortLabel}
                      </button>
                    ))}
                  </div>

                  <div className="flex flex-wrap items-center gap-2">
                    <button
                      type="button"
                      onClick={handleToggleMic}
                      className={`inline-flex items-center gap-1.5 px-3 py-2 text-xs font-medium border rounded-lg transition-colors whitespace-nowrap shrink-0 ${
                        isListening
                          ? 'bg-rose-500/15 border-rose-400/40 text-rose-200'
                          : 'bg-white/[0.04] hover:bg-white/[0.08] border-white/[0.08] text-slate-200'
                      }`}
                    >
                      {isListening ? (
                        <MicOff className="w-3.5 h-3.5" />
                      ) : (
                        <Mic className="w-3.5 h-3.5" />
                      )}
                      {isListening ? 'Stop' : 'Speak'}
                    </button>

                    <button
                      type="button"
                      onClick={() => handleDirectScenes()}
                      disabled={isAiDirecting}
                      className="inline-flex items-center gap-1.5 px-3 py-2 text-xs font-medium text-slate-200 bg-white/[0.04] hover:bg-white/[0.08] border border-white/[0.08] disabled:opacity-50 rounded-lg transition-colors whitespace-nowrap shrink-0"
                    >
                      <Sparkles className="w-3.5 h-3.5" />
                      Quick Direct
                    </button>

                    <button
                      type="button"
                      onClick={() => void handleAiDirectScenes()}
                      disabled={isAiDirecting}
                      className="inline-flex items-center gap-1.5 px-3.5 py-2 text-xs font-semibold text-slate-950 bg-cyan-400 hover:bg-cyan-300 disabled:opacity-60 rounded-lg transition-colors whitespace-nowrap shrink-0"
                    >
                      <Wand2 className="w-3.5 h-3.5" />
                      {isAiDirecting ? 'AI Directing...' : 'AI Direct'}
                    </button>
                  </div>
                </div>
              </div>

              {/* Active Scene Avatar, Voice Sync, Theme, Movement & Caption Studio */}
              <div className="bg-[#101520] border border-white/[0.08] rounded-xl p-4 space-y-3.5">
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <div className="min-w-0">
                    <div className="text-xs font-medium text-slate-400">
                      Scene {String(scenes[activeSceneIndex]?.index ?? 1).padStart(2, '0')} Talking Avatar
                    </div>
                    <div className="text-sm font-medium text-white truncate mt-0.5">
                      {(cast.find((a) => a.id === scenes[activeSceneIndex]?.actorId) ?? cast[0])?.name}
                    </div>
                  </div>

                  <div className="flex flex-wrap items-center gap-2">
                    {cast.map((actor) => {
                      const activeScene = scenes[activeSceneIndex];
                      const isAssigned = activeScene?.actorId === actor.id;
                      return (
                        <button
                          key={actor.id}
                          type="button"
                          onClick={() => handleAssignActorToActiveScene(actor.id)}
                          title={`Assign ${actor.name} to Scene ${activeScene?.index ?? 1}`}
                          className={`flex items-center gap-2 px-2.5 py-1.5 rounded-lg border text-xs font-medium transition-colors whitespace-nowrap ${
                            isAssigned
                              ? 'bg-cyan-400/15 border-cyan-400/60 text-white'
                              : 'bg-black/30 border-white/[0.08] text-slate-300 hover:border-white/25'
                          }`}
                        >
                          {actor.portraitDataUrl ? (
                            <img
                              src={actor.portraitDataUrl}
                              alt={actor.name}
                              referrerPolicy="no-referrer"
                              className="w-6 h-6 rounded-full object-cover object-top shrink-0"
                            />
                          ) : (
                            <span
                              className="w-6 h-6 rounded-full flex items-center justify-center text-[11px] font-semibold text-white shrink-0"
                              style={{ backgroundColor: actor.robeColor }}
                            >
                              {actor.name.slice(0, 1).toUpperCase()}
                            </span>
                          )}
                          <span>{actor.name}</span>
                        </button>
                      );
                    })}
                  </div>
                </div>

                {(() => {
                  const activeScene = scenes[activeSceneIndex];
                  const activeActor =
                    cast.find((a) => a.id === activeScene?.actorId) ?? cast[0];
                  if (!activeScene || !activeActor) return null;
                  const currentDress =
                    activeScene.dressOverride ?? activeActor.dressStyle;
                  const captionPos = activeScene.captionPosition ?? 'bottom';
                  const captionScale = activeScene.captionScale ?? 1.0;

                  return (
                    <div className="space-y-3 pt-2.5 border-t border-white/[0.06]">
                      {/* Bidirectional Voice & Character Sync Row */}
                      <div className="p-2.5 rounded-lg bg-black/25 border border-white/[0.06] space-y-2">
                        <div className="flex items-center justify-between gap-2">
                          <label
                            htmlFor="studio-voice-select"
                            className="text-[11px] text-slate-400"
                          >
                            Character ↔ Audio Voice
                          </label>
                          <div className="flex items-center gap-1.5">
                            <button
                              type="button"
                              onClick={() => setSyncVoiceAndActor((v) => !v)}
                              aria-pressed={syncVoiceAndActor}
                              className={`inline-flex items-center gap-1 px-2 py-0.5 text-[11px] font-medium rounded border transition-colors whitespace-nowrap ${
                                syncVoiceAndActor
                                  ? 'bg-cyan-400/15 border-cyan-400/45 text-cyan-200'
                                  : 'bg-black/30 border-white/[0.08] text-slate-400 hover:text-slate-200'
                              }`}
                            >
                              <Link2 className="w-3 h-3" />
                              Sync {syncVoiceAndActor ? 'On' : 'Off'}
                            </button>
                            <button
                              type="button"
                              onClick={() =>
                                audioEngine.speakDialogue(
                                  activeScene.dialogue,
                                  activeActor,
                                  language
                                )
                              }
                              aria-label="Test active character voice"
                              className="inline-flex items-center gap-1 px-2 py-0.5 text-[11px] font-medium text-slate-300 hover:text-white bg-white/[0.04] hover:bg-white/[0.08] border border-white/[0.08] rounded transition-colors whitespace-nowrap"
                            >
                              <Volume2 className="w-3 h-3" />
                              Test
                            </button>
                          </div>
                        </div>

                        <select
                          id="studio-voice-select"
                          value={activeActor.voicePresetId}
                          onChange={(e) => handleSelectVoiceForActiveScene(e.target.value)}
                          className="w-full bg-[#090C12] border border-white/[0.08] rounded-lg px-2.5 py-1.5 text-xs text-slate-100 focus:border-cyan-400/70 focus:outline-none"
                        >
                          {VOICE_PROFILES.map((vp) => (
                            <option key={vp.id} value={vp.id}>
                              {vp.label}
                            </option>
                          ))}
                        </select>
                      </div>

                      {/* Background Theme & Movement Choreography Row */}
                      <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
                        <div>
                          <label
                            htmlFor="studio-theme-select"
                            className="block text-[11px] text-slate-400 mb-1"
                          >
                            Background Theme
                          </label>
                          <select
                            id="studio-theme-select"
                            value={activeScene.biome}
                            onChange={(e) =>
                              updateActiveScene({
                                biome: Number(e.target.value) as EnvBiome,
                              })
                            }
                            className="w-full bg-[#090C12] border border-white/[0.08] rounded-lg px-2.5 py-1.5 text-xs text-slate-100 focus:border-cyan-400/70 focus:outline-none"
                          >
                            {(Object.keys(BIOME_LABELS) as unknown as EnvBiome[]).map(
                              (bKey) => {
                                const b = Number(bKey) as EnvBiome;
                                return (
                                  <option key={b} value={b}>
                                    {BIOME_LABELS[b]}
                                  </option>
                                );
                              }
                            )}
                          </select>
                        </div>

                        <div>
                          <label
                            htmlFor="studio-gesture-select"
                            className="block text-[11px] text-slate-400 mb-1"
                          >
                            Character Movement
                          </label>
                          <select
                            id="studio-gesture-select"
                            value={activeScene.gesture}
                            onChange={(e) =>
                              updateActiveScene({
                                gesture: e.target.value as GestureAction,
                              })
                            }
                            className="w-full bg-[#090C12] border border-white/[0.08] rounded-lg px-2.5 py-1.5 text-xs text-slate-100 focus:border-cyan-400/70 focus:outline-none"
                          >
                            {Object.values(GestureAction).map((g) => (
                              <option key={g} value={g}>
                                {GESTURE_LABELS[g]}
                              </option>
                            ))}
                          </select>
                        </div>
                      </div>

                      {/* Walking Destination & Pose Side Selector */}
                      <div>
                        <div className="flex items-center justify-between gap-2 mb-1">
                          <span className="text-[11px] text-slate-400">
                            Walking Destination &amp; Pose Side
                          </span>
                          <span className="text-[11px] font-mono text-cyan-300/80">
                            {activeScene.poseSide
                              ? activeScene.poseSide.toUpperCase()
                              : activeScene.poseMode === 'SIDE_LEFT'
                                ? 'LEFT'
                                : activeScene.poseMode === 'SIDE_RIGHT'
                                  ? 'RIGHT'
                                  : activeScene.poseMode === 'FRONT'
                                    ? 'FRONT'
                                    : activeScene.walkingDestination
                                      ? activeScene.walkingDestination.targetXNorm >=
                                        activeScene.walkingDestination.startXNorm
                                        ? 'RIGHT'
                                        : 'LEFT'
                                      : 'AUTO'}
                          </span>
                        </div>
                        <div className="grid grid-cols-4 gap-1 p-0.5 bg-black/40 rounded-lg border border-white/[0.06]">
                          {(
                            [
                              { id: 'auto', label: 'Auto' },
                              { id: 'left', label: 'Walk ← Left' },
                              { id: 'right', label: 'Walk → Right' },
                              { id: 'front', label: 'Front Still' },
                            ] as { id: 'auto' | PoseSide; label: string }[]
                          ).map((opt) => {
                            const curSide: 'auto' | PoseSide =
                              activeScene.poseSide ??
                              (activeScene.poseMode === 'SIDE_LEFT'
                                ? 'left'
                                : activeScene.poseMode === 'SIDE_RIGHT'
                                  ? 'right'
                                  : activeScene.poseMode === 'FRONT'
                                    ? 'front'
                                    : 'auto');
                            const isActive = curSide === opt.id;
                            return (
                              <button
                                key={opt.id}
                                type="button"
                                onClick={() => {
                                  if (opt.id === 'auto') {
                                    updateActiveScene({
                                      poseSide: undefined,
                                      poseMode: 'AUTO',
                                      walkingDestination: undefined,
                                    });
                                  } else if (opt.id === 'front') {
                                    updateActiveScene({
                                      poseSide: 'front',
                                      poseMode: 'FRONT',
                                      walkingDestination: undefined,
                                      gesture:
                                        activeScene.gesture === GestureAction.WALKING
                                          ? GestureAction.TALK_WAVE
                                          : activeScene.gesture,
                                    });
                                  } else {
                                    updateActiveScene({
                                      poseSide: opt.id,
                                      poseMode:
                                        opt.id === 'left' ? 'SIDE_LEFT' : 'SIDE_RIGHT',
                                      gesture: GestureAction.WALKING,
                                      walkingDestination: {
                                        startXNorm: opt.id === 'right' ? -0.26 : 0.26,
                                        targetXNorm: opt.id === 'right' ? 0.26 : -0.26,
                                        label: activeScene.locationTitle,
                                      },
                                    });
                                  }
                                }}
                                className={`py-1.5 px-1 text-[11px] font-medium rounded-md transition-colors whitespace-nowrap ${
                                  isActive
                                    ? 'bg-cyan-400/20 text-cyan-200 border border-cyan-400/40'
                                    : 'text-slate-400 hover:text-slate-200 border border-transparent'
                                }`}
                              >
                                {opt.label}
                              </button>
                            );
                          })}
                        </div>
                      </div>

                      {/* Dress Change & Realism Mode Row */}
                      <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
                        <div>
                          <label
                            htmlFor="studio-dress-select"
                            className="block text-[11px] text-slate-400 mb-1"
                          >
                            Scene Dress / Outfit
                          </label>
                          <select
                            id="studio-dress-select"
                            value={currentDress}
                            onChange={(e) => {
                              const nextDress = e.target.value as DressStyle;
                              updateActiveScene({ dressOverride: nextDress });
                            }}
                            className="w-full bg-[#090C12] border border-white/[0.08] rounded-lg px-2.5 py-1.5 text-xs text-slate-100 focus:border-cyan-400/70 focus:outline-none"
                          >
                            {Object.values(DressStyle).map((d) => (
                              <option key={d} value={d}>
                                {DRESS_LABELS[d]}
                              </option>
                            ))}
                          </select>
                        </div>

                        <div>
                          <span className="block text-[11px] text-slate-400 mb-1">
                            Avatar Appearance
                          </span>
                          <div className="grid grid-cols-4 gap-1 p-0.5 bg-black/40 rounded-lg border border-white/[0.06]">
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
                                  setCast((prev) =>
                                    prev.map((a) =>
                                      a.id === activeActor.id
                                        ? { ...a, avatarMode: opt.mode }
                                        : a
                                    )
                                  )
                                }
                                className={`py-1.5 text-[11px] font-medium rounded-md transition-colors whitespace-nowrap ${
                                  activeActor.avatarMode === opt.mode
                                    ? 'bg-slate-800 text-white'
                                    : 'text-slate-400 hover:text-slate-200'
                                }`}
                              >
                                {opt.label}
                              </button>
                            ))}
                          </div>
                        </div>
                      </div>

                      {/* Caption Studio (Interference-Free) */}
                      <div className="p-2.5 rounded-lg bg-black/25 border border-white/[0.06] space-y-2">
                        <div className="flex items-center justify-between gap-2">
                          <label
                            htmlFor="studio-caption-input"
                            className="text-[11px] text-slate-400"
                          >
                            On-Screen Caption (Safe Zone)
                          </label>
                          <button
                            type="button"
                            onClick={() =>
                              updateActiveScene({ captionText: activeScene.dialogue })
                            }
                            className="inline-flex items-center gap-1 text-[11px] text-cyan-300 hover:text-cyan-200 whitespace-nowrap"
                          >
                            <RotateCcw className="w-3 h-3" />
                            Match Dialogue
                          </button>
                        </div>

                        <input
                          id="studio-caption-input"
                          type="text"
                          value={activeScene.captionText ?? activeScene.dialogue}
                          onChange={(e) =>
                            updateActiveScene({ captionText: e.target.value })
                          }
                          placeholder="Edit on-screen caption without changing voice dialogue..."
                          className="w-full bg-[#090C12] border border-white/[0.08] focus:border-cyan-400/70 rounded-lg px-2.5 py-1.5 text-xs text-slate-100 placeholder:text-slate-500 focus:outline-none"
                        />

                        <div className="flex flex-wrap items-center justify-between gap-2">
                          <div className="grid grid-cols-4 gap-1 p-0.5 bg-black/40 rounded-lg border border-white/[0.06] flex-1 min-w-[200px]">
                            {(
                              [
                                { id: 'bottom', label: 'Bottom' },
                                { id: 'lower_third', label: 'Lower 3rd' },
                                { id: 'top', label: 'Top' },
                                { id: 'hidden', label: 'Off' },
                              ] as { id: CaptionPosition; label: string }[]
                            ).map((pos) => (
                              <button
                                key={pos.id}
                                type="button"
                                onClick={() =>
                                  updateActiveScene({ captionPosition: pos.id })
                                }
                                className={`py-1 text-[11px] font-medium rounded transition-colors whitespace-nowrap ${
                                  captionPos === pos.id
                                    ? 'bg-slate-800 text-white'
                                    : 'text-slate-400 hover:text-slate-200'
                                }`}
                              >
                                {pos.label}
                              </button>
                            ))}
                          </div>

                          <div className="flex items-center gap-1 p-0.5 bg-black/40 rounded-lg border border-white/[0.06]">
                            {[
                              { scale: 0.85, label: 'S' },
                              { scale: 1.0, label: 'M' },
                              { scale: 1.18, label: 'L' },
                            ].map((sz) => (
                              <button
                                key={sz.label}
                                type="button"
                                onClick={() =>
                                  updateActiveScene({ captionScale: sz.scale })
                                }
                                className={`px-2 py-1 text-[11px] font-medium rounded transition-colors ${
                                  Math.abs(captionScale - sz.scale) < 0.05
                                    ? 'bg-slate-800 text-white'
                                    : 'text-slate-400 hover:text-slate-200'
                                }`}
                              >
                                {sz.label}
                              </button>
                            ))}
                          </div>
                        </div>
                      </div>

                      {/* Framing Camera Mode & Voiceover Synthesis (AI TTS + Mic/File) */}
                      <div className="space-y-2.5 pt-2 border-t border-white/[0.06]">
                        <div>
                          <span className="block text-[11px] text-slate-400 mb-1">
                            Camera Framing
                          </span>
                          <div className="grid grid-cols-3 gap-1 p-0.5 bg-black/40 rounded-lg border border-white/[0.06]">
                            {(Object.values(CameraFraming) as CameraFraming[]).map((f) => (
                              <button
                                key={f}
                                type="button"
                                onClick={() => setFraming(f)}
                                className={`py-1.5 text-[11px] font-medium rounded-md transition-colors whitespace-nowrap ${
                                  framing === f
                                    ? 'bg-slate-800 text-white'
                                    : 'text-slate-400 hover:text-slate-200'
                                }`}
                              >
                                {FRAMING_LABELS[f]}
                              </button>
                            ))}
                          </div>
                        </div>

                        <div>
                          <span className="block text-[11px] text-slate-400 mb-1">
                            Voice Narration (Gemini AI TTS · Auto-Paced + -17 LUFS Mix)
                          </span>
                          <div className="grid grid-cols-2 sm:grid-cols-4 gap-1.5">
                            <button
                              type="button"
                              onClick={() => void handleGenerateSceneTts(activeSceneIndex)}
                              disabled={isSynthesizingTts || isRecordingVoice}
                              className="inline-flex items-center justify-center gap-1.5 px-2.5 py-1.5 text-[11px] font-semibold text-slate-950 bg-cyan-400 hover:bg-cyan-300 rounded-lg transition-colors whitespace-nowrap disabled:opacity-50"
                            >
                              <Sparkles className="w-3.5 h-3.5" />
                              {isSynthesizingTts ? 'Voicing...' : 'AI Voice'}
                            </button>

                            <button
                              type="button"
                              onClick={() => void handleGenerateAllTts()}
                              disabled={isSynthesizingTts || isRecordingVoice}
                              className="inline-flex items-center justify-center gap-1.5 px-2.5 py-1.5 text-[11px] font-medium text-cyan-200 bg-cyan-400/10 hover:bg-cyan-400/20 border border-cyan-400/30 rounded-lg transition-colors whitespace-nowrap disabled:opacity-50"
                            >
                              <Volume2 className="w-3.5 h-3.5" />
                              All Scenes
                            </button>

                            <button
                              type="button"
                              onClick={() => void handleToggleRecordVoice()}
                              disabled={isAnalyzingVoice || isSynthesizingTts}
                              className={`inline-flex items-center justify-center gap-1.5 px-2.5 py-1.5 text-[11px] font-medium border rounded-lg transition-colors whitespace-nowrap disabled:opacity-50 ${
                                isRecordingVoice
                                  ? 'bg-rose-500/20 border-rose-400/50 text-rose-200'
                                  : 'bg-[#090C12] hover:bg-white/[0.06] border-white/[0.08] text-slate-200'
                              }`}
                            >
                              {isRecordingVoice ? (
                                <Square className="w-3 h-3 fill-current" />
                              ) : (
                                <Radio className="w-3.5 h-3.5 text-cyan-400" />
                              )}
                              {isRecordingVoice
                                ? 'Stop Rec'
                                : isAnalyzingVoice
                                  ? 'Analyzing...'
                                  : 'Record'}
                            </button>

                            <input
                              ref={voiceFileInputRef}
                              type="file"
                              accept="audio/*"
                              className="hidden"
                              onChange={(e) => {
                                handleUploadSceneAudio(e.target.files?.[0]);
                                e.target.value = '';
                              }}
                            />
                            <button
                              type="button"
                              onClick={() => voiceFileInputRef.current?.click()}
                              disabled={isRecordingVoice || isAnalyzingVoice || isSynthesizingTts}
                              className="inline-flex items-center justify-center gap-1 px-2.5 py-1.5 text-[11px] font-medium text-slate-200 bg-[#090C12] hover:bg-white/[0.06] border border-white/[0.08] rounded-lg transition-colors whitespace-nowrap disabled:opacity-50"
                              title="Upload WAV, MP3, or M4A audio for lip-sync"
                            >
                              <Upload className="w-3.5 h-3.5" />
                              Audio
                            </button>
                          </div>
                        </div>
                      </div>

                      {/* Broadcast Branding Overlay & Optional Layer-2 Scene Video Clip */}
                      <div className="p-2.5 rounded-lg bg-black/25 border border-white/[0.06] space-y-2">
                        <div className="flex flex-wrap items-center justify-between gap-2">
                          <span className="text-[11px] text-slate-400">
                            Broadcast Overlay & Clip Layer
                          </span>
                          <div className="flex items-center gap-1.5">
                            <button
                              type="button"
                              onClick={() =>
                                setOverlayConfig((prev) => ({ ...prev, enabled: !prev.enabled }))
                              }
                              aria-pressed={overlayConfig.enabled}
                              className={`px-2 py-0.5 text-[11px] font-medium rounded border transition-colors whitespace-nowrap ${
                                overlayConfig.enabled
                                  ? 'bg-cyan-400/15 border-cyan-400/45 text-cyan-200'
                                  : 'bg-black/30 border-white/[0.08] text-slate-400'
                              }`}
                            >
                              Overlay {overlayConfig.enabled ? 'On' : 'Off'}
                            </button>
                            <input
                              ref={clipFileInputRef}
                              type="file"
                              accept="video/*"
                              className="hidden"
                              onChange={(e) => {
                                void handleUploadSceneClip(e.target.files?.[0]);
                                e.target.value = '';
                              }}
                            />
                            <button
                              type="button"
                              onClick={() => clipFileInputRef.current?.click()}
                              className="inline-flex items-center gap-1 px-2 py-0.5 text-[11px] font-medium text-slate-200 bg-[#090C12] hover:bg-white/[0.06] border border-white/[0.08] rounded transition-colors whitespace-nowrap"
                              title="Optional Layer-2: use an existing MP4/WebM clip for this shot"
                            >
                              <Video className="w-3 h-3 text-cyan-400" />
                              {activeScene.clipVideoName ? 'Replace Clip' : 'Attach Clip'}
                            </button>
                          </div>
                        </div>

                        {overlayConfig.enabled && (
                          <div className="grid grid-cols-2 gap-2">
                            <input
                              type="text"
                              value={overlayConfig.brandText}
                              onChange={(e) =>
                                setOverlayConfig((prev) => ({
                                  ...prev,
                                  brandText: e.target.value,
                                }))
                              }
                              placeholder="Top-right logo bug"
                              aria-label="Overlay brand bug"
                              className="bg-[#090C12] border border-white/[0.08] rounded px-2.5 py-1 text-xs text-slate-200 focus:border-cyan-400/70 focus:outline-none"
                            />
                            <input
                              type="text"
                              value={overlayConfig.stripText}
                              onChange={(e) =>
                                setOverlayConfig((prev) => ({
                                  ...prev,
                                  stripText: e.target.value,
                                }))
                              }
                              placeholder="Lower-left strip"
                              aria-label="Overlay lower strip"
                              className="bg-[#090C12] border border-white/[0.08] rounded px-2.5 py-1 text-xs text-slate-200 focus:border-cyan-400/70 focus:outline-none"
                            />
                          </div>
                        )}

                        {activeScene.clipVideoName && (
                          <div className="flex items-center justify-between gap-2 px-2.5 py-1 rounded bg-cyan-400/[0.07] border border-cyan-400/25 text-[11px]">
                            <span className="inline-flex items-center gap-1.5 text-cyan-200 truncate">
                              <Film className="w-3 h-3 shrink-0" />
                              Clip: {activeScene.clipVideoName}
                            </span>
                            <button
                              type="button"
                              onClick={() => handleClearSceneClip(activeSceneIndex)}
                              className="text-slate-300 hover:text-white shrink-0"
                            >
                              Remove
                            </button>
                          </div>
                        )}
                      </div>

                      {activeScene.voiceAudioUrl && (
                        <div className="flex items-center justify-between gap-2 px-3 py-1.5 rounded-lg bg-cyan-400/[0.07] border border-cyan-400/25 text-xs">
                          <span className="text-cyan-200 truncate">
                            {activeScene.voiceAudioLabel ?? 'Custom Voiceover'} ·{' '}
                            <span className="font-mono tabular-nums">
                              {(activeScene.durationMs / 1000).toFixed(1)}s
                            </span>
                          </span>
                          <button
                            type="button"
                            onClick={() => handleClearSceneVoice(activeSceneIndex)}
                            className="inline-flex items-center gap-1 text-[11px] text-slate-300 hover:text-white shrink-0"
                          >
                            <Trash2 className="w-3 h-3" />
                            Clear
                          </button>
                        </div>
                      )}

                      {(voiceError || ttsError) && (
                        <p className="text-xs text-amber-300" role="alert">
                          {voiceError || ttsError}
                        </p>
                      )}
                    </div>
                  );
                })()}
              </div>

              {/* Directed Scenes List */}
              <div className="bg-[#101520] border border-white/[0.08] rounded-xl overflow-hidden flex-1 flex flex-col">
                <div className="flex items-center justify-between px-5 py-3.5 border-b border-white/[0.08]">
                  <h2 className="text-sm font-semibold text-white">
                    Directed Scenes
                  </h2>
                  <span className="text-xs font-mono tabular-nums text-slate-400">
                    {scenes.length} shots ·{' '}
                    {computeEffectiveTimelineSeconds(scenes).toFixed(1)}s
                  </span>
                </div>

                <div className="divide-y divide-white/[0.06] max-h-[340px] overflow-y-auto">
                  {scenes.map((scene, idx) => {
                    const actor =
                      cast.find((a) => a.id === scene.actorId) ?? cast[0];
                    const isSelected = idx === activeSceneIndex;
                    return (
                      <button
                        key={scene.id}
                        type="button"
                        onClick={() => setActiveSceneIndex(idx)}
                        className={`w-full text-left px-5 py-3.5 transition-colors space-y-1.5 ${
                          isSelected
                            ? 'bg-cyan-400/[0.08]'
                            : 'hover:bg-white/[0.02]'
                        }`}
                      >
                        <div className="flex items-center justify-between gap-3 text-xs">
                          <div className="flex items-center gap-2 text-cyan-300 font-medium min-w-0">
                            <span className="font-mono tabular-nums">
                              Scene {String(scene.index).padStart(2, '0')}
                            </span>
                            <span aria-hidden="true" className="text-slate-600">
                              ·
                            </span>
                            <span className="truncate">{scene.locationTitle}</span>
                          </div>
                          <span className="font-mono tabular-nums text-slate-400 shrink-0">
                            {(scene.durationMs / 1000).toFixed(1)}s
                          </span>
                        </div>

                        <p className="text-sm text-slate-100 leading-snug">
                          <span
                            className="font-medium"
                            style={{ color: actor?.accentColor ?? '#00D4FF' }}
                          >
                            {actor?.name}:
                          </span>{' '}
                          {scene.dialogue}
                        </p>

                        <div className="flex flex-wrap items-center gap-2 text-xs text-slate-400">
                          <span>{BIOME_LABELS[scene.biome]}</span>
                          <span aria-hidden="true">·</span>
                          <span>{GESTURE_LABELS[scene.gesture]}</span>
                          <span aria-hidden="true">·</span>
                          <span>{EMOTION_LABELS[scene.emotion]}</span>
                        </div>
                        {scene.directorNote && (
                          <p className="text-[11px] text-cyan-300/80 leading-snug">
                            {scene.directorNote}
                          </p>
                        )}
                      </button>
                    );
                  })}
                </div>
              </div>
            </section>

            {/* Right Column: Live WebGL Stage Viewport */}
            <section className="lg:col-span-7">
              <ErrorBoundary scopeLabel="Live Stage Viewport">
                <LiveStageViewport
                  scenes={scenes}
                  cast={cast}
                  format={format}
                  framing={framing}
                  language={language}
                  activeSceneIndex={activeSceneIndex}
                  onSelectSceneIndex={setActiveSceneIndex}
                  audioEngine={audioEngine}
                  renderedVideoUrl={renderedVideoUrl}
                  renderedDownloadUrl={renderedDownloadUrl}
                  renderedVideoMime={renderedVideoMime}
                  renderProgressPct={renderProgressPct}
                  renderStageLabel={renderStageLabel}
                  gestureBoost={gestureBoost}
                  overlayConfig={overlayConfig}
                  qaReport={qaReport}
                />
              </ErrorBoundary>
            </section>
          </div>
        )}

        {activeTab === 'cast' && (
          <ErrorBoundary scopeLabel="Cast & Rigging Studio">
            <CastManagerView
              cast={cast}
              language={language}
              audioEngine={audioEngine}
              onChangeCast={setCast}
            />
          </ErrorBoundary>
        )}

        {activeTab === 'timeline' && (
          <ErrorBoundary scopeLabel="Scene Timeline">
            <TimelineChoreographyView
              scenes={scenes}
              cast={cast}
              onChangeScenes={setScenes}
              onPreviewScene={(idx) => {
                setActiveSceneIndex(idx);
                setActiveTab('studio');
              }}
            />
          </ErrorBoundary>
        )}

        {activeTab === 'colab' && (
          <ErrorBoundary scopeLabel="Colab GPU Bundle">
            <ColabGpuExportView
              scenes={scenes}
              cast={cast}
              format={format}
              framing={framing}
              language={language}
              gestureBoost={gestureBoost}
              overlayConfig={overlayConfig}
              onChangeGestureBoost={setGestureBoost}
            />
          </ErrorBoundary>
        )}

        {activeTab === 'android' && (
          <ErrorBoundary scopeLabel="Android Exporter">
            <AndroidSourceView />
          </ErrorBoundary>
        )}
      </main>
    </div>
  );
}
