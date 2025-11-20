/**
 * Loop Cutting and Stitching Utilities
 *
 * Handles cutting loops at AABB boundaries and stitching preserved segments
 * with newly generated contours for efficient incremental physics updates.
 */

import type { AABB } from '../types';

export interface Point {
  x: number;
  y: number;
}

export interface LoopSegment {
  vertices: Point[];
  isOutside: boolean; // True if this segment is outside the dirty region
  startEdge?: 'minX' | 'maxX' | 'minY' | 'maxY'; // Which AABB edge this segment starts on
  endEdge?: 'minX' | 'maxX' | 'minY' | 'maxY'; // Which AABB edge this segment ends on
}

export interface CutLoop {
  originalAABB: AABB;
  segments: LoopSegment[];
  preservedSegments: LoopSegment[]; // Segments outside the dirty region to preserve
}

/**
 * Check if a point is inside an AABB
 */
function pointInsideAABB(p: Point, aabb: AABB): boolean {
  return p.x >= aabb.minX && p.x <= aabb.maxX &&
         p.y >= aabb.minY && p.y <= aabb.maxY;
}

/**
 * Check if a point is on the boundary of an AABB (within epsilon)
 */
function pointOnAABBBoundary(p: Point, aabb: AABB, epsilon: number = 0.001): {
  onBoundary: boolean;
  edge?: 'minX' | 'maxX' | 'minY' | 'maxY';
} {
  if (Math.abs(p.x - aabb.minX) < epsilon && p.y >= aabb.minY && p.y <= aabb.maxY) {
    return { onBoundary: true, edge: 'minX' };
  }
  if (Math.abs(p.x - aabb.maxX) < epsilon && p.y >= aabb.minY && p.y <= aabb.maxY) {
    return { onBoundary: true, edge: 'maxX' };
  }
  if (Math.abs(p.y - aabb.minY) < epsilon && p.x >= aabb.minX && p.x <= aabb.maxX) {
    return { onBoundary: true, edge: 'minY' };
  }
  if (Math.abs(p.y - aabb.maxY) < epsilon && p.x >= aabb.minX && p.x <= aabb.maxX) {
    return { onBoundary: true, edge: 'maxY' };
  }
  return { onBoundary: false };
}

/**
 * Find intersection point between line segment (p1->p2) and AABB edge
 * Returns intersection point and which edge was intersected
 */
function lineSegmentAABBIntersection(
  p1: Point,
  p2: Point,
  aabb: AABB
): { point: Point; edge: 'minX' | 'maxX' | 'minY' | 'maxY' } | null {
  const dx = p2.x - p1.x;
  const dy = p2.y - p1.y;

  // Check intersection with each edge
  const intersections: Array<{ t: number; point: Point; edge: 'minX' | 'maxX' | 'minY' | 'maxY' }> = [];

  // Left edge (minX)
  if (dx !== 0) {
    const t = (aabb.minX - p1.x) / dx;
    if (t > 0 && t < 1) {
      const y = p1.y + t * dy;
      if (y >= aabb.minY && y <= aabb.maxY) {
        intersections.push({ t, point: { x: aabb.minX, y }, edge: 'minX' });
      }
    }
  }

  // Right edge (maxX)
  if (dx !== 0) {
    const t = (aabb.maxX - p1.x) / dx;
    if (t > 0 && t < 1) {
      const y = p1.y + t * dy;
      if (y >= aabb.minY && y <= aabb.maxY) {
        intersections.push({ t, point: { x: aabb.maxX, y }, edge: 'maxX' });
      }
    }
  }

  // Bottom edge (minY)
  if (dy !== 0) {
    const t = (aabb.minY - p1.y) / dy;
    if (t > 0 && t < 1) {
      const x = p1.x + t * dx;
      if (x >= aabb.minX && x <= aabb.maxX) {
        intersections.push({ t, point: { x, y: aabb.minY }, edge: 'minY' });
      }
    }
  }

  // Top edge (maxY)
  if (dy !== 0) {
    const t = (aabb.maxY - p1.y) / dy;
    if (t > 0 && t < 1) {
      const x = p1.x + t * dx;
      if (x >= aabb.minX && x <= aabb.maxX) {
        intersections.push({ t, point: { x, y: aabb.maxY }, edge: 'maxY' });
      }
    }
  }

  // Return the closest intersection (smallest t)
  if (intersections.length === 0) return null;

  intersections.sort((a, b) => a.t - b.t);
  return { point: intersections[0].point, edge: intersections[0].edge };
}

/**
 * Cut a loop at AABB boundaries
 * Returns segments that are inside and outside the AABB
 */
export function cutLoopAtAABB(loop: Point[], aabb: AABB): CutLoop {
  if (loop.length < 2) {
    return {
      originalAABB: aabb,
      segments: [],
      preservedSegments: []
    };
  }

  const segments: LoopSegment[] = [];
  const preservedSegments: LoopSegment[] = [];
  let currentSegment: Point[] = [];
  let currentIsOutside = !pointInsideAABB(loop[0], aabb);
  let segmentStartEdge: 'minX' | 'maxX' | 'minY' | 'maxY' | undefined;

  // Add first point
  currentSegment.push({ ...loop[0] });

  // Check if first point is on boundary
  const firstBoundary = pointOnAABBBoundary(loop[0], aabb);
  if (firstBoundary.onBoundary) {
    segmentStartEdge = firstBoundary.edge;
  }

  for (let i = 0; i < loop.length; i++) {
    const p1 = loop[i];
    const p2 = loop[(i + 1) % loop.length];

    const p1Inside = pointInsideAABB(p1, aabb);
    const p2Inside = pointInsideAABB(p2, aabb);

    // Check if edge crosses AABB boundary
    if (p1Inside !== p2Inside) {
      // Edge crosses boundary - find intersection
      const intersection = lineSegmentAABBIntersection(p1, p2, aabb);

      if (intersection) {
        // Add intersection point to current segment
        currentSegment.push({ ...intersection.point });

        // Finish current segment
        const segmentEndEdge = intersection.edge;
        const segment: LoopSegment = {
          vertices: currentSegment,
          isOutside: currentIsOutside,
          startEdge: segmentStartEdge,
          endEdge: segmentEndEdge
        };
        segments.push(segment);
        if (currentIsOutside) {
          preservedSegments.push(segment);
        }

        // Start new segment with intersection point
        currentSegment = [{ ...intersection.point }];
        currentIsOutside = !p2Inside;
        segmentStartEdge = intersection.edge;
      }
    }

    // Add next point if it's not the last iteration (to avoid duplicating first point)
    if (i < loop.length - 1) {
      currentSegment.push({ ...p2 });
    }
  }

  // Close the loop by adding the final segment if it has vertices
  if (currentSegment.length > 0) {
    // Check if last point is on boundary
    const lastBoundary = pointOnAABBBoundary(currentSegment[currentSegment.length - 1], aabb);
    const segmentEndEdge = lastBoundary.onBoundary ? lastBoundary.edge : segmentStartEdge;

    const segment: LoopSegment = {
      vertices: currentSegment,
      isOutside: currentIsOutside,
      startEdge: segmentStartEdge,
      endEdge: segmentEndEdge
    };
    segments.push(segment);
    if (currentIsOutside) {
      preservedSegments.push(segment);
    }
  }

  return {
    originalAABB: aabb,
    segments,
    preservedSegments
  };
}

/**
 * Stitch boundary points to create a simple connection
 * This is a simplified version that creates straight-line connections
 */
export function stitchBoundaryPoints(
  point1: Point,
  edge1: 'minX' | 'maxX' | 'minY' | 'maxY',
  point2: Point,
  edge2: 'minX' | 'maxX' | 'minY' | 'maxY',
  aabb: AABB
): Point[] {
  // If points are on the same edge, connect them directly along the edge
  if (edge1 === edge2) {
    return [{ ...point1 }, { ...point2 }];
  }

  // If points are on adjacent edges, connect via corner
  const corners = getAdjacentCorner(edge1, edge2, aabb);
  if (corners) {
    return [{ ...point1 }, corners, { ...point2 }];
  }

  // If points are on opposite edges, connect via two corners
  const [corner1, corner2] = getOppositeCorners(edge1, edge2, aabb);
  return [{ ...point1 }, corner1, corner2, { ...point2 }];
}

/**
 * Get the corner point between two adjacent edges
 */
function getAdjacentCorner(
  edge1: 'minX' | 'maxX' | 'minY' | 'maxY',
  edge2: 'minX' | 'maxX' | 'minY' | 'maxY',
  aabb: AABB
): Point | null {
  const edgePairs: Record<string, Point> = {
    'minX-minY': { x: aabb.minX, y: aabb.minY },
    'minY-minX': { x: aabb.minX, y: aabb.minY },
    'maxX-minY': { x: aabb.maxX, y: aabb.minY },
    'minY-maxX': { x: aabb.maxX, y: aabb.minY },
    'minX-maxY': { x: aabb.minX, y: aabb.maxY },
    'maxY-minX': { x: aabb.minX, y: aabb.maxY },
    'maxX-maxY': { x: aabb.maxX, y: aabb.maxY },
    'maxY-maxX': { x: aabb.maxX, y: aabb.maxY },
  };

  return edgePairs[`${edge1}-${edge2}`] || null;
}

/**
 * Get two corners to traverse when edges are opposite
 */
function getOppositeCorners(
  edge1: 'minX' | 'maxX' | 'minY' | 'maxY',
  edge2: 'minX' | 'maxX' | 'minY' | 'maxY',
  aabb: AABB
): [Point, Point] {
  // Choose the shorter path (clockwise or counter-clockwise)
  // For simplicity, always go clockwise
  if (edge1 === 'minX' && edge2 === 'maxX') {
    return [
      { x: aabb.minX, y: aabb.minY },
      { x: aabb.maxX, y: aabb.minY }
    ];
  }
  if (edge1 === 'maxX' && edge2 === 'minX') {
    return [
      { x: aabb.maxX, y: aabb.maxY },
      { x: aabb.minX, y: aabb.maxY }
    ];
  }
  if (edge1 === 'minY' && edge2 === 'maxY') {
    return [
      { x: aabb.maxX, y: aabb.minY },
      { x: aabb.maxX, y: aabb.maxY }
    ];
  }
  if (edge1 === 'maxY' && edge2 === 'minY') {
    return [
      { x: aabb.minX, y: aabb.maxY },
      { x: aabb.minX, y: aabb.minY }
    ];
  }

  // Fallback (shouldn't happen if edges are truly opposite)
  return [
    { x: aabb.minX, y: aabb.minY },
    { x: aabb.maxX, y: aabb.maxY }
  ];
}

/**
 * Attempt to stitch preserved segments with new contours
 * This is a simplified implementation that creates boundary connections
 */
export function stitchLoops(
  preservedSegments: LoopSegment[],
  newContours: Point[][]
): Point[][] {
  // If no preserved segments, just return new contours
  if (preservedSegments.length === 0) {
    return newContours;
  }

  // If no new contours, try to close preserved segments
  if (newContours.length === 0) {
    const result: Point[][] = [];
    for (const segment of preservedSegments) {
      if (segment.vertices.length >= 2) {
        result.push([...segment.vertices]);
      }
    }
    return result;
  }

  // For now, return a simple combination: preserved segments + new contours
  // A more sophisticated algorithm would:
  // 1. Find which preserved segments connect to which new contours
  // 2. Stitch them together based on boundary edge matching
  // 3. Handle topology changes (splitting/merging)

  const result: Point[][] = [...newContours];

  // Add preserved segments as separate loops (conservative approach)
  for (const segment of preservedSegments) {
    if (segment.vertices.length >= 3) {
      result.push([...segment.vertices]);
    }
  }

  return result;
}
