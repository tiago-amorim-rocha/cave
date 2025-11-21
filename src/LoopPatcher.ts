/**
 * LoopPatcher
 *
 * Handles local arc replacement for efficient loop updates during carving.
 * Instead of rebuilding entire loops, this module:
 * 1. Identifies which existing loops intersect the dirty region
 * 2. Finds the arc (continuous vertex range) that needs replacement
 * 3. Stitches in the new arc from local marching squares
 * 4. Returns the patched loop for physics update
 */

import type { Point, AABB, Vec2 } from './types';

/**
 * Result from loop patching operation
 */
export interface LoopPatchResult {
  /** The patched loop with new arc stitched in */
  patchedLoop: Point[];

  /** Original loop before patching */
  originalLoop: Point[];

  /** The arc that was replaced (for debug visualization) */
  oldArc: Point[];

  /** The new arc that was stitched in (for debug visualization) */
  newArc: Point[];

  /** Start index of the replaced arc in original loop */
  arcStartIdx: number;

  /** End index of the replaced arc in original loop */
  arcEndIdx: number;

  /** AABB of the dirty region that triggered this patch */
  dirtyAABB: AABB;
}

/**
 * Configuration for loop patching
 */
export interface LoopPatchConfig {
  /** Padding around dirty region to ensure stable marching squares (in grid cells) */
  dirtyRegionPadding: number;

  /** Minimum arc length to consider for replacement (vertices) */
  minArcLength: number;

  /** Maximum distance to consider vertices as "affected" by dirty region (world units) */
  affectedDistance: number;
}

/**
 * Default configuration
 */
const DEFAULT_CONFIG: LoopPatchConfig = {
  dirtyRegionPadding: 2, // 2 grid cells padding
  minArcLength: 3, // At least 3 vertices
  affectedDistance: 0.5, // 0.5 meters
};

/**
 * LoopPatcher class
 */
export class LoopPatcher {
  private config: LoopPatchConfig;

  constructor(config?: Partial<LoopPatchConfig>) {
    this.config = { ...DEFAULT_CONFIG, ...config };
  }

  /**
   * Compute AABB from a set of vertices
   */
  computeAABB(vertices: Point[]): AABB {
    if (vertices.length === 0) {
      return { minX: 0, minY: 0, maxX: 0, maxY: 0 };
    }

    let minX = vertices[0].x;
    let minY = vertices[0].y;
    let maxX = vertices[0].x;
    let maxY = vertices[0].y;

    for (const v of vertices) {
      minX = Math.min(minX, v.x);
      minY = Math.min(minY, v.y);
      maxX = Math.max(maxX, v.x);
      maxY = Math.max(maxY, v.y);
    }

    return { minX, minY, maxX, maxY };
  }

  /**
   * Check if a point is inside an AABB
   */
  pointInAABB(point: Point, aabb: AABB): boolean {
    return (
      point.x >= aabb.minX &&
      point.x <= aabb.maxX &&
      point.y >= aabb.minY &&
      point.y <= aabb.maxY
    );
  }

  /**
   * Check if a segment (line from p1 to p2) intersects an AABB
   */
  segmentIntersectsAABB(p1: Point, p2: Point, aabb: AABB): boolean {
    // First check if either endpoint is inside AABB
    if (this.pointInAABB(p1, aabb) || this.pointInAABB(p2, aabb)) {
      return true;
    }

    // Check if segment crosses any of the 4 edges of AABB
    // This is a simplified check - could be more rigorous
    const segAABB = this.computeAABB([p1, p2]);
    return this.aabbsIntersect(segAABB, aabb);
  }

  /**
   * Check if two AABBs intersect
   */
  aabbsIntersect(a: AABB, b: AABB): boolean {
    return !(
      a.maxX < b.minX ||
      a.minX > b.maxX ||
      a.maxY < b.minY ||
      a.minY > b.maxY
    );
  }

  /**
   * Find the continuous arc in a loop that intersects with the dirty region
   * Returns [startIdx, endIdx] where loop[startIdx..endIdx] is the arc to replace
   * Returns null if no intersection found
   */
  findAffectedArc(loop: Point[], dirtyAABB: AABB): { startIdx: number; endIdx: number } | null {
    const n = loop.length;
    if (n < 3) return null;

    // Find all vertices/segments that intersect dirty region
    const affectedIndices: boolean[] = new Array(n).fill(false);

    for (let i = 0; i < n; i++) {
      const p = loop[i];
      const q = loop[(i + 1) % n];

      // Check if vertex is in AABB or if segment intersects AABB
      if (this.pointInAABB(p, dirtyAABB) || this.segmentIntersectsAABB(p, q, dirtyAABB)) {
        affectedIndices[i] = true;
      }
    }

    // Find the continuous range of affected vertices
    // For a closed loop, we need to handle wraparound
    const firstAffected = affectedIndices.indexOf(true);
    if (firstAffected === -1) {
      return null; // No intersection
    }

    // Find the last affected index
    let lastAffected = firstAffected;
    for (let i = firstAffected + 1; i < n; i++) {
      if (affectedIndices[i]) {
        lastAffected = i;
      }
    }

    // Check for wraparound (affected region crosses loop start/end)
    let startIdx = firstAffected;
    let endIdx = lastAffected;

    // Handle wraparound: check if there are affected vertices at the end that connect to the start
    if (affectedIndices[0] && affectedIndices[n - 1]) {
      // Find the actual start (working backwards from 0)
      let i = n - 1;
      while (i > lastAffected && affectedIndices[i]) {
        i--;
      }
      startIdx = i + 1; // This will be > lastAffected, indicating wraparound

      // Find the actual end (working forwards from 0)
      i = 0;
      while (i < firstAffected && affectedIndices[i]) {
        i++;
      }
      endIdx = i - 1;
    }

    // Expand arc by a few vertices on each side to ensure smooth stitching
    const expansion = 2;
    startIdx = (startIdx - expansion + n) % n;
    endIdx = (endIdx + expansion) % n;

    // Ensure minimum arc length
    const arcLength = (endIdx - startIdx + n) % n + 1;
    if (arcLength < this.config.minArcLength) {
      return null;
    }

    return { startIdx, endIdx };
  }

  /**
   * Extract an arc from a loop, handling wraparound
   */
  extractArc(loop: Point[], startIdx: number, endIdx: number): Point[] {
    const n = loop.length;
    const arc: Point[] = [];

    if (startIdx <= endIdx) {
      // Simple case: no wraparound
      for (let i = startIdx; i <= endIdx; i++) {
        arc.push(loop[i]);
      }
    } else {
      // Wraparound case: startIdx > endIdx
      for (let i = startIdx; i < n; i++) {
        arc.push(loop[i]);
      }
      for (let i = 0; i <= endIdx; i++) {
        arc.push(loop[i]);
      }
    }

    return arc;
  }

  /**
   * Find the best matching new arc from local marching squares result
   * Chooses the fragment whose endpoints are closest to the connection points
   */
  findBestMatchingArc(
    beforeLast: Point,
    afterFirst: Point,
    newFragments: Point[][]
  ): Point[] | null {
    if (newFragments.length === 0) return null;

    let bestFragment: Point[] | null = null;
    let bestDistance = Infinity;

    for (const fragment of newFragments) {
      if (fragment.length < 2) continue;

      const fragStart = fragment[0];
      const fragEnd = fragment[fragment.length - 1];

      // Calculate total distance (sum of distances to both connection points)
      const dist1 = this.distance(beforeLast, fragStart) + this.distance(fragEnd, afterFirst);
      const dist2 = this.distance(beforeLast, fragEnd) + this.distance(fragStart, afterFirst);

      const dist = Math.min(dist1, dist2);

      if (dist < bestDistance) {
        bestDistance = dist;
        bestFragment = dist1 < dist2 ? fragment : [...fragment].reverse();
      }
    }

    return bestFragment;
  }

  /**
   * Distance between two points
   */
  private distance(p1: Point, p2: Point): number {
    const dx = p2.x - p1.x;
    const dy = p2.y - p1.y;
    return Math.sqrt(dx * dx + dy * dy);
  }

  /**
   * Stitch a new arc into a loop, replacing the old arc
   *
   * @param loop - Original loop
   * @param oldArcStart - Start index of arc to replace
   * @param oldArcEnd - End index of arc to replace
   * @param newArc - New arc to stitch in
   * @param snapThreshold - Distance threshold for snapping endpoints (world units)
   */
  stitchArc(
    loop: Point[],
    oldArcStart: number,
    oldArcEnd: number,
    newArc: Point[],
    snapThreshold: number = 0.1
  ): Point[] {
    const n = loop.length;

    // Extract the parts we're keeping
    let before: Point[];
    let after: Point[];

    if (oldArcStart <= oldArcEnd) {
      // No wraparound
      before = loop.slice(0, oldArcStart);
      after = loop.slice(oldArcEnd + 1);
    } else {
      // Wraparound: arc goes from oldArcStart to end, then from 0 to oldArcEnd
      // Keep: oldArcEnd+1 to oldArcStart-1
      before = loop.slice(oldArcEnd + 1, oldArcStart);
      after = [];
    }

    // Build the patched loop
    const patched: Point[] = [];

    // Add 'before' part
    patched.push(...before);

    // Snap first point of new arc to last point of before (if close enough)
    const newArcToAdd = [...newArc];
    if (before.length > 0 && newArcToAdd.length > 0) {
      const dist = this.distance(before[before.length - 1], newArcToAdd[0]);
      if (dist < snapThreshold) {
        newArcToAdd[0] = before[before.length - 1]; // Snap to ensure continuity
      }
    }

    // Add new arc
    patched.push(...newArcToAdd);

    // Snap last point of new arc to first point of after (if close enough)
    if (after.length > 0 && patched.length > 0) {
      const dist = this.distance(patched[patched.length - 1], after[0]);
      if (dist < snapThreshold) {
        after[0] = patched[patched.length - 1]; // Snap to ensure continuity
      }
    }

    // Add 'after' part
    patched.push(...after);

    return patched;
  }

  /**
   * Main entry point: patch a loop with new contour fragments from local marching squares
   *
   * @param originalLoop - The loop to patch
   * @param dirtyAABB - The dirty region that triggered the update
   * @param newFragments - New contour fragments from local marching squares
   * @returns Patch result with old/new arcs for debug visualization, or null if no patching needed
   */
  patchLoop(
    originalLoop: Point[],
    dirtyAABB: AABB,
    newFragments: Point[][]
  ): LoopPatchResult | null {
    // Find the arc that needs replacement
    const arcInfo = this.findAffectedArc(originalLoop, dirtyAABB);
    if (!arcInfo) {
      return null; // This loop doesn't intersect the dirty region
    }

    const { startIdx, endIdx } = arcInfo;

    // Extract the old arc (for debug visualization)
    const oldArc = this.extractArc(originalLoop, startIdx, endIdx);

    // Get the connection points
    const beforeIdx = (startIdx - 1 + originalLoop.length) % originalLoop.length;
    const afterIdx = (endIdx + 1) % originalLoop.length;
    const beforeLast = originalLoop[beforeIdx];
    const afterFirst = originalLoop[afterIdx];

    // Find the best matching new arc
    const newArc = this.findBestMatchingArc(beforeLast, afterFirst, newFragments);
    if (!newArc) {
      // No suitable replacement found - return original loop unchanged
      console.warn('[LoopPatcher] No suitable replacement arc found');
      return null;
    }

    // Stitch the new arc in
    const patchedLoop = this.stitchArc(originalLoop, startIdx, endIdx, newArc);

    return {
      patchedLoop,
      originalLoop,
      oldArc,
      newArc,
      arcStartIdx: startIdx,
      arcEndIdx: endIdx,
      dirtyAABB,
    };
  }
}
