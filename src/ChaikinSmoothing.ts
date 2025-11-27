import type { Point } from './types';
import type { OptVertex, CanonicalVertex, VertexId } from './terrain/CanonicalGeometry';
import { chaikinWithAncestry } from './terrain/ChaikinWithAncestry';

/**
 * Chaikin smoothing with ancestry initialization convenience wrapper.
 * Returns OptVertex[] carrying canonStartId/canonEndId.
 *
 * @param points - Input vertices (Point[] or CanonicalVertex[])
 * @param ratio - Chaikin cutting ratio (default 0.25)
 * @param closed - Whether the loop is closed (default true)
 */
export function chaikinSmooth(
  points: Point[] | CanonicalVertex[],
  ratio: number = 0.25,
  closed: boolean = true
): OptVertex[] {
  const withAncestry = points.map((p, i) => {
    const id = 'id' in p ? p.id : (i as VertexId);
    return {
      x: p.x,
      y: p.y,
      canonStartId: id,
      canonEndId: id,
    };
  });

  return chaikinWithAncestry(withAncestry, 1, ratio, closed);
}

/**
 * Apply multiple iterations of ancestry-aware Chaikin smoothing.
 *
 * @param points - Input vertices (Point[] or CanonicalVertex[])
 * @param iterations - Number of Chaikin iterations (default 1)
 * @param ratio - Chaikin cutting ratio (default 0.25)
 * @param closed - Whether the loop is closed (default true)
 */
export function chaikinSmoothMultiple(
  points: Point[] | CanonicalVertex[],
  iterations: number = 1,
  ratio: number = 0.25,
  closed: boolean = true
): OptVertex[] {
  const withAncestry = points.map((p, i) => {
    const id = 'id' in p ? p.id : (i as VertexId);
    return {
      x: p.x,
      y: p.y,
      canonStartId: id,
      canonEndId: id,
    };
  });

  return chaikinWithAncestry(withAncestry, iterations, ratio, closed);
}
