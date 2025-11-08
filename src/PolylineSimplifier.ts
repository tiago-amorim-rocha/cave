/**
 * Douglas-Peucker algorithm for polyline simplification
 * Reduces vertex count while preserving shape within epsilon tolerance
 */

export interface Point {
  x: number;
  y: number;
}

/**
 * Perpendicular distance from point to line segment
 */
function perpendicularDistance(point: Point, lineStart: Point, lineEnd: Point): number {
  const dx = lineEnd.x - lineStart.x;
  const dy = lineEnd.y - lineStart.y;

  // Handle degenerate case where line segment is a point
  const mag = Math.sqrt(dx * dx + dy * dy);
  if (mag < 1e-10) {
    const pdx = point.x - lineStart.x;
    const pdy = point.y - lineStart.y;
    return Math.sqrt(pdx * pdx + pdy * pdy);
  }

  // Distance = |cross product| / |line segment|
  const cross = Math.abs(dx * (lineStart.y - point.y) - dy * (lineStart.x - point.x));
  return cross / mag;
}

/**
 * Douglas-Peucker recursive simplification
 */
function douglasPeuckerRecursive(points: Point[], epsilon: number, startIdx: number, endIdx: number, keep: boolean[]): void {
  if (endIdx <= startIdx + 1) {
    return;
  }

  // Find point with maximum distance from line segment
  let maxDist = 0;
  let maxIdx = startIdx;

  for (let i = startIdx + 1; i < endIdx; i++) {
    const dist = perpendicularDistance(points[i], points[startIdx], points[endIdx]);
    if (dist > maxDist) {
      maxDist = dist;
      maxIdx = i;
    }
  }

  // If max distance is greater than epsilon, recursively simplify
  if (maxDist > epsilon) {
    keep[maxIdx] = true;
    douglasPeuckerRecursive(points, epsilon, startIdx, maxIdx, keep);
    douglasPeuckerRecursive(points, epsilon, maxIdx, endIdx, keep);
  }
}

/**
 * Simplify a polyline using Douglas-Peucker algorithm
 * @param points - Array of points forming the polyline
 * @param epsilon - Maximum distance tolerance (in world units)
 * @param closed - Whether the polyline is closed (first point = last point)
 * @returns Simplified polyline
 */
export function simplifyPolyline(points: Point[], epsilon: number, closed: boolean = false): Point[] {
  if (points.length <= 2) {
    return points.slice();
  }

  // Initialize keep array - always keep first and last points
  const keep = new Array(points.length).fill(false);
  keep[0] = true;
  keep[points.length - 1] = true;

  // Run Douglas-Peucker
  douglasPeuckerRecursive(points, epsilon, 0, points.length - 1, keep);

  // Build simplified result
  const result: Point[] = [];
  for (let i = 0; i < points.length; i++) {
    if (keep[i]) {
      result.push(points[i]);
    }
  }

  // For closed polylines, ensure first and last are the same
  if (closed && result.length > 0) {
    const first = result[0];
    const last = result[result.length - 1];
    if (first.x !== last.x || first.y !== last.y) {
      result.push({ x: first.x, y: first.y });
    }
  }

  return result;
}

/**
 * Simplify multiple polylines
 */
export function simplifyPolylines(polylines: Point[][], epsilon: number, closed: boolean = false): Point[][] {
  return polylines.map(polyline => simplifyPolyline(polyline, epsilon, closed));
}
