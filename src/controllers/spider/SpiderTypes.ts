/**
 * Spider Controller Type Definitions
 *
 * Data structures and configuration for the spider controller
 * Ported from Unity's SpiderController.cs
 */

import type RAPIER from '@dimforge/rapier2d-compat';

/**
 * Runtime leg data structure
 * Holds references to the three segment bodies plus foot
 *
 * From Unity SpiderController.cs line 348-357
 */
export interface ControllerLeg {
  /** Hip segment rigid body (segment1: body -> knee) */
  hip: RAPIER.RigidBody;

  /** Knee segment rigid body (segment2: knee -> ankle) */
  knee: RAPIER.RigidBody;

  /** Ankle segment rigid body (segment3: ankle -> foot) */
  ankle: RAPIER.RigidBody;

  /** Foot rigid body (pinned to ground) */
  foot: RAPIER.RigidBody | null;

  /** True for left leg, false for right leg */
  isLeft: boolean;
}

/**
 * Spider controller configuration
 * All tunable parameters for the controller
 *
 * Values from Unity SpiderController.cs default inspector values
 */
export interface SpiderConfig {
  // === Leg Geometry (metres) ===
  /** Length of segment 1 (hip -> knee) */
  segmentLength1: number;

  /** Length of segment 2 (knee -> ankle) */
  segmentLength2: number;

  /** Length of segment 3 (ankle -> foot) */
  segmentLength3: number;

  // === Vertical Control ===
  /** Desired vertical acceleration per unit of input (Up/Down) */
  verticalAccelGain: number;

  /** Maximum total vertical force we will ask the feet to provide (N) */
  maxTotalFootForceY: number;

  // === Horizontal Control ===
  /** Desired horizontal acceleration per unit of input (Left/Right) */
  horizontalAccelGain: number;

  /** Maximum total horizontal force we will ask the feet to provide (N) */
  maxTotalFootForceX: number;

  // === Torque Scaling ===
  /** Torque multiplier applied to all joint torques */
  torqueGain: number;

  /** Maximum torque allowed on any joint (N⋅m) */
  maxJointTorque: number;

  // === Joint Limit Springs ===
  /** Enable hip joint limit springs */
  enableHipJointLimits: boolean;

  /** Enable knee/ankle joint limit springs */
  enableKneeAnkleJointLimits: boolean;

  /** Stiffness for joint limit springs (deg -> torque-like term) */
  jointLimitKp: number;

  /** Damping for joint limit springs (deg/s -> torque-like term) */
  jointLimitKd: number;

  // === Hip Joint Limits (degrees, relative to body) ===
  /** Minimum hip angle (relative to body) where joint is free */
  hipLimitFreeMin: number;

  /** Maximum hip angle (relative to body) where joint is free */
  hipLimitFreeMax: number;

  // === Knee Joint Limits (degrees, relative flex) ===
  /** Minimum knee flex angle where joint is free */
  kneeLimitFreeMin: number;

  /** Maximum knee flex angle where joint is free */
  kneeLimitFreeMax: number;

  // === Ankle Joint Limits (degrees, relative flex) ===
  /** Minimum ankle flex angle where joint is free */
  ankleLimitFreeMin: number;

  /** Maximum ankle flex angle where joint is free */
  ankleLimitFreeMax: number;

  // === Rotation Stabilization ===
  /** Enable PD-based body rotation compensation */
  stabilizeRotation: boolean;

  /** Target body rotation angle in degrees (0 = upright) */
  targetBodyAngle: number;

  /** Proportional gain for rotation stabilization (deg -> torque-like term) */
  rotationStiffness: number;

  /** Damping gain for rotation stabilization (deg/s -> torque-like term) */
  rotationDamping: number;
}

/**
 * Default spider controller configuration
 * Values extracted from Unity SpiderController.cs default inspector values
 *
 * Segment lengths use baseSegmentLength=1.3 with ratio=1.3:
 * - L1 = 1.3m
 * - L2 = 1.3/1.3 = 1.0m
 * - L3 = 1.0/1.3 ≈ 0.769m (rounded to 0.7m in Unity)
 */
export const DEFAULT_SPIDER_CONFIG: SpiderConfig = {
  // Leg geometry (from Unity lines 66-68)
  segmentLength1: 1.3,
  segmentLength2: 1.0,
  segmentLength3: 0.7,

  // Vertical control (from Unity lines 71-75)
  verticalAccelGain: 1.0,
  maxTotalFootForceY: 20.0,

  // Horizontal control (from Unity lines 77-82)
  horizontalAccelGain: 1.0,
  maxTotalFootForceX: 20.0,

  // Torque scaling (from Unity lines 84-86)
  torqueGain: 1.0,
  maxJointTorque: 100.0,

  // Joint limit springs (from Unity lines 88-99)
  enableHipJointLimits: true,
  enableKneeAnkleJointLimits: true,
  jointLimitKp: 10.0,
  jointLimitKd: 1.0,

  // Hip joint limits (from Unity lines 101-106)
  hipLimitFreeMin: 0.0,
  hipLimitFreeMax: 60.0,

  // Knee joint limits (from Unity lines 108-113)
  kneeLimitFreeMin: 10.0,
  kneeLimitFreeMax: 160.0,

  // Ankle joint limits (from Unity lines 115-120)
  ankleLimitFreeMin: 10.0,
  ankleLimitFreeMax: 160.0,

  // Rotation stabilization (from Unity lines 122-133)
  stabilizeRotation: true,
  targetBodyAngle: 0.0,
  rotationStiffness: 0.5,
  rotationDamping: 0.1,
};

/**
 * Spider body and leg assembly
 * Created by SpiderBuilder and used by SpiderController
 */
export interface SpiderAssembly {
  /** Main body rigid body */
  body: RAPIER.RigidBody;

  /** Left leg (3 segments + foot) */
  leftLeg: ControllerLeg;

  /** Right leg (3 segments + foot) */
  rightLeg: ControllerLeg;

  /** All rigid bodies in the spider (for cleanup and collision filtering) */
  allBodies: RAPIER.RigidBody[];

  /** Configuration used to build this spider */
  config: SpiderConfig;
}

/**
 * Joint limit range helper
 * Used internally for limit calculations
 */
export interface JointLimitRange {
  freeMin: number;
  freeMax: number;
}
