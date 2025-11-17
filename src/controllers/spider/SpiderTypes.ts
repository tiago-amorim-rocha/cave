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
  legSegmentWidth: number; // width of leg segment colliders (affects inertia)

  // === Mass & Inertia ===
  bodyMassScale: number;        // Multiplier for body mass (higher = heavier, more stable)
  legMassScale: number;          // Multiplier for leg segment masses (higher = less noodly)
  bodyInertiaScale: number;      // Multiplier for body rotational inertia (higher = resists rotation)
  legInertiaScale: number;       // Multiplier for leg segment inertia (higher = smoother motion)

  // === Damping ===
  bodyLinearDamping: number;     // Resistance to body linear motion
  bodyAngularDamping: number;    // Resistance to body rotation (higher = less oscillation)
  legLinearDamping: number;      // Resistance to leg linear motion (subtle)
  legAngularDamping: number;     // Resistance to leg rotation (BIG for spaghetti control)

  // === Vertical Control ===
  verticalAccelGain: number;
  maxTotalFootForceY: number;

  // === Horizontal Control ===
  horizontalAccelGain: number;
  maxTotalFootForceX: number;

  // === Torque Scaling ===
  torqueGain: number;            // Jacobian torque gain (higher = stronger pushes)
  maxJointTorque: number;        // Upper bound on torque per joint (prevents explosive wobble)

  // === Joint Springs & Limits ===
  enableHipJointLimits: boolean;
  enableKneeAnkleJointLimits: boolean;
  jointLimitKp: number;          // Stiffness of soft limit springs
  jointLimitKd: number;          // Damping of soft limit springs

  // === Joint Posture Control ===
  jointRotationKp: number;       // Stiffness of posture control (higher = snappier)
  jointRotationKd: number;       // Damping of posture control (higher = less oscillation)

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

  // === Global Physics ===
  gravityScale: number;          // Scale applied to gravity (0 = no gravity, 1 = normal)
  contactFrictionScale: number;  // Multiplier on ground friction (higher = sticky feet)
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
  legSegmentWidth: 0.1, // Default width of leg segments (metres)

  // Mass & Inertia (scale = 1.0 means use default calculated values)
  bodyMassScale: 1.0,
  legMassScale: 1.0,
  bodyInertiaScale: 1.0,
  legInertiaScale: 1.0,

  // Damping (from SpiderBuilder defaults)
  bodyLinearDamping: 0.0,
  bodyAngularDamping: 0.05,
  legLinearDamping: 0.0,
  legAngularDamping: 0.05,

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

  // Joint posture control (disabled by default - set Kp > 0 to enable)
  jointRotationKp: 0.0,
  jointRotationKd: 0.0,

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

  // Global physics
  gravityScale: 0.0,           // Zero gravity by default
  contactFrictionScale: 1.0,   // 1.0 = use default friction (0.3)
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
