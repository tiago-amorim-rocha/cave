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
import { cleanLoop } from './physics/shapeUtils';

/**
 * Result from loop extraction in carved region
 */
export interface CarvedLoop {
  /** Debug/ordering id */
  id: number;

  /** Vertex positions */
  loop: Point[];

  /** Whether this loop is closed */
  closed: boolean;

  /** For open loops, the two endpoints */
  endpoints?: [Point, Point];
  /** Canonical vertex IDs (for boundary arcs) - global IDs */
  canonicalEndpointIds?: [number, number];

  /** Canonical vertex indices (for boundary arcs) - loop-local indices (0..n-1) */
  canonicalEndpointIndices?: [number, number];

  /** True if extracted from dirty region (new), false if from existing boundary (preserved) */
  isNew: boolean;

  /** For boundary arcs: original canonical loop id */
  sourceCanonicalId?: number;
}

/**
 * Ancestry information for a segment within a stitched loop
 */
export interface SegmentAncestry {
  /** Source CarvedLoop ID this segment came from */
  sourceLoopId: number;

  /** True if from new marching squares (warm), false if from boundary arc (cold) */
  isNew: boolean;

  /** For boundary arcs: the canonical loop this originally came from */
  sourceCanonicalId?: number;

  /** For boundary arcs: the canonical vertex ID range in the original loop (global IDs) */
  canonicalEndpointIds?: [number, number];

  /** For boundary arcs: loop-local indices (0..n-1) for opt vertex lookup */
  canonicalEndpointIndices?: [number, number];

  /** Vertex range within the stitched loop (inclusive) */
  vertexRange: [number, number];

  /** Original vertices from the source CarvedLoop */
  originalVertices: Point[];
}

export interface StitchedLoop {
  id: number;
  vertices: Point[];

  /** Segment ancestry tracking - each entry describes a contiguous range of vertices */
  segments: SegmentAncestry[];
}

/**
 * Result from a carve operation
 */
export interface CarveSurgeryResult {
  /** Extracted loops (both new and boundary arcs) */
  loops: CarvedLoop[];

  /** Newly stitched canonical loops */
  stitchedLoops: StitchedLoop[];

  /** Bounding box of the carved region */
  carveRegion: AABB;

  /** Statistics */
  stats: {
    newLoopCount: number;
    boundaryArcCount: number;
    mergedLoopPairs: number;
    boundaryMergePairs: number;
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
    const innerOpenOverlapCells = 0; // keep inner open loops confined to the dirty AABB
    const outerBoundaryOverlapVertices = 0; // no extra overlap for outer boundary arcs (experiment disabled)

    // Convert world AABB to grid AABB with expanded padding
    const baseGridAABB = {
      minX: Math.max(0, Math.floor(dirtyWorldAABB.minX / h) - expandCells),
      minY: Math.max(0, Math.floor(dirtyWorldAABB.minY / h) - expandCells),
      maxX: Math.min(this.densityField.gridWidth - 2, Math.ceil(dirtyWorldAABB.maxX / h) + expandCells),
      maxY: Math.min(this.densityField.gridHeight - 2, Math.ceil(dirtyWorldAABB.maxY / h) + expandCells)
    };

    // Marching squares gets extra padding so open loops can step past the dirty AABB
    const marchingExpandCells = expandCells + innerOpenOverlapCells;
    const marchingGridAABB = {
      minX: Math.max(0, Math.floor(dirtyWorldAABB.minX / h) - marchingExpandCells),
      minY: Math.max(0, Math.floor(dirtyWorldAABB.minY / h) - marchingExpandCells),
      maxX: Math.min(this.densityField.gridWidth - 2, Math.ceil(dirtyWorldAABB.maxX / h) + marchingExpandCells),
      maxY: Math.min(this.densityField.gridHeight - 2, Math.ceil(dirtyWorldAABB.maxY / h) + marchingExpandCells)
    };

    // Use the same quantization lattice everywhere (marching squares + boundary stitching)
    const quantStep = this.marchingSquares.getQuantizationStep();

    const worldMinX = baseGridAABB.minX * h;
    const worldMinY = baseGridAABB.minY * h;
    const worldMaxX = (baseGridAABB.maxX + 1) * h;
    const worldMaxY = (baseGridAABB.maxY + 1) * h;

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
    this.marchingSquares.setBoundaryAABB(marchingGridAABB);

    // Generate contours in dirty region
    const newLoopResults = this.marchingSquares.generateContours(dirtyWorldAABB, marchingExpandCells);

    // Basic dedupe for warm (new) loops directly after marching squares (match full-heal cleanup behavior)
    const warmDedupeDistance = quantStep * 0.75; // treat endpoints within 0.75 lattice steps as duplicates
    const dedupedNewLoops = this.dedupeWarmLoops(newLoopResults, warmDedupeDistance);
    const warmDedupePairs = newLoopResults.length - dedupedNewLoops.length;
    if (warmDedupePairs > 0) {
      console.log('[TerrainSurgery] Warm loop dedupe (inner arcs)', {
        dedupeDistance: warmDedupeDistance.toFixed(4),
        before: newLoopResults.length,
        after: dedupedNewLoops.length,
        duplicatesRemoved: warmDedupePairs
      });
    }

    // Apply the same cleanup pass as full-heal: dedupe tiny edges and ensure CCW on warm loops
    const cleanedWarmLoops = this.cleanWarmLoops(dedupedNewLoops, h);
    const warmCleanupDropped = dedupedNewLoops.length - cleanedWarmLoops.length;
    if (warmCleanupDropped > 0) {
      console.log('[TerrainSurgery] Warm loop cleanup (full-heal hygiene)', {
        before: dedupedNewLoops.length,
        after: cleanedWarmLoops.length,
        dropped: warmCleanupDropped
      });
    }

    // Merge adjacent open loops that touch at quantized endpoints
    const mergedNewLoops = this.mergeAdjacentOpenLoops(cleanedWarmLoops, quantKey);

    const loopLength = (verts: Point[]): number => {
      let len = 0;
      for (let i = 1; i < verts.length; i++) {
        const dx = verts[i].x - verts[i - 1].x;
        const dy = verts[i].y - verts[i - 1].y;
        len += Math.hypot(dx, dy);
      }
      return len;
    };

    const openLoops = cleanedWarmLoops.filter(l => l && !l.closed);
    const closedLoops = cleanedWarmLoops.filter(l => l && l.closed);
    console.log('[TerrainSurgery] New marching squares results (post-warm-cleanup)', {
      total: cleanedWarmLoops.length,
      open: openLoops.length,
      closed: closedLoops.length,
      carveAABB: expandedWorldAABB
    });
    openLoops.forEach((l, idx) => {
      if (!l || !l.endpoints) return;
      const [a, b] = l.endpoints;
      console.log(`[TerrainSurgery]   Open#${idx} endpoints`, {
        a,
        b,
        length: loopLength(l.loop).toFixed(3),
        aabb: this.computeLoopAabb(l.loop)
      });
    });

    // Drop degenerate open loops whose endpoints quantize to the same key or have trivial length
    const cleanedNewLoops = mergedNewLoops.filter(l => {
      if (l.closed || !l.endpoints) return true;
      const [a, b] = l.endpoints;
      const sameKey = quantKey(a) === quantKey(b);
      const short = loopLength(l.loop) < quantStep;
      if (sameKey || short) {
        console.log('[TerrainSurgery] Dropping degenerate open loop', {
          length: loopLength(l.loop).toFixed(3),
          sameKey,
          endpoints: l.endpoints
        });
        return false;
      }
      return true;
    });

    // Clear boundary after use
    this.marchingSquares.setBoundaryAABB(null);

    // Snap new loop endpoints onto nearby canonical loops before extracting boundary arcs
    this.snapNewLoopEndpointsToCanonicalLoops(mergedNewLoops, quantStep);

    // Extract matching boundary arcs from existing canonical loops
    const boundaryArcs = this.extractBoundaryArcs(
      cleanedNewLoops,
      expandedWorldAABB,
      isInsideCarveRegion,
      quantKey,
      quantStep,
      outerBoundaryOverlapVertices
    );

    // Step 2: merge outer (cold) boundary arcs that nearly touch to reduce fragmentation
    const boundaryMergeDistance = quantStep * 1.5; // treat endpoints within ~1.5 lattice steps as connected
    const mergedBoundaryArcs = this.mergeBoundaryArcs(boundaryArcs, boundaryMergeDistance);
    const boundaryMergePairs = boundaryArcs.length - mergedBoundaryArcs.length;
    console.log('[TerrainSurgery] Step2 boundary merge (outer arcs)', {
      mergeDistance: boundaryMergeDistance.toFixed(4),
      before: boundaryArcs.length,
      after: mergedBoundaryArcs.length,
      mergedPairs: boundaryMergePairs
    });

    // Combine results
    let nextId = 1;
    const allLoops: CarvedLoop[] = [
      ...cleanedNewLoops.map(r => ({ ...r, isNew: true, id: nextId++ })),
      ...mergedBoundaryArcs.map(r => ({ ...r, isNew: false, id: nextId++ }))
    ];

    // Snapshot of what we have after step 2 (raw carve + merged outer arcs)
    console.log('[TerrainSurgery] Step2 loop snapshot', {
      total: allLoops.length,
      loops: allLoops.map(l => ({
        id: l.id,
        type: l.isNew ? (l.closed ? 'new-closed' : 'new-open') : 'boundary-arc',
        closed: l.closed,
        verts: l.loop.length,
        length: loopLength(l.loop).toFixed(3),
        endpoints: l.endpoints,
        canonicalEndpointIds: l.canonicalEndpointIds,
        sourceCanonicalId: l.sourceCanonicalId
      }))
    });

    // Stitch canonical loops by walking open endpoints
    const stitchedLoops = this.stitchCanonicalLoops(
      allLoops,
      quantKey,
      isInsideCarveRegion,
      quantStep
    );

    const stats = {
      newLoopCount: mergedNewLoops.length,
      boundaryArcCount: mergedBoundaryArcs.length,
      mergedLoopPairs: mergedNewLoops.filter(l => !l.closed).length - cleanedWarmLoops.filter(r => r && !r.closed).length,
      boundaryMergePairs
    };

    console.log(`[TerrainSurgery] Extracted carved loops`, {
      newLoops: stats.newLoopCount,
      boundaryArcs: stats.boundaryArcCount,
      totalLoops: allLoops.length,
      mergedPairs: stats.mergedLoopPairs,
      boundaryMergedPairs: stats.boundaryMergePairs
    });
    console.log('[Stitch] Result', {
      stitchedCount: stitchedLoops.length,
      stitchedLengths: stitchedLoops.map(s => s.vertices.length)
    });

    return {
      loops: allLoops,
      stitchedLoops,
      carveRegion: expandedWorldAABB,
      stats
    };
  }

  /**
   * Basic dedupe for warm (new) loops straight from marching squares.
   * Removes duplicate open arcs that share nearly identical endpoints, keeping the longer arc.
   */
  private dedupeWarmLoops(
    loops: Array<{ loop: Point[]; closed: boolean; endpoints?: [Point, Point] }>,
    mergeDistance: number
  ): Array<{ loop: Point[]; closed: boolean; endpoints?: [Point, Point] }> {
    const close = (a: Point, b: Point): boolean =>
      Math.hypot(a.x - b.x, a.y - b.y) <= mergeDistance;

    const length = (verts: Point[]): number => {
      let len = 0;
      for (let i = 1; i < verts.length; i++) {
        const dx = verts[i].x - verts[i - 1].x;
        const dy = verts[i].y - verts[i - 1].y;
        len += Math.hypot(dx, dy);
      }
      return len;
    };

    const result: Array<{ loop: Point[]; closed: boolean; endpoints?: [Point, Point] }> = [];

    for (const loop of loops) {
      if (!loop) continue;
      // Only dedupe open loops; keep closed loops as-is to avoid false positives.
      if (loop.closed || !loop.endpoints) {
        result.push(loop);
        continue;
      }

      const [a, b] = loop.endpoints;
      let merged = false;

      for (let i = 0; i < result.length; i++) {
        const other = result[i];
        if (!other || other.closed || !other.endpoints) continue;
        const [oa, ob] = other.endpoints;

        const sameOrder = close(a, oa) && close(b, ob);
        const swapped = close(a, ob) && close(b, oa);
        if (sameOrder || swapped) {
          // Keep the longer arc
          if (length(loop.loop) > length(other.loop)) {
            result[i] = loop;
          }
          merged = true;
          break;
        }
      }

      if (!merged) {
        result.push(loop);
      }
    }

    return result;
  }

  /**
   * Apply the same cleanup pass used in full-heal to warm loops: dedupe small moves,
   * cull tiny edges, ensure CCW, and re-sync endpoints for open loops.
   */
  private cleanWarmLoops(
    loops: Array<{ loop: Point[]; closed: boolean; endpoints?: [Point, Point] }>,
    gridPitch: number
  ): Array<{ loop: Point[]; closed: boolean; endpoints?: [Point, Point] }> {
    const cleaned: Array<{ loop: Point[]; closed: boolean; endpoints?: [Point, Point] }> = [];

    for (const l of loops) {
      if (!l || !l.loop || l.loop.length === 0) continue;
      const loopClean = cleanLoop(l.loop, gridPitch);
      if (loopClean.length < (l.closed ? 3 : 2)) {
        continue; // drop degenerate after cleanup
      }

      if (l.closed || !l.endpoints) {
        cleaned.push({ ...l, loop: loopClean, closed: l.closed });
      } else {
        const start = loopClean[0];
        const end = loopClean[loopClean.length - 1];
        cleaned.push({
          ...l,
          loop: loopClean,
          closed: false,
          endpoints: [{ ...start }, { ...end }]
        });
      }
    }

    return cleaned;
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
   * Merge boundary (cold) arcs from the same canonical loop when their open endpoints are very close.
   * This reduces fragmentation before stitching outer arcs with inner (warm) loops.
   */
  private mergeBoundaryArcs(
    boundaryArcs: Array<{ loop: Point[]; closed: boolean; endpoints?: [Point, Point]; sourceCanonicalId?: number; canonicalEndpointIds?: [number, number] }>,
    mergeDistance: number
  ): Array<{ loop: Point[]; closed: boolean; endpoints?: [Point, Point]; sourceCanonicalId?: number; canonicalEndpointIds?: [number, number] }> {
    const close = (a: Point, b: Point): boolean =>
      Math.hypot(a.x - b.x, a.y - b.y) <= mergeDistance;

    const arcLength = (verts: Point[]): number => {
      let len = 0;
      for (let i = 1; i < verts.length; i++) {
        const dx = verts[i].x - verts[i - 1].x;
        const dy = verts[i].y - verts[i - 1].y;
        len += Math.hypot(dx, dy);
      }
      return len;
    };

    const orientArc = (
      arc: { loop: Point[]; closed: boolean; endpoints?: [Point, Point]; sourceCanonicalId?: number; canonicalEndpointIds?: [number, number] },
      reverse: boolean
    ) => {
      if (!reverse) return arc;
      return {
        ...arc,
        loop: [...arc.loop].reverse(),
        endpoints: arc.endpoints ? [arc.endpoints[1], arc.endpoints[0]] as [Point, Point] : arc.endpoints,
        canonicalEndpointIds: arc.canonicalEndpointIds ? [arc.canonicalEndpointIds[1], arc.canonicalEndpointIds[0]] as [number, number] : arc.canonicalEndpointIds
      };
    };

    const tryMerge = (
      a: { loop: Point[]; closed: boolean; endpoints?: [Point, Point]; sourceCanonicalId?: number; canonicalEndpointIds?: [number, number] },
      b: { loop: Point[]; closed: boolean; endpoints?: [Point, Point]; sourceCanonicalId?: number; canonicalEndpointIds?: [number, number] }
    ):
      | { loop: Point[]; closed: boolean; endpoints?: [Point, Point]; sourceCanonicalId?: number; canonicalEndpointIds?: [number, number] }
      | null => {
      if (a.closed || b.closed) return null;
      if (!a.endpoints || !b.endpoints) return null;
      if (a.sourceCanonicalId === undefined || b.sourceCanonicalId === undefined) return null;
      if (a.sourceCanonicalId !== b.sourceCanonicalId) return null;

      const orientations = [
        { revA: false, revB: false },
        { revA: false, revB: true },
        { revA: true, revB: false },
        { revA: true, revB: true }
      ];

      for (const { revA, revB } of orientations) {
        const oa = orientArc(a, revA);
        const ob = orientArc(b, revB);
        if (!oa.endpoints || !ob.endpoints) continue;

        const startsClose = close(oa.endpoints[0], ob.endpoints[0]) && close(oa.endpoints[1], ob.endpoints[1]);
        const reversedClose = close(oa.endpoints[0], ob.endpoints[1]) && close(oa.endpoints[1], ob.endpoints[0]);
        if (startsClose || reversedClose) {
          const keep = arcLength(oa.loop) >= arcLength(ob.loop) ? oa : ob;
          return {
            loop: [...keep.loop],
            closed: false,
            endpoints: keep.endpoints ? [{ ...keep.endpoints[0] }, { ...keep.endpoints[1] }] : keep.endpoints,
            sourceCanonicalId: keep.sourceCanonicalId,
            canonicalEndpointIds: keep.canonicalEndpointIds ? [...keep.canonicalEndpointIds] as [number, number] : keep.canonicalEndpointIds
          };
        }

        if (!close(oa.endpoints[1], ob.endpoints[0])) continue;

        const join = {
          x: (oa.endpoints[1].x + ob.endpoints[0].x) * 0.5,
          y: (oa.endpoints[1].y + ob.endpoints[0].y) * 0.5
        };

        const mergedLoop = [
          ...oa.loop.slice(0, -1),
          join,
          ...ob.loop.slice(1)
        ];

        if (mergedLoop.length < 2) continue;

        const mergedEndpoints: [Point, Point] = [
          { ...mergedLoop[0] },
          { ...mergedLoop[mergedLoop.length - 1] }
        ];

        const mergedCanonical: [number, number] | undefined =
          oa.canonicalEndpointIds && ob.canonicalEndpointIds
            ? [oa.canonicalEndpointIds[0], ob.canonicalEndpointIds[1]]
            : oa.canonicalEndpointIds ?? ob.canonicalEndpointIds;

        return {
          loop: mergedLoop,
          closed: false,
          endpoints: mergedEndpoints,
          sourceCanonicalId: a.sourceCanonicalId,
          canonicalEndpointIds: mergedCanonical
        };
      }

      return null;
    };

    const grouped = new Map<number, Array<{ loop: Point[]; closed: boolean; endpoints?: [Point, Point]; sourceCanonicalId?: number; canonicalEndpointIds?: [number, number] }>>();
    const result: Array<{ loop: Point[]; closed: boolean; endpoints?: [Point, Point]; sourceCanonicalId?: number; canonicalEndpointIds?: [number, number] }> = [];

    // Group arcs by their canonical source id
    boundaryArcs.forEach(arc => {
      if (arc.sourceCanonicalId === undefined) {
        result.push(arc);
        return;
      }
      const arr = grouped.get(arc.sourceCanonicalId);
      if (arr) {
        arr.push(arc);
      } else {
        grouped.set(arc.sourceCanonicalId, [arc]);
      }
    });

    // Merge within each canonical loop group
    grouped.forEach((group) => {
      const working = [...group];
      let changed = true;
      while (changed) {
        changed = false;
        outer: for (let i = 0; i < working.length; i++) {
          for (let j = i + 1; j < working.length; j++) {
            const merged = tryMerge(working[i], working[j]);
            if (merged) {
              working.splice(j, 1);
              working.splice(i, 1);
              working.push(merged);
              changed = true;
              break outer;
            }
          }
        }
      }
      result.push(...working);
    });

    return result;
  }

  /**
   * Snap new open loop endpoints onto nearby canonical loop edges (prevents tiny gaps)
   */
  private snapNewLoopEndpointsToCanonicalLoops(
    loops: Array<{ loop: Point[]; closed: boolean; endpoints?: [Point, Point] }>,
    quantStep: number
  ): void {
    // Snapping disabled for this experiment; endpoints remain at their raw positions.
    return;
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
    quantStep: number,
    overlapInsideVertices: number
  ): Array<{ loop: Point[]; closed: boolean; endpoints?: [Point, Point]; sourceCanonicalId?: number; canonicalEndpointIds?: [number, number]; canonicalEndpointIndices?: [number, number] }> {
    const canonicalLoops = this.remeshManager.getCanonicalLoops();
    const boundaryArcs: Array<{ loop: Point[]; closed: boolean; endpoints?: [Point, Point]; sourceCanonicalId?: number; canonicalEndpointIds?: [number, number]; canonicalEndpointIndices?: [number, number] }> = [];
    const fracEps = 1e-6;
    const lenEps = 1e-6;

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

    const preferMetrics = (
      candidate: { outsideFrac: number; outside: number; total: number },
      current: { outsideFrac: number; outside: number; total: number } | null
    ): boolean => {
      const candidateInside = candidate.total - candidate.outside;
      const currentInside = current ? current.total - current.outside : Infinity;

      if (!current) return true;

      // Prefer arcs that minimize how much they pass through the carve region
      if (candidateInside + lenEps < currentInside) return true;
      if (currentInside + lenEps < candidateInside) return false;

      // Next prefer the shorter arc to avoid wrapping around the world
      if (candidate.total + lenEps < current.total) return true;
      if (current.total + lenEps < candidate.total) return false;

      // Finally fall back to outside coverage and absolute outside length
      if (candidate.outsideFrac > current.outsideFrac + fracEps) return true;
      if (current.outsideFrac > candidate.outsideFrac + fracEps) return false;
      return candidate.outside + lenEps < current.outside;
    };

    const computePieceAabb = (verts: Point[]): AABB => {
      let minX = Infinity;
      let minY = Infinity;
      let maxX = -Infinity;
      let maxY = -Infinity;
      for (const v of verts) {
        if (v.x < minX) minX = v.x;
        if (v.y < minY) minY = v.y;
        if (v.x > maxX) maxX = v.x;
        if (v.y > maxY) maxY = v.y;
      }
      if (!Number.isFinite(minX)) {
        return { minX: 0, minY: 0, maxX: 0, maxY: 0 };
      }
      return { minX, minY, maxX, maxY };
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

    const extendPieceWithOverlap = (
      piece: { vertices: Point[]; startIndex: number; endIndex: number },
      canonVerts: Point[],
      overlap: number
    ): { vertices: Point[]; startIndex: number; endIndex: number } => {
      if (overlap <= 0 || canonVerts.length === 0) {
        return piece;
      }

      const n = canonVerts.length;
      const count = Math.min(overlap, Math.max(1, n - 1));

      const prepend: Point[] = [];
      let idx = piece.startIndex;
      for (let i = 0; i < count; i++) {
        idx = (idx - 1 + n) % n;
        prepend.push({ ...canonVerts[idx] });
      }
      prepend.reverse();

      const append: Point[] = [];
      idx = piece.endIndex;
      for (let i = 0; i < count; i++) {
        idx = (idx + 1) % n;
        append.push({ ...canonVerts[idx] });
      }

      return {
        vertices: [...prepend, ...piece.vertices, ...append],
        startIndex: (piece.startIndex - count + n) % n,
        endIndex: (piece.endIndex + count) % n
      };
    };

    // Gather all endpoints from new open loops for snapping boundary arcs
    const newLoopEndpoints: Point[] = [];
    newLoops.forEach(l => {
      if (!l.closed && l.endpoints) {
        newLoopEndpoints.push(l.endpoints[0], l.endpoints[1]);
      }
    });

    const snapDist = Math.max(quantStep * 12, 1.0); // generous to bridge AABB-boundary gaps

    const buildForcedEdgeSplits = (canonLoop: CanonicalLoop): Map<number, number[]> => {
      // Snapping is disabled; no forced edge splits.
      return new Map<number, number[]>();
    };

    const snapBoundaryArcEndpoints = (
      arcs: Array<{ loop: Point[]; closed: boolean; endpoints?: [Point, Point]; sourceCanonicalId?: number }>,
      targets: Point[],
      snapToBoundary: boolean
    ) => {
      // Snapping disabled; boundary arc endpoints remain unchanged.
      return;
    };

    // For each open loop from the new marching squares, find matching boundary arc
    const candidateCanonicals = canonicalLoops.filter(cl => this.aabbsIntersect(cl.aabb, carveRegion));
    const fullyInside: number[] = [];
    for (const cl of candidateCanonicals) {
      const allInside = cl.vertices.every(v => isInsideCarveRegion(v));
      if (allInside) {
        fullyInside.push(cl.id);
      }
    }

    console.log('[TerrainSurgery] Boundary arc clipping (all pieces)', {
      carveRegion,
      canonicalCount: canonicalLoops.length,
      candidateCanonicals: candidateCanonicals.map(cl => ({
        id: cl.id,
        verts: cl.vertices.length,
        aabb: cl.aabb
      })),
      fullyInside
    });

    for (const canonLoop of candidateCanonicals) {
      const pieceSummaries: Array<{
        pieceIdx: number;
        startCanon: number;
        endCanon: number;
        verts: number;
        length: string;
        endpoints: [Point, Point];
        outsideFrac: string;
      }> = [];

      const allInside = canonLoop.vertices.every(v => isInsideCarveRegion(v));
      if (allInside) {
        console.log('[TerrainSurgery] Canonical loop fully inside carve region; no outside pieces', {
          canonicalLoopId: canonLoop.id,
          verts: canonLoop.vertices.length
        });
        continue;
      }

      const forcedSplits = buildForcedEdgeSplits(canonLoop);

      const outsidePieces = this.splitArcOutsideRegion(
        canonLoop.vertices,
        carveRegion,
        isInsideCarveRegion,
        quantStep,
        forcedSplits
      );

      outsidePieces.forEach((piece, pieceIdx) => {
        if (piece.vertices.length < 2) return;

        const extendedPiece = extendPieceWithOverlap(piece, canonLoop.vertices, overlapInsideVertices);
        if (extendedPiece.vertices.length < 2) return;

        const pieceAabb = computePieceAabb(extendedPiece.vertices);
        if (!this.aabbsIntersect(pieceAabb, carveRegion)) {
          console.log('[TerrainSurgery]   Skipping piece outside carve region', { pieceIdx, pieceAabb });
          return;
        }

        const endpoints: [Point, Point] = [
          { ...extendedPiece.vertices[0] },
          { ...extendedPiece.vertices[extendedPiece.vertices.length - 1] }
        ];

        boundaryArcs.push({
          loop: extendedPiece.vertices,
          closed: false,
          endpoints,
          sourceCanonicalId: canonLoop.id,
          canonicalEndpointIds: [
            canonLoop.vertices[extendedPiece.startIndex].id,
            canonLoop.vertices[extendedPiece.endIndex].id
          ],
          canonicalEndpointIndices: [
            extendedPiece.startIndex,
            extendedPiece.endIndex
          ]
        });

        pieceSummaries.push({
          pieceIdx,
          startCanon: extendedPiece.startIndex,
          endCanon: extendedPiece.endIndex,
          verts: extendedPiece.vertices.length,
          length: arcLength(extendedPiece.vertices).toFixed(3),
          endpoints,
          outsideFrac: arcOutsideMetrics(extendedPiece.vertices).outsideFrac.toFixed(2)
        });

        console.log('[TerrainSurgery] Boundary arc extracted (clipped piece)', {
          canonicalLoopId: canonLoop.id,
          arcLength: arcLength(extendedPiece.vertices).toFixed(3),
          arcVerts: extendedPiece.vertices.length,
          outsideFrac: arcOutsideMetrics(extendedPiece.vertices).outsideFrac.toFixed(2),
          pieceIdx,
          start: endpoints[0],
          end: endpoints[1]
        });
      });

      if (pieceSummaries.length > 0) {
        console.log('[TerrainSurgery] Boundary arc summary', {
          canonicalLoopId: canonLoop.id,
          pieces: pieceSummaries
        });
      }
    }

    snapBoundaryArcEndpoints(boundaryArcs, newLoopEndpoints, true);

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
    quantStep: number,
    forcedEdgeSplits?: Map<number, number[]>
  ): Array<{ vertices: Point[]; startIndex: number; endIndex: number }> {
    const result: Array<{ vertices: Point[]; startIndex: number; endIndex: number }> = [];
    if (verts.length < 2) return result;

    const boundaryEps = quantStep * 0.25;

    const edgeIntersections = (p: Point, q: Point, edgeIdx: number): number[] => {
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

      const extraSplits = forcedEdgeSplits?.get(edgeIdx);
      if (extraSplits && extraSplits.length > 0) {
        ts.push(...extraSplits);
      }

      ts.sort((a, b) => a - b);
      return ts;
    };

    const pointAt = (p: Point, q: Point, t: number): Point => ({
      x: Math.round((p.x + (q.x - p.x) * t) / quantStep) * quantStep,
      y: Math.round((p.y + (q.y - p.y) * t) / quantStep) * quantStep
    });

    let current: Point[] = [];
    let currentStartIndex = 0;
    let currentEndIndex = 0;

    const edgeCount = verts.length; // include closing edge
    for (let i = 0; i < edgeCount; i++) {
      const pIdx = i;
      const qIdx = (i + 1) % verts.length;
      const p = verts[pIdx];
      const q = verts[qIdx];
      const ts = edgeIntersections(p, q, pIdx);
      const segT: number[] = [0, ...ts, 1];
      const pts: Point[] = [p];
      for (const t of ts) {
        pts.push(pointAt(p, q, t));
      }
      pts.push(q);

      for (let k = 0; k < pts.length - 1; k++) {
        const a = pts[k];
        const b = pts[k + 1];
        const mid = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
        const onBoundary =
          Math.abs(mid.x - carveRegion.minX) <= boundaryEps ||
          Math.abs(mid.x - carveRegion.maxX) <= boundaryEps ||
          Math.abs(mid.y - carveRegion.minY) <= boundaryEps ||
          Math.abs(mid.y - carveRegion.maxY) <= boundaryEps;
        const segStartT = segT[k];
        const segEndT = segT[k + 1];
        const hasForced =
          (forcedEdgeSplits?.get(pIdx) ?? []).some(t => t > segStartT - 1e-9 && t < segEndT + 1e-9);
        const segmentOutside = !isInsideCarveRegion(mid) || onBoundary || hasForced;

        if (segmentOutside) {
          if (current.length === 0) {
            current.push({ ...a });
            currentStartIndex = pIdx;
          }
          current.push({ ...b });
          currentEndIndex = qIdx;
        } else {
          if (current.length > 1) {
            result.push({ vertices: current, startIndex: currentStartIndex, endIndex: currentEndIndex });
          }
          current = [];
          currentStartIndex = 0;
          currentEndIndex = 0;
        }
      }
    }

    if (current.length > 1) {
      result.push({ vertices: current, startIndex: currentStartIndex, endIndex: currentEndIndex });
    }

    return result;
  }

  /**
   * Stitch open carved segments (warm + boundary arcs) into closed canonical loops.
   * Simple algorithm: join segments whose endpoints meet in quantized space.
   *
   * Closed warm loops are included directly without modification.
   */
  private stitchCanonicalLoops(
    carvedLoops: CarvedLoop[],
    quantKey: (v: Point) => string,
    isInsideCarveRegion: (v: Point) => boolean,
    quantStep: number
  ): StitchedLoop[] {
    console.log('[Stitch] Starting simple endpoint-matching stitcher');

    type SegmentEndpoint = {
      loopId: number;
      loopIndex: number;
      endpointIndex: 0 | 1; // which endpoint (0=start, 1=end)
      pos: Point;
      loop: CarvedLoop;
    };

    const stitched: StitchedLoop[] = [];
    const endpointMap = new Map<string, SegmentEndpoint[]>();
    const visitedLoops = new Set<number>();

    // First, add all closed loops directly to output
    carvedLoops.forEach((loop, loopIndex) => {
      if (loop.closed) {
        const ancestry: SegmentAncestry = {
          sourceLoopId: loop.id,
          isNew: loop.isNew,
          sourceCanonicalId: loop.sourceCanonicalId,
          canonicalEndpointIds: loop.canonicalEndpointIds,
          canonicalEndpointIndices: loop.canonicalEndpointIndices,
          vertexRange: [0, loop.loop.length - 1],
          originalVertices: [...loop.loop]
        };
        stitched.push({
          id: stitched.length + 1,
          vertices: [...loop.loop],
          segments: [ancestry]
        });
        visitedLoops.add(loop.id);
        console.log('[Stitch] Added closed loop directly', {
          id: stitched.length,
          loopId: loop.id,
          vertices: loop.loop.length,
          type: loop.isNew ? 'warm' : 'cold'
        });
      }
    });

    // Index all open segment endpoints by quantized position
    carvedLoops.forEach((loop, loopIndex) => {
      if (loop.closed || !loop.endpoints) return;

      const [start, end] = loop.endpoints;
      const startKey = quantKey(start);
      const endKey = quantKey(end);

      const startRef: SegmentEndpoint = {
        loopId: loop.id,
        loopIndex,
        endpointIndex: 0,
        pos: start,
        loop
      };

      const endRef: SegmentEndpoint = {
        loopId: loop.id,
        loopIndex,
        endpointIndex: 1,
        pos: end,
        loop
      };

      if (!endpointMap.has(startKey)) endpointMap.set(startKey, []);
      if (!endpointMap.has(endKey)) endpointMap.set(endKey, []);

      endpointMap.get(startKey)!.push(startRef);
      endpointMap.get(endKey)!.push(endRef);
    });

    // Log endpoint statistics
    console.log('[Stitch] Endpoint index built', {
      totalSegments: carvedLoops.filter(l => !l.closed).length,
      uniquePositions: endpointMap.size,
      endpointDetails: Array.from(endpointMap.entries()).map(([key, refs]) => ({
        key,
        count: refs.length,
        segments: refs.map(r => ({
          loopId: r.loopId,
          endpointIndex: r.endpointIndex,
          type: r.loop.isNew ? 'warm' : 'cold'
        }))
      }))
    });

    // Helper: find next unvisited segment at this position
    const findNextSegment = (posKey: string, excludeLoopId: number): SegmentEndpoint | null => {
      const candidates = endpointMap.get(posKey) || [];
      for (const candidate of candidates) {
        if (candidate.loopId !== excludeLoopId && !visitedLoops.has(candidate.loopId)) {
          return candidate;
        }
      }
      return null;
    };

    // Walk graph to form closed loops
    carvedLoops.forEach((startLoop, startLoopIndex) => {
      if (startLoop.closed || !startLoop.endpoints) return;
      if (visitedLoops.has(startLoop.id)) return;

      // Try starting from both endpoints
      for (let startEndpointIndex = 0; startEndpointIndex <= 1; startEndpointIndex++) {
        if (visitedLoops.has(startLoop.id)) break;

        const startPos = startLoop.endpoints[startEndpointIndex as 0 | 1];
        const startKey = quantKey(startPos);
        const path: Point[] = [];
        const segmentsInPath: Array<{ id: number; type: string }> = [];
        const ancestrySegments: SegmentAncestry[] = [];

        let currentSegment: SegmentEndpoint = {
          loopId: startLoop.id,
          loopIndex: startLoopIndex,
          endpointIndex: startEndpointIndex as 0 | 1,
          pos: startPos,
          loop: startLoop
        };

        let steps = 0;
        const maxSteps = 10000;
        const tempVisited = new Set<number>();

        console.log('[Stitch] Starting walk', {
          startLoopId: startLoop.id,
          startEndpointIndex,
          startPos,
          startKey,
          type: startLoop.isNew ? 'warm' : 'cold'
        });

        while (steps++ < maxSteps) {
          const loop = currentSegment.loop;
          const enteringAtEndpoint = currentSegment.endpointIndex;
          const exitingAtEndpoint: 0 | 1 = enteringAtEndpoint === 0 ? 1 : 0;

          tempVisited.add(loop.id);
          segmentsInPath.push({ id: loop.id, type: loop.isNew ? 'warm' : 'cold' });

          // Track starting position in the stitched path
          const segmentStartInPath = path.length;

          // Append vertices in correct direction
          const verticesForThisSegment: Point[] = [];
          if (enteringAtEndpoint === 0) {
            // Entering at start, exiting at end - traverse forward
            if (path.length === 0) {
              path.push(...loop.loop);
              verticesForThisSegment.push(...loop.loop);
            } else {
              path.push(...loop.loop.slice(1)); // skip first to avoid duplicate
              verticesForThisSegment.push(...loop.loop.slice(1));
            }
          } else {
            // Entering at end, exiting at start - traverse backward
            const reversed = [...loop.loop].reverse();
            if (path.length === 0) {
              path.push(...reversed);
              verticesForThisSegment.push(...reversed);
            } else {
              path.push(...reversed.slice(1)); // skip first to avoid duplicate
              verticesForThisSegment.push(...reversed.slice(1));
            }
          }

          // Track ending position in the stitched path
          const segmentEndInPath = path.length - 1;

          // Record ancestry for this segment
          ancestrySegments.push({
            sourceLoopId: loop.id,
            isNew: loop.isNew,
            sourceCanonicalId: loop.sourceCanonicalId,
            canonicalEndpointIds: loop.canonicalEndpointIds,
            canonicalEndpointIndices: loop.canonicalEndpointIndices,
            vertexRange: [segmentStartInPath, segmentEndInPath],
            originalVertices: [...loop.loop]
          });

          // Get exit position
          const exitPos = loop.endpoints![exitingAtEndpoint];
          const exitKey = quantKey(exitPos);

          // Check if we've closed the loop
          if (exitKey === startKey && tempVisited.size > 1) {
            // Successfully closed!
            stitched.push({
              id: stitched.length + 1,
              vertices: path,
              segments: ancestrySegments
            });
            tempVisited.forEach(id => visitedLoops.add(id));
            console.log('[Stitch] ✓ Closed loop formed with ancestry', {
              stitchedId: stitched.length,
              segments: segmentsInPath.length,
              vertices: path.length,
              segmentIds: segmentsInPath,
              ancestrySegments: ancestrySegments.length
            });
            break;
          }

          // Find next segment at exit position
          const nextSegment = findNextSegment(exitKey, loop.id);
          if (!nextSegment) {
            // Dead end - could not close loop
            console.warn('[Stitch] ✗ OPEN SEGMENT - Failed to close loop', {
              startLoopId: startLoop.id,
              startKey,
              startPos,
              exitKey,
              exitPos,
              segmentsInPath: segmentsInPath.length,
              segmentIds: segmentsInPath,
              vertices: path.length,
              endpointsAtExitPos: (endpointMap.get(exitKey) || []).map(e => ({
                loopId: e.loopId,
                endpointIndex: e.endpointIndex,
                type: e.loop.isNew ? 'warm' : 'cold',
                visited: visitedLoops.has(e.loopId) || tempVisited.has(e.loopId)
              })),
              reason: (endpointMap.get(exitKey) || []).length === 0
                ? 'No endpoints at this position'
                : 'All segments at this position already visited'
            });
            break;
          }

          currentSegment = nextSegment;
        }

        if (steps >= maxSteps) {
          console.error('[Stitch] Safety limit reached - infinite loop detected', {
            startLoopId: startLoop.id,
            segmentsInPath: segmentsInPath.length
          });
        }
      }
    });

    // Report any segments that were never visited (orphaned)
    const orphanedSegments = carvedLoops.filter(
      loop => !loop.closed && !visitedLoops.has(loop.id)
    );
    if (orphanedSegments.length > 0) {
      console.warn('[Stitch] Orphaned segments (never visited during walk)', {
        count: orphanedSegments.length,
        segments: orphanedSegments.map(loop => ({
          loopId: loop.id,
          type: loop.isNew ? 'warm' : 'cold',
          endpoints: loop.endpoints,
          quantizedEndpoints: loop.endpoints
            ? [quantKey(loop.endpoints[0]), quantKey(loop.endpoints[1])]
            : null,
          vertices: loop.loop.length
        }))
      });
    }

    console.log('[Stitch] Summary', {
      inputLoops: carvedLoops.length,
      outputStitched: stitched.length,
      visitedSegments: visitedLoops.size,
      orphanedSegments: orphanedSegments.length
    });

    return stitched;
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

  /**
   * Compute AABB for a loop (open or closed)
   */
  private computeLoopAabb(verts: Point[]): AABB {
    let minX = Infinity;
    let minY = Infinity;
    let maxX = -Infinity;
    let maxY = -Infinity;
    for (const v of verts) {
      minX = Math.min(minX, v.x);
      minY = Math.min(minY, v.y);
      maxX = Math.max(maxX, v.x);
      maxY = Math.max(maxY, v.y);
    }
    if (!Number.isFinite(minX)) {
      return { minX: 0, minY: 0, maxX: 0, maxY: 0 };
    }
    return { minX, minY, maxX, maxY };
  }
}
