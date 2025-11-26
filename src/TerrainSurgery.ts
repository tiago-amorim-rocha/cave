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
  /** Debug/ordering id */
  id: number;

  /** Vertex positions */
  loop: Point[];

  /** Whether this loop is closed */
  closed: boolean;

  /** For open loops, the two endpoints */
  endpoints?: [Point, Point];
  /** Canonical vertex indices (for boundary arcs) */
  canonicalEndpoints?: [number, number];

  /** True if extracted from dirty region (new), false if from existing boundary (preserved) */
  isNew: boolean;

  /** For boundary arcs: original canonical loop id */
  sourceCanonicalId?: number;
}

export interface StitchedLoop {
  id: number;
  vertices: Point[];
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

    // Use the same quantization lattice everywhere (marching squares + boundary stitching)
    const quantStep = this.marchingSquares.getQuantizationStep();

    const worldMinX = gridAABB.minX * h;
    const worldMinY = gridAABB.minY * h;
    const worldMaxX = (gridAABB.maxX + 1) * h;
    const worldMaxY = (gridAABB.maxY + 1) * h;

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

    const loopLength = (verts: Point[]): number => {
      let len = 0;
      for (let i = 1; i < verts.length; i++) {
        const dx = verts[i].x - verts[i - 1].x;
        const dy = verts[i].y - verts[i - 1].y;
        len += Math.hypot(dx, dy);
      }
      return len;
    };

    const openLoops = newLoopResults.filter(l => l && !l.closed);
    const closedLoops = newLoopResults.filter(l => l && l.closed);
    console.log('[TerrainSurgery] New marching squares results', {
      total: newLoopResults.length,
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

    // Extract matching boundary arcs from existing canonical loops
    const boundaryArcs = this.extractBoundaryArcs(
      cleanedNewLoops,
      expandedWorldAABB,
      isInsideCarveRegion,
      quantKey,
      quantStep
    );

    // Combine results
    let nextId = 1;
    const allLoops: CarvedLoop[] = [
      ...cleanedNewLoops.map(r => ({ ...r, isNew: true, id: nextId++ })),
      ...boundaryArcs.map(r => ({ ...r, isNew: false, id: nextId++ }))
    ];

    // Snapshot of what we have after step 1 (raw carve + boundary arcs)
    console.log('[TerrainSurgery] Step1 loop snapshot', {
      total: allLoops.length,
      loops: allLoops.map(l => ({
        id: l.id,
        type: l.isNew ? (l.closed ? 'new-closed' : 'new-open') : 'boundary-arc',
        closed: l.closed,
        verts: l.loop.length,
        length: loopLength(l.loop).toFixed(3),
        endpoints: l.endpoints,
        canonicalEndpoints: l.canonicalEndpoints,
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
      boundaryArcCount: boundaryArcs.length,
      mergedLoopPairs: mergedNewLoops.filter(l => !l.closed).length - newLoopResults.filter(r => r && !r.closed).length
    };

    console.log(`[TerrainSurgery] Extracted carved loops`, {
      newLoops: stats.newLoopCount,
      boundaryArcs: stats.boundaryArcCount,
      totalLoops: allLoops.length,
      mergedPairs: stats.mergedLoopPairs
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
  ): Array<{ loop: Point[]; closed: boolean; endpoints?: [Point, Point]; sourceCanonicalId?: number; canonicalEndpoints?: [number, number] }> {
    const canonicalLoops = this.remeshManager.getCanonicalLoops();
    const boundaryArcs: Array<{ loop: Point[]; closed: boolean; endpoints?: [Point, Point]; sourceCanonicalId?: number; canonicalEndpoints?: [number, number] }> = [];
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

    // Gather all endpoints from new open loops for snapping boundary arcs
    const newLoopEndpoints: Point[] = [];
    newLoops.forEach(l => {
      if (!l.closed && l.endpoints) {
        newLoopEndpoints.push(l.endpoints[0], l.endpoints[1]);
      }
    });

    const expandAabb = (aabb: AABB, pad: number): AABB => ({
      minX: aabb.minX - pad,
      minY: aabb.minY - pad,
      maxX: aabb.maxX + pad,
      maxY: aabb.maxY + pad
    });

    const pointInAabb = (p: Point, aabb: AABB): boolean =>
      p.x >= aabb.minX && p.x <= aabb.maxX && p.y >= aabb.minY && p.y <= aabb.maxY;

    const snapDist = quantStep * 4; // generous to catch slight drift between MS endpoints and canonical vertices

    const buildForcedEdgeSplits = (canonLoop: CanonicalLoop): Map<number, number[]> => {
      const forced = new Map<number, number[]>();
      if (newLoopEndpoints.length === 0) return forced;

      const padded = expandAabb(canonLoop.aabb, snapDist);

      const maybeAdd = (edgeIdx: number, t: number) => {
        if (t <= 1e-6 || t >= 1 - 1e-6) return; // avoid duplicating endpoints
        const arr = forced.get(edgeIdx);
        if (arr) {
          // avoid near-duplicate t values
          if (!arr.some(existing => Math.abs(existing - t) < 1e-6)) {
            arr.push(t);
          }
        } else {
          forced.set(edgeIdx, [t]);
        }
      };

      const projectToSegment = (p: Point, q: Point, target: Point): { t: number; dist: number } => {
        const vx = q.x - p.x;
        const vy = q.y - p.y;
        const len2 = vx * vx + vy * vy || 1e-6;
        const t = Math.max(0, Math.min(1, ((target.x - p.x) * vx + (target.y - p.y) * vy) / len2));
        const projX = p.x + vx * t;
        const projY = p.y + vy * t;
        const dx = projX - target.x;
        const dy = projY - target.y;
        return { t, dist: Math.hypot(dx, dy) };
      };

      for (const ep of newLoopEndpoints) {
        if (!pointInAabb(ep, padded)) continue;
        let bestEdge = -1;
        let bestT = 0;
        let bestDist = Infinity;

        for (let i = 0; i < canonLoop.vertices.length; i++) {
          const p = canonLoop.vertices[i];
          const q = canonLoop.vertices[(i + 1) % canonLoop.vertices.length];
          const { t, dist } = projectToSegment(p, q, ep);
          if (dist < bestDist) {
            bestDist = dist;
            bestT = t;
            bestEdge = i;
          }
        }

        if (bestEdge >= 0 && bestDist <= snapDist) {
          maybeAdd(bestEdge, bestT);
        }
      }

      return forced;
    };

    const snapBoundaryArcEndpoints = (
      arcs: Array<{ loop: Point[]; closed: boolean; endpoints?: [Point, Point] }>,
      targets: Point[]
    ) => {
      if (targets.length === 0) return;
      const snap = (p: Point): Point | null => {
        let best: Point | null = null;
        let bestD = snapDist;
        for (const t of targets) {
          const d = Math.hypot(t.x - p.x, t.y - p.y);
          if (d < bestD) {
            bestD = d;
            best = t;
          }
        }
        return best ? { x: best.x, y: best.y } : null;
      };

      arcs.forEach(arc => {
        if (!arc.endpoints || arc.loop.length < 2) return;
        const snapA = snap(arc.endpoints[0]);
        const snapB = snap(arc.endpoints[1]);
        if (snapA) {
          arc.endpoints[0] = snapA;
          arc.loop[0] = { ...snapA };
        }
        if (snapB) {
          arc.endpoints[1] = snapB;
          arc.loop[arc.loop.length - 1] = { ...snapB };
        }
      });
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

        const pieceAabb = computePieceAabb(piece.vertices);
        if (!this.aabbsIntersect(pieceAabb, carveRegion)) {
          console.log('[TerrainSurgery]   Skipping piece outside carve region', { pieceIdx, pieceAabb });
          return;
        }

        const endpoints: [Point, Point] = [
          { ...piece.vertices[0] },
          { ...piece.vertices[piece.vertices.length - 1] }
        ];

        boundaryArcs.push({
          loop: piece.vertices,
          closed: false,
          endpoints,
          sourceCanonicalId: canonLoop.id,
          canonicalEndpoints: [piece.startIndex, piece.endIndex]
        });

        pieceSummaries.push({
          pieceIdx,
          startCanon: piece.startIndex,
          endCanon: piece.endIndex,
          verts: piece.vertices.length,
          length: arcLength(piece.vertices).toFixed(3),
          endpoints,
          outsideFrac: arcOutsideMetrics(piece.vertices).outsideFrac.toFixed(2)
        });

        console.log('[TerrainSurgery] Boundary arc extracted (clipped piece)', {
          canonicalLoopId: canonLoop.id,
          arcLength: arcLength(piece.vertices).toFixed(3),
          arcVerts: piece.vertices.length,
          outsideFrac: arcOutsideMetrics(piece.vertices).outsideFrac.toFixed(2),
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

    snapBoundaryArcEndpoints(boundaryArcs, newLoopEndpoints);

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
        const segmentOutside = !isInsideCarveRegion(mid) || onBoundary;

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
   * Closed warm loops are included directly without modification.
   */
  private stitchCanonicalLoops(
    carvedLoops: CarvedLoop[],
    quantKey: (v: Point) => string,
    isInsideCarveRegion: (v: Point) => boolean,
    quantStep: number
  ): StitchedLoop[] {
    type EndpointRef = {
      loopId: number;
      loopIndex: number;
      endpointIndex: 0 | 1;
      isNew: boolean;
      sourceCanonicalId?: number;
      pos: Point;
      inside: boolean;
      canonicalIndex?: number;
    };

    const stitched: StitchedLoop[] = [];
    const endpointMap = new Map<string, EndpointRef[]>();
    const visitedLoops = new Set<number>(); // Track traversed edges by CarvedLoop.id

    const addEndpointRef = (key: string, ref: EndpointRef) => {
      const arr = endpointMap.get(key);
      if (arr) {
        arr.push(ref);
      } else {
        endpointMap.set(key, [ref]);
      }
    };

    const neighborCandidates = (pos: Point, canonicalIndex?: number): EndpointRef[] => {
      // Prefer exact canonical index match when available
      if (canonicalIndex !== undefined) {
        const exact = Array.from(endpointMap.values()).flat().filter(r =>
          r.canonicalIndex !== undefined &&
          r.canonicalIndex === canonicalIndex
        );
        if (exact.length > 0) {
          return exact;
        }
      }

      // Fall back to exact quantized position
      const baseKey = quantKey(pos);
      const exactKeyRefs = endpointMap.get(baseKey);
      if (exactKeyRefs && exactKeyRefs.length > 0) {
        return [...exactKeyRefs];
      }

      // Final fallback: neighboring keys (no distance filter) to avoid dead-ends from tiny drift
      const [ix, iy] = baseKey.split(',').map(Number);
      const result: EndpointRef[] = [];
      for (let dx = -1; dx <= 1; dx++) {
        for (let dy = -1; dy <= 1; dy++) {
          const key = `${ix + dx},${iy + dy}`;
          const arr = endpointMap.get(key);
          if (!arr) continue;
          result.push(...arr);
        }
      }
      return result;
    };

    // Index endpoints for all open loops
    carvedLoops.forEach((loop, loopIndex) => {
      if (loop.closed || !loop.endpoints) {
        return;
      }
      const [a, b] = loop.endpoints;
      const refs: [EndpointRef, EndpointRef] = [
        {
          loopId: loop.id,
          loopIndex,
          endpointIndex: 0,
          isNew: loop.isNew,
          sourceCanonicalId: loop.sourceCanonicalId,
          pos: a,
          inside: isInsideCarveRegion(a),
          canonicalIndex: loop.canonicalEndpoints ? loop.canonicalEndpoints[0] : undefined
        },
        {
          loopId: loop.id,
          loopIndex,
          endpointIndex: 1,
          isNew: loop.isNew,
          sourceCanonicalId: loop.sourceCanonicalId,
          pos: b,
          inside: isInsideCarveRegion(b),
          canonicalIndex: loop.canonicalEndpoints ? loop.canonicalEndpoints[1] : undefined
        }
      ];
      addEndpointRef(quantKey(a), refs[0]);
      addEndpointRef(quantKey(b), refs[1]);
    });

    // Helper to append vertices in correct order (avoids duplicating junction vertex)
    const appendVertices = (loop: CarvedLoop, startEndpoint: 0 | 1, out: Point[]) => {
      const verts = startEndpoint === 0 ? loop.loop : [...loop.loop].reverse();
      if (out.length === 0) {
        out.push(...verts);
      } else {
        out.push(...verts.slice(1)); // skip first to avoid duplicates at joints
      }
    };

    const chooseNext = (currentPos: Point, comingFrom: EndpointRef): EndpointRef | null => {
      let candidates = neighborCandidates(currentPos, comingFrom.canonicalIndex);
      // Filter out the edge we just traversed
      let available = candidates.filter(ref => ref.loopId !== comingFrom.loopId || ref.endpointIndex !== comingFrom.endpointIndex);

      // Fallback: if canonical lookup only found ourselves, fall back to positional match
      if (available.length === 0 && comingFrom.canonicalIndex !== undefined) {
        candidates = neighborCandidates(currentPos, undefined);
        available = candidates.filter(ref => ref.loopId !== comingFrom.loopId || ref.endpointIndex !== comingFrom.endpointIndex);
      }

      const unvisited = available.filter(ref => !visitedLoops.has(ref.loopId));

      // Preference rules
      if (comingFrom.isNew) {
        const pref = unvisited.find(ref => !ref.isNew);
        if (pref) return pref;
      } else {
        if (!comingFrom.inside) {
          const pref = unvisited.find(ref => !ref.isNew && ref.sourceCanonicalId === comingFrom.sourceCanonicalId);
          if (pref) return pref;
        } else {
          const pref = unvisited.find(ref => ref.isNew);
          if (pref) return pref;
        }
      }

      // Fallback: any unvisited neighbor
      if (unvisited.length > 0) {
        return unvisited[0];
      }

      // Dead end
      console.log('[Stitch] No neighbor found', {
        pos: currentPos,
        comingFrom: {
          loopId: comingFrom.loopId,
          endpointIndex: comingFrom.endpointIndex,
          isNew: comingFrom.isNew,
          sourceCanonicalId: comingFrom.sourceCanonicalId,
          canonicalIndex: comingFrom.canonicalIndex
        },
        available: available.map(r => ({
          loopId: r.loopId,
          endpointIndex: r.endpointIndex,
          isNew: r.isNew,
          sourceCanonicalId: r.sourceCanonicalId,
          canonicalIndex: r.canonicalIndex
        }))
      });
      return null;
    };

    // Seed stitched loops with closed warm loops directly
    carvedLoops.forEach(loop => {
      if (loop.isNew && loop.closed) {
        stitched.push({ id: stitched.length + 1, vertices: [...loop.loop] });
      }
    });

    const walkOpenLoops = (loopIndices: number[]) => {
      loopIndices.forEach(loopIndex => {
        const loop = carvedLoops[loopIndex];
        if (loop.closed || !loop.endpoints) return;
        if (visitedLoops.has(loop.id)) return;

        const startCandidates: (0 | 1)[] = [];
        const firstIdx: 0 | 1 = isInsideCarveRegion(loop.endpoints[0]) ? 0 : (isInsideCarveRegion(loop.endpoints[1]) ? 1 : 0);
        startCandidates.push(firstIdx, (firstIdx === 0 ? 1 : 0));

        for (const startIdx of startCandidates) {
          if (visitedLoops.has(loop.id)) break;

          const startRef: EndpointRef = {
            loopId: loop.id,
            loopIndex,
            endpointIndex: startIdx,
            isNew: loop.isNew,
            sourceCanonicalId: loop.sourceCanonicalId,
            pos: loop.endpoints[startIdx],
            inside: isInsideCarveRegion(loop.endpoints[startIdx]),
            canonicalIndex: loop.canonicalEndpoints ? loop.canonicalEndpoints[startIdx] : undefined
          };
          const startKey = quantKey(startRef.pos);

          let currentRef = startRef;
          const stitchedVertices: Point[] = [];
          let safety = 0;
          const tempVisited = new Set<number>();

          console.log('[Stitch] Start walk', {
            startLoopId: loop.id,
            startIdx,
            startPos: startRef.pos,
            canonicalIndex: startRef.canonicalIndex
          });

          while (safety++ < 10000) { // guard against infinite loops
            const currentLoop = carvedLoops[currentRef.loopIndex];
            const otherEndpoint: 0 | 1 = currentRef.endpointIndex === 0 ? 1 : 0;
            appendVertices(currentLoop, currentRef.endpointIndex, stitchedVertices);
            tempVisited.add(currentLoop.id);

            const otherPos = currentLoop.endpoints ? currentLoop.endpoints[otherEndpoint] : currentLoop.loop[currentLoop.loop.length - 1];
            const otherKey = quantKey(otherPos);

            // Completed a loop if we returned to start
            if (otherKey === startKey && stitchedVertices.length > 1) {
              const first = stitchedVertices[0];
              const last = stitchedVertices[stitchedVertices.length - 1];
              if (Math.hypot(first.x - last.x, first.y - last.y) > 1e-6) {
                stitchedVertices.push({ ...first });
              }
              stitched.push({ id: stitched.length + 1, vertices: stitchedVertices });
              tempVisited.forEach(id => visitedLoops.add(id));
              console.log('[Stitch] Completed loop', {
                stitchedId: stitched.length,
                vertices: stitchedVertices.length,
                loopsUsed: Array.from(tempVisited)
              });
              break;
            }

            const currentLoopCanon = carvedLoops[currentRef.loopIndex].canonicalEndpoints;
            const nextCanonicalIndex = currentLoopCanon ? currentLoopCanon[otherEndpoint] : currentRef.canonicalIndex;
            const nextRef = chooseNext(otherPos, {
              ...currentRef,
              endpointIndex: otherEndpoint,
              pos: otherPos,
              inside: isInsideCarveRegion(otherPos),
              canonicalIndex: nextCanonicalIndex
            });

            if (!nextRef) {
              console.log('[Stitch] Dead end', {
                atPos: otherPos,
                currentLoopId: currentLoop.id,
                loopsUsed: Array.from(tempVisited),
                neighbors: endpointMap.get(quantKey(otherPos))?.map(r => ({ loopId: r.loopId, canon: r.canonicalIndex }))
              });
              break;
            }

            currentRef = nextRef;
          }
        }
      });
    };

    const boundaryLoopIndices = carvedLoops
      .map((loop, idx) => (!loop.isNew && !loop.closed && loop.endpoints ? idx : -1))
      .filter(idx => idx >= 0);
    const newLoopIndices = carvedLoops
      .map((loop, idx) => (loop.isNew && !loop.closed && loop.endpoints ? idx : -1))
      .filter(idx => idx >= 0);

    // Step 1.5: stitch boundary arcs first (outer ring), then stitch new open loops.
    walkOpenLoops(boundaryLoopIndices);
    walkOpenLoops(newLoopIndices);

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
