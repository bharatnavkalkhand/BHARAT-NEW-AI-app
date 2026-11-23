import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { GLTFExporter } from 'three/addons/exporters/GLTFExporter.js';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';
import {
  ActorProfile,
  CameraFraming,
  CharacterPoseMode,
  DressStyle,
  EmotionMood,
  EnvBiome,
  GestureAction,
  PoseSide,
  WalkingDestination,
} from './types';
import {
  computeBiomeScenePath,
  computeCoMAndZmpBalance,
  evaluateCubicBezierEase,
  evaluateSceneActionBeats,
  REALISM_BEZIER_CURVES,
  SpringDamperState,
  stepSpringDamper,
} from './rigAndCalibration';

export interface GlbExportResult {
  blob: Blob;
  url: string;
  fileName: string;
  boneCount: number;
  morphCount: number;
}

export interface GlbInspectResult {
  boneCount: number;
  morphCount: number;
  morphNames: string[];
  hasHumanoidRig: boolean;
}

type HumanoidBoneKey =
  | 'Hips'
  | 'Spine'
  | 'Spine1'
  | 'Neck'
  | 'Head'
  | 'LeftShoulder'
  | 'LeftArm'
  | 'LeftForeArm'
  | 'LeftHand'
  | 'RightShoulder'
  | 'RightArm'
  | 'RightForeArm'
  | 'RightHand'
  | 'LeftUpLeg'
  | 'LeftLeg'
  | 'LeftFoot'
  | 'RightUpLeg'
  | 'RightLeg'
  | 'RightFoot';

const HUMANOID_BONE_ALIASES: Record<HumanoidBoneKey, RegExp[]> = {
  Hips: [/^(mixamorig[:_]?)?hips$/i, /^pelvis$/i, /^root$/i],
  Spine: [/^(mixamorig[:_]?)?spine$/i, /^spine[_.]?0?1$/i],
  Spine1: [/^(mixamorig[:_]?)?spine[12]$/i, /^chest$/i, /^upperchest$/i],
  Neck: [/^(mixamorig[:_]?)?neck$/i],
  Head: [/^(mixamorig[:_]?)?head$/i],
  LeftShoulder: [/^(mixamorig[:_]?)?leftshoulder$/i, /^shoulder[_.]?l$/i, /^clavicle[_.]?l$/i],
  LeftArm: [/^(mixamorig[:_]?)?leftarm$/i, /^leftupperarm$/i, /^upperarm[_.]?l$/i, /^arm[_.]?l$/i],
  LeftForeArm: [/^(mixamorig[:_]?)?leftforearm$/i, /^leftlowerarm$/i, /^lowerarm[_.]?l$/i, /^forearm[_.]?l$/i],
  LeftHand: [/^(mixamorig[:_]?)?lefthand$/i, /^hand[_.]?l$/i],
  RightShoulder: [/^(mixamorig[:_]?)?rightshoulder$/i, /^shoulder[_.]?r$/i, /^clavicle[_.]?r$/i],
  RightArm: [/^(mixamorig[:_]?)?rightarm$/i, /^rightupperarm$/i, /^upperarm[_.]?r$/i, /^arm[_.]?r$/i],
  RightForeArm: [/^(mixamorig[:_]?)?rightforearm$/i, /^rightlowerarm$/i, /^lowerarm[_.]?r$/i, /^forearm[_.]?r$/i],
  RightHand: [/^(mixamorig[:_]?)?righthand$/i, /^hand[_.]?r$/i],
  LeftUpLeg: [/^(mixamorig[:_]?)?leftupleg$/i, /^leftthigh$/i, /^thigh[_.]?l$/i, /^upperleg[_.]?l$/i],
  LeftLeg: [/^(mixamorig[:_]?)?leftleg$/i, /^leftshin$/i, /^calf[_.]?l$/i, /^lowerleg[_.]?l$/i, /^shin[_.]?l$/i],
  LeftFoot: [/^(mixamorig[:_]?)?leftfoot$/i, /^foot[_.]?l$/i],
  RightUpLeg: [/^(mixamorig[:_]?)?rightupleg$/i, /^rightthigh$/i, /^thigh[_.]?r$/i, /^upperleg[_.]?r$/i],
  RightLeg: [/^(mixamorig[:_]?)?rightleg$/i, /^rightshin$/i, /^calf[_.]?r$/i, /^lowerleg[_.]?r$/i, /^shin[_.]?r$/i],
  RightFoot: [/^(mixamorig[:_]?)?rightfoot$/i, /^foot[_.]?r$/i],
};

// Reusable module-scope math helpers (zero GC inside render loop)
const _euler = new THREE.Euler();
const _deltaQuat = new THREE.Quaternion();
const _targetQuat = new THREE.Quaternion();
const _box = new THREE.Box3();
const _size = new THREE.Vector3();
const _center = new THREE.Vector3();

function detectSoftwareGl(): boolean {
  try {
    const probe = document.createElement('canvas');
    const gl = probe.getContext('webgl2') || probe.getContext('webgl');
    if (!gl) return true;
    const ext = gl.getExtension('WEBGL_debug_renderer_info');
    const param = ext ? ext.UNMASKED_RENDERER_WEBGL : gl.RENDERER;
    const gpu = String(gl.getParameter(param));
    gl.getExtension('WEBGL_lose_context')?.loseContext();
    return /SwiftShader|llvmpipe|softpipe|Software|Basic Render/i.test(gpu);
  } catch {
    return false;
  }
}

function clamp(v: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, v));
}

function getOutfitPalette(dressStyle: DressStyle, robeColor: string, accentColor: string): {
  primary: string;
  secondary: string;
  trousers: string;
  trim: string;
  metalness: number;
  roughness: number;
} {
  switch (dressStyle) {
    case DressStyle.ROYAL_KURTA:
      return {
        primary: robeColor || '#1B3B6F',
        secondary: '#D4A853',
        trousers: '#E6DEC8',
        trim: accentColor,
        metalness: 0.14,
        roughness: 0.58,
      };
    case DressStyle.FESTIVE_SAREE:
      return {
        primary: robeColor || '#5A189A',
        secondary: '#E2B74B',
        trousers: '#4A154B',
        trim: accentColor,
        metalness: 0.2,
        roughness: 0.48,
      };
    case DressStyle.WARRIOR_ARMOR:
      return {
        primary: '#2A3342',
        secondary: '#9CA3AF',
        trousers: '#1A202C',
        trim: accentColor,
        metalness: 0.68,
        roughness: 0.34,
      };
    case DressStyle.FORMAL_COAT:
      return {
        primary: '#1E293B',
        secondary: '#0F172A',
        trousers: '#111827',
        trim: accentColor,
        metalness: 0.08,
        roughness: 0.65,
      };
    default:
      return {
        primary: robeColor || '#273447',
        secondary: '#475569',
        trousers: '#1F2937',
        trim: accentColor,
        metalness: 0.1,
        roughness: 0.62,
      };
  }
}

async function createSelfieHeadTexture(actor: ActorProfile): Promise<THREE.CanvasTexture> {
  const size = 512;
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext('2d');
  if (!ctx) {
    const fallback = new THREE.CanvasTexture(canvas);
    fallback.colorSpace = THREE.SRGBColorSpace;
    return fallback;
  }

  // Base skin fill across full UV sheet
  ctx.fillStyle = actor.skinTone || '#D99B72';
  ctx.fillRect(0, 0, size, size);

  // Subtle shading gradient around cheeks, jawline, and neck seam
  const skinShade = ctx.createLinearGradient(0, 0, 0, size);
  skinShade.addColorStop(0, 'rgba(0,0,0,0.08)');
  skinShade.addColorStop(0.48, 'rgba(255,255,255,0.04)');
  skinShade.addColorStop(1, 'rgba(0,0,0,0.22)');
  ctx.fillStyle = skinShade;
  ctx.fillRect(0, 0, size, size);

  // Painted stylized hair cap on crown (top 22%) and back of cranium (u > 0.56 or u < 0.04)
  ctx.fillStyle = '#181417';
  ctx.fillRect(0, 0, size, size * 0.21);
  ctx.fillRect(size * 0.52, 0, size * 0.48, size * 0.78);
  ctx.fillRect(0, 0, size * 0.04, size * 0.72);
  if (actor.hairStyle === 'WAVY_LONG') {
    ctx.fillRect(size * 0.46, size * 0.18, size * 0.54, size * 0.82);
  }

  // Load selfie image if present
  if (actor.portraitDataUrl) {
    const img = await new Promise<HTMLImageElement | null>((resolve) => {
      const el = new Image();
      el.onload = () => resolve(el);
      el.onerror = () => resolve(null);
      el.src = actor.portraitDataUrl!;
    });

    if (img) {
      // Sphere UV front center is u = 0.25 -> x = 128 on 512px sheet
      const faceCenterX = size * 0.25;
      const faceCenterY = size * (0.48 - actor.eyeLineOffset * 0.35);
      const faceRx = size * 0.175;
      const faceRy = size * 0.245;

      const isTallPortrait = img.height / Math.max(1, img.width) > 1.12;
      const srcW = isTallPortrait ? img.width * 0.36 : img.width * 0.44;
      const srcH = isTallPortrait ? img.height * 0.24 : img.height * 0.44;
      const zoom = clamp(actor.faceZoom || 1, 0.75, 1.35);
      const cropW = srcW / zoom;
      const cropH = srcH / zoom;
      const srcX = (img.width - cropW) * 0.5;
      const srcY =
        (isTallPortrait ? img.height * 0.065 : img.height * 0.07) +
        actor.eyeLineOffset * img.height * 0.14;

      const tmp = document.createElement('canvas');
      tmp.width = size;
      tmp.height = size;
      const tctx = tmp.getContext('2d');
      if (tctx) {
        tctx.save();
        tctx.beginPath();
        tctx.ellipse(faceCenterX, faceCenterY, faceRx, faceRy, 0, 0, Math.PI * 2);
        tctx.clip();
        tctx.drawImage(
          img,
          clamp(srcX, 0, Math.max(0, img.width - cropW)),
          clamp(srcY, 0, Math.max(0, img.height - cropH)),
          Math.min(cropW, img.width),
          Math.min(cropH, img.height),
          faceCenterX - faceRx,
          faceCenterY - faceRy,
          faceRx * 2,
          faceRy * 2
        );
        tctx.restore();

        // Feather outer edge of face mask cleanly into skin tone
        const maskGrad = tctx.createRadialGradient(
          faceCenterX,
          faceCenterY,
          faceRx * 0.62,
          faceCenterX,
          faceCenterY,
          faceRy * 0.98
        );
        maskGrad.addColorStop(0, 'rgba(0,0,0,1)');
        maskGrad.addColorStop(0.76, 'rgba(0,0,0,0.88)');
        maskGrad.addColorStop(1, 'rgba(0,0,0,0)');
        tctx.globalCompositeOperation = 'destination-in';
        tctx.fillStyle = maskGrad;
        tctx.fillRect(0, 0, size, size);
        tctx.globalCompositeOperation = 'source-over';

        ctx.drawImage(tmp, 0, 0);
      }
    }
  } else {
    // Clean facial features for non-selfie anatomy actors
    const cx = size * 0.25;
    const cy = size * 0.46;
    ctx.fillStyle = '#1E1B18';
    ctx.beginPath();
    ctx.ellipse(cx - 26, cy - 12, 10, 6, 0, 0, Math.PI * 2);
    ctx.ellipse(cx + 26, cy - 12, 10, 6, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = '#8F4242';
    ctx.beginPath();
    ctx.ellipse(cx, cy + 44, 18, 6, 0, 0, Math.PI * 2);
    ctx.fill();
  }

  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.needsUpdate = true;
  return tex;
}

interface SkinnedPartSpec {
  geometry: THREE.BufferGeometry;
  boneA: number;
  boneB: number;
  axis: 'x' | 'y';
  minCoord: number;
  maxCoord: number;
  materialIndex: number;
}

function assembleSkinnedBodyGeometry(parts: SkinnedPartSpec[]): THREE.BufferGeometry {
  const nonIndexedParts = parts.map((p) => {
    const g = p.geometry.index ? p.geometry.toNonIndexed() : p.geometry.clone();
    if (!g.getAttribute('normal')) g.computeVertexNormals();
    return { ...p, geometry: g };
  });

  let totalVerts = 0;
  for (const p of nonIndexedParts) {
    totalVerts += p.geometry.getAttribute('position').count;
  }

  const positions = new Float32Array(totalVerts * 3);
  const normals = new Float32Array(totalVerts * 3);
  const uvs = new Float32Array(totalVerts * 2);
  const skinIndices = new Uint16Array(totalVerts * 4);
  const skinWeights = new Float32Array(totalVerts * 4);

  const merged = new THREE.BufferGeometry();
  let vertOffset = 0;

  for (const part of nonIndexedParts) {
    const posAttr = part.geometry.getAttribute('position');
    const normAttr = part.geometry.getAttribute('normal');
    const uvAttr = part.geometry.getAttribute('uv');
    const count = posAttr.count;
    const span = Math.max(1e-4, part.maxCoord - part.minCoord);

    for (let i = 0; i < count; i++) {
      const dst = vertOffset + i;
      const vx = posAttr.getX(i);
      const vy = posAttr.getY(i);
      const vz = posAttr.getZ(i);

      positions[dst * 3] = vx;
      positions[dst * 3 + 1] = vy;
      positions[dst * 3 + 2] = vz;

      normals[dst * 3] = normAttr ? normAttr.getX(i) : 0;
      normals[dst * 3 + 1] = normAttr ? normAttr.getY(i) : 1;
      normals[dst * 3 + 2] = normAttr ? normAttr.getZ(i) : 0;

      uvs[dst * 2] = uvAttr ? uvAttr.getX(i) : 0.5;
      uvs[dst * 2 + 1] = uvAttr ? uvAttr.getY(i) : 0.5;

      const coord = part.axis === 'x' ? vx : vy;
      const t = clamp((coord - part.minCoord) / span, 0, 1);
      skinIndices[dst * 4] = part.boneA;
      skinIndices[dst * 4 + 1] = part.boneB;
      skinIndices[dst * 4 + 2] = 0;
      skinIndices[dst * 4 + 3] = 0;

      skinWeights[dst * 4] = 1 - t;
      skinWeights[dst * 4 + 1] = t;
      skinWeights[dst * 4 + 2] = 0;
      skinWeights[dst * 4 + 3] = 0;
    }

    merged.addGroup(vertOffset, count, part.materialIndex);
    vertOffset += count;
    part.geometry.dispose();
  }

  merged.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  merged.setAttribute('normal', new THREE.BufferAttribute(normals, 3));
  merged.setAttribute('uv', new THREE.BufferAttribute(uvs, 2));
  merged.setAttribute('skinIndex', new THREE.Uint16BufferAttribute(skinIndices, 4));
  merged.setAttribute('skinWeight', new THREE.Float32BufferAttribute(skinWeights, 4));
  merged.computeBoundingBox();
  merged.computeBoundingSphere();

  return merged;
}

function buildMorphTargetHeadGeometry(
  headWorldY: number,
  neckBoneIndex: number,
  headBoneIndex: number
): THREE.BufferGeometry {
  const sphere = new THREE.SphereGeometry(0.112, 32, 24);
  const geo = sphere.toNonIndexed();
  sphere.dispose();

  const pos = geo.getAttribute('position');
  const count = pos.count;

  const skinIndices = new Uint16Array(count * 4);
  const skinWeights = new Float32Array(count * 4);

  const jawDelta = new Float32Array(count * 3);
  const smileDelta = new Float32Array(count * 3);
  const blinkLeftDelta = new Float32Array(count * 3);
  const blinkRightDelta = new Float32Array(count * 3);
  const browUpDelta = new Float32Array(count * 3);

  for (let i = 0; i < count; i++) {
    let x = pos.getX(i);
    let y = pos.getY(i) * 1.18; // Human cranial aspect
    let z = pos.getZ(i) * 1.04;

    // Subtle jawline taper on lower half of face
    if (y < 0) {
      const chinT = clamp(-y / 0.13, 0, 1);
      x *= 1 - chinT * 0.24;
      if (z > 0) z *= 1 + chinT * 0.08;
    }

    pos.setXYZ(i, x, y + headWorldY, z);

    // Skinning weight between Neck & Head
    const headBlend = clamp((y + 0.11) / 0.07, 0, 1);
    skinIndices[i * 4] = neckBoneIndex;
    skinIndices[i * 4 + 1] = headBoneIndex;
    skinWeights[i * 4] = 1 - headBlend;
    skinWeights[i * 4 + 1] = headBlend;

    // 0: jawOpen (lower jaw + lips drop)
    if (y < -0.015 && z > 0.018) {
      const w = clamp((-y - 0.015) / 0.085, 0, 1) * clamp((z - 0.018) / 0.075, 0, 1);
      jawDelta[i * 3 + 1] = -0.026 * w;
      jawDelta[i * 3 + 2] = -0.008 * w;
    }

    // 1: mouthSmile (mouth corners widen & lift)
    if (y > -0.078 && y < -0.018 && z > 0.025 && Math.abs(x) > 0.016) {
      const edgeW = clamp((Math.abs(x) - 0.016) / 0.045, 0, 1);
      const vertW = 1 - Math.abs(y + 0.048) / 0.032;
      const w = Math.max(0, edgeW * vertW);
      smileDelta[i * 3] = Math.sign(x) * 0.008 * w;
      smileDelta[i * 3 + 1] = 0.012 * w;
    }

    // 2: eyeBlinkLeft
    if (x > 0.008 && x < 0.068 && y > 0.005 && y < 0.052 && z > 0.045) {
      const dx = (x - 0.036) / 0.032;
      const dy = (y - 0.028) / 0.024;
      const w = Math.max(0, 1 - dx * dx - dy * dy);
      blinkLeftDelta[i * 3 + 1] = -0.012 * w;
    }

    // 3: eyeBlinkRight
    if (x < -0.008 && x > -0.068 && y > 0.005 && y < 0.052 && z > 0.045) {
      const dx = (x + 0.036) / 0.032;
      const dy = (y - 0.028) / 0.024;
      const w = Math.max(0, 1 - dx * dx - dy * dy);
      blinkRightDelta[i * 3 + 1] = -0.012 * w;
    }

    // 4: browInnerUp
    if (Math.abs(x) < 0.062 && y > 0.034 && y < 0.078 && z > 0.042) {
      const w = (1 - Math.abs(x) / 0.065) * clamp((z - 0.042) / 0.05, 0, 1);
      browUpDelta[i * 3 + 1] = 0.011 * Math.max(0, w);
    }
  }

  geo.computeVertexNormals();
  geo.setAttribute('skinIndex', new THREE.Uint16BufferAttribute(skinIndices, 4));
  geo.setAttribute('skinWeight', new THREE.Float32BufferAttribute(skinWeights, 4));

  geo.morphTargetsRelative = true;
  geo.morphAttributes.position = [
    new THREE.Float32BufferAttribute(jawDelta, 3),
    new THREE.Float32BufferAttribute(smileDelta, 3),
    new THREE.Float32BufferAttribute(blinkLeftDelta, 3),
    new THREE.Float32BufferAttribute(blinkRightDelta, 3),
    new THREE.Float32BufferAttribute(browUpDelta, 3),
  ];

  geo.computeBoundingBox();
  geo.computeBoundingSphere();
  return geo;
}

/**
 * Converts a single actor selfie/portrait + calibrated rig proportions into a
 * ready-to-use, 19-bone humanoid SkinnedMesh .glb with 5 facial morph targets.
 */
export async function generateSelfieRiggedGlb(actor: ActorProfile): Promise<GlbExportResult> {
  const rig = actor.rig;
  const buildMul =
    actor.bodyBuild === 'BROAD' ? 1.14 : actor.bodyBuild === 'SLIM' ? 0.88 : 1.0;
  const femaleFactor = actor.isFemale ? 0.92 : 1.0;

  const hScale = clamp(actor.heightScale || 1.0, 0.88, 1.14);
  const legLen = 0.82 * rig.legLengthRatio * hScale;
  const torsoLen = 0.52 * rig.torsoLengthRatio * hScale;
  const armScale = rig.armLengthRatio * hScale;
  const shoulderHalf = 0.195 * rig.shoulderWidthRatio * buildMul * femaleFactor;
  const hipHalf = 0.098 * rig.hipWidthRatio * (actor.isFemale ? 1.08 : 0.98) * buildMul;

  const hipY = legLen;
  const spineY = hipY + torsoLen * 0.28;
  const chestY = hipY + torsoLen * 0.68;
  const neckY = hipY + torsoLen + 0.03;
  const headCenterY = neckY + 0.155;

  const kneeY = legLen * 0.52;
  const footY = 0.06;

  const upperArmLen = 0.27 * armScale;
  const foreArmLen = 0.25 * armScale;
  const shoulderJointX = shoulderHalf;
  const elbowX = shoulderJointX + upperArmLen;
  const wristX = elbowX + foreArmLen;

  // Build 19-bone Mixamo/ReadyPlayerMe compatible hierarchy
  const boneNames: HumanoidBoneKey[] = [
    'Hips', // 0
    'Spine', // 1
    'Spine1', // 2
    'Neck', // 3
    'Head', // 4
    'LeftShoulder', // 5
    'LeftArm', // 6
    'LeftForeArm', // 7
    'LeftHand', // 8
    'RightShoulder', // 9
    'RightArm', // 10
    'RightForeArm', // 11
    'RightHand', // 12
    'LeftUpLeg', // 13
    'LeftLeg', // 14
    'LeftFoot', // 15
    'RightUpLeg', // 16
    'RightLeg', // 17
    'RightFoot', // 18
  ];

  const bones = boneNames.map((n) => {
    const b = new THREE.Bone();
    b.name = n;
    return b;
  });

  // Bone indices
  const B_HIPS = 0;
  const B_SPINE = 1;
  const B_CHEST = 2;
  const B_NECK = 3;
  const B_HEAD = 4;
  const B_L_SH = 5;
  const B_L_ARM = 6;
  const B_L_FORE = 7;
  const B_L_HAND = 8;
  const B_R_SH = 9;
  const B_R_ARM = 10;
  const B_R_FORE = 11;
  const B_R_HAND = 12;
  const B_L_UPLEG = 13;
  const B_L_LEG = 14;
  const B_L_FOOT = 15;
  const B_R_UPLEG = 16;
  const B_R_LEG = 17;
  const B_R_FOOT = 18;

  // Set local bone positions (T-pose along X for arms, vertical Y for spine & legs)
  bones[B_HIPS].position.set(0, hipY, 0);
  bones[B_SPINE].position.set(0, spineY - hipY, 0);
  bones[B_CHEST].position.set(0, chestY - spineY, 0);
  bones[B_NECK].position.set(0, neckY - chestY, 0);
  bones[B_HEAD].position.set(0, headCenterY - neckY, 0);

  bones[B_L_SH].position.set(shoulderJointX * 0.42, neckY - chestY - 0.04, 0);
  bones[B_L_ARM].position.set(shoulderJointX * 0.58, 0, 0);
  bones[B_L_FORE].position.set(upperArmLen, 0, 0);
  bones[B_L_HAND].position.set(foreArmLen, 0, 0);

  bones[B_R_SH].position.set(-shoulderJointX * 0.42, neckY - chestY - 0.04, 0);
  bones[B_R_ARM].position.set(-shoulderJointX * 0.58, 0, 0);
  bones[B_R_FORE].position.set(-upperArmLen, 0, 0);
  bones[B_R_HAND].position.set(-foreArmLen, 0, 0);

  bones[B_L_UPLEG].position.set(hipHalf, 0, 0);
  bones[B_L_LEG].position.set(0, kneeY - hipY, 0);
  bones[B_L_FOOT].position.set(0, footY - kneeY, 0);

  bones[B_R_UPLEG].position.set(-hipHalf, 0, 0);
  bones[B_R_LEG].position.set(0, kneeY - hipY, 0);
  bones[B_R_FOOT].position.set(0, footY - kneeY, 0);

  // Parent hierarchy
  bones[B_HIPS].add(bones[B_SPINE]);
  bones[B_SPINE].add(bones[B_CHEST]);
  bones[B_CHEST].add(bones[B_NECK]);
  bones[B_NECK].add(bones[B_HEAD]);

  bones[B_CHEST].add(bones[B_L_SH]);
  bones[B_L_SH].add(bones[B_L_ARM]);
  bones[B_L_ARM].add(bones[B_L_FORE]);
  bones[B_L_FORE].add(bones[B_L_HAND]);

  bones[B_CHEST].add(bones[B_R_SH]);
  bones[B_R_SH].add(bones[B_R_ARM]);
  bones[B_R_ARM].add(bones[B_R_FORE]);
  bones[B_R_FORE].add(bones[B_R_HAND]);

  bones[B_HIPS].add(bones[B_L_UPLEG]);
  bones[B_L_UPLEG].add(bones[B_L_LEG]);
  bones[B_L_LEG].add(bones[B_L_FOOT]);

  bones[B_HIPS].add(bones[B_R_UPLEG]);
  bones[B_R_UPLEG].add(bones[B_R_LEG]);
  bones[B_R_LEG].add(bones[B_R_FOOT]);

  // Helper to create translated/rotated limb segments in T-pose world coords
  const makeCyl = (
    rTop: number,
    rBot: number,
    len: number,
    tx: number,
    ty: number,
    tz: number,
    rotZ = 0
  ) => {
    const g = new THREE.CylinderGeometry(rTop, rBot, len, 18, 8);
    if (rotZ !== 0) g.rotateZ(rotZ);
    g.translate(tx, ty, tz);
    return g;
  };

  const torsoW = shoulderHalf * 0.92;
  const waistW = hipHalf * 1.14;
  const armY = neckY - 0.04;

  // Material slots: 0=outfitPrimary, 1=outfitSecondary, 2=trousers, 3=skin, 4=boots/trim
  const bodyParts: SkinnedPartSpec[] = [
    // Pelvis & Lower Torso
    {
      geometry: makeCyl(waistW, hipHalf * 1.22, torsoLen * 0.34, 0, hipY + torsoLen * 0.14, 0),
      boneA: B_HIPS,
      boneB: B_SPINE,
      axis: 'y',
      minCoord: hipY,
      maxCoord: spineY + 0.06,
      materialIndex: 1,
    },
    // Chest / Upper Garment
    {
      geometry: makeCyl(torsoW, waistW * 0.98, torsoLen * 0.7, 0, hipY + torsoLen * 0.64, 0),
      boneA: B_SPINE,
      boneB: B_CHEST,
      axis: 'y',
      minCoord: spineY,
      maxCoord: neckY - 0.02,
      materialIndex: 0,
    },
    // Neck Column
    {
      geometry: makeCyl(0.048, 0.058, 0.12, 0, neckY + 0.03, 0),
      boneA: B_CHEST,
      boneB: B_NECK,
      axis: 'y',
      minCoord: neckY - 0.03,
      maxCoord: neckY + 0.09,
      materialIndex: 3,
    },
    // Left Upper Arm
    {
      geometry: makeCyl(0.056 * buildMul, 0.044 * buildMul, upperArmLen, shoulderJointX + upperArmLen * 0.5, armY, 0, -Math.PI / 2),
      boneA: B_L_ARM,
      boneB: B_L_FORE,
      axis: 'x',
      minCoord: shoulderJointX,
      maxCoord: elbowX,
      materialIndex: 0,
    },
    // Left Forearm
    {
      geometry: makeCyl(0.042 * buildMul, 0.032 * buildMul, foreArmLen, elbowX + foreArmLen * 0.5, armY, 0, -Math.PI / 2),
      boneA: B_L_FORE,
      boneB: B_L_HAND,
      axis: 'x',
      minCoord: elbowX,
      maxCoord: wristX,
      materialIndex: 3,
    },
    // Left Hand
    {
      geometry: (() => {
        const g = new THREE.BoxGeometry(0.11, 0.028, 0.072);
        g.translate(wristX + 0.055, armY, 0);
        return g;
      })(),
      boneA: B_L_HAND,
      boneB: B_L_HAND,
      axis: 'x',
      minCoord: wristX,
      maxCoord: wristX + 0.12,
      materialIndex: 3,
    },
    // Right Upper Arm
    {
      geometry: makeCyl(0.044 * buildMul, 0.056 * buildMul, upperArmLen, -(shoulderJointX + upperArmLen * 0.5), armY, 0, -Math.PI / 2),
      boneA: B_R_FORE,
      boneB: B_R_ARM,
      axis: 'x',
      minCoord: -elbowX,
      maxCoord: -shoulderJointX,
      materialIndex: 0,
    },
    // Right Forearm
    {
      geometry: makeCyl(0.032 * buildMul, 0.042 * buildMul, foreArmLen, -(elbowX + foreArmLen * 0.5), armY, 0, -Math.PI / 2),
      boneA: B_R_HAND,
      boneB: B_R_FORE,
      axis: 'x',
      minCoord: -wristX,
      maxCoord: -elbowX,
      materialIndex: 3,
    },
    // Right Hand
    {
      geometry: (() => {
        const g = new THREE.BoxGeometry(0.11, 0.028, 0.072);
        g.translate(-(wristX + 0.055), armY, 0);
        return g;
      })(),
      boneA: B_R_HAND,
      boneB: B_R_HAND,
      axis: 'x',
      minCoord: -(wristX + 0.12),
      maxCoord: -wristX,
      materialIndex: 3,
    },
    // Left Thigh
    {
      geometry: makeCyl(0.076 * buildMul, 0.056 * buildMul, hipY - kneeY, hipHalf, (hipY + kneeY) * 0.5, 0),
      boneA: B_L_LEG,
      boneB: B_L_UPLEG,
      axis: 'y',
      minCoord: kneeY,
      maxCoord: hipY,
      materialIndex: 2,
    },
    // Left Shin
    {
      geometry: makeCyl(0.054 * buildMul, 0.04 * buildMul, kneeY - footY, hipHalf, (kneeY + footY) * 0.5, 0),
      boneA: B_L_FOOT,
      boneB: B_L_LEG,
      axis: 'y',
      minCoord: footY,
      maxCoord: kneeY,
      materialIndex: 2,
    },
    // Left Boot
    {
      geometry: (() => {
        const g = new THREE.BoxGeometry(0.088, 0.068, 0.19);
        g.translate(hipHalf, 0.034, 0.045);
        return g;
      })(),
      boneA: B_L_FOOT,
      boneB: B_L_FOOT,
      axis: 'y',
      minCoord: 0,
      maxCoord: 0.08,
      materialIndex: 4,
    },
    // Right Thigh
    {
      geometry: makeCyl(0.076 * buildMul, 0.056 * buildMul, hipY - kneeY, -hipHalf, (hipY + kneeY) * 0.5, 0),
      boneA: B_R_LEG,
      boneB: B_R_UPLEG,
      axis: 'y',
      minCoord: kneeY,
      maxCoord: hipY,
      materialIndex: 2,
    },
    // Right Shin
    {
      geometry: makeCyl(0.054 * buildMul, 0.04 * buildMul, kneeY - footY, -hipHalf, (kneeY + footY) * 0.5, 0),
      boneA: B_R_FOOT,
      boneB: B_R_LEG,
      axis: 'y',
      minCoord: footY,
      maxCoord: kneeY,
      materialIndex: 2,
    },
    // Right Boot
    {
      geometry: (() => {
        const g = new THREE.BoxGeometry(0.088, 0.068, 0.19);
        g.translate(-hipHalf, 0.034, 0.045);
        return g;
      })(),
      boneA: B_R_FOOT,
      boneB: B_R_FOOT,
      axis: 'y',
      minCoord: 0,
      maxCoord: 0.08,
      materialIndex: 4,
    },
  ];

  const palette = getOutfitPalette(actor.dressStyle, actor.robeColor, actor.accentColor);
  const bodyMaterials = [
    new THREE.MeshStandardMaterial({
      name: 'OutfitPrimary',
      color: palette.primary,
      metalness: palette.metalness,
      roughness: palette.roughness,
    }),
    new THREE.MeshStandardMaterial({
      name: 'OutfitTrim',
      color: palette.secondary,
      metalness: Math.min(0.85, palette.metalness + 0.22),
      roughness: Math.max(0.25, palette.roughness - 0.12),
    }),
    new THREE.MeshStandardMaterial({
      name: 'Trousers',
      color: palette.trousers,
      metalness: 0.05,
      roughness: 0.72,
    }),
    new THREE.MeshStandardMaterial({
      name: 'BodySkin',
      color: actor.skinTone || '#D99B72',
      metalness: 0.02,
      roughness: 0.55,
    }),
    new THREE.MeshStandardMaterial({
      name: 'Footwear',
      color: '#11151C',
      metalness: 0.18,
      roughness: 0.42,
    }),
  ];

  const bodyGeo = assembleSkinnedBodyGeometry(bodyParts);
  const bodyMesh = new THREE.SkinnedMesh(bodyGeo, bodyMaterials);
  bodyMesh.name = 'AvatarBody';

  const headTex = await createSelfieHeadTexture(actor);
  const headMat = new THREE.MeshStandardMaterial({
    name: 'SelfieFaceSkin',
    map: headTex,
    metalness: 0.02,
    roughness: 0.52,
  });

  const headGeo = buildMorphTargetHeadGeometry(headCenterY, B_NECK, B_HEAD);
  const headMesh = new THREE.SkinnedMesh(headGeo, headMat);
  headMesh.name = 'AvatarHead';
  headMesh.morphTargetDictionary = {
    jawOpen: 0,
    mouthSmile: 1,
    eyeBlinkLeft: 2,
    eyeBlinkRight: 3,
    browInnerUp: 4,
  };
  headMesh.morphTargetInfluences = [0, 0, 0, 0, 0];

  const root = new THREE.Group();
  root.name = `${actor.name.replace(/\s+/g, '_')}_Avatar`;
  root.add(bones[B_HIPS]);
  root.add(bodyMesh);
  root.add(headMesh);

  root.updateMatrixWorld(true);
  const skeleton = new THREE.Skeleton(bones);
  bodyMesh.bind(skeleton);
  headMesh.bind(skeleton);

  const exporter = new GLTFExporter();
  const glbBuffer = await exporter.parseAsync(root, { binary: true });
  const blob = new Blob([glbBuffer as ArrayBuffer], { type: 'model/gltf-binary' });
  const url = URL.createObjectURL(blob);
  const safeName = actor.name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'avatar';

  // Cleanup temporary GPU resources used during generation
  bodyGeo.dispose();
  headGeo.dispose();
  bodyMaterials.forEach((m) => m.dispose());
  headMat.dispose();
  headTex.dispose();

  return {
    blob,
    url,
    fileName: `${safeName}-rigged.glb`,
    boneCount: bones.length,
    morphCount: 5,
  };
}

export async function inspectGlbUrl(url: string): Promise<GlbInspectResult> {
  const loader = new GLTFLoader();
  const gltf = await loader.loadAsync(url);
  const boneSet = new Set<THREE.Bone>();
  const morphNames = new Set<string>();

  gltf.scene.traverse((obj) => {
    if ((obj as THREE.Bone).isBone) {
      boneSet.add(obj as THREE.Bone);
    }
    const mesh = obj as THREE.SkinnedMesh;
    if (mesh.isSkinnedMesh && mesh.skeleton) {
      mesh.skeleton.bones.forEach((b) => boneSet.add(b));
    }
    if (mesh.morphTargetDictionary) {
      Object.keys(mesh.morphTargetDictionary).forEach((k) => morphNames.add(k));
    }
  });

  // Dispose temporary scene objects
  gltf.scene.traverse((obj) => {
    const mesh = obj as THREE.Mesh;
    if (mesh.isMesh) {
      mesh.geometry?.dispose();
      const mats = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
      mats.forEach((m) => m?.dispose());
    }
  });

  return {
    boneCount: boneSet.size,
    morphCount: morphNames.size,
    morphNames: Array.from(morphNames),
    hasHumanoidRig: boneSet.size >= 5,
  };
}

interface LoadedGlbModel {
  url: string;
  sceneGroup: THREE.Group;
  basePos: THREE.Vector3;
  bones: Partial<Record<HumanoidBoneKey, THREE.Bone>>;
  restQuats: Partial<Record<HumanoidBoneKey, THREE.Quaternion>>;
  restHipsX: number;
  restHipsY: number;
  armSign: number;
  morphMeshes: THREE.Mesh[];
  skeletonHelper: THREE.SkeletonHelper | null;
}

export interface GlbFrameParams {
  actor: ActorProfile;
  gesture: GestureAction;
  emotion: EmotionMood;
  biome?: EnvBiome;
  framing: CameraFraming;
  timeSec: number;
  progress?: number;
  audioAmp: number;
  visemeWidth: number;
  showRigOverlay: boolean;
  yawOffset?: number;
  gestureBoost?: number;
  sceneIndex?: number;
  cameraPanRange?: number;
  poseMode?: CharacterPoseMode;
  poseSide?: PoseSide;
  walkingDestination?: WalkingDestination;
}

function computeGlbWalkPhase(phaseRad: number): {
  hipFlex: number;
  kneeFlex: number;
  anklePitch: number;
  isStance: boolean;
  footSideX: number;
} {
  const phase01 = ((phaseRad / (Math.PI * 2)) % 1 + 1) % 1;
  const [nx1, ny1, nx2, ny2] = REALISM_BEZIER_CURVES.NATURAL_REACH;
  const [fx1, fy1, fx2, fy2] = REALISM_BEZIER_CURVES.FAST_BURST;

  if (phase01 < 0.1) {
    // 0% - 10%: Heel Strike & Loading Response
    const t = phase01 / 0.1;
    const ease = evaluateCubicBezierEase(t, nx1, ny1, nx2, ny2);
    return {
      hipFlex: -0.44 - 0.06 * ease,
      kneeFlex: 0.12 + 0.14 * ease,
      anklePitch: -0.22 * (1 - ease),
      isStance: true,
      footSideX: -0.1,
    };
  }
  if (phase01 < 0.3) {
    // 10% - 30%: Mid-Stance (firmly grounded under pelvis)
    const t = (phase01 - 0.1) / 0.2;
    return {
      hipFlex: -0.5 + 0.48 * t,
      kneeFlex: 0.26 - 0.16 * t,
      anklePitch: 0,
      isStance: true,
      footSideX: -0.09,
    };
  }
  if (phase01 < 0.5) {
    // 30% - 50%: Terminal Stance & Heel-Off
    const t = (phase01 - 0.3) / 0.2;
    const ease = evaluateCubicBezierEase(t, nx1, ny1, nx2, ny2);
    return {
      hipFlex: -0.02 + 0.44 * ease,
      kneeFlex: 0.1 + 0.12 * ease,
      anklePitch: 0.2 * ease,
      isStance: t < 0.72,
      footSideX: -0.09,
    };
  }
  if (phase01 < 0.6) {
    // 50% - 60%: Pre-Swing (Double Support toe-off)
    const t = (phase01 - 0.5) / 0.1;
    const ease = evaluateCubicBezierEase(t, fx1, fy1, fx2, fy2);
    return {
      hipFlex: 0.42 + 0.08 * ease,
      kneeFlex: 0.22 + 0.32 * ease,
      anklePitch: 0.2 + 0.12 * ease,
      isStance: false,
      footSideX: -0.09,
    };
  }
  // 60% - 100%: Swing Phase (~60 deg = 1.05 rad knee flexion)
  const t = (phase01 - 0.6) / 0.4;
  const ease = evaluateCubicBezierEase(t, nx1, ny1, nx2, ny2);
  const arc = Math.sin(t * Math.PI);
  return {
    hipFlex: 0.5 - 0.94 * ease,
    kneeFlex: 0.14 + 0.92 * arc,
    anklePitch: 0.26 - 0.48 * ease,
    isStance: false,
    footSideX: -0.1,
  };
}

/**
 * Dedicated Three.js PBR Stage Renderer for rigged .glb humanoid avatars
 * (Avaturn, Ready Player Me, Mixamo, or Selfie-Generated .glb).
 */
export class ThreeGlbStageRenderer {
  private canvas: HTMLCanvasElement;
  private renderer: THREE.WebGLRenderer | null = null;
  private scene: THREE.Scene;
  private camera: THREE.PerspectiveCamera;
  private hemiLight: THREE.HemisphereLight;
  private keyLight: THREE.DirectionalLight;
  private rimLight: THREE.DirectionalLight;
  private envRT: THREE.WebGLRenderTarget | null = null;
  private isSoftwareGl: boolean;
  private contextLost = false;
  private loaded: LoadedGlbModel | null = null;
  private loadingUrl: string | null = null;
  private loader = new GLTFLoader();
  private width = 480;
  private height = 620;
  private lastTimeSec = -1;
  private pelvisSwaySpring: SpringDamperState = { value: 0, velocity: 0 };
  private torsoPitchSpring: SpringDamperState = { value: 0, velocity: 0 };
  private headYawSpring: SpringDamperState = { value: 0, velocity: 0 };
  private shoulderRelaxSpring: SpringDamperState = { value: 0, velocity: 0 };

  constructor(width = 480, height = 620) {
    this.width = width;
    this.height = height;
    this.canvas = document.createElement('canvas');
    this.canvas.width = width;
    this.canvas.height = height;
    this.canvas.addEventListener('webglcontextlost', this.handleContextLost, false);
    this.canvas.addEventListener('webglcontextrestored', this.handleContextRestored, false);

    this.isSoftwareGl = detectSoftwareGl();
    this.scene = new THREE.Scene();
    this.camera = new THREE.PerspectiveCamera(34, width / height, 0.1, 40);
    this.camera.position.set(0, 1.32, 3.15);

    this.initRenderer();

    // Balanced 3-point warm/cool studio rig
    this.hemiLight = new THREE.HemisphereLight(0xcbe8ff, 0x161f33, 1.05);
    this.scene.add(this.hemiLight);

    this.keyLight = new THREE.DirectionalLight(0xfff1dc, 2.1);
    this.keyLight.position.set(2.2, 3.4, 2.8);
    this.scene.add(this.keyLight);

    this.rimLight = new THREE.DirectionalLight(0x38bdf8, 1.4);
    this.rimLight.position.set(-2.4, 2.4, -2.5);
    this.scene.add(this.rimLight);
  }

  private handleContextLost = (e: Event) => {
    e.preventDefault();
    this.contextLost = true;
  };

  private handleContextRestored = () => {
    this.contextLost = false;
    this.initRenderer();
  };

  private initRenderer(): void {
    try {
      this.envRT?.dispose();
      this.envRT = null;
      this.renderer?.dispose();

      const renderer = new THREE.WebGLRenderer({
        canvas: this.canvas,
        alpha: true,
        antialias: !this.isSoftwareGl,
        preserveDrawingBuffer: true,
        powerPreference: 'high-performance',
      });
      renderer.outputColorSpace = THREE.SRGBColorSpace;
      renderer.toneMapping = THREE.ACESFilmicToneMapping;
      renderer.toneMappingExposure = 1.15;
      renderer.setPixelRatio(1);
      renderer.setSize(this.width, this.height, false);
      renderer.setClearColor(0x000000, 0);
      this.renderer = renderer;

      const pmrem = new THREE.PMREMGenerator(renderer);
      const envScene = new RoomEnvironment();
      this.envRT = pmrem.fromScene(envScene, 0.04);
      this.scene.environment = this.envRT.texture;
      envScene.dispose();
      pmrem.dispose();
    } catch {
      this.renderer = null;
    }
  }

  public getCanvas(): HTMLCanvasElement {
    return this.canvas;
  }

  public resize(width: number, height: number): void {
    if (this.width === width && this.height === height) return;
    this.width = Math.max(2, width);
    this.height = Math.max(2, height);
    this.camera.aspect = this.width / this.height;
    this.camera.updateProjectionMatrix();
    this.renderer?.setSize(this.width, this.height, false);
  }

  public isReadyFor(url?: string): boolean {
    return Boolean(url && this.loaded && this.loaded.url === url);
  }

  public async ensureLoaded(url?: string): Promise<boolean> {
    if (!url || !this.renderer) return false;
    if (this.loaded?.url === url) return true;
    if (this.loadingUrl === url) return false;

    this.loadingUrl = url;
    try {
      const gltf = await this.loader.loadAsync(url);
      if (this.loadingUrl !== url) {
        this.disposeGroup(gltf.scene);
        return false;
      }

      this.clearLoadedModel();

      const group = gltf.scene;
      // Normalize scale & ground bottom-center at (0, 0, 0)
      group.updateMatrixWorld(true);
      _box.setFromObject(group);
      _box.getSize(_size);
      const scale = 1.72 / Math.max(0.1, _size.y);
      group.scale.setScalar(scale);
      group.updateMatrixWorld(true);

      _box.setFromObject(group);
      _box.getCenter(_center);
      group.position.set(-_center.x, -_box.min.y, -_center.z);
      group.updateMatrixWorld(true);

      const bones: Partial<Record<HumanoidBoneKey, THREE.Bone>> = {};
      const restQuats: Partial<Record<HumanoidBoneKey, THREE.Quaternion>> = {};
      const morphMeshes: THREE.Mesh[] = [];
      let primarySkinned: THREE.Object3D | null = null;

      group.traverse((obj) => {
        if ((obj as THREE.Bone).isBone) {
          const bone = obj as THREE.Bone;
          const cleanName = bone.name.replace(/\s+/g, '');
          for (const key of Object.keys(HUMANOID_BONE_ALIASES) as HumanoidBoneKey[]) {
            if (!bones[key] && HUMANOID_BONE_ALIASES[key].some((re) => re.test(cleanName))) {
              bones[key] = bone;
              restQuats[key] = bone.quaternion.clone();
            }
          }
        }
        const mesh = obj as THREE.Mesh;
        if (mesh.isMesh) {
          if (!primarySkinned && (mesh as THREE.SkinnedMesh).isSkinnedMesh) {
            primarySkinned = group;
          }
          if (mesh.morphTargetDictionary && mesh.morphTargetInfluences) {
            morphMeshes.push(mesh);
          }
        }
      });

      // Detect whether rest pose is T-pose (arms horizontal) or A-pose (arms lowered)
      let armSign = 1;
      if (bones.LeftArm && bones.LeftForeArm) {
        const pArm = new THREE.Vector3();
        const pFore = new THREE.Vector3();
        bones.LeftArm.getWorldPosition(pArm);
        bones.LeftForeArm.getWorldPosition(pFore);
        armSign = pFore.x >= pArm.x ? 1 : -1;
      }

      const helper = primarySkinned ? new THREE.SkeletonHelper(group) : null;
      if (helper) {
        helper.visible = false;
        const mat = helper.material as THREE.LineBasicMaterial;
        mat.depthTest = false;
        mat.transparent = true;
        mat.opacity = 0.85;
        this.scene.add(helper);
      }

      this.scene.add(group);
      this.loaded = {
        url,
        sceneGroup: group,
        basePos: group.position.clone(),
        bones,
        restQuats,
        restHipsX: bones.Hips ? bones.Hips.position.x : 0,
        restHipsY: bones.Hips ? bones.Hips.position.y : 0,
        armSign,
        morphMeshes,
        skeletonHelper: helper,
      };
      this.loadingUrl = null;
      return true;
    } catch {
      this.loadingUrl = null;
      return false;
    }
  }

  public renderFrame(params: GlbFrameParams): boolean {
    if (!this.renderer || !this.loaded || this.contextLost) return false;
    if (params.actor.glbModelUrl && this.loaded.url !== params.actor.glbModelUrl) {
      return false;
    }

    const {
      actor,
      gesture,
      emotion,
      biome,
      framing,
      timeSec,
      progress,
      audioAmp,
      visemeWidth,
      showRigOverlay,
      yawOffset = 0,
      gestureBoost = 1.25,
    } = params;

    // Sync 3-point lighting mood with the active background theme
    if (biome === EnvBiome.FIRE_BATTLE) {
      this.keyLight.color.setHex(0xffb56b);
      this.rimLight.color.setHex(0xff5500);
    } else if (biome === EnvBiome.ROYAL_PALACE) {
      this.keyLight.color.setHex(0xffe4b5);
      this.rimLight.color.setHex(0xf59e0b);
    } else if (biome === EnvBiome.CYBER_CITY) {
      this.keyLight.color.setHex(0xdbeafe);
      this.rimLight.color.setHex(0xf472b6);
    } else if (biome === EnvBiome.STUDIO_CYCLORAMA) {
      this.keyLight.color.setHex(0xffffff);
      this.rimLight.color.setHex(0xe2e8f0);
    } else {
      this.keyLight.color.setHex(0xfff1dc);
      this.rimLight.color.setHex(0x38bdf8);
    }

    const model = this.loaded;
    const { rig, retarget, ik, blendShapes } = actor;
    const beatProgress = progress !== undefined ? progress : (timeSec % 5.0) / 5.0;
    const beats = evaluateSceneActionBeats(beatProgress);
    const biomePath = computeBiomeScenePath({
      biome: biome ?? EnvBiome.AVATAR_NIGHT,
      gesture,
      framing,
      progress: beatProgress,
      sceneIndex: params.sceneIndex ?? 1,
      cameraPanRange: params.cameraPanRange ?? 0.14,
      poseMode: params.poseMode,
      poseSide: params.poseSide,
      walkingDestination: params.walkingDestination,
    });

    // 1. Update camera framing for Close-Up / Presenter / Full Body
    const isPortraitViewport = this.height >= this.width;
    let camZ = isPortraitViewport ? 3.45 : 2.65;
    if (framing === CameraFraming.CLOSE_UP) {
      camZ = isPortraitViewport ? 1.15 : 0.96;
      this.camera.position.set(0, 1.54, camZ);
      this.camera.lookAt(0, 1.5, 0);
    } else if (framing === CameraFraming.PRESENTER) {
      camZ = isPortraitViewport ? 2.25 : 1.75;
      this.camera.position.set(0, 1.24, camZ);
      this.camera.lookAt(0, 1.16, 0);
    } else {
      this.camera.position.set(0, 0.96, camZ);
      this.camera.lookAt(0, 0.88, 0);
    }

    // Map biome Point A -> Point B normalized path directly into Three.js world coordinates
    const tanHalfFov = Math.tan((34 * Math.PI) / 360);
    const visibleWorldH = 2 * camZ * tanHalfFov;
    const visibleWorldW = visibleWorldH * (this.width / Math.max(1, this.height));
    const worldX = biomePath.normX * visibleWorldW;
    const worldY = -biomePath.normY * visibleWorldH * 0.68;
    const worldZ = (biomePath.depthScale - 1.0) * 1.45;
    model.sceneGroup.position.set(
      model.basePos.x + worldX,
      model.basePos.y + worldY,
      model.basePos.z + worldZ
    );

    // 2. Apply biome path side-profile yaw + Froude walk frequency + 4-beat pacing
    const isWalking = gesture === GestureAction.WALKING;
    const pathWalkWeight = isWalking
      ? 1
      : biomePath.isMoving
        ? clamp((biomePath.moveSpeed - 0.1) * 1.45, 0, 1)
        : 0;
    const isActiveStriding = isWalking || pathWalkWeight > 0.15;
    const boost = clamp(gestureBoost, 0.75, 2.0);
    const froudeFreq = 6.283 / Math.sqrt(Math.max(0.75, rig.legLengthRatio));
    const walkCycle = timeSec * froudeFreq;
    const strideAmp = retarget.strideScale * (0.72 + 0.28 * beats.primaryActionGain);
    const armAmp = retarget.armAmplitude * boost;
    const expr = retarget.expressiveness * (0.85 + 0.15 * boost);

    model.sceneGroup.rotation.y =
      yawOffset +
      biomePath.sideProfile * 1.24 +
      Math.sin(timeSec * 0.95) * 0.065 * expr * (0.7 + 0.3 * beats.anticipationShift) +
      (emotion === EmotionMood.MYSTERIOUS && Math.abs(biomePath.sideProfile) < 0.2 ? 0.14 : 0);

    const needsSpringReset =
      this.lastTimeSec < 0 || timeSec < this.lastTimeSec || timeSec - this.lastTimeSec > 0.25;
    const dt = !needsSpringReset ? Math.max(0.004, Math.min(0.05, timeSec - this.lastTimeSec)) : 0.016;
    if (needsSpringReset) {
      this.pelvisSwaySpring = { value: 0, velocity: 0 };
      this.torsoPitchSpring = { value: 0, velocity: 0 };
      this.headYawSpring = { value: 0, velocity: 0 };
      this.shoulderRelaxSpring = { value: 0, velocity: 0 };
    }
    this.lastTimeSec = timeSec;
    const poseCrossFade = 1 - Math.exp(-9.5 * dt);
    const morphSmooth = 1 - Math.exp(-16.0 * dt);

    // Helper to smoothly cross-fade local bone orientation toward target pose
    const setBoneOffset = (
      key: HumanoidBoneKey,
      rx: number,
      ry: number,
      rz: number
    ) => {
      const bone = model.bones[key];
      const rest = model.restQuats[key];
      if (!bone || !rest) return;
      _euler.set(rx, ry, rz, 'XYZ');
      _deltaQuat.setFromEuler(_euler);
      _targetQuat.copy(rest).multiply(_deltaQuat);
      bone.quaternion.slerp(_targetQuat, poseCrossFade);
    };

    const walkLeft = computeGlbWalkPhase(walkCycle);
    const walkRight = computeGlbWalkPhase(walkCycle + Math.PI);

    // Zero-Moment Point (ZMP) lateral balance inside Base of Support
    const rawSwayPx = isActiveStriding
      ? Math.sin(walkCycle + 0.35) * 12.0 * strideAmp
      : Math.sin(timeSec * 1.45) * 9.0 * expr * beats.anticipationShift;
    const bosMinX = isActiveStriding && !walkLeft.isStance ? 8 : -28;
    const bosMaxX = isActiveStriding && !walkRight.isStance ? -8 : 28;
    const zmp = computeCoMAndZmpBalance({
      headX: rawSwayPx,
      headY: -290,
      torsoX: rawSwayPx,
      torsoY: -120,
      lArmX: rawSwayPx - 65,
      lArmY: -135,
      rArmX: rawSwayPx + 65,
      rArmY: -135,
      lLegX: -24,
      lLegY: 95,
      rLegX: 24,
      rLegY: 95,
      accelX: (rawSwayPx - this.pelvisSwaySpring.value) * 0.16,
      accelZ: Math.sin(walkCycle * 2) * 0.55,
      bosMinX: Math.min(bosMinX, bosMaxX),
      bosMaxX: Math.max(bosMinX, bosMaxX),
    });

    this.pelvisSwaySpring = stepSpringDamper(
      this.pelvisSwaySpring,
      rawSwayPx + zmp.pelvisCorrectionX,
      38,
      1.55,
      dt,
      0.88
    );

    const targetTorsoPitch =
      audioAmp * 0.03 * expr +
      (gesture === GestureAction.POINTING ? 0.045 : gesture === GestureAction.HERO_RAISE ? -0.04 : 0);
    this.torsoPitchSpring = stepSpringDamper(this.torsoPitchSpring, targetTorsoPitch, 42, 1.2, dt, 0.84);

    // Beat 2: eyes/head lead turn before body
    const targetHeadYaw =
      Math.sin(timeSec * 0.9) * 0.12 * expr * (0.65 + 0.45 * beats.eyeLeadFactor);
    this.headYawSpring = stepSpringDamper(this.headYawSpring, targetHeadYaw, 50, 0.75, dt, 0.82);

    // Beat 4: shoulders relax down on settle
    this.shoulderRelaxSpring = stepSpringDamper(
      this.shoulderRelaxSpring,
      beats.settleFollowThrough * 0.06,
      36,
      0.9,
      dt,
      0.85
    );

    // Hips bob + lateral CoM/ZMP weight shift
    if (model.bones.Hips) {
      const bob = isWalking
        ? (1 - Math.cos(walkCycle * 2)) * 0.022 * strideAmp
        : Math.sin(timeSec * 2.1) * 0.01 * (0.7 + 0.3 * beats.stanceMicro) + audioAmp * 0.008;
      model.bones.Hips.position.x = model.restHipsX + this.pelvisSwaySpring.value * 0.0026;
      model.bones.Hips.position.y = model.restHipsY + bob;
      setBoneOffset(
        'Hips',
        0,
        isWalking ? Math.sin(walkCycle) * 0.09 * strideAmp : Math.sin(timeSec * 1.2) * 0.035 * expr,
        isWalking ? Math.cos(walkCycle) * 0.045 * strideAmp : 0
      );
    }

    // Spine & Head motion with spring-damper follow-through
    const headPitch =
      audioAmp * 0.11 * expr +
      Math.sin(timeSec * 1.55) * 0.05 * expr -
      (emotion === EmotionMood.HEROIC ? 0.06 : 0);
    const headYaw = this.headYawSpring.value;
    setBoneOffset('Spine', Math.sin(timeSec * 1.7) * 0.035 * expr, 0, Math.sin(timeSec * 1.1) * 0.025 * expr);
    setBoneOffset(
      'Spine1',
      this.torsoPitchSpring.value,
      isWalking ? -Math.sin(walkCycle) * 0.1 * expr : Math.cos(timeSec * 1.4) * 0.045 * expr,
      0
    );
    setBoneOffset('Neck', headPitch * 0.35, headYaw * 0.35, 0);
    setBoneOffset('Head', headPitch * 0.65, headYaw * 0.65, Math.sin(timeSec * 1.2) * 0.045 * expr);

    // Arms & Clavicles: T-pose arms drop down ~1.18 rad around Z, modulated by Cubic Bezier splines + Beat 4 shoulder settle
    const dropZ = 1.18 + this.shoulderRelaxSpring.value;
    const elbowFlex = clamp(ik.elbowBendBias * 1.6, 0.08, 0.85);
    const lag = retarget.phaseLag;
    const beatActionGain = 0.72 + 0.28 * beats.primaryActionGain;

    if (gesture === GestureAction.WALKING) {
      const swing = Math.sin(walkCycle) * 0.42 * armAmp * beatActionGain;
      setBoneOffset('LeftShoulder', 0, 0, Math.sin(walkCycle) * 0.05 + this.shoulderRelaxSpring.value);
      setBoneOffset('RightShoulder', 0, 0, Math.sin(walkCycle) * 0.05 - this.shoulderRelaxSpring.value);
      setBoneOffset('LeftArm', -swing, 0, -dropZ);
      setBoneOffset('RightArm', swing, 0, dropZ);
      setBoneOffset(
        'LeftForeArm',
        0,
        elbowFlex + Math.max(0, -Math.sin(walkCycle - 0.4 * lag)) * 0.4,
        0
      );
      setBoneOffset(
        'RightForeArm',
        0,
        -(elbowFlex + Math.max(0, Math.sin(walkCycle - 0.4 * lag)) * 0.4),
        0
      );
      setBoneOffset('LeftHand', Math.sin(walkCycle - 0.7 * lag) * 0.16, 0, 0);
      setBoneOffset('RightHand', -Math.sin(walkCycle - 0.7 * lag) * 0.16, 0, 0);
    } else if (gesture === GestureAction.HERO_RAISE) {
      const heavyEase = evaluateCubicBezierEase(
        Math.min(1, beatProgress * 1.45),
        ...REALISM_BEZIER_CURVES.HEAVY_LIFT
      );
      const pulse = Math.sin(timeSec * 2.5) * (0.08 + audioAmp * 0.1) * armAmp;
      setBoneOffset('LeftShoulder', 0, 0, -0.14 + this.shoulderRelaxSpring.value);
      setBoneOffset('RightShoulder', 0, 0, 0.06 - this.shoulderRelaxSpring.value);
      setBoneOffset('LeftArm', (-0.28 + pulse * 0.5) * heavyEase, 0, -dropZ + (dropZ - 0.42) * heavyEase + pulse * 0.4);
      setBoneOffset('RightArm', -0.18 + pulse, -0.12, dropZ - 0.24);
      setBoneOffset('LeftForeArm', 0, 0.44 * heavyEase + pulse * 0.5, 0);
      setBoneOffset('RightForeArm', 0, -(elbowFlex + 0.35 + audioAmp * 0.32), 0);
      setBoneOffset('LeftHand', 0.18 * audioAmp, 0, 0.12);
      setBoneOffset('RightHand', Math.cos(timeSec * 3.1) * 0.22 * armAmp, 0, -0.14);
    } else if (gesture === GestureAction.POINTING) {
      const burstEase = evaluateCubicBezierEase(
        Math.min(1, beatProgress * 2.2),
        ...REALISM_BEZIER_CURVES.FAST_BURST
      );
      const thrust = Math.sin(timeSec * 3.4) * (0.08 + audioAmp * 0.1) * armAmp;
      const lWave = Math.sin(timeSec * 2.4) * (0.16 + audioAmp * 0.18) * armAmp;
      setBoneOffset('LeftShoulder', 0, 0, -0.04 + this.shoulderRelaxSpring.value);
      setBoneOffset('RightShoulder', 0, 0, 0.1 - this.shoulderRelaxSpring.value);
      setBoneOffset('LeftArm', -0.26 + lWave * 0.4, 0.12, -dropZ + 0.18);
      setBoneOffset('RightArm', -1.28 * burstEase + thrust * 0.5, 0.18, dropZ - (dropZ - 0.32) * burstEase);
      setBoneOffset('LeftForeArm', 0, elbowFlex + 0.45 + lWave * 0.5, 0);
      setBoneOffset('RightForeArm', 0, -0.14 + thrust * 0.3, 0);
      setBoneOffset('LeftHand', Math.cos(timeSec * 2.8) * 0.2 * armAmp, 0.15, 0);
      setBoneOffset('RightHand', thrust * 0.5, 0, 0.08);
    } else if (gesture === GestureAction.TALK_WAVE) {
      const speakScale = (0.72 + audioAmp * 0.78) * armAmp * beatActionGain;
      const talkL = Math.sin(timeSec * 3.1) * 0.26 * speakScale;
      const talkR = Math.cos(timeSec * 2.7 + 0.55) * 0.28 * speakScale;
      setBoneOffset('LeftShoulder', 0, 0, -0.06 - audioAmp * 0.06 + this.shoulderRelaxSpring.value);
      setBoneOffset('RightShoulder', 0, 0, 0.06 + audioAmp * 0.06 - this.shoulderRelaxSpring.value);
      setBoneOffset('LeftArm', -0.4 + talkL * 0.55, 0.22, -dropZ + 0.3);
      setBoneOffset('RightArm', -0.44 + talkR * 0.55, -0.22, dropZ - 0.3);
      setBoneOffset('LeftForeArm', 0, 1.02 + talkL * 0.48, 0);
      setBoneOffset('RightForeArm', 0, -(1.02 + talkR * 0.48), 0);
      setBoneOffset('LeftHand', Math.sin(timeSec * 4.2) * 0.26 * speakScale, 0.2, 0.18);
      setBoneOffset('RightHand', Math.cos(timeSec * 3.9) * 0.26 * speakScale, -0.2, -0.18);
    } else {
      const reachEase = evaluateCubicBezierEase(
        Math.min(1, beatProgress * 1.8),
        ...REALISM_BEZIER_CURVES.NATURAL_REACH
      );
      const lExplain = Math.sin(timeSec * 2.3) * (0.16 + audioAmp * 0.2) * armAmp;
      setBoneOffset('LeftShoulder', 0, 0, -0.04 + this.shoulderRelaxSpring.value);
      setBoneOffset('RightShoulder', 0, 0, 0.06 - this.shoulderRelaxSpring.value);
      setBoneOffset('LeftArm', -0.24 + lExplain * 0.4, 0.14, -dropZ + 0.2);
      setBoneOffset('RightArm', -0.32 * reachEase, -0.22 * reachEase, dropZ - 0.26 * reachEase);
      setBoneOffset('LeftForeArm', 0, elbowFlex + 0.55 + lExplain * 0.45, 0);
      setBoneOffset('RightForeArm', 0, -1.16 * reachEase, 0);
      setBoneOffset('LeftHand', Math.sin(timeSec * 3.0) * 0.2 * armAmp, 0.18, 0.12);
      setBoneOffset('RightHand', 0.12, 0, -0.1);
    }

    // Legs: 5-Phase Standard Walk Cycle & Biomechanical Scene Stances (with active Point A -> B path striding)
    const hipSpread = (ik.hipStanceWidth - 1.0) * 0.08;
    const emoKnee =
      emotion === EmotionMood.MYSTERIOUS ? 0.14 : emotion === EmotionMood.INTENSE ? 0.09 : 0.03;
    const kneeRest = ik.kneeBendBias * 0.32 + emoKnee;
    if (isWalking || pathWalkWeight > 0.25) {
      const wScale = isWalking ? 1 : pathWalkWeight;
      const lHipX = walkLeft.hipFlex * strideAmp * wScale;
      const rHipX = walkRight.hipFlex * strideAmp * wScale;
      const lKnee = kneeRest + walkLeft.kneeFlex * ik.ankleLiftGain * wScale;
      const rKnee = kneeRest + walkRight.kneeFlex * ik.ankleLiftGain * wScale;

      setBoneOffset('LeftUpLeg', lHipX, 0, hipSpread);
      setBoneOffset('RightUpLeg', rHipX, 0, -hipSpread);
      setBoneOffset('LeftLeg', lKnee, 0, 0);
      setBoneOffset('RightLeg', rKnee, 0, 0);
      setBoneOffset('LeftFoot', (walkLeft.anklePitch - lKnee * 0.2) * wScale, 0, 0);
      setBoneOffset('RightFoot', (walkRight.anklePitch - rKnee * 0.2) * wScale, 0, 0);
    } else if (gesture === GestureAction.HERO_RAISE) {
      const pulse = Math.sin(timeSec * 2.5) * 0.06;
      setBoneOffset('LeftUpLeg', -0.24 * strideAmp, 0, hipSpread + 0.1);
      setBoneOffset('RightUpLeg', 0.2 * strideAmp, 0, -hipSpread - 0.1);
      setBoneOffset('LeftLeg', kneeRest + 0.22 + Math.max(0, pulse), 0, 0);
      setBoneOffset('RightLeg', kneeRest + 0.14, 0, 0);
      setBoneOffset('LeftFoot', -0.1, 0, 0);
      setBoneOffset('RightFoot', 0.14, 0, 0);
    } else if (gesture === GestureAction.POINTING) {
      const thrust = Math.sin(timeSec * 3.2) * 0.06;
      setBoneOffset('LeftUpLeg', 0.22 * strideAmp, 0, hipSpread + 0.06);
      setBoneOffset('RightUpLeg', -0.28 * strideAmp - thrust * 0.4, 0, -hipSpread - 0.08);
      setBoneOffset('LeftLeg', kneeRest + 0.14, 0, 0);
      setBoneOffset('RightLeg', kneeRest + 0.28 + Math.max(0, thrust), 0, 0);
      setBoneOffset('LeftFoot', 0.16, 0, 0);
      setBoneOffset('RightFoot', -0.12, 0, 0);
    } else if (gesture === GestureAction.TALK_WAVE) {
      const shift = Math.sin(timeSec * 1.95);
      const lUnload = Math.max(0, -shift);
      const rUnload = Math.max(0, shift);
      setBoneOffset('LeftUpLeg', -shift * 0.1 * strideAmp, 0, hipSpread + 0.05 + lUnload * 0.05);
      setBoneOffset('RightUpLeg', shift * 0.1 * strideAmp, 0, -hipSpread - 0.05 - rUnload * 0.05);
      setBoneOffset('LeftLeg', kneeRest + lUnload * 0.24 * ik.ankleLiftGain, 0, 0);
      setBoneOffset('RightLeg', kneeRest + rUnload * 0.24 * ik.ankleLiftGain, 0, 0);
      setBoneOffset('LeftFoot', lUnload * 0.12, 0, 0);
      setBoneOffset('RightFoot', rUnload * 0.12, 0, 0);
    } else {
      const shift = Math.sin(timeSec * 1.15);
      const lFree = Math.max(0, -shift);
      const rFree = Math.max(0, shift);
      setBoneOffset('LeftUpLeg', -0.12 * strideAmp, 0, hipSpread + 0.05);
      setBoneOffset('RightUpLeg', 0.14 * strideAmp, 0, -hipSpread - 0.05);
      setBoneOffset('LeftLeg', kneeRest + lFree * 0.2, 0, 0);
      setBoneOffset('RightLeg', kneeRest + rFree * 0.2, 0, 0);
      setBoneOffset('LeftFoot', lFree * 0.1, 0, 0);
      setBoneOffset('RightFoot', rFree * 0.1, 0, 0);
    }

    // 3. Drive Morph Targets / ARKit / Oculus Viseme Blend Shapes
    const blinkRate = Math.max(0.25, blendShapes.blinkRateGain);
    const blinkPhase = (timeSec * blinkRate) % 3.8;
    const blinkVal =
      blinkPhase > 3.64
        ? Math.sin(((blinkPhase - 3.64) / 0.16) * Math.PI)
        : 0;

    const jawWeight = clamp(audioAmp * 0.95 * blendShapes.jawOpenGain, 0, 1);
    const smileWeight = clamp(
      blendShapes.lipSmileBias +
        (visemeWidth - 0.85) * 0.45 * blendShapes.mouthWidthGain,
      0,
      1
    );
    const browWeight = clamp(audioAmp * 0.6 * blendShapes.browLiftGain, 0, 1);
    const squintWeight = clamp(blendShapes.cheekSquint * (0.4 + smileWeight * 0.6), 0, 1);

    for (const mesh of model.morphMeshes) {
      const dict = mesh.morphTargetDictionary;
      const inf = mesh.morphTargetInfluences;
      if (!dict || !inf) continue;

      const setMorph = (names: string[], val: number) => {
        for (const n of names) {
          const idx = dict[n];
          if (idx !== undefined) {
            inf[idx] = inf[idx] + (val - inf[idx]) * morphSmooth;
          }
        }
      };

      setMorph(['jawOpen', 'mouthOpen', 'viseme_aa', 'viseme_O'], jawWeight);
      setMorph(['mouthSmile', 'mouthSmileLeft', 'mouthSmileRight', 'mouthStretchLeft', 'mouthStretchRight'], smileWeight);
      setMorph(['eyeBlinkLeft', 'eyesClosed', 'blink'], blinkVal);
      setMorph(['eyeBlinkRight'], blinkVal);
      setMorph(['browInnerUp', 'browOuterUpLeft', 'browOuterUpRight'], browWeight);
      setMorph(['cheekSquintLeft', 'cheekSquintRight'], squintWeight);
    }

    if (model.skeletonHelper) {
      model.skeletonHelper.visible = showRigOverlay;
    }

    try {
      this.renderer.render(this.scene, this.camera);
      return true;
    } catch {
      return false;
    }
  }

  private clearLoadedModel(): void {
    if (!this.loaded) return;
    if (this.loaded.skeletonHelper) {
      this.scene.remove(this.loaded.skeletonHelper);
      this.loaded.skeletonHelper.dispose();
    }
    this.scene.remove(this.loaded.sceneGroup);
    this.disposeGroup(this.loaded.sceneGroup);
    this.loaded = null;
  }

  private disposeGroup(group: THREE.Object3D): void {
    group.traverse((obj) => {
      const mesh = obj as THREE.Mesh;
      if (mesh.isMesh) {
        mesh.geometry?.dispose();
        const mats = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
        mats.forEach((m) => {
          if (!m) return;
          const std = m as THREE.MeshStandardMaterial;
          std.map?.dispose();
          std.normalMap?.dispose();
          std.roughnessMap?.dispose();
          m.dispose();
        });
      }
    });
  }

  public dispose(): void {
    this.canvas.removeEventListener('webglcontextlost', this.handleContextLost);
    this.canvas.removeEventListener('webglcontextrestored', this.handleContextRestored);
    this.clearLoadedModel();
    this.envRT?.dispose();
    this.envRT = null;
    this.renderer?.dispose();
    this.renderer = null;
  }
}
