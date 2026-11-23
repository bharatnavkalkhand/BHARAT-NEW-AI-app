import {
  ActorProfile,
  CameraFraming,
  CharacterPoseMode,
  EnvBiome,
  GestureAction,
  MotionRetargetConfig,
  MotionRetargetStyle,
  PoseSide,
  RigProportions,
  WalkingDestination,
} from './types';

export interface BiomePathWaypoint {
  normX: number;
  normY: number;
  depthScale: number;
}

export interface BiomePathSample {
  /** Normalized horizontal position relative to stage center [-0.35..+0.35] */
  normX: number;
  /** Normalized terrain elevation offset relative to ground plane [-0.10..+0.08] */
  normY: number;
  /** Perspective depth scale along the terrain path [0.80..1.12] */
  depthScale: number;
  /** Side-profile orientation [-1.0..+1.0]: 0 = front, +1 = right profile, -1 = left profile */
  sideProfile: number;
  /** True when the character is actively stepping along the path at this instant */
  isMoving: boolean;
  /** Instantaneous normalized speed [0..1] for stride & leg cadence */
  moveSpeed: number;
  /** Path tangent angle in XY stage space (radians) */
  slopeAngle: number;
  /** Sampled Point A -> Point B trajectory points for floor path rendering */
  waypoints: BiomePathWaypoint[];
}

function evalBiomeCurvePoint(
  biome: EnvBiome,
  u: number,
  dir: number,
  spanX: number
): BiomePathWaypoint {
  const clampedU = clamp(u, 0, 1);
  const normX = dir * (-spanX + clampedU * 2 * spanX);

  switch (biome) {
    case EnvBiome.SACRED_RIVER: {
      // Himalayan riverbank terrace descending smoothly toward the river bend
      const stepCurve = clampedU * 0.72 + (Math.sin(clampedU * Math.PI * 3) * 0.04 + clampedU * 0.28);
      return {
        normX,
        normY: -0.052 * (1 - stepCurve) + Math.sin(clampedU * Math.PI * 1.5) * 0.014,
        depthScale: 0.88 + 0.18 * clampedU,
      };
    }
    case EnvBiome.DESERT_MYSTERY: {
      // Sweeping Jaisalmer sand dune crest: climbs ridge and descends leeward slope
      const duneArc = Math.sin(clampedU * Math.PI);
      return {
        normX,
        normY: -0.068 * duneArc + 0.012 * (1 - clampedU),
        depthScale: 0.90 + 0.12 * (1 - duneArc * 0.55),
      };
    }
    case EnvBiome.ROYAL_PALACE: {
      // Grand symmetrical marble colonnade promenade
      return {
        normX,
        normY: 0.012 * Math.sin(clampedU * Math.PI),
        depthScale: 0.94 + 0.09 * Math.sin(clampedU * Math.PI * 0.5),
      };
    }
    case EnvBiome.CYBER_CITY: {
      // Elevated neon skybridge diagonal approach toward foreground camera
      return {
        normX,
        normY: -0.058 * (1 - clampedU),
        depthScale: 0.84 + 0.22 * clampedU,
      };
    }
    case EnvBiome.FIRE_BATTLE: {
      // Steep volcanic ember ridge ascent
      return {
        normX,
        normY: 0.018 - 0.072 * clampedU + Math.sin(clampedU * Math.PI * 3) * 0.008,
        depthScale: 0.91 + 0.12 * Math.sin(clampedU * Math.PI),
      };
    }
    case EnvBiome.MONSOON_RAIN: {
      // Wet hillside storm path curving around rain runoff
      return {
        normX,
        normY: -0.032 * Math.cos(clampedU * Math.PI) + Math.sin(clampedU * Math.PI * 2) * 0.012,
        depthScale: 0.90 + 0.15 * clampedU,
      };
    }
    case EnvBiome.STUDIO_CYCLORAMA: {
      // Clean curved cyclorama stage runway
      return {
        normX,
        normY: 0.024 * Math.sin(clampedU * Math.PI),
        depthScale: 0.95 + 0.09 * Math.sin(clampedU * Math.PI),
      };
    }
    case EnvBiome.AVATAR_NIGHT:
    default: {
      // Bioluminescent mystic valley ridge trail
      return {
        normX,
        normY: -0.044 * Math.sin(clampedU * Math.PI * 0.85) + 0.012 * Math.sin(clampedU * Math.PI * 2),
        depthScale: 0.89 + 0.16 * clampedU,
      };
    }
  }
}

/**
 * Resolves discrete 'left' | 'right' | 'front' poseSide for GPU shader uniforms & side-profile asset switching.
 */
export function resolveScenePoseSide(params: {
  poseSide?: PoseSide;
  poseMode?: CharacterPoseMode;
  gesture: GestureAction;
  walkingDestination?: WalkingDestination;
  biomePath?: BiomePathSample;
}): PoseSide {
  const { poseSide, poseMode, gesture, walkingDestination, biomePath } = params;
  if (poseSide === 'left' || poseSide === 'right' || poseSide === 'front') {
    return poseSide;
  }
  if (poseMode === 'FRONT') return 'front';
  if (poseMode === 'SIDE_LEFT') return 'left';
  if (poseMode === 'SIDE_RIGHT') return 'right';

  if (
    walkingDestination &&
    Math.abs(walkingDestination.targetXNorm - walkingDestination.startXNorm) >= 0.02
  ) {
    return walkingDestination.targetXNorm >= walkingDestination.startXNorm ? 'right' : 'left';
  }

  if (gesture === GestureAction.WALKING || (biomePath && Math.abs(biomePath.sideProfile) >= 0.35)) {
    return (biomePath?.sideProfile ?? 1) < 0 ? 'left' : 'right';
  }

  return 'front';
}

/**
 * Computes a dynamic Point A -> Point B traversal & side-profile angle grounded
 * in the active shader biome geometry, gesture type, camera framing, and walking destination.
 */
export function computeBiomeScenePath(params: {
  biome: EnvBiome;
  gesture: GestureAction;
  framing: CameraFraming;
  progress: number;
  sceneIndex?: number;
  cameraPanRange?: number;
  poseMode?: CharacterPoseMode;
  poseSide?: PoseSide;
  walkingDestination?: WalkingDestination;
}): BiomePathSample {
  const {
    biome,
    gesture,
    framing,
    progress,
    sceneIndex = 1,
    cameraPanRange = 0,
    poseMode = 'AUTO',
    poseSide: explicitPoseSide,
    walkingDestination,
  } = params;

  const p = clamp(progress, 0, 1);
  const [nx1, ny1, nx2, ny2] = REALISM_BEZIER_CURVES.NATURAL_REACH;

  const hasDest = Boolean(
    walkingDestination &&
      Math.abs(walkingDestination.targetXNorm - walkingDestination.startXNorm) >= 0.02
  );

  // Direction of travel along the biome path (Point A -> Point B)
  const dir =
    explicitPoseSide === 'right' || poseMode === 'SIDE_RIGHT'
      ? 1
      : explicitPoseSide === 'left' || poseMode === 'SIDE_LEFT'
        ? -1
        : hasDest && walkingDestination
          ? walkingDestination.targetXNorm >= walkingDestination.startXNorm
            ? 1
            : -1
          : Math.abs(cameraPanRange) > 0.01
            ? cameraPanRange >= 0
              ? 1
              : -1
            : sceneIndex % 2 === 1
              ? 1
              : -1;

  const framingScale =
    framing === CameraFraming.CLOSE_UP
      ? 0.14
      : framing === CameraFraming.PRESENTER
        ? 0.56
        : 1.0;

  let baseSpanX = 0.27;
  let u = 0.5;
  let uPrev = 0.5;
  let targetProfileMag = 0.88;
  let isMoving = true;

  if (gesture === GestureAction.WALKING || hasDest) {
    // Full Point A -> Point B traversal in crisp side profile
    baseSpanX = 0.28;
    u = evaluateCubicBezierEase(p, nx1, ny1, nx2, ny2);
    uPrev = evaluateCubicBezierEase(Math.max(0, p - 0.02), nx1, ny1, nx2, ny2);
    targetProfileMag = 0.92;
    isMoving = p > 0.01 && p < 0.99;
  } else if (gesture === GestureAction.HERO_RAISE || gesture === GestureAction.POINTING) {
    // Dynamic entry walk along the biome slope (0..62%), then lock into 3/4 side stance
    baseSpanX = 0.17;
    const moveT = clamp(p / 0.62, 0, 1);
    const moveTPrev = clamp(Math.max(0, p - 0.02) / 0.62, 0, 1);
    u = evaluateCubicBezierEase(moveT, nx1, ny1, nx2, ny2);
    uPrev = evaluateCubicBezierEase(moveTPrev, nx1, ny1, nx2, ny2);
    targetProfileMag = gesture === GestureAction.POINTING ? 0.78 : 0.64;
    isMoving = p < 0.6;
  } else {
    // TALK_WAVE / THINKING: smooth conversational pacing along the biome path
    baseSpanX = 0.13;
    const moveT = clamp((p - 0.08) / 0.72, 0, 1);
    const moveTPrev = clamp((Math.max(0, p - 0.02) - 0.08) / 0.72, 0, 1);
    u = evaluateCubicBezierEase(moveT, nx1, ny1, nx2, ny2);
    uPrev = evaluateCubicBezierEase(moveTPrev, nx1, ny1, nx2, ny2);
    isMoving = p >= 0.08 && p <= 0.78;
    targetProfileMag = isMoving ? 0.58 : 0.42;
  }

  const spanX = baseSpanX * framingScale;
  const pt = evalBiomeCurvePoint(biome, u, dir, spanX);
  const prevPt = evalBiomeCurvePoint(biome, uPrev, dir, spanX);
  if (hasDest && walkingDestination) {
    const startX = walkingDestination.startXNorm * framingScale;
    const endX = walkingDestination.targetXNorm * framingScale;
    pt.normX = startX + (endX - startX) * u;
    prevPt.normX = startX + (endX - startX) * uPrev;
  }

  const deltaU = Math.max(0, u - uPrev);
  const moveSpeed = clamp(deltaU / 0.028, 0, 1);
  const slopeAngle = Math.atan2(
    pt.normY - prevPt.normY,
    Math.max(1e-4, Math.abs(pt.normX - prevPt.normX))
  );

  let sideProfile = dir * targetProfileMag;
  if (explicitPoseSide === 'front' || poseMode === 'FRONT') {
    sideProfile = 0;
  } else if (explicitPoseSide === 'right' || poseMode === 'SIDE_RIGHT') {
    sideProfile = Math.max(0.88, targetProfileMag);
  } else if (explicitPoseSide === 'left' || poseMode === 'SIDE_LEFT') {
    sideProfile = -Math.max(0.88, targetProfileMag);
  } else if (hasDest) {
    sideProfile = dir * Math.max(0.9, targetProfileMag);
  } else if (gesture !== GestureAction.WALKING && !isMoving) {
    // Smoothly turn back partially toward camera on final settle unless pure walking
    const settleFactor = clamp((p - 0.72) / 0.25, 0, 1);
    sideProfile = dir * (targetProfileMag * (1 - 0.35 * settleFactor));
  }

  const waypoints: BiomePathWaypoint[] = [];
  const steps = 10;
  for (let i = 0; i <= steps; i++) {
    const t = i / steps;
    const wp = evalBiomeCurvePoint(biome, t, dir, spanX);
    if (hasDest && walkingDestination) {
      const startX = walkingDestination.startXNorm * framingScale;
      const endX = walkingDestination.targetXNorm * framingScale;
      wp.normX = startX + (endX - startX) * t;
    }
    waypoints.push(wp);
  }

  return {
    normX: pt.normX,
    normY: pt.normY,
    depthScale: pt.depthScale,
    sideProfile,
    isMoving,
    moveSpeed,
    slopeAngle,
    waypoints,
  };
}

export interface TwoBoneIkResult {
  jointX: number;
  jointY: number;
  endX: number;
  endY: number;
  reachRatio: number;
}

export const RETARGET_PRESETS: Record<
  MotionRetargetStyle,
  { label: string; config: MotionRetargetConfig }
> = {
  NATURAL_HUMAN: {
    label: 'Natural Human',
    config: {
      style: 'NATURAL_HUMAN',
      strideScale: 1.0,
      armAmplitude: 1.0,
      expressiveness: 1.0,
      phaseLag: 1.0,
    },
  },
  PRESENTER_CALM: {
    label: 'Calm Presenter',
    config: {
      style: 'PRESENTER_CALM',
      strideScale: 0.84,
      armAmplitude: 0.82,
      expressiveness: 0.88,
      phaseLag: 1.14,
    },
  },
  CINEMATIC_HERO: {
    label: 'Cinematic Hero',
    config: {
      style: 'CINEMATIC_HERO',
      strideScale: 1.14,
      armAmplitude: 1.18,
      expressiveness: 1.2,
      phaseLag: 0.92,
    },
  },
  ENERGETIC_CREATOR: {
    label: 'Energetic Reel',
    config: {
      style: 'ENERGETIC_CREATOR',
      strideScale: 1.22,
      armAmplitude: 1.32,
      expressiveness: 1.34,
      phaseLag: 1.25,
    },
  },
};

/**
 * Analytical Law-of-Cosines 2-Bone IK Solver with pole vector & soft extension limit.
 */
export function solveTwoBoneIK(
  rootX: number,
  rootY: number,
  targetX: number,
  targetY: number,
  len1: number,
  len2: number,
  poleDirX: number,
  poleDirY: number,
  softLimit = 0.97
): TwoBoneIkResult {
  const vx = targetX - rootX;
  const vy = targetY - rootY;
  const rawDist = Math.hypot(vx, vy);
  const ux = rawDist > 1e-4 ? vx / rawDist : 0;
  const uy = rawDist > 1e-4 ? vy / rawDist : 1;

  const clampedSoft = Math.max(0.85, Math.min(0.996, softLimit));
  const maxReach = (len1 + len2) * clampedSoft;
  const minReach = Math.abs(len1 - len2) + 2;
  const dist = Math.max(minReach, Math.min(maxReach, rawDist));

  // Choose perpendicular normal aligned with anatomical pole vector
  const pAx = -uy;
  const pAy = ux;
  const dotA = pAx * poleDirX + pAy * poleDirY;
  const px = dotA >= 0 ? pAx : uy;
  const py = dotA >= 0 ? pAy : -ux;

  const cosAlpha = Math.max(
    -1,
    Math.min(1, (len1 * len1 + dist * dist - len2 * len2) / (2 * len1 * dist))
  );
  const sinAlpha = Math.sqrt(Math.max(0, 1 - cosAlpha * cosAlpha));

  const jointX = rootX + (ux * cosAlpha + px * sinAlpha) * len1;
  const jointY = rootY + (uy * cosAlpha + py * sinAlpha) * len1;
  const endX = rootX + ux * dist;
  const endY = rootY + uy * dist;

  return {
    jointX,
    jointY,
    endX,
    endY,
    reachRatio: dist / Math.max(1, len1 + len2),
  };
}

/**
 * Damped Least Squares (Levenberg-Marquardt) 2-Bone IK refinement:
 * Delta_theta = J^T * (J * J^T + lambda^2 * I)^(-1) * e
 * Eliminates joint popping and singularities near full leg/arm extension.
 */
export function solveDlsTwoBoneIK(
  rootX: number,
  rootY: number,
  targetX: number,
  targetY: number,
  len1: number,
  len2: number,
  poleDirX: number,
  poleDirY: number,
  softLimit = 0.97
): TwoBoneIkResult {
  const seed = solveTwoBoneIK(
    rootX,
    rootY,
    targetX,
    targetY,
    len1,
    len2,
    poleDirX,
    poleDirY,
    softLimit
  );

  // Clamp effective target inside soft reach envelope before DLS iterations
  const tvx = targetX - rootX;
  const tvy = targetY - rootY;
  const rawDist = Math.hypot(tvx, tvy);
  const maxReach = (len1 + len2) * Math.max(0.85, Math.min(0.996, softLimit));
  const minReach = Math.abs(len1 - len2) + 2;
  const effDist = Math.max(minReach, Math.min(maxReach, rawDist));
  const scale = rawDist > 1e-4 ? effDist / rawDist : 1;
  const goalX = rootX + tvx * scale;
  const goalY = rootY + tvy * scale;

  let theta1 = Math.atan2(seed.jointY - rootY, seed.jointX - rootX);
  let theta12 = Math.atan2(seed.endY - seed.jointY, seed.endX - seed.jointX);
  let theta2 = theta12 - theta1;

  // Damping constant increases near singularities / soft limit boundary
  const reachRatio = effDist / Math.max(1, len1 + len2);
  const lambda = 0.08 + Math.max(0, reachRatio - 0.88) * 1.8;
  const lambdaSq = lambda * lambda;

  for (let iter = 0; iter < 4; iter++) {
    const s1 = Math.sin(theta1);
    const c1 = Math.cos(theta1);
    const s12 = Math.sin(theta1 + theta2);
    const c12 = Math.cos(theta1 + theta2);

    const curX = rootX + len1 * c1 + len2 * c12;
    const curY = rootY + len1 * s1 + len2 * s12;
    const ex = goalX - curX;
    const ey = goalY - curY;
    if (ex * ex + ey * ey < 0.04) break;

    // 2x2 Jacobian J = dx / d_theta
    const j00 = -len1 * s1 - len2 * s12;
    const j01 = -len2 * s12;
    const j10 = len1 * c1 + len2 * c12;
    const j11 = len2 * c12;

    // A = J * J^T + lambda^2 * I
    const a00 = j00 * j00 + j01 * j01 + lambdaSq;
    const a01 = j00 * j10 + j01 * j11;
    const a11 = j10 * j10 + j11 * j11 + lambdaSq;

    const det = a00 * a11 - a01 * a01;
    if (Math.abs(det) < 1e-8) break;
    const invDet = 1 / det;

    // w = A^(-1) * e
    const wx = (a11 * ex - a01 * ey) * invDet;
    const wy = (-a01 * ex + a00 * ey) * invDet;

    // Delta_theta = J^T * w
    const dTheta1 = j00 * wx + j10 * wy;
    const dTheta2 = j01 * wx + j11 * wy;

    theta1 += clamp(dTheta1, -0.35, 0.35);
    theta2 += clamp(dTheta2, -0.35, 0.35);
  }

  const jointX = rootX + len1 * Math.cos(theta1);
  const jointY = rootY + len1 * Math.sin(theta1);
  const endX = jointX + len2 * Math.cos(theta1 + theta2);
  const endY = jointY + len2 * Math.sin(theta1 + theta2);

  return {
    jointX,
    jointY,
    endX,
    endY,
    reachRatio,
  };
}

/**
 * Ground Contact Lock rule:
 * Locks end-effector against floor penetration and foot sliding when
 * v_foot < 0.02 m/s (or grounded stance) and y >= groundY until heel-off.
 */
export function applyGroundContactLock(
  targetX: number,
  targetY: number,
  anchorX: number,
  groundY: number,
  footVelRatio: number,
  isStancePhase: boolean
): { x: number; y: number; locked: boolean } {
  const nearGround = targetY >= groundY - 1.5;
  const lowVelocity = footVelRatio < 0.02;
  if (nearGround && (lowVelocity || isStancePhase)) {
    const blend = lowVelocity ? 0.85 : 0.65;
    return {
      x: anchorX * blend + targetX * (1 - blend),
      y: groundY,
      locked: true,
    };
  }
  return {
    x: targetX,
    y: Math.min(groundY, targetY),
    locked: false,
  };
}

/**
 * Segment mass distribution & Zero-Moment Point (ZMP) stability balance:
 * CoM_total = Sum(m_i * r_i) / M_total
 * x_ZMP = x_CoM - (z_CoM / (z_dd_CoM + g)) * x_dd_CoM
 */
export function computeCoMAndZmpBalance(params: {
  headX: number;
  headY: number;
  torsoX: number;
  torsoY: number;
  lArmX: number;
  lArmY: number;
  rArmX: number;
  rArmY: number;
  lLegX: number;
  lLegY: number;
  rLegX: number;
  rLegY: number;
  accelX: number;
  accelZ: number;
  bosMinX: number;
  bosMaxX: number;
}): {
  comX: number;
  comY: number;
  zmpX: number;
  pelvisCorrectionX: number;
} {
  // Anthropometric segment mass ratios (sum = 1.0)
  const mHead = 0.08;
  const mTorso = 0.5;
  const mArm = 0.05;
  const mLeg = 0.16;

  const comX =
    mHead * params.headX +
    mTorso * params.torsoX +
    mArm * params.lArmX +
    mArm * params.rArmX +
    mLeg * params.lLegX +
    mLeg * params.rLegX;

  const comY =
    mHead * params.headY +
    mTorso * params.torsoY +
    mArm * params.lArmY +
    mArm * params.rArmY +
    mLeg * params.lLegY +
    mLeg * params.rLegY;

  // Convert vertical CoM height above ground into meters (~0.92 m nominal standing)
  const zComMeters = 0.92;
  const g = 9.81;
  const denom = Math.max(2.0, g + params.accelZ);
  const zmpOffsetPx = (zComMeters / denom) * params.accelX * 16;
  const zmpX = comX - zmpOffsetPx;

  const clampedZmpX = clamp(zmpX, params.bosMinX, params.bosMaxX);
  const pelvisCorrectionX = (clampedZmpX - zmpX) * 0.55;

  return {
    comX,
    comY,
    zmpX,
    pelvisCorrectionX,
  };
}

/**
 * Recommended Cubic Bezier realism curves:
 * B(t) = (1-t)^3 P0 + 3(1-t)^2 t P1 + 3(1-t) t^2 P2 + t^3 P3
 */
export const REALISM_BEZIER_CURVES = {
  NATURAL_REACH: [0.25, 0.1, 0.25, 1.0] as const,
  FAST_BURST: [0.16, 1.0, 0.3, 1.0] as const,
  HEAVY_LIFT: [0.55, 0.05, 0.68, 0.19] as const,
};

export function evaluateCubicBezierEase(
  t: number,
  x1: number,
  y1: number,
  x2: number,
  y2: number
): number {
  const targetX = clamp(t, 0, 1);
  if (targetX <= 0) return 0;
  if (targetX >= 1) return 1;

  // Binary search parametric u such that Bezier_X(u) == targetX (monotonically increasing)
  let lo = 0;
  let hi = 1;
  let u = targetX;
  for (let i = 0; i < 10; i++) {
    u = 0.5 * (lo + hi);
    const inv = 1 - u;
    const bx = 3 * inv * inv * u * x1 + 3 * inv * u * u * x2 + u * u * u;
    if (bx < targetX) {
      lo = u;
    } else {
      hi = u;
    }
  }
  const inv = 1 - u;
  return 3 * inv * inv * u * y1 + 3 * inv * u * u * y2 + u * u * u;
}

/**
 * 5-second / 120-frame physical beat pacing envelope:
 * - [0.00 - 0.25]: Stance & Micro-Movement
 * - [0.25 - 0.50]: Anticipation & Weight Shift (eyes lead turn, pelvis shifts over lead leg)
 * - [0.50 - 0.79]: Primary Action (Peak Velocity)
 * - [0.79 - 1.00]: Deceleration & Settle (Follow-Through)
 */
export interface ScenePhysicalBeats {
  stanceMicro: number;
  anticipationShift: number;
  eyeLeadFactor: number;
  primaryActionGain: number;
  settleFollowThrough: number;
}

export function evaluateSceneActionBeats(progress: number): ScenePhysicalBeats {
  const p = clamp(progress, 0, 1);
  const [nx1, ny1, nx2, ny2] = REALISM_BEZIER_CURVES.NATURAL_REACH;
  const [fx1, fy1, fx2, fy2] = REALISM_BEZIER_CURVES.FAST_BURST;

  // Beat 1 [0.00..0.25]: Stance & Micro-movement ramps up smoothly
  const stanceMicro =
    p < 0.25 ? evaluateCubicBezierEase(p / 0.25, nx1, ny1, nx2, ny2) : 1.0;

  // Beat 2 [0.25..0.50]: Anticipation & lateral weight shift; eyes lead before body
  const eyeLeadFactor =
    p < 0.2
      ? 0.25 * (p / 0.2)
      : p < 0.45
        ? 0.25 + 0.75 * evaluateCubicBezierEase((p - 0.2) / 0.25, nx1, ny1, nx2, ny2)
        : 1.0;
  const anticipationShift =
    p < 0.22
      ? 0.15
      : p < 0.5
        ? 0.15 + 0.85 * evaluateCubicBezierEase((p - 0.22) / 0.28, nx1, ny1, nx2, ny2)
        : 1.0;

  // Beat 3 [0.50..0.79]: Primary Action peak velocity via Fast Burst spline
  let primaryActionGain = 0.28;
  if (p < 0.25) {
    primaryActionGain = 0.24 + 0.14 * stanceMicro;
  } else if (p < 0.5) {
    primaryActionGain =
      0.38 + 0.34 * evaluateCubicBezierEase((p - 0.25) / 0.25, nx1, ny1, nx2, ny2);
  } else if (p < 0.79) {
    primaryActionGain =
      0.72 + 0.28 * evaluateCubicBezierEase((p - 0.5) / 0.29, fx1, fy1, fx2, fy2);
  } else {
    // Beat 4 [0.79..1.00]: Deceleration & settle into relaxed grounded hold
    const decel = evaluateCubicBezierEase((p - 0.79) / 0.21, nx1, ny1, nx2, ny2);
    primaryActionGain = 1.0 - 0.22 * decel;
  }

  // Beat 4 [0.79..1.00]: Follow-through settle curve
  const settleFollowThrough =
    p >= 0.79 ? evaluateCubicBezierEase((p - 0.79) / 0.21, nx1, ny1, nx2, ny2) : 0;

  return {
    stanceMicro,
    anticipationShift,
    eyeLeadFactor,
    primaryActionGain,
    settleFollowThrough,
  };
}

/**
 * Secondary Motion & Follow-Through Spring-Damper Physics:
 * F = -k * x - c * v, a = (-k * (x_current - x_target) - c * v_current) / m
 * Critical damping: c = 2 * sqrt(m * k)
 */
export interface SpringDamperState {
  value: number;
  velocity: number;
}

export function stepSpringDamper(
  state: SpringDamperState,
  target: number,
  stiffnessK: number,
  massM: number,
  dt: number,
  dampingFactor = 0.86
): SpringDamperState {
  const safeDt = clamp(dt, 0.001, 0.05);
  const safeM = Math.max(0.1, massM);
  const cCrit = 2 * Math.sqrt(safeM * Math.max(0.5, stiffnessK));
  const c = cCrit * clamp(dampingFactor, 0.35, 1.35);

  const subSteps = safeDt > 0.02 ? 2 : 1;
  const h = safeDt / subSteps;
  let x = state.value;
  let v = state.velocity;

  for (let i = 0; i < subSteps; i++) {
    const accel = (-stiffnessK * (x - target) - c * v) / safeM;
    v += accel * h;
    x += v * h;
  }

  return { value: x, velocity: v };
}

function clamp(v: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, v));
}

function rgbToHex(r: number, g: number, b: number): string {
  const toHex = (n: number) => clamp(Math.round(n), 0, 255).toString(16).padStart(2, '0');
  return `#${toHex(r)}${toHex(g)}${toHex(b)}`.toUpperCase();
}

export interface AutoRigAnalysisResult {
  eyeLineOffset: number;
  mouthLineOffset: number;
  faceZoom: number;
  skinTone: string;
  rig: RigProportions;
}

/**
 * Analyzes an actor's portrait or full-body photo in RAM via YCbCr skin chrominance,
 * eye-valley luminance, lip-Cr peaks, and foreground silhouette width ratios to
 * compute calibrated facial landmarks and skeletal rig proportions.
 */
export async function autoRigActorFromImage(
  imageUrl: string,
  actor: ActorProfile
): Promise<AutoRigAnalysisResult> {
  const img = await new Promise<HTMLImageElement>((resolve, reject) => {
    const el = new Image();
    el.onload = () => resolve(el);
    el.onerror = () => reject(new Error('Unable to load actor image for auto-rigging.'));
    el.src = imageUrl;
  });

  const targetW = 160;
  const targetH = Math.max(120, Math.round((img.height / Math.max(1, img.width)) * targetW));
  const canvas = document.createElement('canvas');
  canvas.width = targetW;
  canvas.height = targetH;
  const ctx = canvas.getContext('2d');
  if (!ctx) {
    throw new Error('2D canvas unavailable for auto-rig analysis.');
  }

  ctx.drawImage(img, 0, 0, targetW, targetH);
  const { data } = ctx.getImageData(0, 0, targetW, targetH);

  // Sample background corners
  let bgR = 0;
  let bgG = 0;
  let bgB = 0;
  const cornerPts = [
    [4, 4],
    [targetW - 5, 4],
    [4, Math.floor(targetH * 0.25)],
    [targetW - 5, Math.floor(targetH * 0.25)],
  ];
  for (const [cx, cy] of cornerPts) {
    const idx = (cy * targetW + cx) * 4;
    bgR += data[idx];
    bgG += data[idx + 1];
    bgB += data[idx + 2];
  }
  bgR /= cornerPts.length;
  bgG /= cornerPts.length;
  bgB /= cornerPts.length;

  // Scan upper/center zone for YCbCr skin pixels to locate face & skin tone
  const scanX0 = Math.floor(targetW * 0.2);
  const scanX1 = Math.ceil(targetW * 0.8);
  const scanY0 = Math.floor(targetH * 0.03);
  const scanY1 = Math.ceil(targetH * 0.66);

  const rowSkinCounts = new Float32Array(targetH);
  const rowLumaAvg = new Float32Array(targetH);
  const rowLipScore = new Float32Array(targetH);

  let skinSumR = 0;
  let skinSumG = 0;
  let skinSumB = 0;
  let skinPixels = 0;

  for (let y = scanY0; y < scanY1; y++) {
    let rowLumaSum = 0;
    let rowLumaN = 0;
    let rowCrMaxSum = 0;

    for (let x = scanX0; x < scanX1; x++) {
      const idx = (y * targetW + x) * 4;
      const r = data[idx];
      const g = data[idx + 1];
      const b = data[idx + 2];

      const yLum = 0.299 * r + 0.587 * g + 0.114 * b;
      const cb = 128 - 0.168736 * r - 0.331264 * g + 0.5 * b;
      const cr = 128 + 0.5 * r - 0.418688 * g - 0.081312 * b;

      const bgDist = Math.hypot(r - bgR, g - bgG, b - bgB);
      const isSkin =
        bgDist > 26 &&
        yLum > 42 &&
        cb >= 76 &&
        cb <= 130 &&
        cr >= 132 &&
        cr <= 176;

      if (isSkin) {
        rowSkinCounts[y] += 1;
        skinSumR += r;
        skinSumG += g;
        skinSumB += b;
        skinPixels += 1;
        rowLumaSum += yLum;
        rowLumaN += 1;
        if (Math.abs(x - targetW * 0.5) < targetW * 0.12) {
          rowCrMaxSum += Math.max(0, cr - cb);
        }
      }
    }

    rowLumaAvg[y] = rowLumaN > 0 ? rowLumaSum / rowLumaN : 160;
    rowLipScore[y] = rowLumaN > 0 ? rowCrMaxSum / rowLumaN : 0;
  }

  // Locate primary vertical face span where skin pixel density exceeds threshold
  let peakSkin = 0;
  for (let y = scanY0; y < scanY1; y++) {
    if (rowSkinCounts[y] > peakSkin) peakSkin = rowSkinCounts[y];
  }

  let faceTopY = Math.floor(targetH * 0.12);
  let faceBottomY = Math.floor(targetH * 0.52);
  if (peakSkin >= 6) {
    const thresh = peakSkin * 0.35;
    let foundTop = -1;
    let foundBot = -1;
    for (let y = scanY0; y < scanY1; y++) {
      if (rowSkinCounts[y] >= thresh) {
        if (foundTop === -1) foundTop = y;
        foundBot = y;
      } else if (foundTop !== -1 && y - foundBot > targetH * 0.06) {
        break;
      }
    }
    if (foundTop !== -1 && foundBot - foundTop > targetH * 0.1) {
      faceTopY = foundTop;
      faceBottomY = foundBot;
    }
  }

  const faceHeight = Math.max(20, faceBottomY - faceTopY);

  // Locate eye valley (darkest horizontal band in upper 22%..50% of face)
  let bestEyeY = faceTopY + faceHeight * 0.39;
  let minEyeLuma = Infinity;
  const eyeSearch0 = Math.floor(faceTopY + faceHeight * 0.2);
  const eyeSearch1 = Math.ceil(faceTopY + faceHeight * 0.5);
  for (let y = eyeSearch0; y < eyeSearch1; y++) {
    if (rowSkinCounts[y] > 3 && rowLumaAvg[y] < minEyeLuma) {
      minEyeLuma = rowLumaAvg[y];
      bestEyeY = y;
    }
  }

  // Locate mouth line (strongest red-chrominance delta in 56%..82% of face)
  let bestMouthY = faceTopY + faceHeight * 0.66;
  let maxMouthCr = -1;
  const mouthSearch0 = Math.floor(faceTopY + faceHeight * 0.54);
  const mouthSearch1 = Math.ceil(faceTopY + faceHeight * 0.84);
  for (let y = mouthSearch0; y < mouthSearch1; y++) {
    if (rowSkinCounts[y] > 3 && rowLipScore[y] > maxMouthCr) {
      maxMouthCr = rowLipScore[y];
      bestMouthY = y;
    }
  }

  const eyeNormInFace = (bestEyeY - faceTopY) / faceHeight;
  const mouthNormInFace = (bestMouthY - faceTopY) / faceHeight;
  const eyeLineOffset = Number(clamp(eyeNormInFace - 0.39, -0.11, 0.11).toFixed(2));
  const mouthLineOffset = Number(clamp(mouthNormInFace - 0.66, -0.11, 0.11).toFixed(2));

  const faceHeightRatio = faceHeight / targetH;
  const idealRatio = targetH / targetW > 1.15 ? 0.22 : 0.44;
  const faceZoom = Number(clamp(idealRatio / Math.max(0.12, faceHeightRatio), 0.82, 1.32).toFixed(2));

  const skinTone =
    skinPixels > 25
      ? rgbToHex(skinSumR / skinPixels, skinSumG / skinPixels, skinSumB / skinPixels)
      : actor.skinTone;

  // Measure foreground silhouette spans at shoulder & hip rows for skeleton proportion fitting
  const measureRowWidth = (normY: number): number => {
    const y = clamp(Math.round(targetH * normY), 0, targetH - 1);
    let minX = targetW;
    let maxX = -1;
    for (let x = 2; x < targetW - 2; x++) {
      const idx = (y * targetW + x) * 4;
      const dist = Math.hypot(data[idx] - bgR, data[idx + 1] - bgG, data[idx + 2] - bgB);
      if (dist > 32 && data[idx + 3] > 80) {
        if (x < minX) minX = x;
        if (x > maxX) maxX = x;
      }
    }
    return maxX > minX ? (maxX - minX) / targetW : 0.42;
  };

  const isFullBodyAspect = targetH / targetW > 1.12;
  const shoulderSpan = measureRowWidth(isFullBodyAspect ? 0.27 : 0.72);
  const hipSpan = measureRowWidth(isFullBodyAspect ? 0.52 : 0.9);

  const shoulderWidthRatio = Number(
    clamp(shoulderSpan / (isFullBodyAspect ? 0.44 : 0.68), 0.82, 1.22).toFixed(2)
  );
  const hipWidthRatio = Number(
    clamp(hipSpan / (isFullBodyAspect ? 0.38 : 0.64), 0.82, 1.2).toFixed(2)
  );
  const torsoLengthRatio = Number(
    clamp(1 + (faceTopY / targetH - (isFullBodyAspect ? 0.08 : 0.14)) * 0.45, 0.88, 1.14).toFixed(2)
  );
  const armLengthRatio = Number(
    clamp(0.95 + (shoulderWidthRatio - 1) * 0.45, 0.88, 1.16).toFixed(2)
  );
  const legLengthRatio = Number(
    clamp(isFullBodyAspect ? 1.02 - (faceHeightRatio - 0.2) * 0.4 : 1.0, 0.88, 1.16).toFixed(2)
  );

  const autoRigSummary = `Face ${Math.round((faceTopY / targetH) * 100)}%-${Math.round((faceBottomY / targetH) * 100)}% · Eyes ${eyeLineOffset >= 0 ? '+' : ''}${eyeLineOffset.toFixed(2)} · Mouth ${mouthLineOffset >= 0 ? '+' : ''}${mouthLineOffset.toFixed(2)} · Shoulders ${shoulderWidthRatio.toFixed(2)}x`;

  return {
    eyeLineOffset,
    mouthLineOffset,
    faceZoom,
    skinTone,
    rig: {
      shoulderWidthRatio,
      hipWidthRatio,
      torsoLengthRatio,
      armLengthRatio,
      legLengthRatio,
      autoRigSummary,
    },
  };
}
