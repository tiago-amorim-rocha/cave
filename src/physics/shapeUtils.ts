/**
 * Shape optimization utilities for physics and rendering
 * Applies hygiene to marching squares output before building meshes
 */

export interface Point {
  x: number;
  y: number;
}

/**
 * Remove consecutive duplicate points
 */
export function dedupe(points: Point[], epsilon = 0.001): Point[] {
  if (points.length < 2) return points;

  const result: Point[] = [points[0]];

  for (let i = 1; i < points.length; i++) {
    const prev = result[result.length - 1];
    const curr = points[i];

    const dx = curr.x - prev.x;
    const dy = curr.y - prev.y;
    const dist = Math.sqrt(dx * dx + dy * dy);

    if (dist > epsilon) {
      result.push(curr);
    }
  }

  return result;
}

/**
 * Remove edges that are too small (< threshold)
 */
export function cullTinyEdges(points: Point[], minEdgeLength: number): Point[] {
  if (points.length < 2) return points;

  const result: Point[] = [points[0]];

  for (let i = 1; i < points.length; i++) {
    const prev = result[result.length - 1];
    const curr = points[i];

    const dx = curr.x - prev.x;
    const dy = curr.y - prev.y;
    const edgeLength = Math.sqrt(dx * dx + dy * dy);

    if (edgeLength >= minEdgeLength) {
      result.push(curr);
    }
  }

  return result;
}

/**
 * Calculate signed area of a polygon (positive = CCW, negative = CW)
 */
export function signedArea(points: Point[]): number {
  if (points.length < 3) return 0;

  let area = 0;
  for (let i = 0; i < points.length; i++) {
    const p = points[i];
    const q = points[(i + 1) % points.length];
    area += (p.x * q.y - q.x * p.y);
  }

  return area / 2;
}

/**
 * Ensure points are in CCW winding order
 */
export function ensureCCW(points: Point[]): Point[] {
  if (signedArea(points) < 0) {
    return points.slice().reverse();
  }
  return points;
}

/**
 * Collapse near-collinear points
 * Removes middle point if it's nearly on the line between neighbors
 */
export function collapseCollinear(points: Point[], angleThresholdDeg = 3, distThreshold = 0.02): Point[] {
  if (points.length < 3) return points;

  const angleThresholdRad = (angleThresholdDeg * Math.PI) / 180;
  const result: Point[] = [];

  for (let i = 0; i < points.length; i++) {
    const prev = points[(i - 1 + points.length) % points.length];
    const curr = points[i];
    const next = points[(i + 1) % points.length];

    // Vectors from current to prev and next
    const v1x = prev.x - curr.x;
    const v1y = prev.y - curr.y;
    const v2x = next.x - curr.x;
    const v2y = next.y - curr.y;

    // Lengths
    const len1 = Math.sqrt(v1x * v1x + v1y * v1y);
    const len2 = Math.sqrt(v2x * v2x + v2y * v2y);

    if (len1 < 0.001 || len2 < 0.001) {
      // Degenerate case
      continue;
    }

    // Normalize
    const n1x = v1x / len1;
    const n1y = v1y / len1;
    const n2x = v2x / len2;
    const n2y = v2y / len2;

    // Dot product for angle
    const dot = n1x * n2x + n1y * n2y;
    const angle = Math.acos(Math.max(-1, Math.min(1, dot)));

    // Perpendicular distance from curr to line prev-next
    const lineVecX = next.x - prev.x;
    const lineVecY = next.y - prev.y;
    const lineLen = Math.sqrt(lineVecX * lineVecX + lineVecY * lineVecY);

    let perpDist = 0;
    if (lineLen > 0.001) {
      // Point-to-line distance
      const t = ((curr.x - prev.x) * lineVecX + (curr.y - prev.y) * lineVecY) / (lineLen * lineLen);
      const projX = prev.x + t * lineVecX;
      const projY = prev.y + t * lineVecY;
      perpDist = Math.sqrt((curr.x - projX) ** 2 + (curr.y - projY) ** 2);
    }

    // Keep point if angle is significant or perpendicular distance is large
    if (angle > angleThresholdRad || perpDist > distThreshold) {
      result.push(curr);
    }
  }

  return result;
}

/**
 * Apply all shape hygiene operations in sequence
 * This is the main function to use for cleaning up marching squares output
 * @param points - Array of points forming the polyline
 * @param gridPitch - Grid pitch in world units (metres)
 * @param angleThresholdDeg - Angle threshold in degrees for collapseCollinear (default 3°)
 */
export function cleanLoop(points: Point[], gridPitch: number, angleThresholdDeg: number = 3): Point[] {
  if (points.length < 3) return points;

  // 1. Remove consecutive duplicates
  let cleaned = dedupe(points, gridPitch * 0.1);

  // 2. Cull tiny edges (< 0.3 * gridPitch)
  cleaned = cullTinyEdges(cleaned, gridPitch * 0.3);

  // 3. Collapse near-collinear points (angle threshold, < 0.02 * gridPitch perp distance)
  cleaned = collapseCollinear(cleaned, angleThresholdDeg, gridPitch * 0.02);

  // 4. Ensure CCW winding
  cleaned = ensureCCW(cleaned);

  // 5. Final dedupe in case collapsing created duplicates
  cleaned = dedupe(cleaned, gridPitch * 0.1);

  return cleaned;
}
