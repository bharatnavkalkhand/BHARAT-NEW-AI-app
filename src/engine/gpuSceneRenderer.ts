import {
  ActorProfile,
  ASPECT_CONFIG,
  AspectFormat,
  BlendShapeConfig,
  CameraFraming,
  createDefaultBlendShapes,
  DirectedScene,
  DRESS_STUDIO_IMAGES,
  DressStyle,
  EmotionMood,
  EnvBiome,
  GestureAction,
  HUMAN_AVATAR_PRESETS,
  OverlayTemplateConfig,
  PoseSide,
  VideoQaReport,
} from './types';
import {
  applyGroundContactLock,
  BiomePathSample,
  computeBiomeScenePath,
  computeCoMAndZmpBalance,
  evaluateCubicBezierEase,
  evaluateSceneActionBeats,
  REALISM_BEZIER_CURVES,
  resolveScenePoseSide,
  solveDlsTwoBoneIK,
  SpringDamperState,
  stepSpringDamper,
} from './rigAndCalibration';
import {
  evaluateCameraMotionAtFrame,
  getActiveCaptionCueLines,
} from './videoProduction';
import { ThreeGlbStageRenderer } from './glbAvatarEngine';

const VERTEX_SHADER_SRC = `
  attribute vec2 aPos;
  attribute vec2 aUv;
  varying vec2 vUv;
  void main() {
    vUv = aUv;
    gl_Position = vec4(aPos, 0.0, 1.0);
  }
`;

const FRAGMENT_SHADER_SRC = `
  precision mediump float;
  varying vec2 vUv;
  uniform float uTime;
  uniform float uEnvType;
  uniform float uZoom;
  uniform float uPan;
  uniform float uAudio;
  uniform float uPoseSide;
  uniform float uPoseBlend;
  uniform sampler2D uOverlayTex;

  float waveNoise(vec2 p) {
    return sin(p.x * 3.1 + uTime * 0.45) * cos(p.y * 2.7 - uTime * 0.35);
  }

  float hash11(float p) {
    return fract(sin(p * 127.1 + 311.7) * 43758.5453);
  }

  void main() {
    vec2 camUv = (vUv - 0.5) / uZoom + 0.5;
    camUv.x += uPan * (1.0 - vUv.y * 0.55) - uPoseSide * 0.012 * uPoseBlend * (1.0 - vUv.y);

    vec3 skyTop = vec3(0.02, 0.05, 0.14);
    vec3 skyBot = vec3(0.04, 0.32, 0.45);
    vec3 orbCol = vec3(0.35, 0.80, 0.95);
    vec3 midLayerCol = vec3(0.04, 0.08, 0.14);
    vec3 frontLayerCol = vec3(0.02, 0.04, 0.08);
    vec3 floorBaseCol = vec3(0.01, 0.03, 0.07);

    if (uEnvType > 0.5 && uEnvType < 1.5) {
      // 1: Fire & Embers
      skyTop = vec3(0.16, 0.02, 0.02);
      skyBot = vec3(0.68, 0.22, 0.06);
      orbCol = vec3(1.0, 0.48, 0.14);
      midLayerCol = vec3(0.16, 0.04, 0.03);
      frontLayerCol = vec3(0.08, 0.02, 0.02);
      floorBaseCol = vec3(0.05, 0.01, 0.01);
    } else if (uEnvType >= 1.5 && uEnvType < 2.5) {
      // 2: Monsoon Storm
      float lightning = pow(max(0.0, sin(uTime * 1.9 + sin(uTime * 5.3))), 24.0) * 0.22;
      skyTop = vec3(0.04, 0.08, 0.14) + vec3(lightning);
      skyBot = vec3(0.15, 0.26, 0.39) + vec3(lightning * 0.7);
      orbCol = vec3(0.55, 0.78, 0.96);
      midLayerCol = vec3(0.05, 0.09, 0.15);
      frontLayerCol = vec3(0.02, 0.05, 0.09);
    } else if (uEnvType >= 2.5 && uEnvType < 3.5) {
      // 3: Jaisalmer / Desert
      skyTop = vec3(0.10, 0.09, 0.18);
      skyBot = vec3(0.64, 0.39, 0.18);
      orbCol = vec3(0.98, 0.75, 0.36);
      midLayerCol = vec3(0.24, 0.13, 0.07);
      frontLayerCol = vec3(0.14, 0.07, 0.04);
      floorBaseCol = vec3(0.10, 0.05, 0.03);
    } else if (uEnvType >= 3.5 && uEnvType < 4.5) {
      // 4: Himalayan River
      skyTop = vec3(0.03, 0.14, 0.26);
      skyBot = vec3(0.09, 0.48, 0.60);
      orbCol = vec3(0.46, 0.94, 0.88);
      midLayerCol = vec3(0.07, 0.17, 0.26);
      frontLayerCol = vec3(0.03, 0.08, 0.14);
    } else if (uEnvType >= 4.5 && uEnvType < 5.5) {
      // 5: Royal Palace Courtyard
      skyTop = vec3(0.08, 0.04, 0.16);
      skyBot = vec3(0.38, 0.17, 0.28);
      orbCol = vec3(0.98, 0.78, 0.32);
      midLayerCol = vec3(0.15, 0.08, 0.14);
      frontLayerCol = vec3(0.09, 0.04, 0.08);
      floorBaseCol = vec3(0.07, 0.04, 0.06);
    } else if (uEnvType >= 5.5 && uEnvType < 6.5) {
      // 6: Cyber Neon Skyline
      skyTop = vec3(0.02, 0.03, 0.10);
      skyBot = vec3(0.14, 0.08, 0.28);
      orbCol = vec3(0.12, 0.88, 0.96);
      midLayerCol = vec3(0.05, 0.06, 0.14);
      frontLayerCol = vec3(0.02, 0.03, 0.08);
      floorBaseCol = vec3(0.02, 0.03, 0.07);
    } else if (uEnvType >= 6.5) {
      // 7: Clean Studio Cyclorama
      skyTop = vec3(0.05, 0.07, 0.12);
      skyBot = vec3(0.11, 0.16, 0.25);
      orbCol = vec3(0.62, 0.85, 0.98);
      midLayerCol = vec3(0.06, 0.09, 0.15);
      frontLayerCol = vec3(0.04, 0.06, 0.10);
      floorBaseCol = vec3(0.05, 0.07, 0.11);
    }

    vec3 col = mix(skyBot, skyTop, clamp(camUv.y, 0.0, 1.0));

    // Atmospheric aurora / mist band
    float aurora = 0.5 + 0.5 * sin(camUv.x * 5.0 + uTime * 0.25 + sin(camUv.y * 6.0));
    col += orbCol * aurora * 0.045 * smoothstep(0.25, 0.85, camUv.y);

    vec2 orbPos = vec2(0.5 + uPan * 0.35 + uPoseSide * 0.09 * uPoseBlend, uEnvType >= 6.5 ? 0.78 : 0.68);
    float dOrb = length(camUv - orbPos);
    col += orbCol * (0.055 + uAudio * 0.048) / (dOrb + 0.09);

    float rays = 0.5 + 0.5 * sin((camUv.x - orbPos.x) * 14.0 + uTime * 0.35);
    col += orbCol * rays * 0.032 * smoothstep(0.92, 0.18, dOrb);

    // Mid & Foreground Theme Silhouettes
    if (uEnvType >= 4.5 && uEnvType < 5.5) {
      // Royal Palace domes & arches
      float domeWave = 0.40 + 0.09 * pow(abs(sin(camUv.x * 9.5 + uPan * 1.4)), 0.55);
      if (camUv.y < domeWave) col = mix(col, midLayerCol, 0.84);
      float archCrest = 0.31 + 0.05 * abs(cos(camUv.x * 16.0 + uPan * 2.5));
      if (camUv.y < archCrest) col = mix(col, frontLayerCol, 0.92);
      // Warm palace lantern glow near arches
      float lanterns = smoothstep(0.92, 1.0, sin(camUv.x * 28.0 + uPan * 3.0)) * smoothstep(0.32, 0.24, abs(camUv.y - 0.29));
      col += vec3(1.0, 0.72, 0.25) * lanterns * 0.28;
    } else if (uEnvType >= 5.5 && uEnvType < 6.5) {
      // Cyber City high-rise blocks & neon accent windows
      float bx = floor((camUv.x + uPan * 0.35) * 18.0);
      float bh = 0.32 + hash11(bx) * 0.24;
      if (camUv.y < bh) {
        col = mix(col, midLayerCol, 0.88);
        float winGrid = step(0.76, fract(camUv.y * 45.0)) * step(0.68, fract((camUv.x + uPan * 0.35) * 72.0));
        col += vec3(0.15, 0.82, 0.98) * winGrid * 0.16 * hash11(bx + floor(camUv.y * 20.0));
      }
      float fx = floor((camUv.x + uPan * 0.65) * 12.0);
      float fh = 0.24 + hash11(fx + 9.1) * 0.16;
      if (camUv.y < fh) col = mix(col, frontLayerCol, 0.94);
    } else if (uEnvType < 6.5) {
      // Natural mountain / dune parallax
      float mBack = 0.48 + 0.07 * sin(camUv.x * 6.0 + uPan * 1.5) + 0.03 * cos(camUv.x * 13.0);
      if (camUv.y < mBack) col = mix(col, midLayerCol, 0.78);
      float mFront = 0.36 + 0.05 * sin(camUv.x * 9.0 + uPan * 3.5 + 1.2);
      if (camUv.y < mFront) col = mix(col, frontLayerCol, 0.90);
    } else {
      // Clean Studio Cyclorama floor sweep
      float studioSweep = smoothstep(0.36, 0.12, camUv.y);
      col = mix(col, floorBaseCol, studioSweep * 0.65);
    }

    if (camUv.y < 0.26) {
      float shimmer = 0.5 + 0.5 * waveNoise(vec2(camUv.x * 18.0, camUv.y * 40.0));
      col = mix(floorBaseCol, skyBot * 0.55, shimmer * 0.42);
    }

    vec2 ovUv = vec2(vUv.x, 1.0 - vUv.y);
    vec4 ov = texture2D(uOverlayTex, ovUv);
    if (abs(uPoseSide) > 0.2 && uPoseBlend > 0.05) {
      float rimStep = 0.0045;
      float leadAlpha = texture2D(
        uOverlayTex,
        clamp(ovUv + vec2(uPoseSide * rimStep, 0.0), 0.001, 0.999)
      ).a;
      float rimEdge =
        clamp((ov.a - leadAlpha) * 2.2, 0.0, 1.0) *
        step(0.18, ovUv.y) *
        step(ovUv.y, 0.88);
      ov.rgb += orbCol * rimEdge * 0.24 * uPoseBlend;
    }
    vec3 finalRgb = col * (1.0 - ov.a) + ov.rgb;
    gl_FragColor = vec4(finalRgb, 1.0);
  }
`;

export interface RenderFrameParams {
  scene: DirectedScene;
  actor: ActorProfile;
  framing?: CameraFraming;
  portraitImg?: HTMLImageElement | null;
  sidePortraitImg?: HTMLImageElement | null;
  dressCutoutCanvas?: HTMLCanvasElement | null;
  poseSide?: PoseSide;
  progress: number;
  timeSec: number;
  audioAmp: number;
  visemeWidth?: number;
  showRigOverlay?: boolean;
  glbRenderCanvas?: HTMLCanvasElement | null;
  gestureBoost?: number;
  overlayConfig?: OverlayTemplateConfig;
  hideCanvasCaptions?: boolean;
}

export class WebGlSceneRenderer {
  private canvas: HTMLCanvasElement;
  private gl: WebGLRenderingContext | null = null;
  private program: WebGLProgram | null = null;
  private texture: WebGLTexture | null = null;
  private vBuf: WebGLBuffer | null = null;
  private uvBuf: WebGLBuffer | null = null;
  private overlayCanvas: HTMLCanvasElement;
  private overlayCtx: CanvasRenderingContext2D | null = null;
  private fallback2dCtx: CanvasRenderingContext2D | null = null;
  private contextLost = false;
  private webglSupported = false;

  private uniforms: {
    uTime: WebGLUniformLocation | null;
    uEnvType: WebGLUniformLocation | null;
    uZoom: WebGLUniformLocation | null;
    uPan: WebGLUniformLocation | null;
    uAudio: WebGLUniformLocation | null;
    uPoseSide: WebGLUniformLocation | null;
    uPoseBlend: WebGLUniformLocation | null;
    uOverlayTex: WebGLUniformLocation | null;
  } = {
    uTime: null,
    uEnvType: null,
    uZoom: null,
    uPan: null,
    uAudio: null,
    uPoseSide: null,
    uPoseBlend: null,
    uOverlayTex: null,
  };

  constructor(canvas: HTMLCanvasElement, prefer2dFallback = false) {
    this.canvas = canvas;
    this.overlayCanvas = document.createElement('canvas');
    this.overlayCanvas.width = Math.max(2, canvas.width);
    this.overlayCanvas.height = Math.max(2, canvas.height);
    this.overlayCtx = this.overlayCanvas.getContext('2d');

    this.canvas.addEventListener('webglcontextlost', this.handleContextLost, false);
    this.canvas.addEventListener('webglcontextrestored', this.handleContextRestored, false);

    if (prefer2dFallback) {
      this.fallback2dCtx = this.canvas.getContext('2d');
    } else {
      this.initGl();
    }
  }

  public isWebGlActive(): boolean {
    return Boolean(this.webglSupported && this.gl && this.program && !this.contextLost);
  }

  private handleContextLost = (e: Event) => {
    e.preventDefault();
    this.contextLost = true;
  };

  private handleContextRestored = () => {
    this.contextLost = false;
    this.initGl();
  };

  public resize(width: number, height: number): void {
    const safeW = Math.max(2, width);
    const safeH = Math.max(2, height);
    if (this.canvas.width !== safeW || this.canvas.height !== safeH) {
      this.canvas.width = safeW;
      this.canvas.height = safeH;
      this.overlayCanvas.width = safeW;
      this.overlayCanvas.height = safeH;
      if (this.gl && !this.contextLost) {
        this.gl.viewport(0, 0, safeW, safeH);
      }
    }
  }

  private initGl(): void {
    try {
      const gl = this.canvas.getContext('webgl', {
        preserveDrawingBuffer: true,
        alpha: false,
        antialias: true,
      });

      if (!gl) {
        this.fallback2dCtx = this.canvas.getContext('2d');
        this.webglSupported = false;
        return;
      }

      const vs = this.compileShader(gl, gl.VERTEX_SHADER, VERTEX_SHADER_SRC);
      const fs = this.compileShader(gl, gl.FRAGMENT_SHADER, FRAGMENT_SHADER_SRC);
      const program = gl.createProgram();
      if (!program || !vs || !fs) {
        if (vs) gl.deleteShader(vs);
        if (fs) gl.deleteShader(fs);
        if (program) gl.deleteProgram(program);
        this.webglSupported = false;
        return;
      }

      gl.attachShader(program, vs);
      gl.attachShader(program, fs);
      gl.linkProgram(program);

      if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
        gl.deleteShader(vs);
        gl.deleteShader(fs);
        gl.deleteProgram(program);
        this.webglSupported = false;
        return;
      }

      gl.deleteShader(vs);
      gl.deleteShader(fs);

      this.gl = gl;
      this.program = program;
      gl.useProgram(program);

      const verts = new Float32Array([-1, -1, 1, -1, -1, 1, 1, 1]);
      const vBuf = gl.createBuffer();
      gl.bindBuffer(gl.ARRAY_BUFFER, vBuf);
      gl.bufferData(gl.ARRAY_BUFFER, verts, gl.STATIC_DRAW);
      this.vBuf = vBuf;
      const posLoc = gl.getAttribLocation(program, 'aPos');
      if (posLoc >= 0) {
        gl.enableVertexAttribArray(posLoc);
        gl.vertexAttribPointer(posLoc, 2, gl.FLOAT, false, 0, 0);
      }

      const uvs = new Float32Array([0, 0, 1, 0, 0, 1, 1, 1]);
      const uvBuf = gl.createBuffer();
      gl.bindBuffer(gl.ARRAY_BUFFER, uvBuf);
      gl.bufferData(gl.ARRAY_BUFFER, uvs, gl.STATIC_DRAW);
      this.uvBuf = uvBuf;
      const uvLoc = gl.getAttribLocation(program, 'aUv');
      if (uvLoc >= 0) {
        gl.enableVertexAttribArray(uvLoc);
        gl.vertexAttribPointer(uvLoc, 2, gl.FLOAT, false, 0, 0);
      }

      const tex = gl.createTexture();
      gl.bindTexture(gl.TEXTURE_2D, tex);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
      this.texture = tex;

      this.uniforms = {
        uTime: gl.getUniformLocation(program, 'uTime'),
        uEnvType: gl.getUniformLocation(program, 'uEnvType'),
        uZoom: gl.getUniformLocation(program, 'uZoom'),
        uPan: gl.getUniformLocation(program, 'uPan'),
        uAudio: gl.getUniformLocation(program, 'uAudio'),
        uPoseSide: gl.getUniformLocation(program, 'uPoseSide'),
        uPoseBlend: gl.getUniformLocation(program, 'uPoseBlend'),
        uOverlayTex: gl.getUniformLocation(program, 'uOverlayTex'),
      };
      this.webglSupported = true;
    } catch {
      this.webglSupported = false;
      this.gl = null;
      this.program = null;
    }
  }

  private compileShader(
    gl: WebGLRenderingContext,
    type: number,
    src: string
  ): WebGLShader | null {
    const shader = gl.createShader(type);
    if (!shader) return null;
    gl.shaderSource(shader, src);
    gl.compileShader(shader);
    if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
      gl.deleteShader(shader);
      return null;
    }
    return shader;
  }

  public renderFrame(params: RenderFrameParams): void {
    if (!this.overlayCtx) return;
    const {
      scene,
      actor,
      framing = CameraFraming.PRESENTER,
      portraitImg,
      sidePortraitImg,
      dressCutoutCanvas,
      poseSide,
      progress,
      timeSec,
      audioAmp,
      visemeWidth = 0.95,
      showRigOverlay = false,
      glbRenderCanvas = null,
      gestureBoost = 1.25,
      overlayConfig,
      hideCanvasCaptions = false,
    } = params;
    const w = this.canvas.width;
    const h = this.canvas.height;

    const camMotion = evaluateCameraMotionAtFrame(
      scene.cameraMotion,
      progress,
      timeSec,
      scene.cameraZoomStart,
      scene.cameraZoomEnd
    );

    const resolvedExplicitSide = poseSide ?? scene.poseSide;
    const biomePath = computeBiomeScenePath({
      biome: scene.biome,
      gesture: scene.gesture,
      framing,
      progress,
      sceneIndex: scene.index,
      cameraPanRange: scene.cameraPanRange,
      poseMode: scene.poseMode,
      poseSide: resolvedExplicitSide,
      walkingDestination: scene.walkingDestination,
    });
    const effectivePoseSide = resolveScenePoseSide({
      poseSide: resolvedExplicitSide,
      poseMode: scene.poseMode,
      gesture: scene.gesture,
      walkingDestination: scene.walkingDestination,
      biomePath,
    });

    this.overlayCtx.clearRect(0, 0, w, h);
    drawArticulatedCharacterAndHud(
      this.overlayCtx,
      w,
      h,
      scene,
      actor,
      framing,
      portraitImg ?? null,
      dressCutoutCanvas ?? null,
      progress,
      timeSec,
      audioAmp,
      visemeWidth,
      showRigOverlay,
      glbRenderCanvas ?? null,
      gestureBoost,
      camMotion,
      overlayConfig,
      hideCanvasCaptions,
      sidePortraitImg ?? null,
      effectivePoseSide,
      biomePath
    );

    if (this.gl && this.program && this.texture && !this.contextLost) {
      const gl = this.gl;
      gl.viewport(0, 0, w, h);
      gl.useProgram(this.program);

      gl.activeTexture(gl.TEXTURE0);
      gl.bindTexture(gl.TEXTURE_2D, this.texture);
      gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, true);
      gl.texImage2D(
        gl.TEXTURE_2D,
        0,
        gl.RGBA,
        gl.RGBA,
        gl.UNSIGNED_BYTE,
        this.overlayCanvas
      );

      const framingBoost =
        framing === CameraFraming.CLOSE_UP
          ? 1.15
          : framing === CameraFraming.PRESENTER
            ? 1.07
            : 1.0;
      const zoom = camMotion.zoom * framingBoost;
      const pan = Math.sin(progress * Math.PI) * scene.cameraPanRange + camMotion.offsetXNorm * 1.4;
      const poseSideUniform =
        effectivePoseSide === 'left' ? -1.0 : effectivePoseSide === 'right' ? 1.0 : 0.0;
      const poseBlendUniform =
        effectivePoseSide === 'front'
          ? 0.0
          : Math.min(1.0, Math.max(0.25, Math.abs(biomePath.sideProfile)));

      gl.uniform1f(this.uniforms.uTime, timeSec);
      gl.uniform1f(this.uniforms.uEnvType, scene.biome);
      gl.uniform1f(this.uniforms.uZoom, zoom);
      gl.uniform1f(this.uniforms.uPan, pan);
      gl.uniform1f(this.uniforms.uAudio, audioAmp);
      gl.uniform1f(this.uniforms.uPoseSide, poseSideUniform);
      gl.uniform1f(this.uniforms.uPoseBlend, poseBlendUniform);
      gl.uniform1i(this.uniforms.uOverlayTex, 0);

      gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
    } else if (this.fallback2dCtx) {
      const ctx = this.fallback2dCtx;
      const grad = ctx.createLinearGradient(0, 0, 0, h);
      grad.addColorStop(0, getFallbackThemeColors(scene.biome).top);
      grad.addColorStop(1, getFallbackThemeColors(scene.biome).bot);
      ctx.fillStyle = grad;
      ctx.fillRect(0, 0, w, h);
      ctx.drawImage(this.overlayCanvas, 0, 0);
    }
  }

  public dispose(): void {
    this.canvas.removeEventListener('webglcontextlost', this.handleContextLost);
    this.canvas.removeEventListener('webglcontextrestored', this.handleContextRestored);
    if (this.gl) {
      if (this.texture) this.gl.deleteTexture(this.texture);
      if (this.vBuf) this.gl.deleteBuffer(this.vBuf);
      if (this.uvBuf) this.gl.deleteBuffer(this.uvBuf);
      if (this.program) this.gl.deleteProgram(this.program);
      this.texture = null;
      this.vBuf = null;
      this.uvBuf = null;
      this.program = null;
      this.gl = null;
    }
  }
}

function drawRoundedRectPath(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  w: number,
  h: number,
  r: number
): void {
  if (typeof ctx.roundRect === 'function') {
    ctx.roundRect(x, y, w, h, r);
    return;
  }
  const rad = Math.min(r, Math.abs(w) * 0.5, Math.abs(h) * 0.5);
  ctx.moveTo(x + rad, y);
  ctx.lineTo(x + w - rad, y);
  ctx.quadraticCurveTo(x + w, y, x + w, y + rad);
  ctx.lineTo(x + w, y + h - rad);
  ctx.quadraticCurveTo(x + w, y + h, x + w - rad, y + h);
  ctx.lineTo(x + rad, y + h);
  ctx.quadraticCurveTo(x, y + h, x, y + h - rad);
  ctx.lineTo(x, y + rad);
  ctx.quadraticCurveTo(x, y, x + rad, y);
  ctx.closePath();
}

function getFallbackThemeColors(biome: EnvBiome): { top: string; bot: string } {
  switch (biome) {
    case EnvBiome.FIRE_BATTLE:
      return { top: '#260606', bot: '#9e3410' };
    case EnvBiome.MONSOON_RAIN:
      return { top: '#0b1424', bot: '#233f5e' };
    case EnvBiome.DESERT_MYSTERY:
      return { top: '#18142b', bot: '#915828' };
    case EnvBiome.ROYAL_PALACE:
      return { top: '#170c29', bot: '#5c2a46' };
    case EnvBiome.CYBER_CITY:
      return { top: '#060a1e', bot: '#211547' };
    case EnvBiome.STUDIO_CYCLORAMA:
      return { top: '#0d121f', bot: '#1e2b42' };
    default:
      return { top: '#071124', bot: '#0c3b54' };
  }
}

function getBiomeRimColor(biome: EnvBiome, fallback: string, t: number): string {
  switch (biome) {
    case EnvBiome.FIRE_BATTLE:
      return t % 0.4 > 0.2 ? '#FF6D00' : '#FF9E00';
    case EnvBiome.MONSOON_RAIN:
      return '#7DD3FC';
    case EnvBiome.DESERT_MYSTERY:
      return '#FBBF24';
    case EnvBiome.SACRED_RIVER:
      return '#5EEAD4';
    case EnvBiome.ROYAL_PALACE:
      return '#FCD34D';
    case EnvBiome.CYBER_CITY:
      return t % 0.8 > 0.4 ? '#22D3EE' : '#F472B6';
    case EnvBiome.STUDIO_CYCLORAMA:
      return '#E2E8F0';
    default:
      return fallback || '#22D3EE';
  }
}

/**
 * Irregular, natural human blink rhythm scaled by actor.blendShapes.blinkRateGain.
 */
function getSmoothBlinkFactor(timeSec: number, blinkRateGain = 1.0): number {
  const rate = Math.max(0.35, Math.min(2.0, blinkRateGain));
  const scaledTime = timeSec * rate;
  const jitter = Math.sin(Math.floor(scaledTime / 3.5) * 2.17) * 0.45;
  const period = 3.55 + jitter;
  const cycle = scaledTime % period;
  if (cycle < period - 0.2) return 0;
  const p = (cycle - (period - 0.2)) / 0.2;
  return Math.sin(Math.min(1, Math.max(0, p)) * Math.PI);
}

interface FootKinematics {
  strideProgress: number;
  footXOffset: number;
  lift: number;
  footPitch: number;
  depthScale: number;
  kneeBendForward: number;
  isStance: boolean;
  footVelRatio: number;
}

interface ArmKinematics {
  upperAngle: number;
  foreAngle: number;
  handAngle: number;
  fingerCurl: number;
  fingerSpread: number;
  pointIndex: boolean;
  depthScale: number;
}

interface BodyMotionState {
  isWalking: boolean;
  sideProfile: number;
  hipSwayX: number;
  hipBobY: number;
  torsoLean: number;
  headNodY: number;
  headTilt: number;
  clothLagX: number;
  shoulderRelaxY: number;
  eyeLeadFactor: number;
  leftAnchorX: number;
  rightAnchorX: number;
  leftFoot: FootKinematics;
  rightFoot: FootKinematics;
  leftArm: ArmKinematics;
  rightArm: ArmKinematics;
}

interface ActorPhysicsState {
  lastTimeSec: number;
  lastGesture: GestureAction;
  pelvisSway: SpringDamperState;
  torsoLean: SpringDamperState;
  headTilt: SpringDamperState;
  clothDrag: SpringDamperState;
  shoulderRelax: SpringDamperState;
  leftAnchorX: number;
  rightAnchorX: number;
}

const _actorPhysicsMap = new Map<string, ActorPhysicsState>();

function getActorPhysicsState(
  actorId: string,
  gesture: GestureAction,
  timeSec: number,
  defaultLeftX: number,
  defaultRightX: number
): { state: ActorPhysicsState; dt: number } {
  let state = _actorPhysicsMap.get(actorId);
  const needsReset =
    !state || timeSec < state.lastTimeSec || timeSec - state.lastTimeSec > 0.25;

  if (!state || needsReset) {
    state = {
      lastTimeSec: timeSec,
      lastGesture: gesture,
      pelvisSway: { value: 0, velocity: 0 },
      torsoLean: { value: 0, velocity: 0 },
      headTilt: { value: 0, velocity: 0 },
      clothDrag: { value: 0, velocity: 0 },
      shoulderRelax: { value: 0, velocity: 0 },
      leftAnchorX: defaultLeftX,
      rightAnchorX: defaultRightX,
    };
    _actorPhysicsMap.set(actorId, state);
    return { state, dt: 0.016 };
  }

  const dt = Math.max(0.004, Math.min(0.05, timeSec - state.lastTimeSec));
  state.lastTimeSec = timeSec;
  state.lastGesture = gesture;
  return { state, dt };
}

function smoothstep01(x: number): number {
  const t = Math.max(0, Math.min(1, x));
  return t * t * (3 - 2 * t);
}

/**
 * 5-Phase Standard Walk Cycle Timing (at ~120 BPM / 1.0s per full 2-step stride):
 * - 0% - 10%  : Heel Strike & Loading Response (Double Support)
 * - 10% - 30% : Mid-Stance (Pelvis shifts over standing leg)
 * - 30% - 50% : Terminal Stance & Heel-Off (Forward weight fall begins)
 * - 50% - 60% : Pre-Swing (Opposite foot strikes ground; Double Support)
 * - 60% - 100%: Swing Phase (~60 deg knee flexion, Cubic Bezier acceleration)
 */
function computeFootKinematics(
  phase: number,
  strideAmp: number,
  liftAmp: number,
  sideSign: number,
  weightShift: number,
  sideProfile = 0
): FootKinematics {
  const phase01 = ((phase / (Math.PI * 2)) % 1 + 1) % 1;
  const [nx1, ny1, nx2, ny2] = REALISM_BEZIER_CURVES.NATURAL_REACH;
  const [fx1, fy1, fx2, fy2] = REALISM_BEZIER_CURVES.FAST_BURST;

  let strideProgress = 0;
  let lift = 0;
  let footPitch = 0;
  let kneeBendForward = 6;
  let isStance = true;
  let footVelRatio = 0.01;

  if (phase01 < 0.1) {
    // 0% - 10%: Heel Strike & Loading Response
    const t = phase01 / 0.1;
    const ease = evaluateCubicBezierEase(t, nx1, ny1, nx2, ny2);
    strideProgress = 0.86 + 0.14 * ease;
    lift = (1 - ease) * 3.5;
    footPitch = -0.2 * (1 - ease);
    kneeBendForward = 7 + 8 * ease;
    isStance = true;
    footVelRatio = 0.016 * (1 - ease) + 0.005;
  } else if (phase01 < 0.3) {
    // 10% - 30%: Mid-Stance (Firmly Grounded)
    const t = (phase01 - 0.1) / 0.2;
    strideProgress = 1.0 - 0.96 * t;
    lift = 0;
    footPitch = 0;
    kneeBendForward = 15 - 8 * t;
    isStance = true;
    footVelRatio = 0.004;
  } else if (phase01 < 0.5) {
    // 30% - 50%: Terminal Stance & Heel-Off
    const t = (phase01 - 0.3) / 0.2;
    const ease = evaluateCubicBezierEase(t, nx1, ny1, nx2, ny2);
    strideProgress = 0.04 - 0.88 * ease;
    lift = 5.5 * Math.max(0, ease - 0.35);
    footPitch = 0.22 * ease;
    kneeBendForward = 7 + 7 * ease;
    isStance = t < 0.72;
    footVelRatio = t < 0.55 ? 0.014 : 0.055;
  } else if (phase01 < 0.6) {
    // 50% - 60%: Pre-Swing (Double Support toe-off)
    const t = (phase01 - 0.5) / 0.1;
    const ease = evaluateCubicBezierEase(t, fx1, fy1, fx2, fy2);
    strideProgress = -0.84 - 0.16 * ease;
    lift = 3.5 + 7.5 * ease;
    footPitch = 0.22 + 0.08 * ease;
    kneeBendForward = 14 + 14 * ease;
    isStance = false;
    footVelRatio = 0.12;
  } else {
    // 60% - 100%: Swing Phase (~60 deg knee flexion arc)
    const t = (phase01 - 0.6) / 0.4;
    const ease = evaluateCubicBezierEase(t, nx1, ny1, nx2, ny2);
    const arc = Math.sin(t * Math.PI);
    strideProgress = -1.0 + 1.86 * ease;
    lift = arc * liftAmp;
    footPitch = 0.26 - 0.46 * ease;
    kneeBendForward = 12 + 34 * arc;
    isStance = false;
    footVelRatio = 0.25 + 0.2 * arc;
  }

  const absP = Math.min(1, Math.abs(sideProfile));
  const facingDir = sideProfile >= 0 ? 1 : -1;
  const frontalOffset = strideProgress * strideAmp * 0.22 * -sideSign + weightShift * 0.28;
  const sagittalOffset = strideProgress * strideAmp * 1.18 * facingDir + weightShift * 0.15;
  const footXOffset = frontalOffset * (1 - absP) + sagittalOffset * absP;
  const depthScale = 1 + (strideProgress * 0.08 * (1 - absP) + sideSign * facingDir * 0.06 * absP);

  return {
    strideProgress,
    footXOffset,
    lift,
    footPitch,
    depthScale,
    kneeBendForward,
    isStance,
    footVelRatio,
  };
}

function computeBodyMotion(
  gesture: GestureAction,
  emotion: EmotionMood,
  biome: EnvBiome,
  actor: ActorProfile,
  timeSec: number,
  progress: number,
  audioAmp: number,
  gestureBoost = 1.25,
  path?: BiomePathSample
): BodyMotionState {
  const beats = evaluateSceneActionBeats(progress);
  const introEase = smoothstep01(progress * 4.5);
  const breathe = Math.sin(timeSec * 2.2) * (0.65 + 0.35 * beats.stanceMicro);
  const isWalking = gesture === GestureAction.WALKING;
  const sideProfile = path?.sideProfile ?? 0;
  const absP = Math.min(1, Math.abs(sideProfile));
  const facingDir = sideProfile >= 0 ? 1 : -1;
  const pathMoveBlend = isWalking
    ? 1
    : path?.isMoving
      ? Math.max(0, Math.min(1, (path.moveSpeed ?? 0) * 1.15))
      : 0;
  const boost = Math.max(0.75, Math.min(2.0, gestureBoost));

  const buildFactor =
    actor.bodyBuild === 'BROAD' ? 1.15 : actor.bodyBuild === 'SLIM' ? 0.88 : 1.0;
  const legRatio = actor.rig?.legLengthRatio ?? 1.0;
  const strideScale = actor.retarget?.strideScale ?? 1.0;
  const armAmp = (actor.retarget?.armAmplitude ?? 1.0) * boost;
  const expr = (actor.retarget?.expressiveness ?? 1.0) * (0.85 + 0.15 * boost);
  const lagMult = actor.retarget?.phaseLag ?? 1.0;

  const stanceMult = actor.ik?.hipStanceWidth ?? 1.0;
  const ankleLiftGain = actor.ik?.ankleLiftGain ?? 1.0;
  const elbowBias = actor.ik?.elbowBendBias ?? 0.18;

  const nominalLeftFootX = -36 * buildFactor * stanceMult;
  const nominalRightFootX = 36 * buildFactor * stanceMult;
  const { state: phys, dt } = getActorPhysicsState(
    actor.id || 'actor',
    gesture,
    timeSec,
    nominalLeftFootX,
    nominalRightFootX
  );

  // Scene-mood & terrain biome leg modulation
  const emotionCadence =
    emotion === EmotionMood.INTENSE
      ? 1.22
      : emotion === EmotionMood.HEROIC
        ? 1.08
        : emotion === EmotionMood.MYSTERIOUS
          ? 0.84
          : 0.94;
  const emotionKneeAdd =
    emotion === EmotionMood.MYSTERIOUS
      ? 11
      : emotion === EmotionMood.INTENSE
        ? 8
        : emotion === EmotionMood.HEROIC
          ? 6
          : 2;
  const terrainLift =
    biome === EnvBiome.DESERT_MYSTERY ||
    biome === EnvBiome.SACRED_RIVER ||
    biome === EnvBiome.FIRE_BATTLE ||
    biome === EnvBiome.MONSOON_RAIN
      ? 1.18
      : 1.0;

  // Froude biomechanical cadence scaling: ~120 BPM baseline scaled by emotion & leg length
  const gaitFreq = (6.283 * emotionCadence) / Math.sqrt(Math.max(0.75, legRatio));

  const actionBeatGain = 0.42 + 0.58 * beats.primaryActionGain;
  let targetHipSwayX =
    (Math.sin(timeSec * 1.15) * 6.5 + Math.sin(timeSec * 2.4) * audioAmp * 3.8) *
    expr *
    (0.7 + 0.3 * beats.anticipationShift);
  let hipBobY = breathe * 2.6 + audioAmp * 2.5;
  let targetTorsoLean =
    (Math.sin(timeSec * 1.45) * 0.02 + audioAmp * Math.sin(timeSec * 4.2) * 0.018) *
    expr *
    actionBeatGain;
  // Beat 2 anticipation: eyes/head lead turn before torso catches up
  const headNodY =
    audioAmp * 6.0 * expr * (0.8 + 0.2 * beats.eyeLeadFactor) + breathe * 1.4;
  let targetHeadTilt =
    (((Math.sin(timeSec * 1.75) * 4.2 + Math.cos(timeSec * 3.1) * audioAmp * 4.0) *
      expr *
      (0.75 + 0.35 * beats.eyeLeadFactor)) *
      Math.PI) /
    180;

  let leftFoot: FootKinematics;
  let rightFoot: FootKinematics;

  if (isWalking) {
    const phi = timeSec * gaitFreq;
    const strideGain =
      introEase * strideScale * (0.72 + 0.28 * beats.primaryActionGain) * Math.max(0.45, path?.moveSpeed ?? 1);
    // Pelvis shifts laterally (~2-4 cm -> ~11px scaled) over standing leg during Mid-Stance
    targetHipSwayX = Math.sin(phi + 0.35) * 11.5 * introEase * expr * (1 - 0.45 * absP);
    hipBobY = (1 - Math.cos(phi * 2)) * 6.2 * introEase * Math.min(1.35, strideScale);
    targetTorsoLean =
      (Math.sin(phi) * 0.036 * (1 - 0.5 * absP) + facingDir * 0.065 * absP) * introEase * expr;
    targetHeadTilt += Math.sin(phi) * 0.026 * introEase * expr;

    leftFoot = computeFootKinematics(
      phi,
      44 * strideGain,
      30 * introEase * ankleLiftGain * terrainLift,
      -1,
      targetHipSwayX,
      sideProfile
    );
    rightFoot = computeFootKinematics(
      phi + Math.PI,
      44 * strideGain,
      30 * introEase * ankleLiftGain * terrainLift,
      1,
      targetHipSwayX,
      sideProfile
    );
  } else if (gesture === GestureAction.HERO_RAISE) {
    const beat = Math.sin(timeSec * 2.6 * emotionCadence);
    const stepShift =
      (0.65 + 0.14 * beat + audioAmp * 0.16) * introEase * strideScale * actionBeatGain;
    targetHipSwayX = (-10 * beats.anticipationShift + beat * 4.5) * introEase * expr;
    hipBobY = (4.5 + Math.abs(beat) * 3.5 + audioAmp * 3.2) * introEase;
    leftFoot = {
      strideProgress: 0.58 * stepShift,
      footXOffset: -18 * introEase * strideScale * beats.anticipationShift,
      lift: Math.max(0, beat) * 5.0 * ankleLiftGain,
      footPitch: -0.06 * introEase,
      depthScale: 1.05,
      kneeBendForward: 13 + emotionKneeAdd + Math.max(0, beat) * 6,
      isStance: beat <= 0.15,
      footVelRatio: beat <= 0.15 ? 0.008 : 0.06,
    };
    rightFoot = {
      strideProgress: -0.48 * stepShift,
      footXOffset: 16 * introEase * strideScale * beats.anticipationShift,
      lift: (3 + Math.max(0, -beat) * 7.0) * introEase * ankleLiftGain,
      footPitch: 0.16 * introEase,
      depthScale: 0.95,
      kneeBendForward: 9 + emotionKneeAdd * 0.6,
      isStance: beat >= -0.25,
      footVelRatio: beat >= -0.25 ? 0.01 : 0.05,
    };
  } else if (gesture === GestureAction.POINTING) {
    const thrust = Math.sin(timeSec * 3.2 * emotionCadence);
    const lunge =
      (0.72 + 0.16 * thrust + audioAmp * 0.18) * introEase * strideScale * actionBeatGain;
    targetHipSwayX = (11 * beats.anticipationShift + thrust * 4) * introEase * expr;
    hipBobY = (5.0 + Math.max(0, thrust) * 3.2) * introEase;
    leftFoot = {
      strideProgress: -0.52 * lunge,
      footXOffset: -14 * introEase * strideScale * beats.anticipationShift,
      lift: (5 + Math.max(0, thrust) * 7.5) * introEase * ankleLiftGain,
      footPitch: 0.2 * introEase,
      depthScale: 0.94,
      kneeBendForward: 8 + emotionKneeAdd * 0.5,
      isStance: thrust < 0.25,
      footVelRatio: thrust < 0.25 ? 0.012 : 0.05,
    };
    rightFoot = {
      strideProgress: 0.65 * lunge,
      footXOffset: 18 * introEase * strideScale * beats.anticipationShift,
      lift: Math.max(0, -thrust) * 3.5 * ankleLiftGain,
      footPitch: -0.05 * introEase,
      depthScale: 1.06,
      kneeBendForward: 16 + emotionKneeAdd + Math.max(0, thrust) * 5,
      isStance: true,
      footVelRatio: 0.008,
    };
  } else if (gesture === GestureAction.TALK_WAVE) {
    const swayPhase = timeSec * 1.95 * emotionCadence;
    const shift = Math.sin(swayPhase);
    const tap = Math.max(0, Math.sin(swayPhase * 2)) * (0.4 + audioAmp * 0.8);
    targetHipSwayX =
      (shift * 14.5 + Math.sin(timeSec * 3.4) * audioAmp * 4.5) *
      expr *
      (0.75 + 0.25 * beats.anticipationShift);
    hipBobY += Math.abs(shift) * 3.4 + audioAmp * 3.0;

    const lUnloaded = Math.max(0, -shift);
    const rUnloaded = Math.max(0, shift);
    leftFoot = {
      strideProgress: (0.22 * shift + 0.14 * lUnloaded) * strideScale,
      footXOffset: (-6 - lUnloaded * 10) * strideScale + targetHipSwayX * 0.2,
      lift: (lUnloaded * 10.5 + tap * 4.5) * ankleLiftGain * terrainLift,
      footPitch: lUnloaded * 0.18,
      depthScale: 1 + 0.04 * shift,
      kneeBendForward: 5 + emotionKneeAdd * 0.5 + lUnloaded * 14 + audioAmp * 4,
      isStance: lUnloaded < 0.25,
      footVelRatio: lUnloaded < 0.25 ? 0.01 : 0.06,
    };
    rightFoot = {
      strideProgress: (-0.22 * shift + 0.14 * rUnloaded) * strideScale,
      footXOffset: (6 + rUnloaded * 10) * strideScale + targetHipSwayX * 0.2,
      lift: (rUnloaded * 10.5 + tap * 4.5) * ankleLiftGain * terrainLift,
      footPitch: rUnloaded * 0.18,
      depthScale: 1 - 0.04 * shift,
      kneeBendForward: 5 + emotionKneeAdd * 0.5 + rUnloaded * 14 + audioAmp * 4,
      isStance: rUnloaded < 0.25,
      footVelRatio: rUnloaded < 0.25 ? 0.01 : 0.06,
    };
  } else {
    const pacePhase = timeSec * 1.15 * emotionCadence;
    const shift = Math.sin(pacePhase);
    const paceStep = Math.sin(pacePhase * 0.5);
    targetHipSwayX = shift * 11.5 * expr * (0.8 + 0.2 * beats.anticipationShift);
    hipBobY += Math.abs(shift) * 2.5;
    const lFree = Math.max(0, -shift);
    const rFree = Math.max(0, shift);
    leftFoot = {
      strideProgress: (-0.28 + paceStep * 0.22) * strideScale,
      footXOffset: -10 * strideScale + targetHipSwayX * 0.18,
      lift: lFree * 9.0 * ankleLiftGain,
      footPitch: lFree * 0.15,
      depthScale: 0.97 + paceStep * 0.04,
      kneeBendForward: 6 + emotionKneeAdd + lFree * 12,
      isStance: lFree < 0.25,
      footVelRatio: lFree < 0.25 ? 0.009 : 0.05,
    };
    rightFoot = {
      strideProgress: (0.32 - paceStep * 0.22) * strideScale,
      footXOffset: 11 * strideScale + targetHipSwayX * 0.18,
      lift: rFree * 9.0 * ankleLiftGain,
      footPitch: rFree * 0.15,
      depthScale: 1.03 - paceStep * 0.04,
      kneeBendForward: 6 + emotionKneeAdd + rFree * 12,
      isStance: rFree < 0.25,
      footVelRatio: rFree < 0.25 ? 0.009 : 0.05,
    };
  }

  // When a non-WALKING scene actively traverses along the biome path from A to B, blend real stepping kinematics
  if (!isWalking && pathMoveBlend > 0.08) {
    const phi = timeSec * gaitFreq;
    const stepStride = 34 * strideScale * pathMoveBlend;
    const stepL = computeFootKinematics(
      phi,
      stepStride,
      24 * ankleLiftGain * terrainLift * pathMoveBlend,
      -1,
      targetHipSwayX,
      sideProfile
    );
    const stepR = computeFootKinematics(
      phi + Math.PI,
      stepStride,
      24 * ankleLiftGain * terrainLift * pathMoveBlend,
      1,
      targetHipSwayX,
      sideProfile
    );
    const blendFoot = (base: FootKinematics, walk: FootKinematics): FootKinematics => ({
      strideProgress: base.strideProgress * (1 - pathMoveBlend) + walk.strideProgress * pathMoveBlend,
      footXOffset: base.footXOffset * (1 - pathMoveBlend) + walk.footXOffset * pathMoveBlend,
      lift: base.lift * (1 - pathMoveBlend) + walk.lift * pathMoveBlend,
      footPitch: base.footPitch * (1 - pathMoveBlend) + walk.footPitch * pathMoveBlend,
      depthScale: base.depthScale * (1 - pathMoveBlend) + walk.depthScale * pathMoveBlend,
      kneeBendForward:
        base.kneeBendForward * (1 - pathMoveBlend) + walk.kneeBendForward * pathMoveBlend,
      isStance: pathMoveBlend > 0.45 ? walk.isStance : base.isStance,
      footVelRatio: base.footVelRatio * (1 - pathMoveBlend) + walk.footVelRatio * pathMoveBlend,
    });
    leftFoot = blendFoot(leftFoot, stepL);
    rightFoot = blendFoot(rightFoot, stepR);
    hipBobY += (1 - Math.cos(phi * 2)) * 4.2 * pathMoveBlend;
    targetTorsoLean += facingDir * 0.045 * absP * pathMoveBlend;
  }

  // Segment-mass CoM + Zero-Moment Point (ZMP) stability correction inside grounded Base of Support
  const lFootTargetX = nominalLeftFootX + leftFoot.footXOffset;
  const rFootTargetX = nominalRightFootX + rightFoot.footXOffset;
  const bosLeft = leftFoot.isStance ? lFootTargetX - 18 : rFootTargetX - 18;
  const bosRight = rightFoot.isStance ? rFootTargetX + 18 : lFootTargetX + 18;
  const bosMinX = Math.min(bosLeft, bosRight);
  const bosMaxX = Math.max(bosLeft, bosRight);

  const zmp = computeCoMAndZmpBalance({
    headX: targetHipSwayX + Math.sin(targetTorsoLean) * 240,
    headY: -296,
    torsoX: targetHipSwayX + Math.sin(targetTorsoLean) * 110,
    torsoY: -120,
    lArmX: targetHipSwayX - 75,
    lArmY: -140,
    rArmX: targetHipSwayX + 75,
    rArmY: -140,
    lLegX: (targetHipSwayX + lFootTargetX) * 0.5,
    lLegY: 95,
    rLegX: (targetHipSwayX + rFootTargetX) * 0.5,
    rLegY: 95,
    accelX: (targetHipSwayX - phys.pelvisSway.value) * 0.18,
    accelZ: Math.sin(timeSec * 4.4) * 0.65,
    bosMinX,
    bosMaxX,
  });

  const balancedSwayTarget = targetHipSwayX + zmp.pelvisCorrectionX;

  // Step Damped Harmonic Spring-Damper physics for smooth natural follow-through
  phys.pelvisSway = stepSpringDamper(phys.pelvisSway, balancedSwayTarget, 38, 1.55, dt, 0.88);
  phys.torsoLean = stepSpringDamper(phys.torsoLean, targetTorsoLean, 42, 1.2, dt, 0.84);
  phys.headTilt = stepSpringDamper(phys.headTilt, targetHeadTilt, 52, 0.75, dt, 0.82);

  // Cloth/saree/shawl lags smoothly behind horizontal velocity & torso lean
  const targetClothLag = -phys.pelvisSway.velocity * 0.18 - phys.torsoLean.value * 110;
  phys.clothDrag = stepSpringDamper(phys.clothDrag, targetClothLag, 18, 0.95, dt, 0.68);

  // Beat 4 deceleration & shoulder settle down
  const targetShoulderRelax = beats.settleFollowThrough * 4.5 * (1 - audioAmp * 0.4);
  phys.shoulderRelax = stepSpringDamper(
    phys.shoulderRelax,
    targetShoulderRelax,
    36,
    0.9,
    dt,
    0.85
  );

  // Cache grounded foot world X anchors for Ground Contact Lock
  if (leftFoot.isStance && leftFoot.footVelRatio < 0.025) {
    phys.leftAnchorX = phys.leftAnchorX * 0.72 + lFootTargetX * 0.28;
  } else if (!leftFoot.isStance) {
    phys.leftAnchorX = lFootTargetX;
  }
  if (rightFoot.isStance && rightFoot.footVelRatio < 0.025) {
    phys.rightAnchorX = phys.rightAnchorX * 0.72 + rFootTargetX * 0.28;
  } else if (!rightFoot.isStance) {
    phys.rightAnchorX = rFootTargetX;
  }

  const hipSwayX = phys.pelvisSway.value;
  const torsoLean = phys.torsoLean.value;
  const headTilt = phys.headTilt.value;

  let leftArm: ArmKinematics = {
    upperAngle: -0.22 + breathe * 0.03 * expr,
    foreAngle: -0.24 - elbowBias * 0.7 + Math.sin(timeSec * 2.2 - 0.5 * lagMult) * 0.05,
    handAngle: -0.28 - elbowBias * 0.75 + Math.sin(timeSec * 2.2 - 0.9 * lagMult) * 0.06,
    fingerCurl: 0.3,
    fingerSpread: 0.18,
    pointIndex: false,
    depthScale: 1,
  };

  let rightArm: ArmKinematics = {
    upperAngle: 0.24 - breathe * 0.03 * expr,
    foreAngle: 0.26 + elbowBias * 0.7 - Math.sin(timeSec * 2.2 - 0.5 * lagMult) * 0.05,
    handAngle: 0.3 + elbowBias * 0.75 - Math.sin(timeSec * 2.2 - 0.9 * lagMult) * 0.06,
    fingerCurl: 0.3,
    fingerSpread: 0.18,
    pointIndex: false,
    depthScale: 1,
  };

  switch (gesture) {
    case GestureAction.WALKING: {
      const phi = timeSec * gaitFreq;
      const lSwing = Math.sin(phi + Math.PI);
      const lLag1 = Math.sin(phi + Math.PI - 0.55 * lagMult);
      const lLag2 = Math.sin(phi + Math.PI - 0.95 * lagMult);

      const rSwing = Math.sin(phi);
      const rLag1 = Math.sin(phi - 0.55 * lagMult);
      const rLag2 = Math.sin(phi - 0.95 * lagMult);

      const walkArmGain = armAmp * introEase * actionBeatGain;
      const sagittalArm = absP > 0.2;
      const lUpperFront = -0.2 * introEase + lSwing * 0.42 * walkArmGain;
      const lUpperSide = facingDir * (0.08 + lSwing * 0.48 * walkArmGain);
      const lUpper = lUpperFront * (1 - absP) + lUpperSide * absP;
      const lForeFront =
        lUpperFront -
        (0.16 + elbowBias * 0.8) -
        Math.max(0, lLag1) * 0.44 * walkArmGain -
        audioAmp * 0.22 * armAmp;
      const lForeSide =
        lUpperSide + facingDir * (0.28 + Math.max(0, lLag1 * facingDir) * 0.44 * walkArmGain);
      const lFore = sagittalArm ? lForeFront * (1 - absP) + lForeSide * absP : lForeFront;
      const lHand = lFore + (sagittalArm ? facingDir * 0.14 : -0.14 - lLag2 * 0.18 * lagMult * introEase);

      const rUpperFront = 0.2 * introEase - rSwing * 0.42 * walkArmGain;
      const rUpperSide = facingDir * (0.08 + rSwing * 0.48 * walkArmGain);
      const rUpper = rUpperFront * (1 - absP) + rUpperSide * absP;
      const rForeFront =
        rUpperFront +
        (0.16 + elbowBias * 0.8) +
        Math.max(0, rLag1) * 0.44 * walkArmGain +
        audioAmp * 0.24 * armAmp;
      const rForeSide =
        rUpperSide + facingDir * (0.28 + Math.max(0, rLag1 * facingDir) * 0.44 * walkArmGain);
      const rFore = sagittalArm ? rForeFront * (1 - absP) + rForeSide * absP : rForeFront;
      const rHand = rFore + (sagittalArm ? facingDir * 0.14 : 0.14 + rLag2 * 0.18 * lagMult * introEase);

      leftArm = {
        upperAngle: lUpper,
        foreAngle: lFore,
        handAngle: lHand,
        fingerCurl: Math.max(0.18, 0.44 - audioAmp * 0.16),
        fingerSpread: 0.16 + audioAmp * 0.22,
        pointIndex: false,
        depthScale: 1 + lSwing * 0.06 * introEase - (facingDir > 0 ? 0.06 * absP : 0),
      };
      rightArm = {
        upperAngle: rUpper,
        foreAngle: rFore,
        handAngle: rHand,
        fingerCurl: Math.max(0.18, 0.44 - audioAmp * 0.16),
        fingerSpread: 0.16 + audioAmp * 0.22,
        pointIndex: false,
        depthScale: 1 + rSwing * 0.06 * introEase - (facingDir < 0 ? 0.06 * absP : 0),
      };
      break;
    }

    case GestureAction.TALK_WAVE: {
      const speak = (0.58 + audioAmp * 0.88) * armAmp * (0.8 + 0.2 * beats.primaryActionGain);
      const waveA = Math.sin(timeSec * 2.55);
      const waveB = Math.cos(timeSec * 2.15 + 0.6);
      const beatAccent = Math.sin(timeSec * 4.4) * audioAmp * armAmp;

      const lU = -0.36 + waveA * 0.22 * speak + breathe * 0.045 * expr;
      const lF =
        -1.08 -
        elbowBias * 0.65 +
        Math.sin(timeSec * 2.55 - 0.58 * lagMult) * 0.42 * speak +
        beatAccent * 0.16;
      const lH =
        lF - 0.26 + Math.sin(timeSec * 2.55 - 1.12 * lagMult) * 0.3 * speak;

      const rU = 0.38 + waveB * 0.24 * speak - breathe * 0.045 * expr;
      const rF =
        1.14 +
        elbowBias * 0.65 +
        Math.cos(timeSec * 2.15 + 0.6 - 0.55 * lagMult) * 0.44 * speak -
        beatAccent * 0.16;
      const rH =
        rF + 0.26 + Math.cos(timeSec * 2.15 + 0.6 - 1.08 * lagMult) * 0.32 * speak;

      leftArm = {
        upperAngle: lU,
        foreAngle: lF,
        handAngle: lH,
        fingerCurl: Math.max(0.05, 0.18 - audioAmp * 0.14),
        fingerSpread: 0.42 + audioAmp * 0.48,
        pointIndex: false,
        depthScale: 1 + (0.04 + audioAmp * 0.045) * (0.5 + 0.5 * waveA),
      };
      rightArm = {
        upperAngle: rU,
        foreAngle: rF,
        handAngle: rH,
        fingerCurl: Math.max(0.05, 0.18 - audioAmp * 0.14),
        fingerSpread: 0.44 + audioAmp * 0.48,
        pointIndex: false,
        depthScale: 1 + (0.04 + audioAmp * 0.045) * (0.5 + 0.5 * waveB),
      };
      break;
    }

    case GestureAction.HERO_RAISE: {
      const heroLift = evaluateCubicBezierEase(
        Math.min(1, progress * 1.45),
        ...REALISM_BEZIER_CURVES.HEAVY_LIFT
      );
      const pulse = Math.sin(timeSec * 2.4) * (0.09 + audioAmp * 0.08) * armAmp;
      const lU =
        -0.25 - 2.04 * Math.max(introEase * 0.65, heroLift) * Math.min(1.14, armAmp * 0.8 + 0.18) + pulse;
      const lF =
        -0.38 -
        2.2 * Math.max(introEase * 0.65, heroLift) +
        Math.sin(timeSec * 2.4 - 0.5 * lagMult) * 0.12 * armAmp;
      const lH = lF - 0.18 + Math.sin(timeSec * 2.4 - 1.0 * lagMult) * 0.14 * armAmp;

      const rCounter = Math.cos(timeSec * 2.6) * (0.14 + audioAmp * 0.18) * armAmp;
      const rU = 0.36 + rCounter * 0.6;
      const rF = 0.72 + elbowBias * 0.6 + rCounter + audioAmp * 0.22 * armAmp;
      const rH = rF + 0.2 + Math.sin(timeSec * 3.0) * 0.12;

      leftArm = {
        upperAngle: lU,
        foreAngle: lF,
        handAngle: lH,
        fingerCurl: emotion === EmotionMood.HEROIC ? 0.62 : 0.2,
        fingerSpread: 0.28 + audioAmp * 0.2,
        pointIndex: false,
        depthScale: 1.06,
      };
      rightArm = {
        upperAngle: rU,
        foreAngle: rF,
        handAngle: rH,
        fingerCurl: Math.max(0.1, 0.28 - audioAmp * 0.12),
        fingerSpread: 0.32 + audioAmp * 0.3,
        pointIndex: false,
        depthScale: 1.02,
      };
      break;
    }

    case GestureAction.POINTING: {
      const pointBurst = evaluateCubicBezierEase(
        Math.min(1, progress * 2.2),
        ...REALISM_BEZIER_CURVES.FAST_BURST
      );
      const emphasis = Math.sin(timeSec * 3.4) * (0.09 + audioAmp * 0.11) * armAmp;
      const rU = 0.28 + 0.98 * pointBurst + emphasis * 0.55;
      const rF =
        0.44 +
        1.1 * pointBurst -
        elbowBias * 0.2 +
        Math.sin(timeSec * 3.4 - 0.45 * lagMult) * 0.14 * armAmp;
      const rH = rF + 0.1 + Math.sin(timeSec * 3.4 - 0.9 * lagMult) * 0.11;

      const lTalk = Math.sin(timeSec * 2.3) * (0.16 + audioAmp * 0.2) * armAmp;
      leftArm = {
        upperAngle: -0.28 + lTalk * 0.55,
        foreAngle: -0.68 - elbowBias * 0.55 + lTalk,
        handAngle: -0.84 + Math.sin(timeSec * 2.8) * 0.14,
        fingerCurl: Math.max(0.12, 0.28 - audioAmp * 0.12),
        fingerSpread: 0.34 + audioAmp * 0.26,
        pointIndex: false,
        depthScale: 1.0,
      };
      rightArm = {
        upperAngle: rU,
        foreAngle: rF,
        handAngle: rH,
        fingerCurl: 0.72,
        fingerSpread: 0.2,
        pointIndex: true,
        depthScale: 1.08,
      };
      break;
    }

    case GestureAction.THINKING: {
      const reachEase = evaluateCubicBezierEase(
        Math.min(1, progress * 1.8),
        ...REALISM_BEZIER_CURVES.NATURAL_REACH
      );
      const drift = Math.sin(timeSec * 1.9) * (0.055 + audioAmp * 0.06) * armAmp;
      const rU = 0.26 + 0.2 * reachEase + drift * 0.45;
      const rF = 0.4 - 2.84 * reachEase + drift;
      const rH = rF + 0.24 + Math.sin(timeSec * 1.9 - 0.6 * lagMult) * 0.08;

      const lExplain = Math.sin(timeSec * 2.4) * (0.18 + audioAmp * 0.22) * armAmp;
      leftArm = {
        upperAngle: -0.26 + breathe * 0.03 + lExplain * 0.45,
        foreAngle: -0.78 - elbowBias * 0.45 + lExplain,
        handAngle: -0.96 + Math.cos(timeSec * 2.4) * 0.14,
        fingerCurl: Math.max(0.12, 0.3 - audioAmp * 0.14),
        fingerSpread: 0.3 + audioAmp * 0.32,
        pointIndex: false,
        depthScale: 1.01,
      };
      rightArm = {
        upperAngle: rU,
        foreAngle: rF,
        handAngle: rH,
        fingerCurl: 0.44,
        fingerSpread: 0.16,
        pointIndex: false,
        depthScale: 1.04,
      };
      break;
    }
  }

  return {
    isWalking,
    sideProfile,
    hipSwayX,
    hipBobY,
    torsoLean,
    headNodY,
    headTilt,
    clothLagX: phys.clothDrag.value,
    shoulderRelaxY: phys.shoulderRelax.value,
    eyeLeadFactor: beats.eyeLeadFactor,
    leftAnchorX: phys.leftAnchorX,
    rightAnchorX: phys.rightAnchorX,
    leftFoot,
    rightFoot,
    leftArm,
    rightArm,
  };
}

interface SkeletonPoint {
  x: number;
  y: number;
}

interface SkeletonDebugFrame {
  pelvis: SkeletonPoint;
  chest: SkeletonPoint;
  neck: SkeletonPoint;
  head: SkeletonPoint;
  lShoulder: SkeletonPoint;
  lElbow: SkeletonPoint;
  lWrist: SkeletonPoint;
  rShoulder: SkeletonPoint;
  rElbow: SkeletonPoint;
  rWrist: SkeletonPoint;
  lHip: SkeletonPoint;
  lKnee: SkeletonPoint;
  lAnkle: SkeletonPoint;
  rHip: SkeletonPoint;
  rKnee: SkeletonPoint;
  rAnkle: SkeletonPoint;
}

function drawRigSkeletonOverlay(
  ctx: CanvasRenderingContext2D,
  skel: SkeletonDebugFrame,
  accentColor: string
): void {
  const bones: [SkeletonPoint, SkeletonPoint][] = [
    [skel.pelvis, skel.chest],
    [skel.chest, skel.neck],
    [skel.neck, skel.head],
    [skel.chest, skel.lShoulder],
    [skel.lShoulder, skel.lElbow],
    [skel.lElbow, skel.lWrist],
    [skel.chest, skel.rShoulder],
    [skel.rShoulder, skel.rElbow],
    [skel.rElbow, skel.rWrist],
    [skel.pelvis, skel.lHip],
    [skel.lHip, skel.lKnee],
    [skel.lKnee, skel.lAnkle],
    [skel.pelvis, skel.rHip],
    [skel.rHip, skel.rKnee],
    [skel.rKnee, skel.rAnkle],
  ];

  ctx.save();
  ctx.strokeStyle = '#22D3EE';
  ctx.lineWidth = 2.6;
  ctx.lineCap = 'round';
  for (const [a, b] of bones) {
    ctx.beginPath();
    ctx.moveTo(a.x, a.y);
    ctx.lineTo(b.x, b.y);
    ctx.stroke();
  }

  const joints: SkeletonPoint[] = [
    skel.pelvis,
    skel.chest,
    skel.neck,
    skel.head,
    skel.lShoulder,
    skel.lElbow,
    skel.rShoulder,
    skel.rElbow,
    skel.lHip,
    skel.lKnee,
    skel.rHip,
    skel.rKnee,
  ];
  for (const j of joints) {
    ctx.fillStyle = '#090C12';
    ctx.strokeStyle = '#FFFFFF';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.arc(j.x, j.y, 4.5, 0, Math.PI * 2);
    ctx.fill();
    ctx.stroke();
  }

  // IK Target End Effectors (wrists & ankles)
  for (const ikPt of [skel.lWrist, skel.rWrist, skel.lAnkle, skel.rAnkle]) {
    ctx.strokeStyle = accentColor || '#FACC15';
    ctx.lineWidth = 2.2;
    ctx.beginPath();
    ctx.arc(ikPt.x, ikPt.y, 7.5, 0, Math.PI * 2);
    ctx.stroke();
    ctx.beginPath();
    ctx.moveTo(ikPt.x - 10, ikPt.y);
    ctx.lineTo(ikPt.x + 10, ikPt.y);
    ctx.moveTo(ikPt.x, ikPt.y - 10);
    ctx.lineTo(ikPt.x, ikPt.y + 10);
    ctx.stroke();
  }
  ctx.restore();
}

function drawArticulatedCharacterAndHud(
  ctx: CanvasRenderingContext2D,
  w: number,
  h: number,
  scene: DirectedScene,
  actor: ActorProfile,
  framing: CameraFraming,
  portrait: HTMLImageElement | null,
  dressCutout: HTMLCanvasElement | null,
  progress: number,
  timeSec: number,
  audioAmp: number,
  visemeWidth: number,
  showRigOverlay = false,
  glbRenderCanvas: HTMLCanvasElement | null = null,
  gestureBoost = 1.25,
  camMotion: { zoom: number; offsetXNorm: number; offsetYNorm: number } = {
    zoom: 1,
    offsetXNorm: 0,
    offsetYNorm: 0,
  },
  overlayConfig?: OverlayTemplateConfig,
  hideCanvasCaptions = false,
  sidePortrait: HTMLImageElement | null = null,
  poseSide: PoseSide = 'front',
  precomputedBiomePath?: BiomePathSample
): void {
  const activeDress = scene.dressOverride ?? actor.dressStyle;
  const isVertical = h > w;

  // Compute caption layout first so character safe-zone avoids mouth/hand interference
  const captionPos = scene.captionPosition ?? 'bottom';
  const captionScale = Math.max(0.8, Math.min(1.35, scene.captionScale ?? 1.0));
  const timedLines =
    captionPos === 'hidden' ? [] : getActiveCaptionCueLines(scene, progress);
  const fontSize = Math.round((isVertical ? 24 : 25) * captionScale);
  const lineH = Math.round(fontSize * 1.34);
  const captionLines = timedLines.length > 0 ? timedLines : [];
  const overlayBottomOffset = overlayConfig?.enabled ? Math.round(h * 0.145) : 0;
  const captionBarH =
    captionPos === 'bottom' && captionLines.length > 0
      ? Math.max(108, 38 + captionLines.length * lineH) + overlayBottomOffset
      : 0;

  // Lift avatar subtly only if tall bottom/top captions intrude on safe zone
  const safeZoneShiftY =
    captionPos === 'bottom'
      ? -Math.max(0, captionBarH - 142) * 0.34
      : captionPos === 'top' && captionLines.length > 0
        ? 44
        : 0;

  const biomePath =
    precomputedBiomePath ??
    computeBiomeScenePath({
      biome: scene.biome,
      gesture: scene.gesture,
      framing,
      progress,
      sceneIndex: scene.index,
      cameraPanRange: scene.cameraPanRange,
      poseMode: scene.poseMode,
      poseSide: poseSide ?? scene.poseSide,
      walkingDestination: scene.walkingDestination,
    });

  // Apply unified Ken Burns zoom (<= 1.15) + handheld sway to world terrain, character & particles
  ctx.save();
  ctx.translate(
    w * 0.5 + camMotion.offsetXNorm * w,
    h * 0.5 + camMotion.offsetYNorm * h
  );
  ctx.scale(camMotion.zoom, camMotion.zoom);
  ctx.translate(-w * 0.5, -h * 0.5);

  if (framing !== CameraFraming.CLOSE_UP) {
    drawBiomeTerrainPath(
      ctx,
      w,
      h,
      scene.biome,
      actor,
      framing,
      biomePath,
      safeZoneShiftY,
      timeSec
    );
  }

  if (actor.avatarMode === 'GLB_3D' && glbRenderCanvas) {
    if (framing === CameraFraming.FULL_BODY) {
      ctx.save();
      ctx.fillStyle = 'rgba(0, 0, 0, 0.42)';
      ctx.beginPath();
      ctx.ellipse(
        w * (0.5 + biomePath.normX),
        h * (0.86 + biomePath.normY) + safeZoneShiftY,
        w * 0.12 * biomePath.depthScale,
        13 * biomePath.depthScale,
        0,
        0,
        Math.PI * 2
      );
      ctx.fill();
      ctx.restore();
    }
    ctx.drawImage(glbRenderCanvas, 0, safeZoneShiftY, w, h);
  } else {
    const motion = computeBodyMotion(
      scene.gesture,
      scene.emotion,
      scene.biome,
      actor,
      timeSec,
      progress,
      audioAmp,
      gestureBoost,
      biomePath
    );

    ctx.save();
    ctx.translate(0, safeZoneShiftY);
    drawArticulatedDressHumanRig(
      ctx,
      w,
      h,
      scene,
      actor,
      framing,
      portrait,
      dressCutout,
      activeDress,
      motion,
      biomePath,
      timeSec,
      audioAmp,
      visemeWidth,
      showRigOverlay,
      sidePortrait,
      poseSide
    );
    ctx.restore();
  }

  // Weather & Theme Particles Layer
  drawParticles(ctx, w, h, scene.biome, timeSec);
  ctx.restore();

  // Top Cinema HUD Bar (renders only when scene header/location exists)
  const hasHeader = Boolean(scene.locationTitle || scene.index > 0);
  if (hasHeader) {
    ctx.fillStyle = 'rgba(5, 8, 15, 0.72)';
    ctx.fillRect(0, 0, w, 74);
    ctx.fillStyle = 'rgba(255, 255, 255, 0.08)';
    ctx.fillRect(0, 73, w, 1);

    ctx.fillStyle = actor.accentColor;
    ctx.font = '700 20px "Plus Jakarta Sans", sans-serif';
    ctx.textAlign = 'left';
    ctx.fillText(`SCENE ${scene.index}  ·  ${scene.locationTitle}`, 24, 45);
  }

  // Place hookBanner cleanly in the top header corner or badge (avoiding top-right logo bug)
  if (scene.hookBanner) {
    const hookAlpha = Math.min(1, Math.max(0, progress * 4));
    const hookLabel = scene.hookBanner.trim().toUpperCase();
    ctx.save();
    ctx.globalAlpha = hookAlpha;
    ctx.font = '700 16px "Plus Jakarta Sans", sans-serif';
    const textW = ctx.measureText(hookLabel).width;
    const tagW = Math.min(w * 0.36, textW + 26);
    const tagH = 32;
    const tagX = overlayConfig?.enabled
      ? Math.max(20, w * 0.78 - tagW)
      : hasHeader
        ? w - tagW - 24
        : (w - tagW) * 0.5;
    const tagY = hasHeader ? 21 : 22;

    ctx.fillStyle = 'rgba(8, 12, 22, 0.84)';
    ctx.beginPath();
    drawRoundedRectPath(ctx, tagX, tagY, tagW, tagH, 8);
    ctx.fill();
    ctx.strokeStyle = actor.accentColor;
    ctx.lineWidth = 1.5;
    ctx.stroke();

    ctx.fillStyle = '#F8FAFC';
    ctx.textAlign = 'center';
    ctx.fillText(hookLabel, tagX + tagW * 0.5, tagY + 21);
    ctx.restore();
  }

  if (overlayConfig?.enabled) {
    drawBroadcastOverlayTemplate(ctx, w, h, scene, actor, overlayConfig);
  }

  if (!hideCanvasCaptions && captionLines.length > 0) {
    drawWrappedSubtitles(
      ctx,
      captionLines,
      w,
      h,
      captionPos,
      fontSize,
      lineH,
      captionBarH,
      overlayBottomOffset
    );
  }
}

type CanvasImageElementOrCanvas = HTMLImageElement | HTMLCanvasElement;

// Reusable offscreen feather buffer for seamless portrait-to-neck compositing
let _headFeatherCanvas: HTMLCanvasElement | null = null;
let _headFeatherCtx: CanvasRenderingContext2D | null = null;

function getHeadFeatherBuffer(w: number, h: number): {
  canvas: HTMLCanvasElement;
  ctx: CanvasRenderingContext2D;
} | null {
  if (typeof document === 'undefined') return null;
  if (!_headFeatherCanvas) {
    _headFeatherCanvas = document.createElement('canvas');
    _headFeatherCanvas.width = w;
    _headFeatherCanvas.height = h;
    _headFeatherCtx = _headFeatherCanvas.getContext('2d');
  } else if (_headFeatherCanvas.width !== w || _headFeatherCanvas.height !== h) {
    _headFeatherCanvas.width = w;
    _headFeatherCanvas.height = h;
  }
  if (!_headFeatherCtx) return null;
  return { canvas: _headFeatherCanvas, ctx: _headFeatherCtx };
}

/**
 * Talking face animator using 16-strip jaw/chin mesh displacement,
 * softly feathered interior oral shadow (zero sticker outlines),
 * smooth eyelid blinking, and calibrated eye/mouth landmark alignment.
 */
function drawHyperRealisticTalkingFaceRegion(
  ctx: CanvasRenderingContext2D,
  src: CanvasImageElementOrCanvas,
  sx: number,
  sy: number,
  sw: number,
  sh: number,
  dx: number,
  dy: number,
  dw: number,
  dh: number,
  skinTone: string,
  eyeOffsetNorm: number,
  mouthOffsetNorm: number,
  blendShapes: BlendShapeConfig,
  timeSec: number,
  audioAmp: number,
  visemeWidth: number
): void {
  const eyeNormY = Math.min(0.56, Math.max(0.28, 0.44 + eyeOffsetNorm));
  const mouthNormY = Math.min(0.84, Math.max(0.54, 0.69 + mouthOffsetNorm));
  const chinNormY = Math.min(0.96, mouthNormY + 0.21);
  const mouthY = dy + dh * mouthNormY;
  const chinY = dy + dh * chinNormY;
  const jawOpenGain = blendShapes.jawOpenGain ?? 1.0;
  const mouthWidthGain = blendShapes.mouthWidthGain ?? 1.0;
  const lipSmileBias = blendShapes.lipSmileBias ?? 0.08;
  const browLiftGain = blendShapes.browLiftGain ?? 1.0;
  const cheekSquint = blendShapes.cheekSquint ?? 0.25;
  const blinkRateGain = blendShapes.blinkRateGain ?? 1.0;

  const jawMaxDrop = dh * 0.068 * audioAmp * jawOpenGain;

  // 1. Upper face (forehead -> upper lip)
  const upperH = dh * mouthNormY;
  ctx.drawImage(src, sx, sy, sw, sh * mouthNormY, dx, dy, dw, upperH);

  // Subtle eyebrow micro-expression lift on stressed syllables
  if (audioAmp > 0.36 && browLiftGain > 0.05) {
    const liftPx = Math.max(0, audioAmp - 0.36) * 3.5 * browLiftGain;
    const browNormY = Math.max(0.16, eyeNormY - 0.13);
    const browSrcY = sy + sh * browNormY;
    const browSrcH = sh * 0.1;
    const browDstY = dy + dh * browNormY - liftPx;
    const browDstH = dh * 0.1;
    ctx.save();
    ctx.globalAlpha = Math.min(0.75, 0.48 * browLiftGain);
    ctx.drawImage(src, sx, browSrcY, sw, browSrcH, dx, browDstY, dw, browDstH);
    ctx.restore();
  }

  // Subtle cheek cushion lift
  if (cheekSquint > 0.08 && (lipSmileBias > 0.08 || audioAmp > 0.25)) {
    const squintAmt = cheekSquint * (0.35 + Math.max(0, lipSmileBias) * 0.5 + audioAmp * 0.35);
    const cheekY = dy + dh * Math.min(0.66, eyeNormY + 0.12);
    ctx.save();
    ctx.globalAlpha = Math.min(0.16, 0.1 * squintAmt);
    ctx.fillStyle = skinTone;
    ctx.beginPath();
    ctx.ellipse(dx + dw * 0.3, cheekY, dw * 0.12, dh * 0.04, -0.08, 0, Math.PI * 2);
    ctx.ellipse(dx + dw * 0.7, cheekY, dw * 0.12, dh * 0.04, 0.08, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
  }

  // 2. Smooth 16-strip lower-jaw & chin displacement mesh
  const strips = 16;
  const srcStripH = (sh * (chinNormY - mouthNormY)) / strips;
  const dstStripBaseH = (chinY - mouthY) / strips;

  for (let i = 0; i < strips; i++) {
    const t0 = i / strips;
    const t1 = (i + 1) / strips;
    const disp0 = jawMaxDrop * Math.sin(Math.min(1, t0 * 1.1) * Math.PI * 0.85);
    const disp1 = jawMaxDrop * Math.sin(Math.min(1, t1 * 1.1) * Math.PI * 0.85);

    const sY = sy + sh * mouthNormY + i * srcStripH;
    const dY = mouthY + i * dstStripBaseH + disp0;
    const dH = Math.max(1, dstStripBaseH + (disp1 - disp0) + 0.6);

    ctx.drawImage(src, sx, sY, sw, srcStripH + 0.5, dx, dY, dw, dH);
  }

  if (chinNormY < 1.0) {
    ctx.drawImage(
      src,
      sx,
      sy + sh * chinNormY,
      sw,
      sh * (1 - chinNormY),
      dx,
      chinY + jawMaxDrop * 0.35,
      dw,
      dh * (1 - chinNormY)
    );
  }

  // 3. Softly feathered interior mouth shadow (no hard cartoon sticker oval)
  const cx = dx + dw * 0.5;
  const cy = mouthY + jawMaxDrop * 0.44;
  const mouthRx =
    dw *
    0.118 *
    Math.min(1.3, Math.max(0.58, visemeWidth * mouthWidthGain + Math.max(0, lipSmileBias) * 0.08));

  if (audioAmp > 0.08) {
    const mouthRy = Math.max(1.2, dh * 0.036 * audioAmp * jawOpenGain);

    ctx.save();
    ctx.beginPath();
    ctx.ellipse(cx, cy, mouthRx, mouthRy, 0, 0, Math.PI * 2);
    ctx.clip();

    const cavityGrad = ctx.createRadialGradient(
      cx,
      cy,
      mouthRx * 0.08,
      cx,
      cy,
      Math.max(mouthRx, mouthRy)
    );
    cavityGrad.addColorStop(0, 'rgba(26, 6, 8, 0.92)');
    cavityGrad.addColorStop(0.68, 'rgba(48, 14, 16, 0.72)');
    cavityGrad.addColorStop(1, 'rgba(48, 14, 16, 0.0)');
    ctx.fillStyle = cavityGrad;
    ctx.fillRect(cx - mouthRx - 2, cy - mouthRy - 2, mouthRx * 2 + 4, mouthRy * 2 + 4);

    if (mouthRy > 3.6) {
      ctx.fillStyle = 'rgba(230, 220, 210, 0.42)';
      ctx.beginPath();
      ctx.ellipse(cx, cy - mouthRy * 0.36, mouthRx * 0.58, mouthRy * 0.2, 0, 0, Math.PI * 2);
      ctx.fill();
    }

    ctx.restore();
  }

  // 4. Smooth Eyelid Blink aligned to calibrated eyeNormY & blinkRateGain
  const blink = getSmoothBlinkFactor(timeSec, blinkRateGain);
  if (blink > 0.04) {
    const eyeY = dy + dh * eyeNormY;
    const eyeSpanX = dw * 0.16;
    const lidRx = dw * 0.082;
    const lidRy = dh * 0.034 * blink;

    for (const ex of [dx + dw * 0.5 - eyeSpanX, dx + dw * 0.5 + eyeSpanX]) {
      const lidGrad = ctx.createLinearGradient(ex, eyeY - lidRy, ex, eyeY + lidRy);
      lidGrad.addColorStop(0, skinTone);
      lidGrad.addColorStop(0.78, skinTone);
      lidGrad.addColorStop(1, 'rgba(20, 14, 16, 0.85)');

      ctx.fillStyle = lidGrad;
      ctx.beginPath();
      ctx.ellipse(ex, eyeY, lidRx, Math.max(1.2, lidRy), 0, 0, Math.PI * 2);
      ctx.fill();
    }
  }
}

/**
 * Side-profile talking face animator for dedicated 90-deg right-facing studio profile portraits
 * (automatically mirrored horizontally upstream when poseSide === 'left').
 */
function drawSideProfileTalkingFaceRegion(
  ctx: CanvasRenderingContext2D,
  src: CanvasImageElementOrCanvas,
  sx: number,
  sy: number,
  sw: number,
  sh: number,
  dx: number,
  dy: number,
  dw: number,
  dh: number,
  skinTone: string,
  eyeOffsetNorm: number,
  mouthOffsetNorm: number,
  blendShapes: BlendShapeConfig,
  timeSec: number,
  audioAmp: number,
  visemeWidth: number
): void {
  const eyeNormY = Math.min(0.60, Math.max(0.36, 0.49 + eyeOffsetNorm * 0.5));
  const mouthNormY = Math.min(0.82, Math.max(0.58, 0.71 + mouthOffsetNorm * 0.5));
  const chinNormY = Math.min(0.97, mouthNormY + 0.18);
  const mouthY = dy + dh * mouthNormY;
  const chinY = dy + dh * chinNormY;
  const jawOpenGain = blendShapes.jawOpenGain ?? 1.0;
  const mouthWidthGain = blendShapes.mouthWidthGain ?? 1.0;
  const blinkRateGain = blendShapes.blinkRateGain ?? 1.0;

  const jawMaxDrop = dh * 0.056 * audioAmp * jawOpenGain;

  // 1. Upper cranium, ear, eye & nose bridge (fixed above lip seam)
  const upperH = dh * mouthNormY;
  ctx.drawImage(src, sx, sy, sw, sh * mouthNormY, dx, dy, dw, upperH);

  // 2. Smooth 12-strip lower jaw & chin animation in side profile
  const strips = 12;
  const srcStripH = (sh * (chinNormY - mouthNormY)) / strips;
  const dstStripBaseH = (chinY - mouthY) / strips;
  for (let i = 0; i < strips; i++) {
    const t0 = i / strips;
    const t1 = (i + 1) / strips;
    const disp0 = jawMaxDrop * Math.sin(Math.min(1, t0 * 1.1) * Math.PI * 0.85);
    const disp1 = jawMaxDrop * Math.sin(Math.min(1, t1 * 1.1) * Math.PI * 0.85);
    const sY = sy + sh * mouthNormY + i * srcStripH;
    const dY = mouthY + i * dstStripBaseH + disp0;
    const dH = Math.max(1, dstStripBaseH + (disp1 - disp0) + 0.5);
    ctx.drawImage(src, sx, sY, sw, srcStripH + 0.5, dx, dY, dw, dH);
  }

  if (chinNormY < 1.0) {
    ctx.drawImage(
      src,
      sx,
      sy + sh * chinNormY,
      sw,
      sh * (1 - chinNormY),
      dx,
      chinY + jawMaxDrop * 0.3,
      dw,
      dh * (1 - chinNormY)
    );
  }

  // 3. Feathered profile oral cavity near facing lip corner (~74% width)
  if (audioAmp > 0.09) {
    const mouthCx = dx + dw * 0.74;
    const mouthCy = mouthY + jawMaxDrop * 0.38;
    const mouthRx = dw * 0.07 * Math.min(1.25, Math.max(0.65, visemeWidth * mouthWidthGain));
    const mouthRy = Math.max(1.0, dh * 0.032 * audioAmp * jawOpenGain);

    ctx.save();
    ctx.beginPath();
    ctx.ellipse(mouthCx, mouthCy, mouthRx, mouthRy, 0, 0, Math.PI * 2);
    ctx.clip();

    const cavityGrad = ctx.createRadialGradient(
      mouthCx,
      mouthCy,
      mouthRx * 0.1,
      mouthCx,
      mouthCy,
      Math.max(mouthRx, mouthRy)
    );
    cavityGrad.addColorStop(0, 'rgba(22, 6, 8, 0.9)');
    cavityGrad.addColorStop(0.7, 'rgba(48, 14, 16, 0.65)');
    cavityGrad.addColorStop(1, 'rgba(48, 14, 16, 0.0)');
    ctx.fillStyle = cavityGrad;
    ctx.fillRect(mouthCx - mouthRx - 2, mouthCy - mouthRy - 2, mouthRx * 2 + 4, mouthRy * 2 + 4);
    ctx.restore();
  }

  // 4. Near-side profile eyelid blink (~65% X)
  const blink = getSmoothBlinkFactor(timeSec, blinkRateGain);
  if (blink > 0.05) {
    const eyeX = dx + dw * 0.65;
    const eyeY = dy + dh * eyeNormY;
    const lidRx = dw * 0.068;
    const lidRy = dh * 0.03 * blink;
    const lidGrad = ctx.createLinearGradient(eyeX, eyeY - lidRy, eyeX, eyeY + lidRy);
    lidGrad.addColorStop(0, skinTone);
    lidGrad.addColorStop(0.78, skinTone);
    lidGrad.addColorStop(1, 'rgba(20, 14, 16, 0.85)');
    ctx.fillStyle = lidGrad;
    ctx.beginPath();
    ctx.ellipse(eyeX, eyeY, lidRx, Math.max(1.2, lidRy), 0, 0, Math.PI * 2);
    ctx.fill();
  }
}

function drawBiomeTerrainPath(
  ctx: CanvasRenderingContext2D,
  w: number,
  h: number,
  biome: EnvBiome,
  actor: ActorProfile,
  framing: CameraFraming,
  biomePath: BiomePathSample,
  safeZoneShiftY: number,
  timeSec: number
): void {
  if (biomePath.waypoints.length < 2) return;
  const heightMult = actor.heightScale || 1.0;
  const legRatio = actor.rig?.legLengthRatio ?? 1.0;
  const baseScale =
    framing === CameraFraming.PRESENTER
      ? Math.min((h * 0.675) / 390, (w * 0.92) / 320) * heightMult
      : Math.min((h * 0.72) / 594, (w * 0.86) / 340) * heightMult;

  const baseGroundScreenY =
    framing === CameraFraming.PRESENTER
      ? h * 0.84 + safeZoneShiftY
      : h * 0.145 + (378 + 206 * legRatio) * baseScale + safeZoneShiftY;

  const pts = biomePath.waypoints.map((wp) => ({
    x: w * (0.5 + wp.normX),
    y: baseGroundScreenY + wp.normY * h * (framing === CameraFraming.PRESENTER ? 0.55 : 1.0),
    depth: wp.depthScale,
  }));

  const pathPalette: Record<EnvBiome, { fill: string; edge: string; glow: string }> = {
    [EnvBiome.AVATAR_NIGHT]: {
      fill: 'rgba(14, 116, 144, 0.22)',
      edge: 'rgba(94, 234, 212, 0.36)',
      glow: '#2DD4BF',
    },
    [EnvBiome.FIRE_BATTLE]: {
      fill: 'rgba(124, 45, 18, 0.32)',
      edge: 'rgba(251, 146, 60, 0.42)',
      glow: '#F97316',
    },
    [EnvBiome.MONSOON_RAIN]: {
      fill: 'rgba(30, 58, 138, 0.28)',
      edge: 'rgba(147, 197, 253, 0.38)',
      glow: '#60A5FA',
    },
    [EnvBiome.DESERT_MYSTERY]: {
      fill: 'rgba(146, 94, 38, 0.32)',
      edge: 'rgba(252, 211, 77, 0.42)',
      glow: '#FBBF24',
    },
    [EnvBiome.SACRED_RIVER]: {
      fill: 'rgba(15, 118, 110, 0.28)',
      edge: 'rgba(153, 246, 228, 0.40)',
      glow: '#5EEAD4',
    },
    [EnvBiome.ROYAL_PALACE]: {
      fill: 'rgba(109, 40, 217, 0.24)',
      edge: 'rgba(250, 204, 21, 0.44)',
      glow: '#FACC15',
    },
    [EnvBiome.CYBER_CITY]: {
      fill: 'rgba(17, 24, 39, 0.48)',
      edge: 'rgba(34, 211, 238, 0.55)',
      glow: '#22D3EE',
    },
    [EnvBiome.STUDIO_CYCLORAMA]: {
      fill: 'rgba(51, 65, 85, 0.26)',
      edge: 'rgba(226, 232, 240, 0.32)',
      glow: '#CBD5E1',
    },
  };

  const pal = pathPalette[biome] ?? pathPalette[EnvBiome.AVATAR_NIGHT];

  ctx.save();
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';

  // Soft wide biome ground trail
  ctx.strokeStyle = pal.fill;
  ctx.lineWidth = framing === CameraFraming.FULL_BODY ? 44 : 30;
  ctx.beginPath();
  ctx.moveTo(pts[0].x, pts[0].y);
  for (let i = 1; i < pts.length; i++) {
    ctx.lineTo(pts[i].x, pts[i].y);
  }
  ctx.stroke();

  // Crisp directional track highlights along Point A -> Point B
  ctx.strokeStyle = pal.edge;
  ctx.lineWidth = 2.2;
  ctx.setLineDash([12, 10]);
  ctx.lineDashOffset = -timeSec * 18;
  ctx.beginPath();
  ctx.moveTo(pts[0].x, pts[0].y);
  for (let i = 1; i < pts.length; i++) {
    ctx.lineTo(pts[i].x, pts[i].y);
  }
  ctx.stroke();
  ctx.setLineDash([]);

  // Subtle Point A (start) and Point B (destination) ground anchors
  for (const pt of [pts[0], pts[pts.length - 1]]) {
    ctx.fillStyle = pal.glow;
    ctx.globalAlpha = 0.35;
    ctx.beginPath();
    ctx.ellipse(pt.x, pt.y, 14 * pt.depth, 5 * pt.depth, 0, 0, Math.PI * 2);
    ctx.fill();
  }

  ctx.restore();
}

function drawArticulatedDressHumanRig(
  ctx: CanvasRenderingContext2D,
  w: number,
  h: number,
  scene: DirectedScene,
  actor: ActorProfile,
  framing: CameraFraming,
  portrait: HTMLImageElement | null,
  dressCutout: HTMLCanvasElement | null,
  dress: DressStyle,
  motion: BodyMotionState,
  biomePath: BiomePathSample,
  timeSec: number,
  audioAmp: number,
  visemeWidth: number,
  showRigOverlay = false,
  sidePortrait: HTMLImageElement | null = null,
  poseSide: PoseSide = 'front'
): void {
  const heightMult = actor.heightScale || 1.0;
  const breathe = Math.sin(timeSec * 2.2) * 2.8;
  const skin = actor.skinTone || '#D99B72';

  const legRatio = actor.rig?.legLengthRatio ?? 1.0;
  const sideProfile = motion.sideProfile;
  const absP = Math.min(1, Math.abs(sideProfile));
  const facingDir = sideProfile >= 0 ? 1 : -1;

  const cx = w * (0.5 + biomePath.normX) + motion.hipSwayX;
  let scale: number;
  let baseY: number;
  if (framing === CameraFraming.CLOSE_UP) {
    scale = Math.min((h * 0.68) / 233, (w * 0.94) / 235) * heightMult;
    baseY = h * (0.155 + biomePath.normY * 0.35) + 378 * scale - motion.hipBobY;
  } else if (framing === CameraFraming.PRESENTER) {
    const baseScale = Math.min((h * 0.675) / 390, (w * 0.92) / 320) * heightMult;
    scale = baseScale * (0.5 + 0.5 * biomePath.depthScale);
    baseY = h * (0.165 + biomePath.normY * 0.55) + 378 * baseScale - motion.hipBobY;
  } else {
    const baseScale = Math.min((h * 0.72) / 594, (w * 0.86) / 340) * heightMult;
    scale = baseScale * (0.38 + 0.62 * biomePath.depthScale);
    const groundScreenY = h * 0.145 + (378 + 198 * legRatio) * baseScale + biomePath.normY * h;
    baseY = groundScreenY - 198 * legRatio * scale - motion.hipBobY;
  }

  const buildFactor =
    actor.bodyBuild === 'BROAD' ? 1.15 : actor.bodyBuild === 'SLIM' ? 0.88 : 1.0;
  const shoulderRatio = actor.rig?.shoulderWidthRatio ?? 1.0;
  const hipRatio = actor.rig?.hipWidthRatio ?? 1.0;
  const torsoRatio = actor.rig?.torsoLengthRatio ?? 1.0;
  const armRatio = actor.rig?.armLengthRatio ?? 1.0;
  const ikCfg = actor.ik;
  const stanceMult = (ikCfg?.hipStanceWidth ?? 1.0) * (1 - 0.52 * absP);
  const softLimit = ikCfg?.ikSoftLimit ?? 0.97;
  const kneeBias = ikCfg?.kneeBendBias ?? 0.25;
  const rimColor = getBiomeRimColor(scene.biome, actor.accentColor, timeSec);

  ctx.save();
  ctx.translate(cx, baseY);
  ctx.scale(scale, scale);

  const groundFootY = 198 * legRatio;
  const foreshortenY = 1 - 0.78 * absP;
  const resolveLockedFootTarget = (side: 'left' | 'right') => {
    const sign = side === 'left' ? -1 : 1;
    const foot = side === 'left' ? motion.leftFoot : motion.rightFoot;
    const anchorX = side === 'left' ? motion.leftAnchorX : motion.rightAnchorX;
    const hipBaseX = sign * 36 * buildFactor * stanceMult;
    const rawFootX = hipBaseX + foot.footXOffset;
    const rawFootY = groundFootY + foot.strideProgress * 18 * foreshortenY - foot.lift;
    const locked = applyGroundContactLock(
      rawFootX,
      rawFootY,
      anchorX,
      groundFootY + foot.strideProgress * 12 * foreshortenY,
      foot.footVelRatio,
      foot.isStance
    );
    return { foot, sign, footX: locked.x, footY: locked.y };
  };

  const resolvedLeftFoot = resolveLockedFootTarget('left');
  const resolvedRightFoot = resolveLockedFootTarget('right');

  // Ground contact shadows anchored beneath each locked human foot
  if (framing === CameraFraming.FULL_BODY) {
    ctx.fillStyle = 'rgba(0,0,0,0.46)';
    for (const item of [resolvedLeftFoot, resolvedRightFoot]) {
      const shX = item.footX;
      const shY = 208 * legRatio + item.foot.strideProgress * 12 * foreshortenY;
      const shRx = 34 * Math.max(0.62, 1 - item.foot.lift / 45);
      ctx.beginPath();
      ctx.ellipse(shX, shY, shRx, 12, 0, 0, Math.PI * 2);
      ctx.fill();
    }
  }

  // Sculpted Human Legs solved via Damped Least Squares (Levenberg-Marquardt) 2-Bone IK
  const legColor =
    dress === DressStyle.FESTIVE_SAREE
      ? skin
      : dress === DressStyle.ROYAL_KURTA
        ? '#ECE6D8'
        : dress === DressStyle.WARRIOR_ARMOR
          ? '#384457'
          : dress === DressStyle.FORMAL_COAT
            ? '#334155'
            : '#3B4D6B';
  const kneeTrim = dress === DressStyle.WARRIOR_ARMOR ? actor.accentColor : undefined;
  const showBareLowerLeg = dress === DressStyle.FESTIVE_SAREE;

  let lHipJoint = { x: -30 * buildFactor * hipRatio * (1 - 0.56 * absP), y: -12 };
  let rHipJoint = { x: 30 * buildFactor * hipRatio * (1 - 0.56 * absP), y: -12 };
  let lLegIk = { jointX: lHipJoint.x, jointY: 94, endX: lHipJoint.x, endY: 198 };
  let rLegIk = { jointX: rHipJoint.x, jointY: 94, endX: rHipJoint.x, endY: 198 };

  const drawSingleLeg = (side: 'left' | 'right') => {
    const resolved = side === 'left' ? resolvedLeftFoot : resolvedRightFoot;
    const { sign, foot, footX, footY } = resolved;
    const hipX = sign * 30 * buildFactor * hipRatio * (1 - 0.56 * absP);
    const hipY = -12 + foot.strideProgress * -3;
    const solved = drawHumanLeg(
      ctx,
      hipX,
      hipY,
      footX,
      footY,
      foot.kneeBendForward,
      foot.footPitch,
      foot.depthScale,
      sign,
      legRatio,
      kneeBias,
      softLimit,
      legColor,
      skin,
      rimColor,
      showBareLowerLeg,
      kneeTrim,
      sideProfile
    );
    if (side === 'left') {
      lHipJoint = { x: hipX, y: hipY };
      lLegIk = solved;
    } else {
      rHipJoint = { x: hipX, y: hipY };
      rLegIk = solved;
    }
  };

  if (absP > 0.16) {
    // Far leg draws behind near leg in 3/4 and side profile poses
    if (facingDir > 0) {
      drawSingleLeg('left');
      drawSingleLeg('right');
    } else {
      drawSingleLeg('right');
      drawSingleLeg('left');
    }
  } else if (motion.leftFoot.strideProgress <= motion.rightFoot.strideProgress) {
    drawSingleLeg('left');
    drawSingleLeg('right');
  } else {
    drawSingleLeg('right');
    drawSingleLeg('left');
  }

  // Asymmetric Saree Drape Skirt (spring-damper cloth drag over moving human legs)
  const sideHipNarrow = 1 - 0.5 * absP;
  if (dress === DressStyle.FESTIVE_SAREE) {
    const hemSway =
      (motion.leftFoot.strideProgress - motion.rightFoot.strideProgress) * 14 +
      motion.clothLagX * 0.75 -
      facingDir * 8 * absP;
    const strideSpread = Math.abs(motion.leftFoot.footXOffset - motion.rightFoot.footXOffset) * 0.26;
    const drapeLeftY = 66 * legRatio;
    const drapeRightY = 82 * legRatio;
    const drapeGrad = ctx.createLinearGradient(-70, -42, 70, drapeRightY + 6);
    drapeGrad.addColorStop(0, actor.robeColor);
    drapeGrad.addColorStop(0.55, '#4C1D95');
    drapeGrad.addColorStop(1, '#2E1065');
    ctx.fillStyle = drapeGrad;
    ctx.beginPath();
    ctx.moveTo(-56 * buildFactor * hipRatio * sideHipNarrow, -45);
    ctx.lineTo(56 * buildFactor * hipRatio * sideHipNarrow, -45);
    ctx.quadraticCurveTo(
      66 * buildFactor * sideHipNarrow + hemSway * 0.45 + strideSpread * 0.35,
      16 * legRatio,
      (74 + strideSpread) * buildFactor * sideHipNarrow + hemSway,
      drapeRightY
    );
    ctx.lineTo(-(74 + strideSpread) * buildFactor * sideHipNarrow + hemSway * 0.7, drapeLeftY);
    ctx.quadraticCurveTo(
      -66 * buildFactor * sideHipNarrow + hemSway * 0.3 - strideSpread * 0.35,
      16 * legRatio,
      -56 * buildFactor * hipRatio * sideHipNarrow,
      -45
    );
    ctx.closePath();
    ctx.fill();
    ctx.strokeStyle = '#F59E0B';
    ctx.lineWidth = 4;
    ctx.beginPath();
    ctx.moveTo(-(72 + strideSpread) * buildFactor * sideHipNarrow + hemSway * 0.7, drapeLeftY - 4);
    ctx.lineTo((72 + strideSpread) * buildFactor * sideHipNarrow + hemSway, drapeRightY - 4);
    ctx.stroke();
  }

  // Torso subtle lean & twist scaled by torsoLengthRatio
  ctx.save();
  ctx.rotate(motion.torsoLean);

  const shoulderY = -196 * torsoRatio + breathe + motion.shoulderRelaxY * 0.45;
  const shoulderArmY = -184 * torsoRatio + breathe + motion.shoulderRelaxY;
  const neckTopY = -246 * torsoRatio + breathe;
  const headY = -296 * torsoRatio + breathe - motion.headNodY;

  if (
    (actor.hairStyle === 'WAVY_LONG' || actor.isFemale) &&
    (actor.avatarMode === 'ANATOMY_RIG' || !portrait)
  ) {
    ctx.fillStyle = '#141722';
    ctx.beginPath();
    ctx.ellipse(-facingDir * 14 * absP, -255 * torsoRatio + breathe, 78 * (1 - 0.16 * absP), 94, 0, 0, Math.PI * 2);
    ctx.fill();
  }

  const baseShoulderW = (actor.isFemale ? 70 : 84) * buildFactor * shoulderRatio;
  const baseWaistW = (actor.isFemale ? 54 : 66) * buildFactor * hipRatio;
  const baseHemW =
    (dress === DressStyle.ROYAL_KURTA || dress === DressStyle.FORMAL_COAT ? 88 : 78) *
    buildFactor *
    hipRatio;
  const shoulderW = baseShoulderW * (1 - 0.56 * absP);
  const waistW = baseWaistW * (1 - 0.52 * absP);
  const hemW = baseHemW * (1 - 0.48 * absP);
  const chestPush = facingDir * 15 * absP;
  const backPull = -facingDir * 6 * absP;
  const hemY =
    dress === DressStyle.ROYAL_KURTA || dress === DressStyle.FORMAL_COAT ? 38 : 16;

  const longSleeves = dress !== DressStyle.FESTIVE_SAREE;
  let lArmIk = { elbowX: -shoulderW, elbowY: shoulderArmY + 60, handX: -shoulderW, handY: shoulderArmY + 115 };
  let rArmIk = { elbowX: shoulderW, elbowY: shoulderArmY + 60, handX: shoulderW, handY: shoulderArmY + 115 };

  const sleeveBaseColor =
    dress === DressStyle.ROYAL_KURTA
      ? '#13284D'
      : dress === DressStyle.FESTIVE_SAREE
        ? '#581C87'
        : dress === DressStyle.WARRIOR_ARMOR
          ? '#263042'
          : dress === DressStyle.FORMAL_COAT
            ? '#172030'
            : actor.robeColor;

  const lShoulderX = -shoulderW + 8 * (1 - absP) + facingDir * 4 * absP;
  const rShoulderX = shoulderW - 8 * (1 - absP) + facingDir * 4 * absP;

  const drawLeftArm = () => {
    lArmIk = drawHumanArm(
      ctx,
      lShoulderX,
      shoulderArmY,
      motion.leftArm,
      armRatio,
      softLimit,
      sleeveBaseColor,
      skin,
      dress === DressStyle.ROYAL_KURTA || dress === DressStyle.FESTIVE_SAREE
        ? '#F59E0B'
        : actor.accentColor,
      longSleeves,
      -1,
      sideProfile
    );
  };
  const drawRightArm = () => {
    rArmIk = drawHumanArm(
      ctx,
      rShoulderX,
      shoulderArmY,
      motion.rightArm,
      armRatio,
      softLimit,
      sleeveBaseColor,
      skin,
      dress === DressStyle.ROYAL_KURTA || dress === DressStyle.FESTIVE_SAREE
        ? '#F59E0B'
        : actor.accentColor,
      longSleeves,
      1,
      sideProfile
    );
  };

  const leftArmBehind = absP > 0.16 ? facingDir > 0 : motion.leftArm.depthScale < 0.99;
  const rightArmBehind = absP > 0.16 ? facingDir < 0 : motion.rightArm.depthScale < 0.99;

  if (leftArmBehind) drawLeftArm();
  if (rightArmBehind) drawRightArm();

  // Articulated Torso Silhouette with side-pose chest projection & 3D studio rim lighting
  const frontTopX = facingDir * shoulderW + chestPush * 0.45;
  const frontChestX = facingDir * shoulderW + chestPush * 0.95;
  const frontWaistX = facingDir * waistW + chestPush * 0.35;
  const frontHemX = facingDir * hemW + chestPush * 0.25;
  const backTopX = -facingDir * shoulderW + backPull;
  const backWaistX = -facingDir * waistW + backPull * 0.5;
  const backHemX = -facingDir * hemW + backPull * 0.4;

  const torsoPath = () => {
    ctx.beginPath();
    ctx.moveTo(backTopX, shoulderY);
    ctx.quadraticCurveTo(chestPush * 0.2, shoulderY - 24, frontTopX, shoulderY);
    ctx.quadraticCurveTo(frontChestX, shoulderY + 52, frontWaistX, -45);
    ctx.lineTo(frontHemX, hemY);
    ctx.quadraticCurveTo(chestPush * 0.2, hemY + 12, backHemX, hemY);
    ctx.lineTo(backWaistX, -45);
    ctx.closePath();
  };

  const torsoGrad = ctx.createLinearGradient(-shoulderW + backPull, shoulderY - 20, shoulderW + chestPush, hemY);
  if (dress === DressStyle.ROYAL_KURTA) {
    torsoGrad.addColorStop(0, '#102446');
    torsoGrad.addColorStop(0.5, '#1D3C70');
    torsoGrad.addColorStop(1, '#0B162C');
  } else if (dress === DressStyle.FESTIVE_SAREE) {
    torsoGrad.addColorStop(0, '#4C1D95');
    torsoGrad.addColorStop(0.5, '#6B21A8');
    torsoGrad.addColorStop(1, '#2E1065');
  } else if (dress === DressStyle.WARRIOR_ARMOR) {
    torsoGrad.addColorStop(0, '#1E293B');
    torsoGrad.addColorStop(0.5, '#334155');
    torsoGrad.addColorStop(1, '#0F172A');
  } else if (dress === DressStyle.FORMAL_COAT) {
    torsoGrad.addColorStop(0, '#1E293B');
    torsoGrad.addColorStop(0.5, '#273549');
    torsoGrad.addColorStop(1, '#0F172A');
  } else {
    torsoGrad.addColorStop(0, actor.robeColor);
    torsoGrad.addColorStop(0.65, actor.robeColor);
    torsoGrad.addColorStop(1, '#090D16');
  }

  ctx.save();
  ctx.shadowColor = rimColor;
  ctx.shadowBlur = 18 + audioAmp * 8;
  torsoPath();
  ctx.fillStyle = torsoGrad;
  ctx.fill();
  ctx.restore();

  // In REAL_HUMAN_FULL mode, blend a strictly interior fabric swatch inside torso clip (zero background pixels)
  if (actor.avatarMode === 'REAL_HUMAN_FULL' && dressCutout) {
    ctx.save();
    torsoPath();
    ctx.clip();
    ctx.globalAlpha = 0.42;
    const cw = dressCutout.width;
    const ch = dressCutout.height;
    const isTall = ch / Math.max(1, cw) > 1.12;
    const sx = cw * 0.34;
    const sy = ch * (isTall ? 0.30 : 0.62);
    const sw = cw * 0.32;
    const sh = ch * (isTall ? 0.24 : 0.32);
    ctx.drawImage(
      dressCutout,
      sx,
      sy,
      sw,
      sh,
      -shoulderW + backPull - 8,
      shoulderY - 12,
      shoulderW * 2 + Math.abs(chestPush) + 16,
      hemY - shoulderY + 24
    );
    ctx.restore();
  }

  // Subtle top shoulder specular shading & soft biome rim edge
  torsoPath();
  const torsoSheen = ctx.createLinearGradient(0, shoulderY - 22, 0, shoulderY + 120);
  torsoSheen.addColorStop(0, 'rgba(255,255,255,0.12)');
  torsoSheen.addColorStop(0.5, 'rgba(255,255,255,0.0)');
  torsoSheen.addColorStop(1, 'rgba(0,0,0,0.28)');
  ctx.fillStyle = torsoSheen;
  ctx.fill();

  ctx.strokeStyle = 'rgba(255,255,255,0.16)';
  ctx.lineWidth = 1.8;
  ctx.stroke();

  drawDressDetails(
    ctx,
    dress,
    actor,
    shoulderW,
    waistW,
    hemY,
    breathe,
    motion.clothLagX,
    sideProfile
  );

  // Shaded Neck Column with chin ambient occlusion
  const neckCenterX = facingDir * 6 * absP;
  const neckGrad = ctx.createLinearGradient(-22 + neckCenterX, neckTopY, 22 + neckCenterX, neckTopY + 54);
  neckGrad.addColorStop(0, skin);
  neckGrad.addColorStop(1, 'rgba(20, 12, 10, 0.28)');
  ctx.fillStyle = skin;
  ctx.beginPath();
  drawRoundedRectPath(ctx, neckCenterX - 19, neckTopY, 38, 54 * torsoRatio, 12);
  ctx.fill();
  ctx.fillStyle = 'rgba(0,0,0,0.26)';
  ctx.beginPath();
  ctx.ellipse(neckCenterX, neckTopY + 18, 19, 12, 0, 0, Math.PI * 2);
  ctx.fill();

  if (!leftArmBehind) drawLeftArm();
  if (!rightArmBehind) drawRightArm();

  // Head & Talking Face anchored seamlessly over neck
  ctx.save();
  ctx.translate(facingDir * 8 * absP, headY);
  ctx.rotate(motion.headTilt);

  if (actor.avatarMode !== 'ANATOMY_RIG' && (portrait || sidePortrait)) {
    const hasWalkingDest = Boolean(
      scene.walkingDestination &&
        Math.abs(scene.walkingDestination.targetXNorm - scene.walkingDestination.startXNorm) >= 0.02
    );
    drawPortraitHumanHead(
      ctx,
      portrait ?? sidePortrait!,
      actor,
      scene.biome,
      timeSec,
      audioAmp,
      visemeWidth,
      sideProfile,
      sidePortrait,
      poseSide,
      hasWalkingDest || scene.gesture === GestureAction.WALKING
    );
  } else {
    drawAnatomyHumanHead(
      ctx,
      actor,
      scene.emotion,
      timeSec,
      audioAmp,
      visemeWidth,
      skin,
      sideProfile
    );
  }

  ctx.restore();

  if (showRigOverlay) {
    drawRigSkeletonOverlay(
      ctx,
      {
        pelvis: { x: 0, y: -10 },
        chest: { x: facingDir * 4 * absP, y: shoulderArmY },
        neck: { x: neckCenterX, y: neckTopY + 8 },
        head: { x: facingDir * 8 * absP, y: headY },
        lShoulder: { x: lShoulderX, y: shoulderArmY },
        lElbow: { x: lArmIk.elbowX, y: lArmIk.elbowY },
        lWrist: { x: lArmIk.handX, y: lArmIk.handY },
        rShoulder: { x: rShoulderX, y: shoulderArmY },
        rElbow: { x: rArmIk.elbowX, y: rArmIk.elbowY },
        rWrist: { x: rArmIk.handX, y: rArmIk.handY },
        lHip: lHipJoint,
        lKnee: { x: lLegIk.jointX, y: lLegIk.jointY },
        lAnkle: { x: lLegIk.endX, y: lLegIk.endY },
        rHip: rHipJoint,
        rKnee: { x: rLegIk.jointX, y: rLegIk.jointY },
        rAnkle: { x: rLegIk.endX, y: rLegIk.endY },
      },
      actor.accentColor
    );
  }

  ctx.restore();
  ctx.restore();
}

function drawDressDetails(
  ctx: CanvasRenderingContext2D,
  dress: DressStyle,
  actor: ActorProfile,
  shoulderW: number,
  waistW: number,
  hemY: number,
  breathe: number,
  clothLagX = 0,
  sideProfile = 0
): void {
  const absP = Math.min(1, Math.abs(sideProfile));
  const facingDir = sideProfile >= 0 ? 1 : -1;
  const chestLineX = facingDir * 14 * absP;

  switch (dress) {
    case DressStyle.ROYAL_KURTA: {
      // Gold embroidered placket & buttons aligned to front chest
      ctx.strokeStyle = '#EAB308';
      ctx.lineWidth = 4;
      ctx.beginPath();
      ctx.moveTo(chestLineX, -198 + breathe);
      ctx.lineTo(chestLineX * 0.9, -82 + breathe);
      ctx.stroke();

      ctx.fillStyle = '#FDE047';
      for (const by of [-174, -150, -126, -102]) {
        ctx.beginPath();
        ctx.arc(chestLineX * 0.95, by + breathe, 3, 0, Math.PI * 2);
        ctx.fill();
      }

      // Mandarin embroidered collar
      ctx.strokeStyle = '#EAB308';
      ctx.lineWidth = 7;
      ctx.beginPath();
      ctx.arc(chestLineX * 0.55, -204 + breathe, 24 * (1 - 0.32 * absP), 0.15, Math.PI - 0.15);
      ctx.stroke();

      // Draped silk gold zari shawl over shoulder with spring-damper follow-through lag
      const shawlGrad = ctx.createLinearGradient(
        shoulderW * 0.25,
        -206 + breathe,
        waistW * 0.9 + clothLagX,
        hemY
      );
      shawlGrad.addColorStop(0, 'rgba(217, 160, 44, 0.72)');
      shawlGrad.addColorStop(0.5, 'rgba(234, 179, 8, 0.56)');
      shawlGrad.addColorStop(1, 'rgba(146, 98, 18, 0.75)');
      ctx.fillStyle = shawlGrad;
      ctx.beginPath();
      ctx.moveTo(shoulderW * 0.28 * (1 - 0.5 * absP) + chestLineX * 0.4, -206 + breathe);
      ctx.lineTo(shoulderW * 0.74 * (1 - 0.4 * absP) + chestLineX * 0.4, -196 + breathe);
      ctx.lineTo(waistW * 0.9 + clothLagX * 0.85, hemY);
      ctx.lineTo(waistW * 0.24 + clothLagX * 0.65, hemY);
      ctx.closePath();
      ctx.fill();
      ctx.strokeStyle = '#FACC15';
      ctx.lineWidth = 2;
      ctx.stroke();
      break;
    }
    case DressStyle.FESTIVE_SAREE: {
      const palluGrad = ctx.createLinearGradient(
        -shoulderW * 0.7,
        -196 + breathe,
        waistW * 0.95 + clothLagX * 0.5,
        -45
      );
      palluGrad.addColorStop(0, 'rgba(245, 158, 11, 0.65)');
      palluGrad.addColorStop(1, 'rgba(180, 83, 9, 0.45)');
      ctx.fillStyle = palluGrad;
      ctx.beginPath();
      ctx.moveTo(-shoulderW * 0.72 + chestLineX * 0.35, -196 + breathe);
      ctx.lineTo(-shoulderW * 0.24 + chestLineX * 0.35, -204 + breathe);
      ctx.lineTo(waistW * 0.95 + clothLagX * 0.45, -45);
      ctx.lineTo(waistW * 0.35 + clothLagX * 0.35, -45);
      ctx.closePath();
      ctx.fill();
      ctx.strokeStyle = '#FBBF24';
      ctx.lineWidth = 2.5;
      ctx.stroke();

      ctx.strokeStyle = '#FDE047';
      ctx.lineWidth = 4.5;
      ctx.beginPath();
      ctx.arc(chestLineX * 0.5, -198 + breathe, 26 * (1 - 0.32 * absP), 0.25, Math.PI - 0.25);
      ctx.stroke();
      break;
    }
    case DressStyle.WARRIOR_ARMOR: {
      ctx.fillStyle = '#1E293B';
      ctx.strokeStyle = '#D97706';
      ctx.lineWidth = 3;
      for (const side of [-1, 1]) {
        ctx.beginPath();
        ctx.ellipse(side * (shoulderW - 6) + chestLineX * 0.25, -188 + breathe, 24 * (1 - 0.25 * absP), 18, side * 0.3, 0, Math.PI * 2);
        ctx.fill();
        ctx.stroke();
      }
      ctx.strokeStyle = '#D97706';
      ctx.lineWidth = 2.5;
      ctx.beginPath();
      ctx.moveTo(-shoulderW * 0.55 + chestLineX * 0.3, -162 + breathe);
      ctx.lineTo(chestLineX, -125 + breathe);
      ctx.lineTo(shoulderW * 0.55 + chestLineX * 0.4, -162 + breathe);
      ctx.stroke();
      ctx.fillStyle = '#451A03';
      ctx.fillRect(-waistW, -52, waistW * 2 + chestLineX * 0.3, 14);
      break;
    }
    case DressStyle.FORMAL_COAT: {
      ctx.fillStyle = '#0B1120';
      ctx.beginPath();
      ctx.moveTo(chestLineX * 0.65 - 22 * (1 - 0.4 * absP), -204 + breathe);
      ctx.lineTo(chestLineX * 0.65 + 22 * (1 - 0.4 * absP), -204 + breathe);
      ctx.lineTo(chestLineX, -108 + breathe);
      ctx.closePath();
      ctx.fill();

      ctx.strokeStyle = 'rgba(255,255,255,0.28)';
      ctx.lineWidth = 3;
      ctx.beginPath();
      ctx.moveTo(chestLineX * 0.65 - 20 * (1 - 0.4 * absP), -204 + breathe);
      ctx.lineTo(chestLineX * 0.8 - 28 * (1 - 0.45 * absP), -150 + breathe);
      ctx.lineTo(chestLineX, -108 + breathe);
      ctx.moveTo(chestLineX * 0.65 + 20 * (1 - 0.4 * absP), -204 + breathe);
      ctx.lineTo(chestLineX * 0.8 + 28 * (1 - 0.45 * absP), -150 + breathe);
      ctx.lineTo(chestLineX, -108 + breathe);
      ctx.stroke();

      ctx.fillStyle = '#94A3B8';
      for (const by of [-100, -72]) {
        ctx.beginPath();
        ctx.arc(chestLineX * 0.85 - 12 * (1 - 0.5 * absP), by, 3.5, 0, Math.PI * 2);
        ctx.arc(chestLineX * 0.85 + 12 * (1 - 0.5 * absP), by, 3.5, 0, Math.PI * 2);
        ctx.fill();
      }
      break;
    }
    default: {
      ctx.fillStyle = '#0D1320';
      ctx.beginPath();
      ctx.moveTo(chestLineX * 0.6 - 20 * (1 - 0.4 * absP), -206 + breathe);
      ctx.lineTo(chestLineX * 0.6 + 20 * (1 - 0.4 * absP), -206 + breathe);
      ctx.lineTo(chestLineX, -142 + breathe);
      ctx.closePath();
      ctx.fill();

      ctx.strokeStyle = actor.accentColor;
      ctx.lineWidth = 3;
      ctx.beginPath();
      ctx.moveTo(chestLineX, -142 + breathe);
      ctx.lineTo(chestLineX * 0.85, hemY - 4);
      ctx.moveTo(-waistW + 2, -45);
      ctx.lineTo(waistW - 2 + chestLineX * 0.25, -45);
      ctx.stroke();
      break;
    }
  }
}

function drawTaperedLimbSegment(
  ctx: CanvasRenderingContext2D,
  x0: number,
  y0: number,
  r0: number,
  x1: number,
  y1: number,
  r1: number,
  fill: string
): void {
  const dx = x1 - x0;
  const dy = y1 - y0;
  const len = Math.hypot(dx, dy) || 1;
  const nx = -dy / len;
  const ny = dx / len;

  ctx.fillStyle = fill;
  ctx.beginPath();
  ctx.moveTo(x0 + nx * r0, y0 + ny * r0);
  ctx.lineTo(x1 + nx * r1, y1 + ny * r1);
  ctx.arc(x1, y1, r1, Math.atan2(ny, nx), Math.atan2(-ny, -nx), false);
  ctx.lineTo(x0 - nx * r0, y0 - ny * r0);
  ctx.arc(x0, y0, r0, Math.atan2(-ny, -nx), Math.atan2(ny, nx), false);
  ctx.closePath();
  ctx.fill();
}

function drawSculptedLegSegment(
  ctx: CanvasRenderingContext2D,
  x0: number,
  y0: number,
  r0: number,
  xMid: number,
  yMid: number,
  rMid: number,
  x1: number,
  y1: number,
  r1: number,
  baseColor: string,
  rimColor: string,
  sideSign: number
): void {
  const dx = x1 - x0;
  const dy = y1 - y0;
  const len = Math.hypot(dx, dy) || 1;
  const nx = -dy / len;
  const ny = dx / len;

  const minX = Math.min(x0, xMid, x1) - Math.max(r0, rMid, r1);
  const maxX = Math.max(x0, xMid, x1) + Math.max(r0, rMid, r1);
  const grad = ctx.createLinearGradient(minX, 0, maxX, 0);
  if (sideSign < 0) {
    grad.addColorStop(0, rimColor);
    grad.addColorStop(0.16, baseColor);
    grad.addColorStop(0.65, baseColor);
    grad.addColorStop(1, 'rgba(8, 12, 22, 0.92)');
  } else {
    grad.addColorStop(0, 'rgba(8, 12, 22, 0.92)');
    grad.addColorStop(0.35, baseColor);
    grad.addColorStop(0.84, baseColor);
    grad.addColorStop(1, rimColor);
  }

  ctx.fillStyle = baseColor;
  ctx.beginPath();
  ctx.moveTo(x0 + nx * r0, y0 + ny * r0);
  ctx.quadraticCurveTo(xMid + nx * rMid, yMid + ny * rMid, x1 + nx * r1, y1 + ny * r1);
  ctx.arc(x1, y1, r1, Math.atan2(ny, nx), Math.atan2(-ny, -nx), false);
  ctx.quadraticCurveTo(xMid - nx * rMid, yMid - ny * rMid, x0 - nx * r0, y0 - ny * r0);
  ctx.arc(x0, y0, r0, Math.atan2(-ny, -nx), Math.atan2(ny, nx), false);
  ctx.closePath();
  ctx.fill();

  // Soft 3D cylindrical volume & rim shading
  ctx.save();
  ctx.globalAlpha = 0.34;
  ctx.fillStyle = grad;
  ctx.fill();
  ctx.restore();

  ctx.strokeStyle = 'rgba(255,255,255,0.14)';
  ctx.lineWidth = 1.4;
  ctx.stroke();
}

function drawHumanLeg(
  ctx: CanvasRenderingContext2D,
  hipX: number,
  hipY: number,
  footX: number,
  footY: number,
  kneeBendForward: number,
  footPitch: number,
  depthScale: number,
  sideSign: number,
  legRatio: number,
  kneeBendBias: number,
  softLimit: number,
  legColor: string,
  skinColor: string,
  rimColor: string,
  showBareLowerLeg: boolean,
  kneeTrim?: string,
  sideProfile = 0
): { jointX: number; jointY: number; endX: number; endY: number } {
  const segLen = 112 * legRatio;
  const absP = Math.min(1, Math.abs(sideProfile));
  const facingDir = sideProfile >= 0 ? 1 : -1;
  const poleDirX =
    sideSign * (0.14 + kneeBendBias * 0.25) * (1 - absP) +
    facingDir * (0.82 + kneeBendBias * 0.25) * absP;
  const ik = solveDlsTwoBoneIK(
    hipX,
    hipY,
    footX,
    footY,
    segLen,
    segLen,
    poleDirX,
    -0.3 - kneeBendBias * 0.45,
    softLimit
  );

  // Align knee along natural hip-to-ankle line while pushing forward toward facingDir in side view
  const kneeX =
    ik.jointX * (0.45 + 0.35 * absP) +
    (hipX * 0.45 + footX * 0.55) * (0.55 - 0.35 * absP) +
    facingDir * kneeBendForward * 0.28 * absP;
  const kneeY = ik.jointY - kneeBendForward * 0.32;
  const ankleX = ik.endX;
  const ankleY = ik.endY;

  const thighR = 19.5 * depthScale;
  const midThighR = 17.5 * depthScale;
  const kneeR = 12.8 * depthScale;
  const calfR = 14.8 * depthScale;
  const ankleR = 7.8 * depthScale;

  ctx.save();
  if (depthScale < 0.98) {
    ctx.globalAlpha = 0.92;
  }

  // Sculpted Thigh (hip -> knee)
  const midThighX = (hipX + kneeX) * 0.5;
  const midThighY = (hipY + kneeY) * 0.5;
  drawSculptedLegSegment(
    ctx,
    hipX,
    hipY,
    thighR,
    midThighX,
    midThighY,
    midThighR,
    kneeX,
    kneeY,
    kneeR,
    legColor,
    rimColor,
    sideSign
  );

  // Sculpted Lower Leg / Calf (knee -> gastrocnemius curve -> slim ankle)
  const calfX = kneeX + (ankleX - kneeX) * 0.34 + sideSign * 2.2 * depthScale;
  const calfY = kneeY + (ankleY - kneeY) * 0.34;
  drawSculptedLegSegment(
    ctx,
    kneeX,
    kneeY,
    kneeR * 1.02,
    calfX,
    calfY,
    calfR,
    ankleX,
    ankleY,
    ankleR,
    legColor,
    rimColor,
    sideSign
  );

  // Exposed Human Ankle Skin Bridge above shoe cuff
  const dx = ankleX - kneeX;
  const dy = ankleY - kneeY;
  const shinLen = Math.hypot(dx, dy) || 1;
  const cuffDist = showBareLowerLeg ? 24 : 15;
  const cuffT = Math.max(0.75, 1 - cuffDist / shinLen);
  const cuffX = kneeX + dx * cuffT;
  const cuffY = kneeY + dy * cuffT;
  drawTaperedLimbSegment(
    ctx,
    cuffX,
    cuffY,
    ankleR * 1.15,
    ankleX,
    ankleY,
    ankleR * 0.92,
    skinColor
  );

  // Subtle trouser hem band above bare ankle
  if (!showBareLowerLeg) {
    const nx = (-dy / shinLen) * (ankleR * 1.18);
    const ny = (dx / shinLen) * (ankleR * 1.18);
    ctx.strokeStyle = 'rgba(255,255,255,0.22)';
    ctx.lineWidth = 2.4;
    ctx.beginPath();
    ctx.moveTo(cuffX - nx, cuffY - ny);
    ctx.lineTo(cuffX + nx, cuffY + ny);
    ctx.stroke();
  }

  // Patella / Knee contour or warrior knee guard
  if (kneeTrim) {
    ctx.fillStyle = kneeTrim;
    ctx.beginPath();
    ctx.ellipse(kneeX, kneeY, 10.5 * depthScale, 8.5 * depthScale, 0, 0, Math.PI * 2);
    ctx.fill();
  } else {
    ctx.fillStyle = 'rgba(255,255,255,0.11)';
    ctx.beginPath();
    ctx.ellipse(kneeX, kneeY - 2, 7.5 * depthScale, 6 * depthScale, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.strokeStyle = 'rgba(0,0,0,0.24)';
    ctx.lineWidth = 1.8;
    ctx.beginPath();
    ctx.moveTo(kneeX - 7 * depthScale, kneeY + 3);
    ctx.lineTo(kneeX + 7 * depthScale, kneeY + 3);
    ctx.stroke();
  }

  // Sculpted Human Foot / Shoe / Sandal (oriented along facingDir in side pose)
  const shoeDir = absP > 0.32 ? facingDir : sideSign;
  ctx.save();
  ctx.translate(ankleX, ankleY);
  ctx.rotate(footPitch * shoeDir * (0.65 + 0.3 * absP));
  ctx.scale(depthScale, depthScale);

  if (showBareLowerLeg) {
    // Bare foot arch + metallic gold strap sandal
    ctx.fillStyle = skinColor;
    ctx.beginPath();
    ctx.moveTo(-9 * shoeDir, -4);
    ctx.quadraticCurveTo(8 * shoeDir, -5, 22 * shoeDir, 5);
    ctx.lineTo(24 * shoeDir, 11);
    ctx.lineTo(-12 * shoeDir, 11);
    ctx.closePath();
    ctx.fill();

    ctx.fillStyle = '#1E1B4B';
    ctx.fillRect(shoeDir > 0 ? -13 : -25, 9, 38, 4.5);
    ctx.strokeStyle = '#F59E0B';
    ctx.lineWidth = 2.5;
    ctx.beginPath();
    ctx.moveTo(-4 * shoeDir, 0);
    ctx.lineTo(14 * shoeDir, 7);
    ctx.stroke();
  } else {
    ctx.fillStyle = '#111827';
    ctx.beginPath();
    ctx.moveTo(-10 * shoeDir, -5);
    ctx.quadraticCurveTo(9 * shoeDir, -7, 24 * shoeDir, 3);
    ctx.quadraticCurveTo(28 * shoeDir, 12, 15 * shoeDir, 13);
    ctx.lineTo(-12 * shoeDir, 13);
    ctx.quadraticCurveTo(-16 * shoeDir, 7, -10 * shoeDir, -5);
    ctx.closePath();
    ctx.fill();

    ctx.strokeStyle = 'rgba(255,255,255,0.22)';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(-11 * shoeDir, 12);
    ctx.lineTo(22 * shoeDir, 12);
    ctx.stroke();
  }

  ctx.restore();
  ctx.restore();

  return { jointX: kneeX, jointY: kneeY, endX: ankleX, endY: ankleY };
}

function drawHumanHand(
  ctx: CanvasRenderingContext2D,
  hx: number,
  hy: number,
  handAngle: number,
  skinColor: string,
  arm: ArmKinematics,
  sideSign: number,
  sideProfile = 0
): void {
  const absP = Math.abs(sideProfile);
  const facingDir = sideProfile < 0 ? -1 : 1;
  const handDir = absP > 0.3 ? facingDir : sideSign;

  ctx.save();
  ctx.translate(hx, hy);
  ctx.rotate(-handAngle);
  ctx.scale(arm.depthScale * (1 - 0.24 * absP), arm.depthScale);

  ctx.fillStyle = skinColor;
  ctx.beginPath();
  drawRoundedRectPath(ctx, -8.5, -2, 17, 17, 6);
  ctx.fill();

  const thumbX = -handDir * 9.5;
  ctx.strokeStyle = skinColor;
  ctx.lineWidth = 4.6;
  ctx.lineCap = 'round';
  ctx.beginPath();
  ctx.moveTo(-handDir * 5, 4);
  ctx.quadraticCurveTo(thumbX, 9, thumbX * 1.15, 15 - arm.fingerCurl * 4);
  ctx.stroke();

  const fingerSpecs = [
    { x: -handDir * 5.6, len: 14.5, isIndex: true },
    { x: -handDir * 1.8, len: 16.0, isIndex: false },
    { x: handDir * 2.0, len: 14.5, isIndex: false },
    { x: handDir * 5.6, len: 11.5, isIndex: false },
  ];

  fingerSpecs.forEach((f, idx) => {
    const isExtendedPoint = arm.pointIndex && f.isIndex;
    const curl = isExtendedPoint ? 0.05 : arm.fingerCurl;
    const spreadAngle = (idx - 1.5) * -handDir * arm.fingerSpread * 0.18;
    const effLen = f.len * (1 - curl * 0.52);
    const tipX = f.x + Math.sin(spreadAngle) * effLen;
    const tipY = 13 + Math.cos(spreadAngle) * effLen;

    ctx.strokeStyle = skinColor;
    ctx.lineWidth = f.isIndex ? 3.8 : 3.4;
    ctx.lineCap = 'round';
    ctx.beginPath();
    ctx.moveTo(f.x, 12);
    ctx.quadraticCurveTo(
      f.x + Math.sin(spreadAngle) * effLen * 0.55,
      12 + effLen * 0.55,
      tipX,
      tipY
    );
    ctx.stroke();
  });

  ctx.strokeStyle = 'rgba(0,0,0,0.16)';
  ctx.lineWidth = 1.4;
  ctx.beginPath();
  ctx.moveTo(-4, 7);
  ctx.lineTo(4, 9);
  ctx.stroke();

  ctx.restore();
}

function drawHumanArm(
  ctx: CanvasRenderingContext2D,
  sx: number,
  sy: number,
  arm: ArmKinematics,
  armRatio: number,
  softLimit: number,
  sleeveColor: string,
  skinColor: string,
  accentColor: string,
  longSleeves: boolean,
  sideSign: number,
  sideProfile = 0
): { elbowX: number; elbowY: number; handX: number; handY: number } {
  const absP = Math.abs(sideProfile);
  const facingDir = sideProfile < 0 ? -1 : 1;
  const upperLen = 64 * armRatio * arm.depthScale;
  const foreLen = 58 * armRatio * arm.depthScale;
  const rawEx = sx + Math.sin(arm.upperAngle) * upperLen;
  const rawEy = sy + Math.cos(arm.upperAngle) * upperLen;
  const targetHx = rawEx + Math.sin(arm.foreAngle) * foreLen;
  const targetHy = rawEy + Math.cos(arm.foreAngle) * foreLen;

  // In side view, human elbows flex backward (-facingDir) as forearms reach forward (+facingDir)
  const poleDirX = sideSign * 0.9 * (1 - absP) - facingDir * 0.85 * absP;
  const armIk = solveDlsTwoBoneIK(
    sx,
    sy,
    targetHx,
    targetHy,
    upperLen,
    foreLen,
    poleDirX,
    0.45,
    softLimit
  );

  const ex = rawEx * 0.65 + armIk.jointX * 0.35;
  const ey = rawEy * 0.65 + armIk.jointY * 0.35;
  const hx = armIk.endX;
  const hy = armIk.endY;

  ctx.save();
  if (arm.depthScale < 0.98) {
    ctx.globalAlpha = 0.92;
  }

  drawTaperedLimbSegment(
    ctx,
    sx,
    sy,
    14.5 * arm.depthScale,
    ex,
    ey,
    11.0 * arm.depthScale,
    sleeveColor
  );

  const foreFill = longSleeves ? sleeveColor : skinColor;
  drawTaperedLimbSegment(
    ctx,
    ex,
    ey,
    11.0 * arm.depthScale,
    hx,
    hy,
    7.2 * arm.depthScale,
    foreFill
  );

  if (longSleeves) {
    ctx.strokeStyle = accentColor;
    ctx.lineWidth = 2.6;
    const dx = hx - ex;
    const dy = hy - ey;
    const len = Math.hypot(dx, dy) || 1;
    const nx = (-dy / len) * 7.4 * arm.depthScale;
    const ny = (dx / len) * 7.4 * arm.depthScale;
    ctx.beginPath();
    ctx.moveTo(hx - nx, hy - ny);
    ctx.lineTo(hx + nx, hy + ny);
    ctx.stroke();
  }

  drawHumanHand(ctx, hx, hy, arm.handAngle, skinColor, arm, sideSign, sideProfile);
  ctx.restore();

  return { elbowX: ex, elbowY: ey, handX: hx, handY: hy };
}

function drawPortraitHumanHead(
  ctx: CanvasRenderingContext2D,
  portrait: HTMLImageElement,
  actor: ActorProfile,
  _biome: EnvBiome,
  timeSec: number,
  audioAmp: number,
  visemeWidth: number,
  sideProfile = 0,
  sidePortrait: HTMLImageElement | null = null,
  poseSide: PoseSide = 'front',
  isWalkingScene = false
): void {
  const absP = Math.abs(sideProfile);
  const facingDir = poseSide === 'left' ? -1 : poseSide === 'right' ? 1 : sideProfile < 0 ? -1 : 1;
  const useSideAsset = Boolean(
    sidePortrait && poseSide !== 'front' && (isWalkingScene || absP >= 0.42)
  );
  const activeSrc = useSideAsset && sidePortrait ? sidePortrait : portrait;

  const rx = 62 * (useSideAsset ? 0.94 : 1 - 0.16 * absP);
  const ry = 74;
  const blendShapes = actor.blendShapes ?? createDefaultBlendShapes();

  const zoom = Math.max(0.75, Math.min(1.35, actor.faceZoom || 1.0));
  const isTallFullBody =
    !useSideAsset && activeSrc.height / Math.max(1, activeSrc.width) > 1.15;
  const baseFracW = useSideAsset ? 0.56 : isTallFullBody ? 0.34 : 0.42;
  const baseFracH = useSideAsset ? 0.62 : isTallFullBody ? 0.24 : 0.44;
  const sw = (activeSrc.width * baseFracW) / zoom;
  const sh = (activeSrc.height * baseFracH) / zoom;
  const sxOffset = useSideAsset ? 0 : -facingDir * activeSrc.width * 0.025 * absP;
  const sx = Math.max(
    0,
    Math.min(activeSrc.width - sw, (activeSrc.width - sw) * 0.5 + sxOffset)
  );
  const sy = Math.max(
    0,
    activeSrc.height * (useSideAsset ? 0.05 : 0.07) -
      (sh - activeSrc.height * baseFracH) * 0.35
  );

  // Back-cranium hair silhouette only when stretching a front photo without a dedicated side asset
  if (absP > 0.12 && !useSideAsset) {
    ctx.save();
    const backX = -facingDir * 24 * absP;
    ctx.fillStyle = '#141722';
    ctx.beginPath();
    ctx.ellipse(backX, -10, 44 * absP + 18, 66, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
  }

  const bufW = 192;
  const bufH = 224;
  const feather = getHeadFeatherBuffer(bufW, bufH);

  if (feather) {
    const fctx = feather.ctx;
    fctx.clearRect(0, 0, bufW, bufH);
    fctx.save();
    fctx.beginPath();
    fctx.ellipse(bufW * 0.5, bufH * 0.5, rx * 1.4, ry * 1.4, 0, 0, Math.PI * 2);
    fctx.clip();

    if (useSideAsset && facingDir < 0) {
      fctx.translate(bufW, 0);
      fctx.scale(-1, 1);
    }

    if (useSideAsset) {
      drawSideProfileTalkingFaceRegion(
        fctx,
        activeSrc,
        sx,
        sy,
        sw,
        sh,
        bufW * 0.5 - rx * 1.4,
        bufH * 0.5 - ry * 1.4,
        rx * 2.8,
        ry * 2.8,
        actor.skinTone || '#C98A63',
        actor.eyeLineOffset || 0,
        actor.mouthLineOffset || 0,
        blendShapes,
        timeSec,
        audioAmp,
        visemeWidth
      );
    } else {
      drawHyperRealisticTalkingFaceRegion(
        fctx,
        activeSrc,
        sx,
        sy,
        sw,
        sh,
        bufW * 0.5 - rx * 1.4,
        bufH * 0.5 - ry * 1.4,
        rx * 2.8,
        ry * 2.8,
        actor.skinTone || '#C98A63',
        actor.eyeLineOffset || 0,
        actor.mouthLineOffset || 0,
        blendShapes,
        timeSec,
        audioAmp,
        visemeWidth
      );
    }
    fctx.restore();

    // Soft elliptical edge feathering so head & hair melt cleanly with zero cutout outline
    fctx.save();
    fctx.globalCompositeOperation = 'destination-in';
    fctx.translate(bufW * 0.5, bufH * 0.5);
    fctx.scale(rx * 1.4, ry * 1.4);
    const maskGrad = fctx.createRadialGradient(0, 0, 0.68, 0, 0, 1.0);
    maskGrad.addColorStop(0, 'rgba(0,0,0,1)');
    maskGrad.addColorStop(0.84, 'rgba(0,0,0,0.92)');
    maskGrad.addColorStop(1, 'rgba(0,0,0,0)');
    fctx.fillStyle = maskGrad;
    fctx.beginPath();
    fctx.arc(0, 0, 1, 0, Math.PI * 2);
    fctx.fill();
    fctx.restore();

    ctx.drawImage(
      feather.canvas,
      -rx * 1.05 + facingDir * 10 * absP,
      -ry * 1.05 - 4,
      rx * 2.1,
      ry * 2.1
    );
  } else {
    ctx.save();
    ctx.translate(facingDir * 10 * absP, 0);
    ctx.beginPath();
    ctx.ellipse(0, -4, rx, ry, 0, 0, Math.PI * 2);
    ctx.clip();

    if (useSideAsset && facingDir < 0) {
      ctx.scale(-1, 1);
    }

    if (useSideAsset) {
      drawSideProfileTalkingFaceRegion(
        ctx,
        activeSrc,
        sx,
        sy,
        sw,
        sh,
        -rx,
        -ry - 4,
        rx * 2,
        ry * 2,
        actor.skinTone || '#C98A63',
        actor.eyeLineOffset || 0,
        actor.mouthLineOffset || 0,
        blendShapes,
        timeSec,
        audioAmp,
        visemeWidth
      );
    } else {
      drawHyperRealisticTalkingFaceRegion(
        ctx,
        activeSrc,
        sx,
        sy,
        sw,
        sh,
        -rx,
        -ry - 4,
        rx * 2,
        ry * 2,
        actor.skinTone || '#C98A63',
        actor.eyeLineOffset || 0,
        actor.mouthLineOffset || 0,
        blendShapes,
        timeSec,
        audioAmp,
        visemeWidth
      );
    }
    ctx.restore();
  }

  // Sculpted side-profile shadow depth on the trailing cheek
  if (absP > 0.16 && !useSideAsset) {
    ctx.save();
    const shadeGrad = ctx.createLinearGradient(
      -facingDir * 56,
      0,
      facingDir * 44,
      0
    );
    shadeGrad.addColorStop(0, `rgba(8, 12, 22, ${0.34 * absP})`);
    shadeGrad.addColorStop(0.55, 'rgba(8, 12, 22, 0)');
    ctx.fillStyle = shadeGrad;
    ctx.beginPath();
    ctx.ellipse(facingDir * 6 * absP, -4, rx, ry, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
  }
}

function drawAnatomyHumanHead(
  ctx: CanvasRenderingContext2D,
  actor: ActorProfile,
  emotion: EmotionMood,
  timeSec: number,
  audioAmp: number,
  visemeWidth: number,
  skin: string,
  sideProfile = 0
): void {
  const blendShapes = actor.blendShapes ?? createDefaultBlendShapes();
  const absP = Math.abs(sideProfile);
  const facingDir = sideProfile < 0 ? -1 : 1;
  const mouthOpen = Math.min(26, Math.max(2.5, (3 + audioAmp * 19) * blendShapes.jawOpenGain));

  if (absP > 0.35) {
    // True 3/4-to-Side Profile Human Head & Facial Silhouette
    const d = facingDir;
    const jawDrop = mouthOpen * 0.45;
    const noseTipX = d * (48 + 18 * absP);
    const browX = d * (36 + 14 * absP);
    const lipsX = d * (40 + 14 * absP);
    const chinX = d * (34 + 14 * absP);
    const backX = -d * (42 + 12 * absP);

    // Cranium + Side Profile Silhouette (Forehead -> Brow -> Nose -> Lips -> Chin -> Jaw)
    ctx.fillStyle = skin;
    ctx.beginPath();
    ctx.moveTo(backX, -20);
    ctx.quadraticCurveTo(backX - d * 10, -78, 0, -76);
    ctx.quadraticCurveTo(d * 42, -76, browX, -32);
    ctx.lineTo(browX + d * 2, -16);
    ctx.lineTo(noseTipX, 8);
    ctx.lineTo(lipsX - d * 2, 16);
    ctx.lineTo(lipsX + d * 2, 27 + jawDrop * 0.25);
    ctx.lineTo(lipsX - d * 1, 36 + jawDrop * 0.65);
    ctx.lineTo(chinX, 54 + jawDrop * 0.75);
    ctx.quadraticCurveTo(d * 6, 68 + jawDrop * 0.4, -d * 18, 48);
    ctx.quadraticCurveTo(backX + d * 4, 24, backX, -20);
    ctx.closePath();
    ctx.fill();

    // Subtle side facial shading
    const cheekGrad = ctx.createLinearGradient(backX, -10, noseTipX, 20);
    cheekGrad.addColorStop(0, 'rgba(0,0,0,0.22)');
    cheekGrad.addColorStop(0.55, 'rgba(0,0,0,0)');
    ctx.fillStyle = cheekGrad;
    ctx.fill();

    // Beard / Stubble wrapped cleanly around jawline & chin in profile
    if (!actor.isFemale && actor.facialHair !== 'NONE') {
      ctx.fillStyle =
        actor.facialHair === 'BEARD' ? 'rgba(20, 23, 34, 0.88)' : 'rgba(20, 23, 34, 0.36)';
      ctx.beginPath();
      ctx.moveTo(-d * 18, 4);
      ctx.quadraticCurveTo(d * 10, 24, lipsX - d * 4, 26);
      ctx.lineTo(chinX, 56 + jawDrop * 0.75);
      ctx.quadraticCurveTo(d * 4, 68 + jawDrop * 0.4, -d * 22, 46);
      ctx.quadraticCurveTo(-d * 34, 24, -d * 18, 4);
      ctx.closePath();
      ctx.fill();
    }

    // Swept Profile Hair Cap covering back cranium & forehead hairline
    ctx.fillStyle = '#141722';
    ctx.beginPath();
    ctx.moveTo(backX - d * 2, 14);
    ctx.quadraticCurveTo(backX - d * 16, -78, -d * 2, -84);
    ctx.quadraticCurveTo(d * 42, -88, browX - d * 2, -36);
    ctx.quadraticCurveTo(d * 12, -52, -d * 8, -28);
    ctx.quadraticCurveTo(-d * 20, -4, backX - d * 2, 14);
    ctx.closePath();
    ctx.fill();

    // Visible Near-Side Ear (far ear occluded by head in side pose)
    ctx.fillStyle = skin;
    ctx.beginPath();
    ctx.ellipse(-d * 12, 4, 8, 15, d * 0.12, 0, Math.PI * 2);
    ctx.fill();
    ctx.strokeStyle = 'rgba(0,0,0,0.2)';
    ctx.lineWidth = 1.6;
    ctx.beginPath();
    ctx.arc(-d * 12, 4, 4.2, -0.6, 2.2);
    ctx.stroke();

    // Near-Side Eye + Optional Foreshortened Far Eye for 3/4 angles
    const blink = getSmoothBlinkFactor(timeSec, blendShapes.blinkRateGain);
    const nearEyeX = d * (24 + 8 * (1 - absP));
    if (blink > 0.7) {
      ctx.strokeStyle = '#141722';
      ctx.lineWidth = 3.2;
      ctx.beginPath();
      ctx.moveTo(nearEyeX - d * 8, -9);
      ctx.lineTo(nearEyeX + d * 8, -9);
      ctx.stroke();
    } else {
      ctx.fillStyle = '#F8FAFC';
      ctx.beginPath();
      ctx.ellipse(nearEyeX, -9, 8.5, 6.2 * (1 - blink * 0.7), 0, 0, Math.PI * 2);
      ctx.fill();

      ctx.fillStyle = '#3B2314';
      ctx.beginPath();
      ctx.arc(nearEyeX + d * 2.2, -9, 4.3, 0, Math.PI * 2);
      ctx.fill();

      ctx.fillStyle = '#090C12';
      ctx.beginPath();
      ctx.arc(nearEyeX + d * 2.6, -9, 2.1, 0, Math.PI * 2);
      ctx.fill();
    }

    // Expressive Profile Brow
    ctx.strokeStyle = '#141722';
    ctx.lineWidth = 4.2;
    ctx.lineCap = 'round';
    const browBaseTilt =
      emotion === EmotionMood.INTENSE || emotion === EmotionMood.HEROIC
        ? 5.5
        : emotion === EmotionMood.MYSTERIOUS
          ? -3
          : 0;
    const browDynLift = audioAmp * 3.2 * blendShapes.browLiftGain;
    const browTilt = browBaseTilt * blendShapes.browLiftGain;
    ctx.beginPath();
    ctx.moveTo(nearEyeX - d * 10, -23 - browTilt - browDynLift);
    ctx.lineTo(nearEyeX + d * 9, -22 + browTilt * 0.6 - browDynLift);
    ctx.stroke();

    // Side-Profile Talking Mouth Opening
    const smileCy = 31 - blendShapes.lipSmileBias * 3;
    ctx.fillStyle = '#5B1820';
    ctx.beginPath();
    ctx.ellipse(lipsX - d * 6, smileCy, 10.5, mouthOpen * 0.5, 0, 0, Math.PI * 2);
    ctx.fill();
    if (mouthOpen > 7) {
      ctx.fillStyle = '#F8FAFC';
      ctx.fillRect(lipsX - d * 6 - 5, smileCy - mouthOpen * 0.3, 10, 3);
    }

    ctx.strokeStyle = actor.accentColor;
    ctx.lineWidth = 2.2;
    ctx.beginPath();
    ctx.ellipse(0, -4, 52, 74, 0, 0, Math.PI * 2);
    ctx.stroke();
    return;
  }

  // Frontal / Subtle 3/4 View
  const shiftX = sideProfile * 16;

  ctx.fillStyle = skin;
  ctx.beginPath();
  ctx.ellipse(-56 + shiftX * 0.3, 2, 9, 16, 0, 0, Math.PI * 2);
  ctx.ellipse(56 + shiftX * 0.3, 2, 9, 16, 0, 0, Math.PI * 2);
  ctx.fill();

  ctx.fillStyle = skin;
  ctx.beginPath();
  ctx.moveTo(-54, -22);
  ctx.quadraticCurveTo(-56, -72, 0, -74);
  ctx.quadraticCurveTo(56, -72, 54, -22);
  ctx.quadraticCurveTo(52, 42, 24, 62);
  ctx.quadraticCurveTo(0, 72, -24, 62);
  ctx.quadraticCurveTo(-52, 42, -54, -22);
  ctx.closePath();
  ctx.fill();

  if (!actor.isFemale && actor.facialHair !== 'NONE') {
    ctx.fillStyle =
      actor.facialHair === 'BEARD' ? 'rgba(20, 23, 34, 0.85)' : 'rgba(20, 23, 34, 0.34)';
    ctx.beginPath();
    ctx.moveTo(-50, 4);
    ctx.quadraticCurveTo(-48, 50, shiftX * 0.4, 70);
    ctx.quadraticCurveTo(48, 50, 50, 4);
    ctx.quadraticCurveTo(36, 28, shiftX * 0.4, 22);
    ctx.quadraticCurveTo(-36, 28, -50, 4);
    ctx.closePath();
    ctx.fill();
  }

  ctx.fillStyle = '#141722';
  ctx.beginPath();
  if (actor.hairStyle === 'SWEPT_BACK') {
    ctx.moveTo(-56, -24);
    ctx.quadraticCurveTo(-60, -90, 0, -86);
    ctx.quadraticCurveTo(60, -90, 56, -24);
    ctx.quadraticCurveTo(28, -52, shiftX * 0.4, -54);
    ctx.quadraticCurveTo(-28, -52, -56, -24);
  } else if (actor.hairStyle === 'SIDE_PART') {
    ctx.moveTo(-56, -22);
    ctx.quadraticCurveTo(-58, -84, 0, -84);
    ctx.quadraticCurveTo(58, -84, 56, -22);
    ctx.quadraticCurveTo(18, -52, -16 + shiftX * 0.3, -34);
    ctx.quadraticCurveTo(-38, -44, -56, -22);
  } else {
    ctx.moveTo(-56, -24);
    ctx.quadraticCurveTo(-58, -82, 0, -82);
    ctx.quadraticCurveTo(58, -82, 56, -24);
    ctx.quadraticCurveTo(34, -46, shiftX * 0.4, -44);
    ctx.quadraticCurveTo(-34, -46, -56, -24);
  }
  ctx.closePath();
  ctx.fill();

  const blink = getSmoothBlinkFactor(timeSec, blendShapes.blinkRateGain);
  if (blink > 0.7) {
    ctx.strokeStyle = '#141722';
    ctx.lineWidth = 3.5;
    ctx.beginPath();
    ctx.moveTo(-30 + shiftX, -8);
    ctx.lineTo(-10 + shiftX, -8);
    ctx.moveTo(10 + shiftX, -8);
    ctx.lineTo(30 + shiftX, -8);
    ctx.stroke();
  } else {
    for (const ex of [-21 + shiftX, 21 + shiftX]) {
      ctx.fillStyle = '#F8FAFC';
      ctx.beginPath();
      ctx.ellipse(ex, -8, 10, 6.5 * (1 - blink * 0.7), 0, 0, Math.PI * 2);
      ctx.fill();

      ctx.fillStyle = '#3B2314';
      ctx.beginPath();
      ctx.arc(ex, -8, 4.8, 0, Math.PI * 2);
      ctx.fill();

      ctx.fillStyle = '#090C12';
      ctx.beginPath();
      ctx.arc(ex, -8, 2.4, 0, Math.PI * 2);
      ctx.fill();
    }
  }

  ctx.strokeStyle = '#141722';
  ctx.lineWidth = 4.5;
  ctx.lineCap = 'round';
  const browBaseTilt =
    emotion === EmotionMood.INTENSE || emotion === EmotionMood.HEROIC
      ? 6
      : emotion === EmotionMood.MYSTERIOUS
        ? -3.5
        : 0;
  const browDynLift = audioAmp * 3.5 * blendShapes.browLiftGain;
  const browTilt = browBaseTilt * blendShapes.browLiftGain;
  ctx.beginPath();
  ctx.moveTo(-33 + shiftX, -23 - browTilt - browDynLift);
  ctx.lineTo(-10 + shiftX, -23 + browTilt - browDynLift);
  ctx.moveTo(10 + shiftX, -23 + browTilt - browDynLift);
  ctx.lineTo(33 + shiftX, -23 - browTilt - browDynLift);
  ctx.stroke();

  if (blendShapes.cheekSquint > 0.05 && blendShapes.lipSmileBias > 0.05) {
    ctx.fillStyle = `rgba(232, 130, 120, ${0.14 * blendShapes.cheekSquint})`;
    ctx.beginPath();
    ctx.ellipse(-28 + shiftX, 14, 12, 6, 0, 0, Math.PI * 2);
    ctx.ellipse(28 + shiftX, 14, 12, 6, 0, 0, Math.PI * 2);
    ctx.fill();
  }

  ctx.strokeStyle = 'rgba(0,0,0,0.22)';
  ctx.lineWidth = 2.5;
  ctx.beginPath();
  ctx.moveTo(shiftX, -10);
  ctx.lineTo(-3 + shiftX + sideProfile * 6, 12);
  ctx.lineTo(4 + shiftX + sideProfile * 6, 15);
  ctx.stroke();

  const mouthRx =
    16 *
    Math.min(
      1.4,
      Math.max(0.55, visemeWidth * blendShapes.mouthWidthGain + Math.max(0, blendShapes.lipSmileBias) * 0.14)
    );
  const smileCy = 32 - blendShapes.lipSmileBias * 4;
  ctx.fillStyle = '#5B1820';
  ctx.beginPath();
  ctx.ellipse(shiftX, smileCy, mouthRx, mouthOpen * 0.55, 0, 0, Math.PI * 2);
  ctx.fill();

  if (mouthOpen > 7) {
    ctx.fillStyle = '#F8FAFC';
    ctx.fillRect(-mouthRx * 0.6 + shiftX, smileCy - mouthOpen * 0.35, mouthRx * 1.2, 3.5);
  }

  ctx.strokeStyle = actor.accentColor;
  ctx.lineWidth = 2.5;
  ctx.beginPath();
  ctx.ellipse(0, -4, 58, 74, 0, 0, Math.PI * 2);
  ctx.stroke();
}

function drawParticles(
  ctx: CanvasRenderingContext2D,
  w: number,
  h: number,
  biome: EnvBiome,
  t: number
): void {
  ctx.save();
  switch (biome) {
    case EnvBiome.MONSOON_RAIN: {
      ctx.strokeStyle = 'rgba(189, 224, 254, 0.55)';
      ctx.lineWidth = 3;
      for (let i = 0; i < 65; i++) {
        const x = seededRand(i * 3 + 1) * w;
        const y = (seededRand(i * 3 + 2) * h + t * 850) % h;
        ctx.beginPath();
        ctx.moveTo(x, y);
        ctx.lineTo(x - 14, y + 40);
        ctx.stroke();
      }
      break;
    }
    case EnvBiome.FIRE_BATTLE: {
      for (let i = 0; i < 50; i++) {
        ctx.fillStyle =
          i % 2 === 0 ? 'rgba(255, 109, 0, 0.8)' : 'rgba(255, 214, 0, 0.74)';
        const x = seededRand(i * 5 + 1) * w + Math.sin(t * 2 + i) * 24;
        const y = h - ((seededRand(i * 5 + 2) * h + t * 240) % h);
        const r = seededRand(i * 5 + 3) * 5 + 2;
        ctx.beginPath();
        ctx.arc(x, y, r, 0, Math.PI * 2);
        ctx.fill();
      }
      break;
    }
    case EnvBiome.DESERT_MYSTERY: {
      ctx.strokeStyle = 'rgba(233, 196, 106, 0.35)';
      ctx.lineWidth = 2.5;
      for (let i = 0; i < 35; i++) {
        const x = (seededRand(i * 7 + 1) * w + t * 380) % w;
        const y = seededRand(i * 7 + 2) * h;
        ctx.beginPath();
        ctx.moveTo(x, y);
        ctx.lineTo(x + 70, y - 5);
        ctx.stroke();
      }
      break;
    }
    case EnvBiome.ROYAL_PALACE: {
      for (let i = 0; i < 42; i++) {
        ctx.fillStyle =
          i % 3 === 0 ? 'rgba(252, 211, 77, 0.72)' : 'rgba(251, 146, 60, 0.55)';
        const x = seededRand(i * 13 + 1) * w + Math.sin(t * 1.1 + i) * 18;
        const y = h * 0.88 - ((seededRand(i * 13 + 2) * h * 0.8 + t * 52) % (h * 0.8));
        const r = seededRand(i * 13 + 3) * 3.8 + 1.4;
        ctx.beginPath();
        ctx.arc(x, y, r, 0, Math.PI * 2);
        ctx.fill();
      }
      break;
    }
    case EnvBiome.CYBER_CITY: {
      for (let i = 0; i < 38; i++) {
        ctx.strokeStyle =
          i % 2 === 0 ? 'rgba(34, 211, 238, 0.45)' : 'rgba(244, 114, 182, 0.42)';
        ctx.lineWidth = 2;
        const x = seededRand(i * 17 + 1) * w;
        const y = (seededRand(i * 17 + 2) * h + t * 220) % h;
        ctx.beginPath();
        ctx.moveTo(x, y);
        ctx.lineTo(x, y + 26);
        ctx.stroke();
      }
      break;
    }
    case EnvBiome.STUDIO_CYCLORAMA: {
      ctx.fillStyle = 'rgba(226, 232, 240, 0.24)';
      for (let i = 0; i < 24; i++) {
        const x = seededRand(i * 19 + 1) * w + Math.sin(t * 0.7 + i) * 10;
        const y = seededRand(i * 19 + 2) * h * 0.8;
        const r = seededRand(i * 19 + 3) * 2.2 + 0.8;
        ctx.beginPath();
        ctx.arc(x, y, r, 0, Math.PI * 2);
        ctx.fill();
      }
      break;
    }
    default: {
      ctx.fillStyle = 'rgba(114, 239, 221, 0.68)';
      for (let i = 0; i < 50; i++) {
        const x = seededRand(i * 11 + 1) * w;
        const y = seededRand(i * 11 + 2) * h * 0.8;
        const r =
          (seededRand(i * 11 + 3) * 3.5 + 1.5) * (0.6 + 0.4 * Math.sin(t * 3 + i));
        ctx.beginPath();
        ctx.arc(x, y, r, 0, Math.PI * 2);
        ctx.fill();
      }
      break;
    }
  }
  ctx.restore();
}

function seededRand(seed: number): number {
  const x = Math.sin(seed * 12.9898 + 78.233) * 43758.5453;
  return x - Math.floor(x);
}

function drawBroadcastOverlayTemplate(
  ctx: CanvasRenderingContext2D,
  w: number,
  h: number,
  scene: DirectedScene,
  actor: ActorProfile,
  overlayConfig: OverlayTemplateConfig
): void {
  ctx.save();

  // 1. Top-Right Brand Logo Bug (safe zone: x 81%..96%, y 3%..11%)
  const brandLabel = (overlayConfig.brandText || 'BHARAT AI').trim().toUpperCase();
  ctx.font = `800 ${Math.max(13, Math.round(w * 0.02))}px "Plus Jakarta Sans", sans-serif`;
  const brandTextW = ctx.measureText(brandLabel).width;
  const bugW = Math.min(w * 0.18, Math.max(w * 0.13, brandTextW + 24));
  const bugH = Math.max(30, Math.round(h * 0.042));
  const bugX = w * 0.965 - bugW;
  const bugY = Math.round(h * 0.024);

  ctx.fillStyle = 'rgba(7, 11, 20, 0.86)';
  ctx.beginPath();
  drawRoundedRectPath(ctx, bugX, bugY, bugW, bugH, 7);
  ctx.fill();
  ctx.strokeStyle = actor.accentColor;
  ctx.lineWidth = 1.5;
  ctx.stroke();

  ctx.fillStyle = '#F8FAFC';
  ctx.textAlign = 'center';
  ctx.fillText(brandLabel, bugX + bugW * 0.5, bugY + bugH * 0.66);

  // 2. Bottom-Left Brand / Location Strip (safe zone: x 3%..33%, y 85.5%..93.5%)
  const stripPrimary = (overlayConfig.stripText || 'POCKET STUDIO').trim().toUpperCase();
  const stripSecondary = (scene.locationTitle || `SCENE ${scene.index}`).trim();
  const stripX = Math.round(w * 0.03);
  const stripW = Math.round(w * 0.32);
  const stripH = Math.max(46, Math.round(h * 0.068));
  const stripY = Math.round(h * 0.86);

  ctx.fillStyle = 'rgba(8, 12, 22, 0.88)';
  ctx.beginPath();
  drawRoundedRectPath(ctx, stripX, stripY, stripW, stripH, 8);
  ctx.fill();
  ctx.fillStyle = actor.accentColor;
  ctx.fillRect(stripX, stripY + 6, 4, stripH - 12);

  ctx.textAlign = 'left';
  ctx.fillStyle = actor.accentColor;
  ctx.font = `700 ${Math.max(11, Math.round(w * 0.015))}px "Plus Jakarta Sans", sans-serif`;
  ctx.fillText(stripPrimary.slice(0, 22), stripX + 12, stripY + Math.round(stripH * 0.42));
  ctx.fillStyle = '#E2E8F0';
  ctx.font = `600 ${Math.max(12, Math.round(w * 0.017))}px "Plus Jakarta Sans", sans-serif`;
  ctx.fillText(stripSecondary.slice(0, 22), stripX + 12, stripY + Math.round(stripH * 0.78));

  // 3. Bottom-Right Speaker / Actor Name Pill (safe zone: x 60%..97%, y 85.5%..93.5%)
  if (overlayConfig.showNamePill) {
    const pillW = Math.round(w * 0.36);
    const pillH = stripH;
    const pillX = Math.round(w * 0.97) - pillW;
    const pillY = stripY;

    ctx.fillStyle = 'rgba(8, 12, 22, 0.88)';
    ctx.beginPath();
    drawRoundedRectPath(ctx, pillX, pillY, pillW, pillH, 8);
    ctx.fill();
    ctx.strokeStyle = 'rgba(255, 255, 255, 0.14)';
    ctx.lineWidth = 1.2;
    ctx.stroke();

    ctx.fillStyle = actor.accentColor;
    ctx.beginPath();
    ctx.arc(pillX + 16, pillY + pillH * 0.5, 5, 0, Math.PI * 2);
    ctx.fill();

    ctx.textAlign = 'left';
    ctx.fillStyle = '#FFFFFF';
    ctx.font = `700 ${Math.max(13, Math.round(w * 0.019))}px "Plus Jakarta Sans", sans-serif`;
    ctx.fillText(actor.name, pillX + 28, pillY + Math.round(pillH * 0.46));

    ctx.fillStyle = '#94A3B8';
    ctx.font = `500 ${Math.max(11, Math.round(w * 0.015))}px "Plus Jakarta Sans", sans-serif`;
    ctx.fillText(
      `SHOT ${String(scene.index).padStart(2, '0')} · ${scene.emotion}`,
      pillX + 28,
      pillY + Math.round(pillH * 0.8)
    );
  }

  ctx.restore();
}

function drawWrappedSubtitles(
  ctx: CanvasRenderingContext2D,
  lines: string[],
  w: number,
  h: number,
  position: 'bottom' | 'lower_third' | 'top' | 'hidden',
  fontSize: number,
  lineH: number,
  bottomBarH: number,
  bottomLiftPx = 0
): void {
  if (lines.length === 0 || position === 'hidden') return;

  ctx.save();
  ctx.font = `600 ${fontSize}px "Noto Sans Devanagari", "DM Sans", sans-serif`;
  ctx.textAlign = 'center';

  if (position === 'bottom') {
    const bandH = Math.max(84, lines.length * lineH + 28);
    const barTop = h - bandH - bottomLiftPx - 14;
    ctx.fillStyle = 'rgba(7, 10, 18, 0.78)';
    ctx.beginPath();
    drawRoundedRectPath(ctx, 24, barTop, w - 48, bandH, 12);
    ctx.fill();
    ctx.strokeStyle = 'rgba(255, 255, 255, 0.12)';
    ctx.lineWidth = 1.2;
    ctx.stroke();

    const startY = barTop + 16 + fontSize * 0.85;
    ctx.fillStyle = '#FFFFFF';
    lines.forEach((line, idx) => {
      ctx.fillText(line, w * 0.5, startY + idx * lineH);
    });
  } else if (position === 'lower_third') {
    const maxLineW = Math.max(...lines.map((l) => ctx.measureText(l).width));
    const boxW = Math.min(w - 48, maxLineW + 52);
    const boxH = lines.length * lineH + 26;
    const boxX = (w - boxW) * 0.5;
    const boxY = h - boxH - bottomLiftPx - 28;

    ctx.fillStyle = 'rgba(7, 10, 18, 0.82)';
    ctx.beginPath();
    drawRoundedRectPath(ctx, boxX, boxY, boxW, boxH, 14);
    ctx.fill();
    ctx.strokeStyle = 'rgba(255, 255, 255, 0.14)';
    ctx.lineWidth = 1.5;
    ctx.stroke();

    ctx.fillStyle = '#FFFFFF';
    const startY = boxY + 18 + fontSize * 0.82;
    lines.forEach((line, idx) => {
      ctx.fillText(line, w * 0.5, startY + idx * lineH);
    });
  } else {
    // top caption bar cleanly below header strip
    const boxH = lines.length * lineH + 26;
    const boxY = 88;
    ctx.fillStyle = 'rgba(7, 10, 18, 0.78)';
    ctx.beginPath();
    drawRoundedRectPath(ctx, 24, boxY, w - 48, boxH, 12);
    ctx.fill();
    ctx.fillStyle = '#FFFFFF';
    const startY = boxY + 16 + fontSize * 0.82;
    lines.forEach((line, idx) => {
      ctx.fillText(line, w * 0.5, startY + idx * lineH);
    });
  }
  ctx.restore();
}

export async function loadPortraitImage(
  dataUrl?: string
): Promise<HTMLImageElement | null> {
  if (!dataUrl) return null;
  return new Promise((resolve) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => resolve(null);
    img.src = dataUrl;
  });
}

export async function loadDressCutoutCanvas(
  imageUrl?: string
): Promise<HTMLCanvasElement | null> {
  const img = await loadPortraitImage(imageUrl);
  if (!img) return null;

  const targetW = 450;
  const targetH = Math.round((img.height / Math.max(1, img.width)) * targetW);
  const canvas = document.createElement('canvas');
  canvas.width = targetW;
  canvas.height = targetH;
  const ctx = canvas.getContext('2d');
  if (!ctx) return null;

  ctx.drawImage(img, 0, 0, targetW, targetH);
  const imgData = ctx.getImageData(0, 0, targetW, targetH);
  const data = imgData.data;

  let bgR = 0;
  let bgG = 0;
  let bgB = 0;
  const samples = [
    [4, 4],
    [targetW - 5, 4],
    [4, Math.floor(targetH * 0.3)],
    [targetW - 5, Math.floor(targetH * 0.3)],
  ];
  for (const [sx, sy] of samples) {
    const p = (sy * targetW + sx) * 4;
    bgR += data[p];
    bgG += data[p + 1];
    bgB += data[p + 2];
  }
  bgR /= samples.length;
  bgG /= samples.length;
  bgB /= samples.length;

  const total = targetW * targetH;
  const visited = new Uint8Array(total);
  const queue = new Int32Array(total);
  let head = 0;
  let tail = 0;

  const tryPush = (idx: number) => {
    if (visited[idx]) return;
    const p = idx * 4;
    const dr = data[p] - bgR;
    const dg = data[p + 1] - bgG;
    const db = data[p + 2] - bgB;
    const dist = Math.sqrt(dr * dr + dg * dg + db * db);
    if (dist < 46) {
      visited[idx] = 1;
      queue[tail++] = idx;
    }
  };

  for (let x = 0; x < targetW; x++) {
    tryPush(x);
    tryPush((targetH - 1) * targetW + x);
  }
  for (let y = 0; y < targetH; y++) {
    tryPush(y * targetW);
    tryPush(y * targetW + (targetW - 1));
  }

  while (head < tail) {
    const idx = queue[head++];
    const p = idx * 4;
    const dr = data[p] - bgR;
    const dg = data[p + 1] - bgG;
    const db = data[p + 2] - bgB;
    const dist = Math.sqrt(dr * dr + dg * dg + db * db);

    if (dist < 28) {
      data[p + 3] = 0;
    } else {
      data[p + 3] = Math.round(((dist - 28) / 18) * 255);
    }

    const x = idx % targetW;
    const y = (idx - x) / targetW;
    if (x > 0) tryPush(idx - 1);
    if (x < targetW - 1) tryPush(idx + 1);
    if (y > 0) tryPush(idx - targetW);
    if (y < targetH - 1) tryPush(idx + targetW);
  }

  ctx.putImageData(imgData, 0, 0);
  return canvas;
}

export function resolveActorSidePortraitUrl(actor: ActorProfile): string | undefined {
  if (actor.sidePortraitDataUrl) return actor.sidePortraitDataUrl;
  const matchedPreset = HUMAN_AVATAR_PRESETS.find((p) => p.imageUrl === actor.portraitDataUrl);
  return matchedPreset?.sideImageUrl;
}

export async function recordMovieToVideoBlob(options: {
  scenes: DirectedScene[];
  cast: ActorProfile[];
  format: AspectFormat;
  framing: CameraFraming;
  gestureBoost?: number;
  audioStream: MediaStream | null;
  onStartAudioForScene: (scene: DirectedScene, actor: ActorProfile) => void;
  onProgress: (pct: number, sceneIndex: number) => void;
}): Promise<{ blob: Blob; mimeType: string }> {
  const {
    scenes,
    cast,
    format,
    framing,
    gestureBoost = 1.25,
    audioStream,
    onStartAudioForScene,
    onProgress,
  } = options;
  const { width, height } = ASPECT_CONFIG[format];

  const offCanvas = document.createElement('canvas');
  offCanvas.width = width;
  offCanvas.height = height;
  const renderer = new WebGlSceneRenderer(offCanvas);

  const portraitCache = new Map<string, HTMLImageElement | null>();
  const sidePortraitCache = new Map<string, HTMLImageElement | null>();
  for (const actor of cast) {
    portraitCache.set(actor.id, await loadPortraitImage(actor.portraitDataUrl));
    sidePortraitCache.set(actor.id, await loadPortraitImage(resolveActorSidePortraitUrl(actor)));
  }

  const cutoutCache = new Map<DressStyle, HTMLCanvasElement | null>();
  for (const [style, url] of Object.entries(DRESS_STUDIO_IMAGES)) {
    if (url) {
      cutoutCache.set(style as DressStyle, await loadDressCutoutCanvas(url));
    }
  }

  const hasGlbActors = cast.some((a) => a.avatarMode === 'GLB_3D' && a.glbModelUrl);
  const glbRenderer = hasGlbActors ? new ThreeGlbStageRenderer(width, height) : null;
  if (glbRenderer) {
    for (const actor of cast) {
      if (actor.avatarMode === 'GLB_3D' && actor.glbModelUrl) {
        await glbRenderer.ensureLoaded(actor.glbModelUrl);
      }
    }
  }

  const canvasStream = offCanvas.captureStream(30);
  const combinedStream = new MediaStream(canvasStream.getVideoTracks());
  if (audioStream) {
    audioStream.getAudioTracks().forEach((track) => combinedStream.addTrack(track));
  }

  const candidateTypes = [
    'video/webm;codecs=vp9,opus',
    'video/webm;codecs=vp8,opus',
    'video/webm',
  ];
  const mimeType =
    candidateTypes.find((t) => MediaRecorder.isTypeSupported(t)) ?? 'video/webm';

  const recorder = new MediaRecorder(combinedStream, {
    mimeType,
    videoBitsPerSecond: 4_000_000,
  });

  const chunks: BlobPart[] = [];
  recorder.ondataavailable = (e) => {
    if (e.data.size > 0) chunks.push(e.data);
  };

  const totalDurationMs = scenes.reduce((sum, s) => sum + s.durationMs, 0);

  return new Promise((resolve, reject) => {
    recorder.onerror = () => {
      renderer.dispose();
      glbRenderer?.dispose();
      reject(new Error('MediaRecorder failed during video encoding.'));
    };
    recorder.onstop = () => {
      renderer.dispose();
      glbRenderer?.dispose();
      resolve({ blob: new Blob(chunks, { type: mimeType }), mimeType });
    };

    recorder.start(250);

    let sceneIdx = 0;
    let sceneStartTime = performance.now();
    const globalStartTime = sceneStartTime;

    const firstActor =
      cast.find((a) => a.id === scenes[0].actorId) ?? cast[0];
    onStartAudioForScene(scenes[0], firstActor);

    const step = (now: number) => {
      const currentScene = scenes[sceneIdx];
      if (!currentScene) {
        recorder.stop();
        return;
      }

      const elapsedScene = now - sceneStartTime;
      if (elapsedScene >= currentScene.durationMs) {
        sceneIdx++;
        if (sceneIdx >= scenes.length) {
          onProgress(100, scenes.length);
          recorder.stop();
          return;
        }
        sceneStartTime = now;
        const nextScene = scenes[sceneIdx];
        const nextActor = cast.find((a) => a.id === nextScene.actorId) ?? cast[0];
        onStartAudioForScene(nextScene, nextActor);
      }

      const activeScene = scenes[sceneIdx];
      const activeActor = cast.find((a) => a.id === activeScene.actorId) ?? cast[0];
      const activeDress = activeScene.dressOverride ?? activeActor.dressStyle;
      const localElapsed = now - sceneStartTime;
      const progress = Math.min(1, Math.max(0, localElapsed / activeScene.durationMs));
      const exactFrame = (localElapsed / 1000) * 30;
      const maxIdx = Math.max(0, activeScene.lipSyncEnvelope.length - 1);
      const f0 = Math.min(maxIdx, Math.floor(exactFrame));
      const f1 = Math.min(maxIdx, f0 + 1);
      const frac = exactFrame - Math.floor(exactFrame);

      const amp0 = activeScene.lipSyncEnvelope[f0] ?? 0;
      const amp1 = activeScene.lipSyncEnvelope[f1] ?? amp0;
      const audioAmp = amp0 * (1 - frac) + amp1 * frac;

      const w0 = activeScene.visemeWidths?.[f0] ?? 0.95;
      const w1 = activeScene.visemeWidths?.[f1] ?? w0;
      const visemeWidth = w0 * (1 - frac) + w1 * frac;

      const timeSec = (now - globalStartTime) / 1000;
      let glbRenderCanvas: HTMLCanvasElement | null = null;
      if (glbRenderer && activeActor.avatarMode === 'GLB_3D' && activeActor.glbModelUrl) {
        if (!glbRenderer.isReadyFor(activeActor.glbModelUrl)) {
          void glbRenderer.ensureLoaded(activeActor.glbModelUrl);
        } else if (
          glbRenderer.renderFrame({
            actor: activeActor,
            gesture: activeScene.gesture,
            emotion: activeScene.emotion,
            biome: activeScene.biome,
            framing,
            timeSec,
            progress,
            audioAmp,
            visemeWidth,
            showRigOverlay: false,
            gestureBoost,
            sceneIndex: activeScene.index,
            cameraPanRange: activeScene.cameraPanRange,
            poseMode: activeScene.poseMode,
            poseSide: activeScene.poseSide,
            walkingDestination: activeScene.walkingDestination,
          })
        ) {
          glbRenderCanvas = glbRenderer.getCanvas();
        }
      }

      renderer.renderFrame({
        scene: activeScene,
        actor: activeActor,
        framing,
        portraitImg: portraitCache.get(activeActor.id) ?? null,
        sidePortraitImg: sidePortraitCache.get(activeActor.id) ?? null,
        dressCutoutCanvas: cutoutCache.get(activeDress) ?? null,
        poseSide: activeScene.poseSide,
        progress,
        timeSec,
        audioAmp,
        visemeWidth,
        glbRenderCanvas,
        gestureBoost,
      });

      const pct = Math.min(
        99,
        Math.round(((now - globalStartTime) / Math.max(1, totalDurationMs)) * 100)
      );
      onProgress(pct, activeScene.index);

      requestAnimationFrame(step);
    };

    requestAnimationFrame(step);
  });
}

async function fetchJsonSafe<T>(url: string, init: RequestInit): Promise<T> {
  const res = await fetch(url, init);
  const text = await res.text();
  let parsed: unknown = null;
  try {
    parsed = JSON.parse(text);
  } catch {
    throw new Error(
      `Server returned an unexpected response (${res.status}). Check that the backend is running.`
    );
  }
  if (!res.ok) {
    const errMsg =
      (parsed as { error?: string } | null)?.error ||
      `Render server error (${res.status}).`;
    throw new Error(errMsg);
  }
  return parsed as T;
}

export async function renderMovieToMp4ViaServer(options: {
  scenes: DirectedScene[];
  cast: ActorProfile[];
  format: AspectFormat;
  framing: CameraFraming;
  gestureBoost?: number;
  overlayConfig?: OverlayTemplateConfig;
  getAudioForScene?: (
    scene: DirectedScene
  ) => Promise<{ base64?: string; ext?: string }>;
  onProgress: (pct: number, label: string) => void;
}): Promise<{
  videoUrl: string;
  downloadUrl: string;
  mimeType: string;
  qa: VideoQaReport;
}> {
  const {
    scenes,
    cast,
    format,
    framing,
    gestureBoost = 1.25,
    overlayConfig,
    getAudioForScene,
    onProgress,
  } = options;
  const fps = 30;
  const { width, height } = ASPECT_CONFIG[format];

  onProgress(2, 'Loading portrait cutouts, 3D rigs, and audio tracks...');

  const offCanvas = document.createElement('canvas');
  offCanvas.width = width;
  offCanvas.height = height;
  const renderer = new WebGlSceneRenderer(offCanvas);

  const portraitCache = new Map<string, HTMLImageElement | null>();
  const sidePortraitCache = new Map<string, HTMLImageElement | null>();
  for (const actor of cast) {
    portraitCache.set(actor.id, await loadPortraitImage(actor.portraitDataUrl));
    sidePortraitCache.set(actor.id, await loadPortraitImage(resolveActorSidePortraitUrl(actor)));
  }

  const cutoutCache = new Map<DressStyle, HTMLCanvasElement | null>();
  for (const [style, url] of Object.entries(DRESS_STUDIO_IMAGES)) {
    if (url) {
      cutoutCache.set(style as DressStyle, await loadDressCutoutCanvas(url));
    }
  }

  const hasGlbActors = cast.some((a) => a.avatarMode === 'GLB_3D' && a.glbModelUrl);
  const glbRenderer = hasGlbActors ? new ThreeGlbStageRenderer(width, height) : null;
  if (glbRenderer) {
    for (const actor of cast) {
      if (actor.avatarMode === 'GLB_3D' && actor.glbModelUrl) {
        await glbRenderer.ensureLoaded(actor.glbModelUrl);
      }
    }
  }

  try {
    const resolvedAudio = await Promise.all(
      scenes.map(async (s) => {
        if (s.voiceAudioBase64) {
          return { base64: s.voiceAudioBase64, ext: 'wav' };
        }
        if (getAudioForScene) {
          return getAudioForScene(s);
        }
        return {};
      })
    );

    const anyCaptionActive = scenes.some((s) => (s.captionPosition ?? 'bottom') !== 'hidden');

    const { jobId } = await fetchJsonSafe<{ jobId: string }>('/api/render/start', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        width,
        height,
        fps,
        overlayEnabled: Boolean(overlayConfig?.enabled),
        captionEnabled: anyCaptionActive,
        scenes: scenes.map((s, idx) => ({
          index: s.index,
          dialogue: s.dialogue,
          captionText: s.captionText,
          captionCues: s.captionCues,
          captionPosition: s.captionPosition ?? 'bottom',
          locationTitle: s.locationTitle,
          durationSec: Math.max(1.5, s.durationMs / 1000),
          biome: s.biome,
          transitionIn: s.transitionIn ?? (idx === 0 ? 'cut' : 'cut'),
          audioBase64: resolvedAudio[idx]?.base64,
          audioExt: resolvedAudio[idx]?.ext ?? 'wav',
          clipVideoBase64: s.clipVideoBase64,
        })),
      }),
    });

    const totalFrameBudget = scenes.reduce(
      (sum, s) =>
        sum + (s.clipVideoBase64 ? 10 : Math.max(45, Math.round((s.durationMs / 1000) * fps))),
      0
    );
    let uploadedFrames = 0;
    let timeCursorSec = 0;

    for (let sIdx = 0; sIdx < scenes.length; sIdx++) {
      const scene = scenes[sIdx];
      const actor = cast.find((a) => a.id === scene.actorId) ?? cast[0];
      const activeDress = scene.dressOverride ?? actor.dressStyle;
      const durationSec = Math.max(1.5, scene.durationMs / 1000);

      if (scene.clipVideoBase64) {
        uploadedFrames += 10;
        timeCursorSec += durationSec;
        const pct = Math.min(82, 6 + Math.round((uploadedFrames / Math.max(1, totalFrameBudget)) * 76));
        onProgress(pct, `Prepared external video clip for Scene ${scene.index}...`);
        continue;
      }

      const sceneFrames = Math.max(45, Math.round(durationSec * fps));
      const BATCH_SIZE = 15;

      for (let startF = 0; startF < sceneFrames; startF += BATCH_SIZE) {
        const batchFrames: string[] = [];
        const endF = Math.min(sceneFrames, startF + BATCH_SIZE);

        for (let f = startF; f < endF; f++) {
          const progress = sceneFrames > 1 ? f / (sceneFrames - 1) : 0;
          const timeSec = timeCursorSec + f / fps;

          const maxIdx = Math.max(0, scene.lipSyncEnvelope.length - 1);
          const f0 = Math.min(maxIdx, f);
          const f1 = Math.min(maxIdx, f + 1);
          const audioAmp = (scene.lipSyncEnvelope[f0] ?? 0) * 0.5 + (scene.lipSyncEnvelope[f1] ?? 0) * 0.5;
          const visemeWidth = scene.visemeWidths?.[f0] ?? 0.95;

          let glbRenderCanvas: HTMLCanvasElement | null = null;
          if (glbRenderer && actor.avatarMode === 'GLB_3D' && actor.glbModelUrl) {
            if (glbRenderer.isReadyFor(actor.glbModelUrl)) {
              if (
                glbRenderer.renderFrame({
                  actor,
                  gesture: scene.gesture,
                  emotion: scene.emotion,
                  biome: scene.biome,
                  framing,
                  timeSec,
                  progress,
                  audioAmp,
                  visemeWidth,
                  showRigOverlay: false,
                  gestureBoost,
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
          }

          renderer.renderFrame({
            scene,
            actor,
            framing,
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
            gestureBoost,
            overlayConfig,
            hideCanvasCaptions: true,
          });

          const jpegDataUrl = offCanvas.toDataURL('image/jpeg', 0.9);
          batchFrames.push(jpegDataUrl.slice(jpegDataUrl.indexOf(',') + 1));
        }

        await fetchJsonSafe<{ saved: number }>(`/api/render/${jobId}/scene-frames`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            sceneIndex: sIdx,
            startFrame: startF,
            frames: batchFrames,
          }),
        });

        uploadedFrames += batchFrames.length;
        const pct = Math.min(
          84,
          6 + Math.round((uploadedFrames / Math.max(1, totalFrameBudget)) * 78)
        );
        onProgress(
          pct,
          `Rendering Scene ${scene.index}/${scenes.length} · ${fSafeLabel(endF, sceneFrames)} (${width}×${height} @ 30fps)`
        );
        await new Promise((r) => setTimeout(r, 0));
      }

      timeCursorSec += durationSec;
    }

    onProgress(90, 'Muxing H.264 High MP4, AAC -17 LUFS audio & Devanagari captions...');
    const result = await fetchJsonSafe<{
      videoUrl: string;
      mimeType: string;
      qa: VideoQaReport;
    }>(`/api/render/${jobId}/finalize`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({}),
    });

    onProgress(100, 'MP4 master & quality check complete');
    return {
      videoUrl: result.videoUrl,
      downloadUrl: `${result.videoUrl}?download=1`,
      mimeType: result.mimeType || 'video/mp4',
      qa: result.qa,
    };
  } finally {
    renderer.dispose();
    glbRenderer?.dispose();
  }
}

function fSafeLabel(cur: number, total: number): string {
  return `frame ${cur}/${total}`;
}
