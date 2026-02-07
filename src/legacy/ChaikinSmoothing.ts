import type { Point } from './types';
import type { OptVertex, CanonicalVertex, VertexId } from './terrain/CanonicalGeometry';
import { chaikinWithAncestry } from './terrain/ChaikinWithAncestry';

function isClosedByPosition(points: Array<{ x: number; y: number }>): boolean {
  if (points.length < 3) return false;
  const first = points[0];
  const last = points[points.length - 1];
  return Math.hypot(first.x - last.x, first.y - last.y) < 1e-6;
}

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
  const base = points.map((p) => ({ x: p.x, y: p.y }));
  const closedByPos = closed && isClosedByPosition(base);
  const unique = closedByPos ? base.slice(0, -1) : base;

  const withAncestry = unique.map((p, i) => {
    const id = i as VertexId;
    return {
      x: p.x,
      y: p.y,
      canonStartId: id,
      canonEndId: id,
    };
  });

  return chaikinWithAncestry(withAncestry, 1, ratio, closed, unique.length);
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
  const base = points.map((p) => ({ x: p.x, y: p.y }));
  const closedByPos = closed && isClosedByPosition(base);
  const unique = closedByPos ? base.slice(0, -1) : base;

  const withAncestry = unique.map((p, i) => {
    const id = i as VertexId;
    return {
      x: p.x,
      y: p.y,
      canonStartId: id,
      canonEndId: id,
    };
  });

  return chaikinWithAncestry(withAncestry, iterations, ratio, closed, unique.length);
}
