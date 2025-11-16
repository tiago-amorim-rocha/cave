/**
 * Spider Controller Math Utilities
 *
 * Pure math functions ported from Unity's SpiderController.cs
 * All angles in degrees (for readability) - converted to radians internally for trig
 *
 * Key functions:
 * - deltaAngle: Shortest angular difference (Unity's Mathf.DeltaAngle)
 * - normalizeAngle180: Wrap angle to [-180, 180]
 * - computeJointLimitTorque: PD controller for soft joint limits
 * - applyMirrorIfNeeded: Mirror left/right leg limits
 */

const ANGLE_EPSILON = 0.0001; // From Unity: internal const float AngleEpsilon

/**
 * Calculate the shortest difference between two angles in degrees
 * Returns value in range [-180, 180]
 *
 * This is Unity's Mathf.DeltaAngle equivalent
 *
 * @param from - Current angle in degrees
 * @param to - Target angle in degrees
 * @returns Shortest angular difference in degrees
 */
export function deltaAngle(from: number, to: number): number {
  let diff = (to - from) % 360;

  // Normalize to [-180, 180]
  if (diff > 180) {
    diff -= 360;
  } else if (diff < -180) {
    diff += 360;
  }

  return diff;
}

/**
 * Normalize an angle to [-180, 180] range
 *
 * From Unity SpiderController.cs line 383-387
 *
 * @param angleDeg - Angle in degrees
 * @returns Normalized angle in degrees
 */
export function normalizeAngle180(angleDeg: number): number {
  return deltaAngle(0, angleDeg);
}

/**
 * Clamp a value between min and max
 *
 * @param value - Value to clamp
 * @param min - Minimum value
 * @param max - Maximum value
 * @returns Clamped value
 */
export function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

/**
 * Normalize a joint limit range to ensure min <= max
 * Modifies the input values in-place
 *
 * From Unity SpiderController.cs line 389-401
 *
 * @param range - Object with freeMin and freeMax properties (modified in place)
 */
export function normalizeLimitRange(range: { freeMin: number; freeMax: number }): void {
  range.freeMin = normalizeAngle180(range.freeMin);
  range.freeMax = normalizeAngle180(range.freeMax);

  // Ensure freeMin <= freeMax (simple, non-wrapping interval)
  if (range.freeMin > range.freeMax) {
    const tmp = range.freeMin;
    range.freeMin = range.freeMax;
    range.freeMax = tmp;
  }
}

/**
 * Compute joint limit torque using PD controller
 *
 * This creates a spring-like force that pushes the joint back into
 * the allowed range when it goes outside.
 *
 * From Unity SpiderController.cs line 360-381
 *
 * @param parentDeg - Parent body rotation in degrees
 * @param childDeg - Child body rotation in degrees
 * @param freeMin - Minimum allowed relative angle in degrees
 * @param freeMax - Maximum allowed relative angle in degrees
 * @param kp - Proportional gain (stiffness)
 * @param kd - Derivative gain (damping)
 * @param parentAngVel - Parent angular velocity in deg/s
 * @param childAngVel - Child angular velocity in deg/s
 * @returns Torque to apply to child body
 */
export function computeJointLimitTorque(
  parentDeg: number,
  childDeg: number,
  freeMin: number,
  freeMax: number,
  kp: number,
  kd: number,
  parentAngVel: number,
  childAngVel: number
): number {
  // Normalize limit range
  const range = { freeMin, freeMax };
  normalizeLimitRange(range);

  // Relative angle child - parent (childDeg - parentDeg) in [-180,180]
  const rel = deltaAngle(parentDeg, childDeg);

  // Inside free range: no limit torque
  if (rel >= range.freeMin && rel <= range.freeMax) {
    return 0;
  }

  // Outside free range: pull back to nearest boundary
  const targetRel = clamp(rel, range.freeMin, range.freeMax);

  const errorRel = targetRel - rel;
  const relVel = childAngVel - parentAngVel;

  // PD controller: P term pushes toward target, D term damps motion
  return kp * errorRel - kd * relVel;
}

/**
 * Mirror a signed joint limit range for left/right leg symmetry
 *
 * From Unity SpiderController.cs line 643-654
 *
 * @param isLeft - True for left leg, false for right leg
 * @param range - Object with freeMin and freeMax properties (modified in place for right leg)
 */
export function applyMirrorIfNeeded(isLeft: boolean, range: { freeMin: number; freeMax: number }): void {
  if (!isLeft) {
    // Mirror the range for right leg: swap and negate
    const mirroredMin = -range.freeMax;
    const mirroredMax = -range.freeMin;
    range.freeMin = mirroredMin;
    range.freeMax = mirroredMax;
  }

  // Normalize after mirroring
  normalizeLimitRange(range);
}

/**
 * Convert angle in degrees to direction vector
 *
 * From Unity SpiderController.cs line 326-333
 *
 * @param angleDeg - Angle in degrees (0 = right, 90 = up)
 * @returns Unit direction vector
 */
export function angleToDir(angleDeg: number): { x: number; y: number } {
  if (Math.abs(angleDeg) < ANGLE_EPSILON) {
    return { x: 1, y: 0 }; // Optimization for 0 degrees
  }

  const rad = angleDeg * (Math.PI / 180);
  return {
    x: Math.cos(rad),
    y: Math.sin(rad)
  };
}

/**
 * Rotate a direction vector by a delta angle
 *
 * From Unity SpiderController.cs line 335-344
 *
 * @param dir - Direction vector to rotate
 * @param deltaAngleDeg - Angle to rotate by in degrees
 * @returns Rotated direction vector
 */
export function rotateDir(dir: { x: number; y: number }, deltaAngleDeg: number): { x: number; y: number } {
  if (Math.abs(deltaAngleDeg) < ANGLE_EPSILON) {
    return dir; // Optimization for zero rotation
  }

  const rad = deltaAngleDeg * (Math.PI / 180);
  const c = Math.cos(rad);
  const s = Math.sin(rad);

  return {
    x: c * dir.x - s * dir.y,
    y: s * dir.x + c * dir.y
  };
}

/**
 * Convert degrees to radians
 * Helper for Rapier physics (which uses radians)
 */
export function degToRad(deg: number): number {
  return deg * (Math.PI / 180);
}

/**
 * Convert radians to degrees
 * Helper for displaying Rapier physics values
 */
export function radToDeg(rad: number): number {
  return rad * (180 / Math.PI);
}
