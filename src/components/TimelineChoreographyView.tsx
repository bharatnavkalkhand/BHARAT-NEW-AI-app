import React from 'react';
import { Play, Plus, Trash2 } from 'lucide-react';
import {
  ActorProfile,
  BIOME_LABELS,
  CaptionPosition,
  CharacterPoseMode,
  DirectedScene,
  DRESS_LABELS,
  DressStyle,
  EMOTION_LABELS,
  EmotionMood,
  EnvBiome,
  GESTURE_LABELS,
  GestureAction,
  SceneTransition,
  VOICE_PROFILES,
} from '../engine/types';
import { buildSyllableLipSyncEnvelope } from '../engine/localDirectorBrain';
import {
  buildTimedCaptionCues,
  computeDefaultCameraMotion,
  computeEffectiveTimelineSeconds,
} from '../engine/videoProduction';

interface TimelineChoreographyViewProps {
  scenes: DirectedScene[];
  cast: ActorProfile[];
  onChangeScenes: (next: DirectedScene[]) => void;
  onPreviewScene: (index: number) => void;
}

export const TimelineChoreographyView: React.FC<TimelineChoreographyViewProps> = ({
  scenes,
  cast,
  onChangeScenes,
  onPreviewScene,
}) => {
  const updateScene = (id: string, patch: Partial<DirectedScene>) => {
    onChangeScenes(
      scenes.map((scene) => {
        if (scene.id !== id) return scene;
        const nextScene = { ...scene, ...patch };
        if (patch.dialogue !== undefined || patch.durationMs !== undefined) {
          const actor = cast.find((a) => a.id === nextScene.actorId) ?? cast[0];
          const { envelope, visemeWidths, effectiveDurationMs } = buildSyllableLipSyncEnvelope(
            nextScene.dialogue,
            patch.durationMs ?? nextScene.durationMs,
            actor?.speechRate ?? 0.94
          );
          nextScene.lipSyncEnvelope = envelope;
          nextScene.visemeWidths = visemeWidths;
          nextScene.durationMs = effectiveDurationMs;
        }
        if (
          patch.dialogue !== undefined ||
          patch.captionText !== undefined ||
          patch.durationMs !== undefined
        ) {
          const capSource = (nextScene.captionText ?? '').trim() || nextScene.dialogue;
          nextScene.captionCues = buildTimedCaptionCues(capSource, nextScene.durationMs);
        }
        return nextScene;
      })
    );
  };

  const handleAddScene = () => {
    const actor = cast[0];
    const dialogue = 'अब कहानी एक नया मोड़ ले रही है।';
    const { envelope, visemeWidths, effectiveDurationMs } = buildSyllableLipSyncEnvelope(
      dialogue,
      3500,
      actor?.speechRate ?? 0.94
    );
    const next: DirectedScene = {
      id: `scene-${Date.now()}`,
      index: scenes.length + 1,
      locationTitle: 'MYSTIC REALM',
      hookBanner: '',
      dialogue,
      captionText: dialogue,
      captionPosition: 'bottom',
      captionScale: 1.0,
      captionCues: buildTimedCaptionCues(dialogue, effectiveDurationMs),
      actorId: actor?.id ?? '',
      biome: EnvBiome.AVATAR_NIGHT,
      gesture: GestureAction.TALK_WAVE,
      emotion: EmotionMood.CALM,
      transitionIn: 'cut',
      cameraMotion: computeDefaultCameraMotion(scenes.length),
      cameraZoomStart: 1.0,
      cameraZoomEnd: 1.12,
      cameraPanRange: 0.1,
      durationMs: effectiveDurationMs,
      lipSyncEnvelope: envelope,
      visemeWidths,
    };
    onChangeScenes([...scenes, next]);
  };

  const handleDeleteScene = (id: string) => {
    const filtered = scenes
      .filter((s) => s.id !== id)
      .map((s, idx) => ({ ...s, index: idx + 1 }));
    onChangeScenes(filtered);
  };

  const totalSeconds = computeEffectiveTimelineSeconds(scenes);
  const totalCues = scenes.reduce((sum, s) => sum + (s.captionCues?.length ?? 1), 0);

  return (
    <div className="max-w-[1360px] mx-auto px-6 py-8 space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight text-white">
            Scene Choreography Timeline
          </h1>
          <div className="flex flex-wrap items-center gap-2 text-xs text-slate-400 mt-1">
            <span className="font-mono tabular-nums">{scenes.length} Shots</span>
            <span aria-hidden="true">·</span>
            <span className="font-mono tabular-nums">{totalSeconds.toFixed(1)}s Effective Runtime</span>
            <span aria-hidden="true">·</span>
            <span className="font-mono tabular-nums">{totalCues} Timed Caption Cues</span>
            <span aria-hidden="true">·</span>
            <span>30 FPS H.264 / AAC -17 LUFS</span>
          </div>
        </div>

        <button
          type="button"
          onClick={handleAddScene}
          className="inline-flex items-center gap-2 px-4 py-2.5 text-xs font-semibold text-slate-950 bg-cyan-400 hover:bg-cyan-300 rounded-lg transition-colors whitespace-nowrap shrink-0"
        >
          <Plus className="w-4 h-4" />
          Add Scene
        </button>
      </div>

      <div className="bg-[#101520] border border-white/[0.08] rounded-xl overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-left border-collapse">
            <thead>
              <tr className="border-b border-white/[0.08] text-xs font-medium text-slate-400 bg-black/20">
                <th className="py-3 px-4 w-16">#</th>
                <th className="py-3 px-4 min-w-[240px]">Dialogue & Hook</th>
                <th className="py-3 px-4 w-32">Actor</th>
                <th className="py-3 px-4 w-44">Dress</th>
                <th className="py-3 px-4 w-40">Shader Biome</th>
                <th className="py-3 px-4 w-44">Gesture</th>
                <th className="py-3 px-4 w-32">Mood</th>
                <th className="py-3 px-4 w-28">Transition</th>
                <th className="py-3 px-4 w-24 text-right">Duration</th>
                <th className="py-3 px-4 w-24 text-right">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-white/[0.06] text-sm">
              {scenes.map((scene, idx) => {
                const sceneActor = cast.find((a) => a.id === scene.actorId) ?? cast[0];
                const voiceLabel =
                  VOICE_PROFILES.find((v) => v.id === sceneActor?.voicePresetId)?.label ??
                  'Custom Voice';
                return (
                <tr key={scene.id} className="hover:bg-white/[0.02] transition-colors align-top">
                  <td className="py-3.5 px-4 font-mono tabular-nums text-xs text-cyan-300 font-medium">
                    {String(scene.index).padStart(2, '0')}
                  </td>
                  <td className="py-3.5 px-4 space-y-2">
                    <textarea
                      rows={2}
                      value={scene.dialogue}
                      onChange={(e) => {
                        const nextDialogue = e.target.value;
                        const wasMirrored =
                          !scene.captionText || scene.captionText === scene.dialogue;
                        updateScene(scene.id, {
                          dialogue: nextDialogue,
                          ...(wasMirrored ? { captionText: nextDialogue } : {}),
                        });
                      }}
                      aria-label={`Scene ${scene.index} dialogue`}
                      className="w-full bg-black/30 border border-white/[0.08] focus:border-cyan-400/70 rounded-lg px-3 py-2 text-xs text-slate-100 focus:outline-none resize-none"
                    />
                    <div className="grid grid-cols-[1fr_112px] gap-2">
                      <input
                        type="text"
                        value={scene.captionText ?? scene.dialogue}
                        onChange={(e) =>
                          updateScene(scene.id, { captionText: e.target.value })
                        }
                        placeholder="On-screen caption text"
                        aria-label={`Scene ${scene.index} caption`}
                        className="bg-black/25 border border-white/[0.07] rounded px-2.5 py-1 text-xs text-cyan-100 placeholder:text-slate-500 focus:border-cyan-400/70 focus:outline-none"
                      />
                      <select
                        value={scene.captionPosition ?? 'bottom'}
                        onChange={(e) =>
                          updateScene(scene.id, {
                            captionPosition: e.target.value as CaptionPosition,
                          })
                        }
                        aria-label={`Scene ${scene.index} caption placement`}
                        className="bg-[#090C12] border border-white/[0.08] rounded px-2 py-1 text-[11px] text-slate-200 focus:border-cyan-400/70 focus:outline-none"
                      >
                        <option value="bottom">Cap: Bottom</option>
                        <option value="lower_third">Cap: Lower 3rd</option>
                        <option value="top">Cap: Top</option>
                        <option value="hidden">Cap: Off</option>
                      </select>
                    </div>
                    <div className="grid grid-cols-2 gap-2">
                      <input
                        type="text"
                        value={scene.locationTitle}
                        onChange={(e) =>
                          updateScene(scene.id, { locationTitle: e.target.value })
                        }
                        placeholder="Location header"
                        className="bg-black/20 border border-white/[0.06] rounded px-2.5 py-1 text-xs text-slate-300 focus:border-cyan-400/70 focus:outline-none"
                      />
                      <input
                        type="text"
                        value={scene.hookBanner}
                        onChange={(e) =>
                          updateScene(scene.id, { hookBanner: e.target.value })
                        }
                        placeholder="Hook year/date (optional)"
                        className="bg-black/20 border border-white/[0.06] rounded px-2.5 py-1 text-xs text-slate-300 focus:border-cyan-400/70 focus:outline-none"
                      />
                    </div>
                  </td>
                  <td className="py-3.5 px-4 space-y-1.5">
                    <select
                      value={scene.actorId}
                      onChange={(e) => updateScene(scene.id, { actorId: e.target.value })}
                      className="w-full bg-[#090C12] border border-white/[0.08] rounded-lg px-2.5 py-2 text-xs text-slate-200 focus:border-cyan-400/70 focus:outline-none"
                    >
                      {cast.map((a) => (
                        <option key={a.id} value={a.id}>
                          {a.name}
                        </option>
                      ))}
                    </select>
                    <p className="text-[11px] text-slate-400 truncate" title={voiceLabel}>
                      {voiceLabel}
                    </p>
                  </td>
                  <td className="py-3.5 px-4">
                    <select
                      value={scene.dressOverride ?? ''}
                      onChange={(e) =>
                        updateScene(scene.id, {
                          dressOverride: e.target.value
                            ? (e.target.value as DressStyle)
                            : undefined,
                        })
                      }
                      className="w-full bg-[#090C12] border border-white/[0.08] rounded-lg px-2.5 py-2 text-xs text-slate-200 focus:border-cyan-400/70 focus:outline-none"
                    >
                      <option value="">Actor Default</option>
                      {Object.values(DressStyle).map((d) => (
                        <option key={d} value={d}>
                          {DRESS_LABELS[d]}
                        </option>
                      ))}
                    </select>
                  </td>
                  <td className="py-3.5 px-4">
                    <select
                      value={scene.biome}
                      onChange={(e) =>
                        updateScene(scene.id, { biome: Number(e.target.value) as EnvBiome })
                      }
                      className="w-full bg-[#090C12] border border-white/[0.08] rounded-lg px-2.5 py-2 text-xs text-slate-200 focus:border-cyan-400/70 focus:outline-none"
                    >
                      {(Object.keys(BIOME_LABELS) as unknown as EnvBiome[]).map((bKey) => {
                        const b = Number(bKey) as EnvBiome;
                        return (
                          <option key={b} value={b}>
                            {BIOME_LABELS[b]}
                          </option>
                        );
                      })}
                    </select>
                  </td>
                  <td className="py-3.5 px-4 space-y-2">
                    <select
                      value={scene.gesture}
                      onChange={(e) =>
                        updateScene(scene.id, { gesture: e.target.value as GestureAction })
                      }
                      className="w-full bg-[#090C12] border border-white/[0.08] rounded-lg px-2.5 py-2 text-xs text-slate-200 focus:border-cyan-400/70 focus:outline-none"
                    >
                      {Object.values(GestureAction).map((g) => (
                        <option key={g} value={g}>
                          {GESTURE_LABELS[g]}
                        </option>
                      ))}
                    </select>
                    <select
                      value={scene.poseMode ?? 'AUTO'}
                      onChange={(e) => {
                        const mode = e.target.value as CharacterPoseMode;
                        updateScene(scene.id, {
                          poseMode: mode,
                          poseSide:
                            mode === 'SIDE_LEFT'
                              ? 'left'
                              : mode === 'SIDE_RIGHT'
                                ? 'right'
                                : mode === 'FRONT'
                                  ? 'front'
                                  : undefined,
                          walkingDestination:
                            mode === 'SIDE_RIGHT'
                              ? {
                                  startXNorm: -0.26,
                                  targetXNorm: 0.26,
                                  label: scene.locationTitle,
                                }
                              : mode === 'SIDE_LEFT'
                                ? {
                                    startXNorm: 0.26,
                                    targetXNorm: -0.26,
                                    label: scene.locationTitle,
                                  }
                                : mode === 'FRONT'
                                  ? undefined
                                  : scene.walkingDestination,
                        });
                      }}
                      aria-label={`Scene ${scene.index} character pose`}
                      className="w-full bg-[#090C12] border border-white/[0.06] rounded-lg px-2.5 py-1.5 text-[11px] text-cyan-200 focus:border-cyan-400/70 focus:outline-none"
                    >
                      <option value="AUTO">Pose: Auto Path</option>
                      <option value="SIDE_RIGHT">Pose: Side Walk →</option>
                      <option value="SIDE_LEFT">Pose: Side Walk ←</option>
                      <option value="FRONT">Pose: Front Facing</option>
                    </select>
                  </td>
                  <td className="py-3.5 px-4">
                    <select
                      value={scene.emotion}
                      onChange={(e) =>
                        updateScene(scene.id, { emotion: e.target.value as EmotionMood })
                      }
                      className="w-full bg-[#090C12] border border-white/[0.08] rounded-lg px-2.5 py-2 text-xs text-slate-200 focus:border-cyan-400/70 focus:outline-none"
                    >
                      {Object.values(EmotionMood).map((m) => (
                        <option key={m} value={m}>
                          {EMOTION_LABELS[m]}
                        </option>
                      ))}
                    </select>
                  </td>
                  <td className="py-3.5 px-4 space-y-1.5">
                    <select
                      value={idx === 0 ? 'cut' : (scene.transitionIn ?? 'cut')}
                      disabled={idx === 0}
                      onChange={(e) =>
                        updateScene(scene.id, { transitionIn: e.target.value as SceneTransition })
                      }
                      aria-label={`Scene ${scene.index} transition`}
                      className="w-full bg-[#090C12] border border-white/[0.08] rounded-lg px-2 py-2 text-xs text-slate-200 disabled:opacity-50 focus:border-cyan-400/70 focus:outline-none"
                    >
                      <option value="cut">Hard Cut</option>
                      <option value="fade">0.4s Fade</option>
                    </select>
                    <p className="text-[11px] font-mono tabular-nums text-slate-400">
                      {scene.voiceAudioBase64
                        ? 'AI TTS'
                        : scene.voiceAudioUrl
                          ? 'Audio'
                          : 'Est'} · {scene.captionCues?.length ?? 1} cue
                    </p>
                  </td>
                  <td className="py-3.5 px-4 text-right">
                    <input
                      type="number"
                      min={1.5}
                      max={15}
                      step={0.5}
                      value={(scene.durationMs / 1000).toFixed(1)}
                      onChange={(e) => {
                        const sec = Math.max(1.5, Math.min(15, parseFloat(e.target.value) || 3));
                        updateScene(scene.id, { durationMs: Math.round(sec * 1000) });
                      }}
                      className="w-20 text-right bg-[#090C12] border border-white/[0.08] rounded-lg px-2.5 py-1.5 font-mono tabular-nums text-xs text-slate-200 focus:border-cyan-400/70 focus:outline-none"
                    />
                  </td>
                  <td className="py-3.5 px-4 text-right">
                    <div className="inline-flex items-center gap-1">
                      <button
                        type="button"
                        onClick={() => onPreviewScene(idx)}
                        title="Preview scene on stage"
                        aria-label={`Preview scene ${scene.index}`}
                        className="p-2 rounded-lg text-cyan-300 hover:bg-cyan-400/10 transition-colors"
                      >
                        <Play className="w-3.5 h-3.5" />
                      </button>
                      {scenes.length > 1 && (
                        <button
                          type="button"
                          onClick={() => handleDeleteScene(scene.id)}
                          title="Delete scene"
                          aria-label={`Delete scene ${scene.index}`}
                          className="p-2 rounded-lg text-slate-400 hover:text-rose-400 hover:bg-rose-400/10 transition-colors"
                        >
                          <Trash2 className="w-3.5 h-3.5" />
                        </button>
                      )}
                    </div>
                  </td>
                </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
};
