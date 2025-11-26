/**
 * TerrainSurgery
 *
 * Handles terrain modification through carving operations.
 * Extracts geometry from carved regions and finds matching boundary arcs
 * from existing terrain to ensure proper stitching.
 *
 * Current workflow:
 * 1. Carve operation modifies density field
 * 2. Extract new loops from dirty region (marching squares)
 * 3. Extract matching boundary arcs from existing canonical loops
 * 4. Store results for visualization and future stitching
 */

import type { DensityField } from './DensityField';
import type { MarchingSquares } from './MarchingSquares';
import type { RemeshManager } from './RemeshManager';
import type { CanonicalLoop } from './terrain/CanonicalGeometry';
import type { Point, AABB } from './types';

/**
 * Result from loop extraction in carved region
 */
export interface CarvedLoop {
  /** Vertex positions */
  loop: Point[];

  /** Whether this loop is closed */
  closed: boolean;

  /** For open loops, the two endpoints */
  endpoints?: [Point, Point];

  /** True if extracted from dirty region (new), false if from existing boundary (preserved) */
  isNew: boolean;
}

/**
 * Result from a carve operation
 */
export interface CarveSurgeryResult {
  /** Extracted loops (both new and boundary arcs) */
  loops: CarvedLoop[];

  /** Bounding box of the carved region */
  carveRegion: AABB;

  /** Statistics */
  stats: {
    newLoopCount: number;
    boundaryArcCount: number;
    mergedLoopPairs: number;
  };
}

/**
 * TerrainSurgery class
 */
export class TerrainSurgery {
  private densityField: DensityField;
  private marchingSquares: MarchingSquares;
  private remeshManager: RemeshManager;

  constructor(
    densityField: DensityField,
    marchingSquares: MarchingSquares,
    remeshManager: RemeshManager
  ) {
    this.densityField = densityField;
    this.marchingSquares = marchingSquares;
    this.remeshManager = remeshManager;
  }

  /**
   * Extract loops from a carved region
   *
   * This performs the core surgery operation:
   * 1. Run marching squares in dirty region to get new loops
   * 2. Find matching boundary arcs from existing canonical loops
   * 3. Merge adjacent open loops at boundaries
   * 4. Return combined result for visualization/stitching
   *
   * @param expandCells - Padding around dirty region (in grid cells)
   * @returns Surgery result with loops and statistics
   */
  extractCarvedLoops(expandCells: number): CarveSurgeryResult | null {
    const dirtyWorldAABB = this.densityField.getDirtyWorldAABB();
    if (!dirtyWorldAABB) {
      return null;
    }

    const h = this.densityField.config.gridPitch;

    // Convert world AABB to grid AABB with expanded padding
    const gridAABB = {
      minX: Math.max(0, Math.floor(dirtyWorldAABB.minX / h) - expandCells),
      minY: Math.max(0, Math.floor(dirtyWorldAABB.minY / h) - expandCells),
      maxX: Math.min(this.densityField.gridWidth - 2, Math.ceil(dirtyWorldAABB.maxX / h) + expandCells),
      maxY: Math.min(this.densityField.gridHeight - 2, Math.ceil(dirtyWorldAABB.maxY / h) + expandCells)
    };

    const worldMinX = gridAABB.minX * h;
    const worldMinY = gridAABB.minY * h;
    const worldMaxX = (gridAABB.maxX + 1) * h;
    const worldMaxY = (gridAABB.maxY + 1) * h;

    // Quantization step for vertex snapping (prevents floating point mismatches at boundaries)
    const quantStep = h / 4;
    const quantKey = (v: Point): string =>
      `${Math.round(v.x / quantStep)},${Math.round(v.y / quantStep)}`;

    // Expanded world AABB (includes boundary cells)
    const expandedWorldAABB = {
      minX: worldMinX,
      minY: worldMinY,
      maxX: worldMaxX,
      maxY: worldMaxY
    };

    // Check if point is inside the carved region
    const isInsideCarveRegion = (v: Point): boolean => (
      v.x >= worldMinX && v.x <= worldMaxX &&
      v.y >= worldMinY && v.y <= worldMaxY
    );

    // Set boundary for marching squares (confined to dirty region)
    this.marchingSquares.setBoundaryAABB(gridAABB);

    // Generate contours in dirty region
    const newLoopResults = this.marchingSquares.generateContours(dirtyWorldAABB, expandCells);

    // Merge adjacent open loops that touch at quantized endpoints
    const mergedNewLoops = this.mergeAdjacentOpenLoops(newLoopResults, quantKey);

    // Clear boundary after use
    this.marchingSquares.setBoundaryAABB(null);

    // Extract matching boundary arcs from existing canonical loops
    const boundaryArcs = this.extractBoundaryArcs(
      mergedNewLoops,
      expandedWorldAABB,
      isInsideCarveRegion,
      quantKey,
      quantStep
    );

    // Combine results
    const allLoops: CarvedLoop[] = [
      ...mergedNewLoops.map(r => ({ ...r, isNew: true })),
      ...boundaryArcs.map(r => ({ ...r, isNew: false }))
    ];

    const stats = {
      newLoopCount: mergedNewLoops.length,
      boundaryArcCount: boundaryArcs.length,
      mergedLoopPairs: mergedNewLoops.filter(l => !l.closed).length - newLoopResults.filter(r => r && !r.closed).length
    };

    console.log(`[TerrainSurgery] Extracted carved loops`, {
      newLoops: stats.newLoopCount,
      boundaryArcs: stats.boundaryArcCount,
      totalLoops: allLoops.length,
      mergedPairs: stats.mergedLoopPairs
    });

    return {
      loops: allLoops,
      carveRegion: expandedWorldAABB,
      stats
    };
  }

  /**
   * Merge adjacent open loops that share quantized endpoints
   * Prevents artificial splits at region boundaries
   */
  private mergeAdjacentOpenLoops(
    loops: Array<{ loop: Point[]; closed: boolean; endpoints?: [Point, Point] }>,
    quantKey: (v: Point) => string
  ): Array<{ loop: Point[]; closed: boolean; endpoints?: [Point, Point] }> {
    const open: Array<{ loop: Point[]; closed: boolean; endpoints?: [Point, Point] }> = [];
    const closed: Array<{ loop: Point[]; closed: boolean; endpoints?: [Point, Point] }> = [];
    let mergesPerformed = 0;

    // Separate open and closed loops
    for (const l of loops) {
      if (l && l.loop && l.loop.length > 0) {
        if (l.closed || !l.endpoints) {
          closed.push(l);
        } else {
          open.push(l);
        }
      }
    }

    // Iteratively merge touching loops
    let changed = true;
    while (changed) {
      changed = false;
      outer: for (let i = 0; i < open.length; i++) {
        for (let j = 0; j < open.length; j++) {
          if (i === j) continue;
          const a = open[i];
          const b = open[j];
          if (!a.endpoints || !b.endpoints) continue;

          const aEndKey = quantKey(a.endpoints[1]);
          const bStartKey = quantKey(b.endpoints[0]);

          if (aEndKey === bStartKey) {
            // Merge A then B (drop duplicate touching vertex)
            const mergedLoop = [...a.loop, ...b.loop.slice(1)];
            const mergedEndpoints: [Point, Point] = [
              a.endpoints[0],
              b.endpoints[1]
            ];
            const merged = { loop: mergedLoop, closed: false, endpoints: mergedEndpoints };

            open.splice(i, 1);
            const jIdx = j > i ? j - 1 : j;
            open.splice(jIdx, 1);
            open.push(merged);
            changed = true;
            mergesPerformed++;

            console.log('[TerrainSurgery] Merged adjacent open loops', {
              aEnd: a.endpoints[1],
              bStart: b.endpoints[0],
              mergedLength: mergedLoop.length,
              aLength: a.loop.length,
              bLength: b.loop.length
            });
            break outer;
          }
        }
      }
    }

    if (mergesPerformed > 0) {
      console.log(`[TerrainSurgery] Merged ${mergesPerformed} open loop pairs`);
    }

    return [...closed, ...open];
  }

  /**
   * Extract boundary arcs from existing canonical loops
   * Finds portions of existing loops that lie outside the carved region
   */
  private extractBoundaryArcs(
    newLoops: Array<{ loop: Point[]; closed: boolean; endpoints?: [Point, Point] }>,
    carveRegion: AABB,
    isInsideCarveRegion: (v: Point) => boolean,
    quantKey: (v: Point) => string,
    quantStep: number
  ): Array<{ loop: Point[]; closed: boolean; endpoints?: [Point, Point] }> {
    const canonicalLoops = this.remeshManager.getCanonicalLoops();
    const boundaryArcs: Array<{ loop: Point[]; closed: boolean; endpoints?: [Point, Point] }> = [];

    const arcLength = (verts: Point[]): number => {
      let len = 0;
      for (let i = 1; i < verts.length; i++) {
        const dx = verts[i].x - verts[i - 1].x;
        const dy = verts[i].y - verts[i - 1].y;
        len += Math.hypot(dx, dy);
      }
      return len;
    };

    const arcOutsideMetrics = (verts: Point[]) => {
      let total = 0;
      let outside = 0;
      for (let i = 1; i < verts.length; i++) {
        const dx = verts[i].x - verts[i - 1].x;
        const dy = verts[i].y - verts[i - 1].y;
        const segLen = Math.hypot(dx, dy);
        total += segLen;
        if (!isInsideCarveRegion(verts[i - 1]) && !isInsideCarveRegion(verts[i])) {
          outside += segLen;
        }
      }
      return { total, outside, outsideFrac: total > 0 ? outside / total : 0 };
    };

    const nearestIndex = (verts: Point[], target: Point): number => {
      let best = 0;
      let bestD2 = Infinity;
      for (let i = 0; i < verts.length; i++) {
        const dx = verts[i].x - target.x;
        const dy = verts[i].y - target.y;
        const d2 = dx * dx + dy * dy;
        if (d2 < bestD2) {
          bestD2 = d2;
          best = i;
        }
      }
      return best;
    };

    const collectArc = (verts: Point[], startIdx: number, endIdx: number): Point[] => {
      const n = verts.length;
      const result: Point[] = [];
      let idx = startIdx;
      result.push({ x: verts[idx].x, y: verts[idx].y });
      while (idx !== endIdx) {
        idx = (idx + 1) % n;
        result.push({ x: verts[idx].x, y: verts[idx].y });
      }
      return result;
    };

    // For each open loop from the new marching squares, find matching boundary arc
    newLoops.forEach((newLoop, newLoopIdx) => {
      if (newLoop.closed || !newLoop.endpoints) return;

      const [epA, epB] = newLoop.endpoints;
      let bestArc: { verts: Point[]; loopId: number; bestFrac: number; bestOutside: number } | null = null;

      for (const canonLoop of canonicalLoops) {
        if (!this.aabbsIntersect(canonLoop.aabb, carveRegion)) continue;
        const verts = canonLoop.vertices;
        if (verts.length < 2) continue;

        const iA = nearestIndex(verts, epA);
        const iB = nearestIndex(verts, epB);
        if (iA === iB) continue;

        const forward = collectArc(verts, iA, iB);
        const backward = collectArc(verts, iB, iA);
        const fMetrics = arcOutsideMetrics(forward);
        const bMetrics = arcOutsideMetrics(backward);

        let chosen = forward;
        let chosenMetrics = fMetrics;
        if (bMetrics.outsideFrac > fMetrics.outsideFrac ||
            (bMetrics.outsideFrac === fMetrics.outsideFrac && bMetrics.outside > fMetrics.outside)) {
          chosen = backward;
          chosenMetrics = bMetrics;
        }

        const arcVerts = chosen.map(v => ({ x: v.x, y: v.y }));

        if (!bestArc ||
            chosenMetrics.outsideFrac > bestArc.bestFrac ||
            (chosenMetrics.outsideFrac === bestArc.bestFrac && chosenMetrics.outside > bestArc.bestOutside)) {
          bestArc = { verts: arcVerts, loopId: canonLoop.id, bestFrac: chosenMetrics.outsideFrac, bestOutside: chosenMetrics.outside };
        }
      }

      if (bestArc && bestArc.verts.length > 1) {
        const outsidePieces = this.splitArcOutsideRegion(bestArc.verts, carveRegion, isInsideCarveRegion, quantStep);

        outsidePieces.forEach((piece, pieceIdx) => {
          if (piece.length < 2) return;
          const endpoints: [Point, Point] = [
            { ...piece[0] },
            { ...piece[piece.length - 1] }
          ];

          boundaryArcs.push({
            loop: piece,
            closed: false,
            endpoints
          });

          console.log('[TerrainSurgery] Boundary arc extracted', {
            newLoop: newLoopIdx,
            canonicalLoopId: bestArc.loopId,
            arcLength: arcLength(piece).toFixed(3),
            arcVerts: piece.length,
            outsideFrac: arcOutsideMetrics(piece).outsideFrac.toFixed(2),
            pieceIdx,
            start: endpoints[0],
            end: endpoints[1]
          });
        });
      }
    });

    return boundaryArcs;
  }

  /**
   * Split an arc into pieces that lie outside the carved region
   * Uses Liang-Barsky clipping to find intersection points
   */
  private splitArcOutsideRegion(
    verts: Point[],
    carveRegion: AABB,
    isInsideCarveRegion: (v: Point) => boolean,
    quantStep: number
  ): Point[][] {
    const result: Point[][] = [];
    if (verts.length < 2) return result;

    const edgeIntersections = (p: Point, q: Point): number[] => {
      const ts: number[] = [];
      const dx = q.x - p.x;
      const dy = q.y - p.y;
      let tEnter = 0;
      let tExit = 1;

      const clip = (pC: number, qC: number): boolean => {
        if (pC === 0) return qC >= 0;
        const r = qC / pC;
        if (pC < 0) {
          if (r > tExit) return false;
          if (r > tEnter) tEnter = r;
        } else if (pC > 0) {
          if (r < tEnter) return false;
          if (r < tExit) tExit = r;
        }
        return true;
      };

      if (
        !clip(-dx, p.x - carveRegion.minX) ||
        !clip(dx, carveRegion.maxX - p.x) ||
        !clip(-dy, p.y - carveRegion.minY) ||
        !clip(dy, carveRegion.maxY - p.y)
      ) {
        return ts;
      }

      if (tEnter > 0 && tEnter < 1) ts.push(tEnter);
      if (tExit > 0 && tExit < 1 && tExit !== tEnter) ts.push(tExit);
      ts.sort((a, b) => a - b);
      return ts;
    };

    const pointAt = (p: Point, q: Point, t: number): Point => ({
      x: Math.round((p.x + (q.x - p.x) * t) / quantStep) * quantStep,
      y: Math.round((p.y + (q.y - p.y) * t) / quantStep) * quantStep
    });

    let current: Point[] = [];

    for (let i = 0; i < verts.length - 1; i++) {
      const p = verts[i];
      const q = verts[i + 1];
      const ts = edgeIntersections(p, q);
      const pts: Point[] = [p];
      for (const t of ts) {
        pts.push(pointAt(p, q, t));
      }
      pts.push(q);

      for (let k = 0; k < pts.length - 1; k++) {
        const a = pts[k];
        const b = pts[k + 1];
        const mid = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
        const segmentOutside = !isInsideCarveRegion(mid);

        if (segmentOutside) {
          if (current.length === 0) current.push({ ...a });
          current.push({ ...b });
        } else {
          if (current.length > 1) {
            result.push(current);
          }
          current = [];
        }
      }
    }

    if (current.length > 1) {
      result.push(current);
    }

    return result;
  }

  /**
   * Check if two AABBs intersect
   */
  private aabbsIntersect(a: AABB, b: AABB): boolean {
    return !(
      a.maxX < b.minX ||
      a.minX > b.maxX ||
      a.maxY < b.minY ||
      a.minY > b.maxY
    );
  }
}
