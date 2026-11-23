import { ActorProfile, DirectedScene, EnvBiome, VoiceLang } from './types';

const TARGET_SAMPLE_RATE = 22050;

export class WebAudioMixEngine {
  private ctx: AudioContext | null = null;
  private masterGain: GainNode | null = null;
  private streamDest: MediaStreamAudioDestinationNode | null = null;
  private activeNodes: AudioNode[] = [];
  private activeVoiceNode: AudioBufferSourceNode | null = null;
  private decodedBufferCache = new Map<string, AudioBuffer>();
  private isMuted = false;

  private ensureContext(): AudioContext | null {
    try {
      if (!this.ctx) {
        const AudioCtx =
          window.AudioContext ||
          (window as unknown as { webkitAudioContext?: typeof AudioContext })
            .webkitAudioContext;
        if (!AudioCtx) return null;
        this.ctx = new AudioCtx();
        this.masterGain = this.ctx.createGain();
        this.masterGain.gain.value = this.isMuted ? 0 : 0.55;
        this.masterGain.connect(this.ctx.destination);
        this.streamDest = this.ctx.createMediaStreamDestination();
        this.masterGain.connect(this.streamDest);
      }
      if (this.ctx.state === 'suspended') {
        void this.ctx.resume().catch(() => {});
      }
      return this.ctx;
    } catch {
      return null;
    }
  }

  public setMuted(muted: boolean): void {
    this.isMuted = muted;
    if (this.masterGain && this.ctx) {
      this.masterGain.gain.setTargetAtTime(muted ? 0 : 0.55, this.ctx.currentTime, 0.05);
    }
    if (muted) {
      this.stopSpeech();
    }
  }

  public getCaptureAudioStream(): MediaStream | null {
    this.ensureContext();
    return this.streamDest?.stream ?? null;
  }

  /**
   * Decodes a recorded mic clip or uploaded voice file in RAM and extracts
   * 30 FPS RMS amplitude + spectral-centroid-derived viseme mouth width curves.
   */
  public async analyzeAudioUrlToLipSync(audioUrl: string): Promise<{
    durationMs: number;
    envelope: number[];
    visemeWidths: number[];
  }> {
    const ctx = this.ensureContext();
    if (!ctx) {
      throw new Error('Web Audio API is unavailable in this browser.');
    }
    const res = await fetch(audioUrl);
    const arrayBuf = await res.arrayBuffer();
    const audioBuf = await ctx.decodeAudioData(arrayBuf.slice(0));
    this.decodedBufferCache.set(audioUrl, audioBuf);

    const sampleRate = audioBuf.sampleRate;
    const channelData = audioBuf.getChannelData(0);
    const durationMs = Math.max(1500, Math.round(audioBuf.duration * 1000));
    const samplesPerFrame = Math.max(1, Math.floor(sampleRate / 30));
    const totalFrames = Math.max(30, Math.ceil(channelData.length / samplesPerFrame));

    const rawAmp: number[] = new Array(totalFrames).fill(0);
    const rawWidth: number[] = new Array(totalFrames).fill(0.95);

    for (let f = 0; f < totalFrames; f++) {
      const start = f * samplesPerFrame;
      const end = Math.min(channelData.length, start + samplesPerFrame);
      const count = Math.max(1, end - start);

      let sumSq = 0;
      let zeroCrossings = 0;
      let prev = channelData[start] ?? 0;

      for (let i = start; i < end; i++) {
        const s = channelData[i];
        sumSq += s * s;
        if ((s >= 0 && prev < 0) || (s < 0 && prev >= 0)) {
          zeroCrossings++;
        }
        prev = s;
      }

      const rms = Math.sqrt(sumSq / count);
      const amp = Math.min(1, Math.max(0, rms * 4.8));
      rawAmp[f] = amp;

      // High zero-crossing density => bright/spread consonant/ee; low => rounded o/u vowel
      const zcrNorm = zeroCrossings / count;
      rawWidth[f] = amp < 0.07 ? 0.92 : zcrNorm > 0.14 ? 1.18 : 0.76;
    }

    const envelope = rawAmp.map((v, i) => {
      const p = rawAmp[Math.max(0, i - 1)];
      const n = rawAmp[Math.min(rawAmp.length - 1, i + 1)];
      return Number((p * 0.25 + v * 0.5 + n * 0.25).toFixed(3));
    });

    const visemeWidths = rawWidth.map((v, i) => {
      const p = rawWidth[Math.max(0, i - 1)];
      const n = rawWidth[Math.min(rawWidth.length - 1, i + 1)];
      return Number((p * 0.25 + v * 0.5 + n * 0.25).toFixed(3));
    });

    return { durationMs, envelope, visemeWidths };
  }

  public startAmbientDrone(biome: EnvBiome): void {
    this.stopAmbientDrone();
    const ctx = this.ensureContext();
    if (!ctx || !this.masterGain) return;

    const now = ctx.currentTime;
    const droneGain = ctx.createGain();
    droneGain.gain.setValueAtTime(0.001, now);
    droneGain.gain.linearRampToValueAtTime(
      biome === EnvBiome.STUDIO_CYCLORAMA ? 0.05 : 0.16,
      now + 0.35
    );
    droneGain.connect(this.masterGain);

    const freqs =
      biome === EnvBiome.ROYAL_PALACE
        ? [82.41, 123.47, 164.81]
        : biome === EnvBiome.CYBER_CITY
          ? [65.41, 98.0, 130.81]
          : [73.42, 110.0, 146.83];
    const gains = [0.45, 0.3, 0.2];

    freqs.forEach((freq, i) => {
      const osc = ctx.createOscillator();
      const g = ctx.createGain();
      osc.type =
        biome === EnvBiome.CYBER_CITY && i === 1
          ? 'sawtooth'
          : i === 0
            ? 'sine'
            : 'triangle';
      osc.frequency.value = freq;
      g.gain.value = biome === EnvBiome.CYBER_CITY && i === 1 ? 0.12 : gains[i];
      osc.connect(g);
      g.connect(droneGain);
      osc.start(now);
      this.activeNodes.push(osc, g);
    });

    const bufferSize = ctx.sampleRate * 2;
    const noiseBuf = ctx.createBuffer(1, bufferSize, ctx.sampleRate);
    const data = noiseBuf.getChannelData(0);
    let lastOut = 0;
    for (let i = 0; i < bufferSize; i++) {
      const white = Math.random() * 2 - 1;
      lastOut = lastOut * 0.92 + white * 0.08;
      data[i] =
        biome === EnvBiome.FIRE_BATTLE && Math.random() < 0.006
          ? white * 0.85
          : lastOut * 1.4;
    }

    const noiseSrc = ctx.createBufferSource();
    noiseSrc.buffer = noiseBuf;
    noiseSrc.loop = true;

    const filter = ctx.createBiquadFilter();
    filter.type = biome === EnvBiome.DESERT_MYSTERY ? 'bandpass' : 'lowpass';
    filter.frequency.value =
      biome === EnvBiome.MONSOON_RAIN
        ? 1100
        : biome === EnvBiome.SACRED_RIVER
          ? 850
          : biome === EnvBiome.FIRE_BATTLE
            ? 650
            : biome === EnvBiome.CYBER_CITY
              ? 520
              : 420;

    const sfxGain = ctx.createGain();
    sfxGain.gain.value =
      biome === EnvBiome.STUDIO_CYCLORAMA
        ? 0.02
        : biome === EnvBiome.AVATAR_NIGHT
          ? 0.07
          : biome === EnvBiome.MONSOON_RAIN
            ? 0.22
            : 0.15;

    noiseSrc.connect(filter);
    filter.connect(sfxGain);
    sfxGain.connect(this.masterGain);
    noiseSrc.start(now);

    this.activeNodes.push(droneGain, noiseSrc, filter, sfxGain);
  }

  public stopAmbientDrone(): void {
    this.activeNodes.forEach((node) => {
      try {
        if ('stop' in node && typeof (node as AudioScheduledSourceNode).stop === 'function') {
          (node as AudioScheduledSourceNode).stop();
        }
        node.disconnect();
      } catch {
        // Ignore already stopped nodes
      }
    });
    this.activeNodes = [];
  }

  public async playSceneVoice(
    scene: DirectedScene,
    actor: ActorProfile,
    lang: VoiceLang
  ): Promise<void> {
    this.stopSpeech();
    if (this.isMuted) return;

    if (scene.voiceAudioUrl) {
      const ctx = this.ensureContext();
      if (ctx && this.masterGain) {
        let buf = this.decodedBufferCache.get(scene.voiceAudioUrl);
        if (!buf) {
          try {
            const res = await fetch(scene.voiceAudioUrl);
            const arr = await res.arrayBuffer();
            buf = await ctx.decodeAudioData(arr);
            this.decodedBufferCache.set(scene.voiceAudioUrl, buf);
          } catch {
            buf = undefined;
          }
        }

        if (buf) {
          const src = ctx.createBufferSource();
          src.buffer = buf;
          const voiceGain = ctx.createGain();
          voiceGain.gain.value = 1.45;
          src.connect(voiceGain);
          voiceGain.connect(this.masterGain);
          src.start();
          this.activeVoiceNode = src;
          return;
        }
      }
    }

    this.speakDialogue(scene.dialogue, actor, lang);
  }

  public speakDialogue(
    text: string,
    actor: ActorProfile,
    lang: VoiceLang
  ): void {
    if (this.isMuted) return;
    if (typeof window === 'undefined' || !('speechSynthesis' in window)) return;
    try {
      const synth = window.speechSynthesis;
      synth.cancel();

      const utterance = new SpeechSynthesisUtterance(text);
      utterance.lang = lang;
      utterance.pitch = Math.min(1.6, Math.max(0.65, actor.pitch));
      utterance.rate = Math.min(1.45, Math.max(0.65, actor.speechRate));

      const voices = synth.getVoices();
      const langVoices = voices.filter(
        (v) =>
          v.lang.toLowerCase().startsWith(lang.toLowerCase()) ||
          v.lang.toLowerCase().startsWith(lang === VoiceLang.HINDI ? 'hi' : 'en')
      );
      const genderMatched = langVoices.find((v) =>
        actor.isFemale
          ? /female|woman|lekha|kalpana|heera|swara|aditi|raveena|samantha|aria|zira/i.test(
              v.name
            )
          : /male|man|madhur|hemant|prabhat|rishi|daniel|david|guy/i.test(v.name)
      );
      const matched = genderMatched || langVoices[0] || voices[0];
      if (matched) utterance.voice = matched;

      synth.speak(utterance);
    } catch {
      // Ignore blocked speechSynthesis in restricted iframe environments
    }
  }

  public stopSpeech(): void {
    if (this.activeVoiceNode) {
      try {
        this.activeVoiceNode.stop();
        this.activeVoiceNode.disconnect();
      } catch {
        // Ignore already stopped buffer source
      }
      this.activeVoiceNode = null;
    }
    if (typeof window !== 'undefined' && 'speechSynthesis' in window) {
      try {
        window.speechSynthesis.cancel();
      } catch {
        // Ignore speech cancel failure
      }
    }
  }

  public renderMasterWavBlob(scenes: DirectedScene[]): Blob {
    const totalSamples = Math.max(
      TARGET_SAMPLE_RATE,
      scenes.reduce(
        (sum, s) => sum + Math.floor((s.durationMs * TARGET_SAMPLE_RATE) / 1000),
        0
      )
    );
    const pcm = new Int16Array(totalSamples);
    let cursor = 0;
    let lpFilter = 0;

    for (const scene of scenes) {
      const sceneSamples = Math.floor((scene.durationMs * TARGET_SAMPLE_RATE) / 1000);
      const voiceBuf = scene.voiceAudioUrl
        ? this.decodedBufferCache.get(scene.voiceAudioUrl)
        : undefined;
      const voiceData = voiceBuf ? voiceBuf.getChannelData(0) : null;
      const voiceSr = voiceBuf ? voiceBuf.sampleRate : TARGET_SAMPLE_RATE;

      for (let i = 0; i < sceneSamples; i++) {
        const gIdx = cursor + i;
        if (gIdx >= totalSamples) break;
        const t = gIdx / TARGET_SAMPLE_RATE;

        const drone =
          (Math.sin(2 * Math.PI * 73.42 * t) * 0.45 +
            Math.sin(2 * Math.PI * 110.0 * t) * 0.3 +
            Math.sin(2 * Math.PI * 146.83 * t) * 0.2) *
          (0.75 + 0.25 * Math.sin(2 * Math.PI * 0.18 * t)) *
          2600;

        const white = Math.random() * 2 - 1;
        lpFilter = lpFilter * 0.92 + white * 0.08;
        let sfx = 0;
        switch (scene.biome) {
          case EnvBiome.MONSOON_RAIN:
            sfx = lpFilter * 2500;
            break;
          case EnvBiome.DESERT_MYSTERY:
            sfx = lpFilter * 1900 * (0.6 + 0.4 * Math.sin(2 * Math.PI * 0.25 * t));
            break;
          case EnvBiome.FIRE_BATTLE:
            sfx = Math.random() < 0.005 ? white * 4600 : lpFilter * 1300;
            break;
          case EnvBiome.SACRED_RIVER:
            sfx = lpFilter * 2000;
            break;
          case EnvBiome.ROYAL_PALACE:
            sfx = Math.sin(2 * Math.PI * 164.81 * t) * 700 + lpFilter * 900;
            break;
          case EnvBiome.CYBER_CITY:
            sfx = Math.sin(2 * Math.PI * 98 * t) * 850;
            break;
          case EnvBiome.STUDIO_CYCLORAMA:
            sfx = lpFilter * 350;
            break;
          case EnvBiome.AVATAR_NIGHT:
            sfx = Math.sin(2 * Math.PI * 220 * t) * 500;
            break;
        }

        let voiceSample = 0;
        if (voiceData) {
          const srcIdx = Math.floor((i * voiceSr) / TARGET_SAMPLE_RATE);
          if (srcIdx < voiceData.length) {
            voiceSample = voiceData[srcIdx] * 28000;
          }
        } else {
          const frameIdx = Math.min(
            scene.lipSyncEnvelope.length - 1,
            Math.floor((i / TARGET_SAMPLE_RATE) * 30)
          );
          const env = scene.lipSyncEnvelope[frameIdx] ?? 0;
          voiceSample = Math.sin(2 * Math.PI * 185 * t) * env * 850;
        }

        const mixed = Math.max(
          -32767,
          Math.min(32767, Math.round(drone + sfx + voiceSample))
        );
        pcm[gIdx] = mixed;
      }
      cursor += sceneSamples;
    }

    return encodeMonoWav(pcm, TARGET_SAMPLE_RATE);
  }
}

function encodeMonoWav(pcm: Int16Array, sampleRate: number): Blob {
  const dataSize = pcm.length * 2;
  const buffer = new ArrayBuffer(44 + dataSize);
  const view = new DataView(buffer);

  const writeStr = (offset: number, str: string) => {
    for (let i = 0; i < str.length; i++) view.setUint8(offset + i, str.charCodeAt(i));
  };

  writeStr(0, 'RIFF');
  view.setUint32(4, 36 + dataSize, true);
  writeStr(8, 'WAVE');
  writeStr(12, 'fmt ');
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true);
  view.setUint16(22, 1, true);
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * 2, true);
  view.setUint16(32, 2, true);
  view.setUint16(34, 16, true);
  writeStr(36, 'data');
  view.setUint32(40, dataSize, true);

  let offset = 44;
  for (let i = 0; i < pcm.length; i++) {
    view.setInt16(offset, pcm[i], true);
    offset += 2;
  }

  return new Blob([buffer], { type: 'audio/wav' });
}
