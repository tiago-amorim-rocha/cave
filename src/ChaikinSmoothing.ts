import type { Point } from './types';
import type { OptVertex } from './terrain/CanonicalGeometry';
import { chaikinWithAncestry } from './terrain/ChaikinWithAncestry';

/**
 * Chaikin smoothing with ancestry initialization convenience wrapper.
 * Returns OptVertex[] carrying canonStart/canonEnd indices.
 */
export function chaikinSmooth(
  points: Point[],
  ratio: number = 0.25,
  closed: boolean = true
): OptVertex[] {
  const withAncestry = points.map((p, i) => ({
    x: p.x,
    y: p.y,
    canonStart: i,
    canonEnd: i,
  }));

  return chaikinWithAncestry(withAncestry, 1, ratio, closed);
}

/**
 * Apply multiple iterations of ancestry-aware Chaikin smoothing.
 */
export function chaikinSmoothMultiple(
  points: Point[],
  iterations: number = 1,
  ratio: number = 0.25,
  closed: boolean = true
): OptVertex[] {
  const withAncestry = points.map((p, i) => ({
    x: p.x,
    y: p.y,
    canonStart: i,
    canonEnd: i,
  }));

  return chaikinWithAncestry(withAncestry, iterations, ratio, closed);
}
