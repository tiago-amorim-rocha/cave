/**
 * Chaikin's corner-cutting algorithm for smoothing polylines
 * Creates smoother curves by replacing each edge with two shorter edges
 */

export interface Point {
  x: number;
  y: number;
}

/**
 * Apply one iteration of Chaikin corner-cutting smoothing
 * @param points - Original polyline points
 * @param ratio - Cutting ratio (0.25 = classic Chaikin, 0.5 = midpoint)
 * @param closed - Whether the polyline is closed
 * @returns Smoothed polyline with more points
 */
export function chaikinSmooth(points: Point[], ratio: number = 0.25, closed: boolean = true): Point[] {
  if (points.length < 3) {
    return points.slice(); // Not enough points to smooth
  }

  const result: Point[] = [];
  const n = closed ? points.length : points.length - 1;

  for (let i = 0; i < n; i++) {
    const p0 = points[i];
    const p1 = points[(i + 1) % points.length];

    // First cut point: ratio along the edge from p0 to p1
    const q = {
      x: p0.x * (1 - ratio) + p1.x * ratio,
      y: p0.y * (1 - ratio) + p1.y * ratio,
    };

    // Second cut point: (1-ratio) along the edge from p0 to p1
    const r = {
      x: p0.x * ratio + p1.x * (1 - ratio),
      y: p0.y * ratio + p1.y * (1 - ratio),
    };

    result.push(q, r);
  }

  // For closed polylines, ensure the last point matches the first
  if (closed && result.length > 0) {
    result.push({ x: result[0].x, y: result[0].y });
  }

  return result;
}

/**
 * Apply multiple iterations of Chaikin smoothing
 * Each iteration doubles the number of points
 */
export function chaikinSmoothMultiple(points: Point[], iterations: number = 1, ratio: number = 0.25, closed: boolean = true): Point[] {
  let result = points;
  for (let i = 0; i < iterations; i++) {
    result = chaikinSmooth(result, ratio, closed);
  }
  return result;
}
