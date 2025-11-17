/**
 * Spider Math Utilities
 * Helper functions for angle calculations and clamping
 */

/**
 * Clamp a value between min and max
 */
export function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

/**
 * Convert radians to degrees
 */
export function radToDeg(rad: number): number {
  return rad * (180 / Math.PI);
}

/**
 * Convert degrees to radians
 */
export function degToRad(deg: number): number {
  return deg * (Math.PI / 180);
}

/**
 * Normalize an angle to [-180, 180] degrees
 * Equivalent to Unity's Mathf.DeltaAngle(0, angleDeg)
 */
export function normalizeAngle180(angleDeg: number): number {
  return deltaAngle(0, angleDeg);
}

/**
 * Calculate the shortest difference between two angles
 * Equivalent to Unity's Mathf.DeltaAngle
 *
 * @param current - Current angle in degrees
 * @param target - Target angle in degrees
 * @returns Shortest angular difference in degrees, in range [-180, 180]
 */
export function deltaAngle(current: number, target: number): number {
  let delta = target - current;

  // Normalize to [-180, 180]
  while (delta > 180) delta -= 360;
  while (delta < -180) delta += 360;

  return delta;
}

/**
 * Normalize a joint limit range to ensure min <= max
 * and both are in [-180, 180]
 */
export function normalizeLimitRange(range: { min: number; max: number }): void {
  range.min = normalizeAngle180(range.min);
  range.max = normalizeAngle180(range.max);

  if (range.min > range.max) {
    const tmp = range.min;
    range.min = range.max;
    range.max = tmp;
  }
}

/**
 * Mirror a joint limit range for left/right leg symmetry
 * From Unity SpiderController.cs line 643-654
 */
export function applyMirrorIfNeeded(isLeft: boolean, range: { min: number; max: number }): void {
  if (!isLeft) {
    const mirroredMin = -range.max;
    const mirroredMax = -range.min;
    range.min = mirroredMin;
    range.max = mirroredMax;
  }

  normalizeLimitRange(range);
}

/**
 * Compute joint limit torque using PD control
 * From Unity SpiderController.cs line 360-381
 *
 * @param parentDeg - Parent body rotation in degrees
 * @param childDeg - Child body rotation in degrees
 * @param freeMin - Minimum free range angle (degrees)
 * @param freeMax - Maximum free range angle (degrees)
 * @param kp - Proportional gain
 * @param kd - Derivative gain
 * @param parentAngVel - Parent angular velocity (rad/s)
 * @param childAngVel - Child angular velocity (rad/s)
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
  const range = { min: freeMin, max: freeMax };
  normalizeLimitRange(range);

  // Relative angle child - parent (in [-180, 180])
  const rel = deltaAngle(parentDeg, childDeg);

  // Inside free range: no limit torque
  if (rel >= range.min && rel <= range.max) {
    return 0;
  }

  // Outside free range: pull back to nearest boundary
  const targetRel = clamp(rel, range.min, range.max);

  const errorRel = targetRel - rel;
  const relVel = childAngVel - parentAngVel;

  return kp * errorRel - kd * relVel;
}

/**
 * Convert angle in degrees to direction vector
 * @param angleDeg - Angle in degrees (0 = right, 90 = down in screen space)
 * @returns Unit direction vector
 */
export function angleToDir(angleDeg: number): { x: number; y: number } {
  const rad = degToRad(angleDeg);
  return {
    x: Math.cos(rad),
    y: Math.sin(rad),
  };
}

/**
 * Rotate a direction vector by an angle
 * @param dir - Direction vector to rotate
 * @param angleDeg - Rotation angle in degrees
 * @returns Rotated direction vector
 */
export function rotateDir(dir: { x: number; y: number }, angleDeg: number): { x: number; y: number } {
  const rad = degToRad(angleDeg);
  const cos = Math.cos(rad);
  const sin = Math.sin(rad);
  return {
    x: dir.x * cos - dir.y * sin,
    y: dir.x * sin + dir.y * cos,
  };
}
