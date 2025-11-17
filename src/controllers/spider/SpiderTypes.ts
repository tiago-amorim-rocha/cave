/**
 * Spider Controller Type Definitions for Box2D
 * Ported from Unity's SpiderController.cs
 */

import type { b2Body } from '@box2d/core';

/**
 * Runtime leg data structure
 * Holds references to the three segment bodies plus foot
 */
export interface ControllerLeg {
  /** Hip segment body (segment1: body -> knee) */
  hip: b2Body;

  /** Knee segment body (segment2: knee -> ankle) */
  knee: b2Body;

  /** Ankle segment body (segment3: ankle -> foot) */
  ankle: b2Body;

  /** Foot body (pinned to ground) */
  foot: b2Body | null;

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
  segmentLength1: number; // hip -> knee
  segmentLength2: number; // knee -> ankle
  segmentLength3: number; // ankle -> foot

  // === Vertical Control ===
  verticalAccelGain: number;
  maxTotalFootForceY: number;

  // === Horizontal Control ===
  horizontalAccelGain: number;
  maxTotalFootForceX: number;

  // === Torque Scaling ===
  torqueGain: number;
  maxJointTorque: number;

  // === Joint Limit Springs ===
  enableHipJointLimits: boolean;
  enableKneeAnkleJointLimits: boolean;
  jointLimitKp: number;
  jointLimitKd: number;

  // === Hip Joint Limits (degrees) ===
  hipLimitFreeMin: number;
  hipLimitFreeMax: number;

  // === Knee Joint Limits (degrees) ===
  kneeLimitFreeMin: number;
  kneeLimitFreeMax: number;

  // === Ankle Joint Limits (degrees) ===
  ankleLimitFreeMin: number;
  ankleLimitFreeMax: number;

  // === Rotation Stabilization ===
  stabilizeRotation: boolean;
  targetBodyAngle: number;
  rotationStiffness: number;
  rotationDamping: number;
}

/**
 * Default spider controller configuration
 * Values extracted from Unity spider.prefab
 */
export const DEFAULT_SPIDER_CONFIG: SpiderConfig = {
  // Leg geometry
  segmentLength1: 1.3,
  segmentLength2: 1.0,
  segmentLength3: 0.7,

  // Vertical control
  verticalAccelGain: 2.0,
  maxTotalFootForceY: 20.0,

  // Horizontal control
  horizontalAccelGain: 2.0,
  maxTotalFootForceX: 20.0,

  // Torque scaling
  torqueGain: 2.0,
  maxJointTorque: 100.0,

  // Joint limit springs
  enableHipJointLimits: true,
  enableKneeAnkleJointLimits: true,
  jointLimitKp: 0.1,
  jointLimitKd: 0.05,

  // Hip joint limits (NEGATED and SWAPPED to match negated initial angles)
  // Original: min=-78.8°, max=76.5° → Negated: min=-76.5°, max=78.8°
  hipLimitFreeMin: -76.5,
  hipLimitFreeMax: 78.8,

  // Knee joint limits (NEGATED and SWAPPED to match negated initial angles)
  // Original: min=20.0°, max=150.0° → Negated: min=-150.0°, max=-20.0°
  kneeLimitFreeMin: -150.0,
  kneeLimitFreeMax: -20.0,

  // Ankle joint limits (NEGATED and SWAPPED to match negated initial angles)
  // Original: min=20.0°, max=150.0° → Negated: min=-150.0°, max=-20.0°
  ankleLimitFreeMin: -150.0,
  ankleLimitFreeMax: -20.0,

  // Rotation stabilization
  stabilizeRotation: true,
  targetBodyAngle: 0.0,
  rotationStiffness: 0.1,
  rotationDamping: 0.1,
};

/**
 * Spider body and leg assembly
 */
export interface SpiderAssembly {
  body: b2Body;
  leftLeg: ControllerLeg;
  rightLeg: ControllerLeg;
  allBodies: b2Body[];
  config: SpiderConfig;
}
