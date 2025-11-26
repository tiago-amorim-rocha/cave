/**
 * Remesh Manager
 *
 * Handles all remeshing operations including:
 * - Full world remesh (periodic and on-demand)
 * - Incremental updates (future)
 * - Loop classification (rock vs cave)
 * - Integration with physics and rendering
 */

import type { DensityField } from './DensityField';
import type { MarchingSquares } from './MarchingSquares';
import type { LoopCache } from './LoopCache';
import type { Box2DPhysics } from './Box2DPhysics';
import type { Renderer } from './Renderer';
import { VertexOptimizationPipeline, type OptimizationOptions } from './VertexOptimizationPipeline';
import type { Point } from './types';
import { cleanLoop } from './physics/shapeUtils';
import { LoopPatcher } from './LoopPatcher';
import { createCanonicalLoop, replaceCanonicalRange, buildSegmentsForLoop, type CanonicalLoop, type OptVertex, type PhysicsSegment } from './terrain/CanonicalGeometry';

// Debug flag for loop classification - set to false to silence logs
const DEBUG_LOOP_CLASSIFICATION = true;

// Debug interfaces for loop classification analysis
interface DebugSamplePoint {
  x: number;
  y: number;
  density: number;
  side: "inside" | "outside";
  segmentIndex: number;
}

interface DebugLoopInfo {
  loopIndex?: number;
  area: number;
  centroid: { x: number; y: number };
  samples: DebugSamplePoint[];
}

/**
 * Compute signed area of a polygon
 * Positive area = CCW winding, Negative area = CW winding
 */
function computePolygonArea(loop: Point[]): number {
  let area = 0;
  const n = loop.length;
  for (let i = 0; i < n; i++) {
    const p = loop[i];
    const q = loop[(i + 1) % n];
    area += (p.x * q.y - q.x * p.y);
  }
  return area * 0.5;
}

/**
 * Compute centroid of a polygon using the shoelace formula
 */
function computePolygonCentroid(loop: Point[]): { x: number; y: number } {
  let areaAcc = 0;
  let cxAcc = 0;
  let cyAcc = 0;
  const n = loop.length;
  for (let i = 0; i < n; i++) {
    const p = loop[i];
    const q = loop[(i + 1) % n];
    const cross = p.x * q.y - q.x * p.y;
    areaAcc += cross;
    cxAcc += (p.x + q.x) * cross;
    cyAcc += (p.y + q.y) * cross;
  }
  const area = areaAcc * 0.5;
  if (Math.abs(area) < 1e-8) {
    // Fallback: simple average of vertices for degenerate cases
    let sx = 0, sy = 0;
    for (let i = 0; i < n; i++) {
      sx += loop[i].x;
      sy += loop[i].y;
    }
    return { x: sx / n, y: sy / n };
  }
  const f = 1 / (6 * area);
  return {
    x: cxAcc * f,
    y: cyAcc * f,
  };
}

export interface RemeshConfig {
  densityField: DensityField;
  marchingSquares: MarchingSquares;
  loopCache: LoopCache;
  physics: Box2DPhysics;
  renderer: Renderer;
  optimizationOptions: OptimizationOptions;
}

export interface RemeshStats {
  originalVertexCount: number;
  finalVertexCount: number;
  simplificationReduction: number;
  postSimplificationReduction: number;
}

export class RemeshManager {
  private densityField: DensityField;
  private marchingSquares: MarchingSquares;
  private loopCache: LoopCache;
  private physics: Box2DPhysics;
  private renderer: Renderer;
  private optimizationPipeline: VertexOptimizationPipeline;
  private optimizationOptions: OptimizationOptions;
  private loopPatcher: LoopPatcher;
  private canonicalLoops: CanonicalLoop[] = []; // Read-only canonical layer (cleaned marching squares output)
  private canonicalPhysicsLoops: Array<{ loop: CanonicalLoop; shouldReverse: boolean }> = [];
  private optimizedOptLoopsDebug: OptVertex[][] = []; // For ancestry debug rendering

  private lastFullHealTime = 0;
  private needsFullHeal = false;

  constructor(config: RemeshConfig) {
    this.densityField = config.densityField;
    this.marchingSquares = config.marchingSquares;
    this.loopCache = config.loopCache;
    this.physics = config.physics;
    this.renderer = config.renderer;
    this.optimizationOptions = config.optimizationOptions;
    this.optimizationPipeline = new VertexOptimizationPipeline();
    this.loopPatcher = new LoopPatcher({
      dirtyRegionPadding: 2,
      minArcLength: 3,
      affectedDistance: 0.5,
    });
  }

  /**
   * Simple AABB intersection test
   */
  private aabbsIntersect(a: { minX: number; minY: number; maxX: number; maxY: number }, b: { minX: number; minY: number; maxX: number; maxY: number }): boolean {
    return !(a.maxX < b.minX || a.minX > b.maxX || a.maxY < b.minY || a.minY > b.maxY);
  }

  /**
   * Geometry helper: check whether a loop (as points) touches an AABB.
   * Touch = any vertex inside, or any edge segment intersects the AABB.
   */
  private loopTouchesRegion(points: Point[], region: { minX: number; minY: number; maxX: number; maxY: number }): boolean {
    const pointInside = (p: Point) =>
      p.x >= region.minX && p.x <= region.maxX && p.y >= region.minY && p.y <= region.maxY;

    const segmentsIntersect = (a: Point, b: Point, c: Point, d: Point): boolean => {
      const cross = (p: Point, q: Point, r: Point) => (q.x - p.x) * (r.y - p.y) - (q.y - p.y) * (r.x - p.x);
      const onSegment = (p: Point, q: Point, r: Point) =>
        Math.min(p.x, r.x) - 1e-6 <= q.x && q.x <= Math.max(p.x, r.x) + 1e-6 &&
        Math.min(p.y, r.y) - 1e-6 <= q.y && q.y <= Math.max(p.y, r.y) + 1e-6;

      const o1 = cross(a, b, c);
      const o2 = cross(a, b, d);
      const o3 = cross(c, d, a);
      const o4 = cross(c, d, b);

      if (o1 === 0 && onSegment(a, c, b)) return true;
      if (o2 === 0 && onSegment(a, d, b)) return true;
      if (o3 === 0 && onSegment(c, a, d)) return true;
      if (o4 === 0 && onSegment(c, b, d)) return true;

      return (o1 > 0) !== (o2 > 0) && (o3 > 0) !== (o4 > 0);
    };

    const segmentIntersectsAABB = (p1: Point, p2: Point): boolean => {
      if (pointInside(p1) || pointInside(p2)) return true;

      // Quick reject using segment AABB
      const minX = Math.min(p1.x, p2.x);
      const maxX = Math.max(p1.x, p2.x);
      const minY = Math.min(p1.y, p2.y);
      const maxY = Math.max(p1.y, p2.y);
      if (maxX < region.minX || minX > region.maxX || maxY < region.minY || minY > region.maxY) {
        return false;
      }

      // Check against each rectangle edge
      const topLeft = { x: region.minX, y: region.minY };
      const topRight = { x: region.maxX, y: region.minY };
      const bottomLeft = { x: region.minX, y: region.maxY };
      const bottomRight = { x: region.maxX, y: region.maxY };

      return (
        segmentsIntersect(p1, p2, topLeft, topRight) ||
        segmentsIntersect(p1, p2, topRight, bottomRight) ||
        segmentsIntersect(p1, p2, bottomRight, bottomLeft) ||
        segmentsIntersect(p1, p2, bottomLeft, topLeft)
      );
    };

    // Any vertex inside?
    for (const v of points) {
      if (pointInside(v)) return true;
    }

    // Any edge intersect?
    for (let i = 0; i < points.length - 1; i++) {
      if (segmentIntersectsAABB(points[i], points[i + 1])) return true;
    }

    return false;
  }

  /**
   * Dev-only assertion to ensure canonical AABBs contain their vertices
   */
  private assertCanonicalAABBs(canonicalLoops: CanonicalLoop[]): void {
    for (const loop of canonicalLoops) {
      const { aabb } = loop;
      for (const v of loop.vertices) {
        console.assert(
          v.x >= aabb.minX - 1e-6 && v.x <= aabb.maxX + 1e-6 && v.y >= aabb.minY - 1e-6 && v.y <= aabb.maxY + 1e-6,
          '[Phase1] Canonical vertex outside AABB',
          { loopId: loop.id, vertex: { x: v.x, y: v.y }, aabb }
        );
      }
    }
  }

  /**
   * Compute AABB for optimized vertices (ancestry-carrying) - debug only
   */
  private computeOptAABB(loop: OptVertex[]): { minX: number; minY: number; maxX: number; maxY: number } {
    if (loop.length === 0) {
      return { minX: 0, minY: 0, maxX: 0, maxY: 0 };
    }
    let minX = loop[0].x;
    let minY = loop[0].y;
    let maxX = loop[0].x;
    let maxY = loop[0].y;
    for (const v of loop) {
      minX = Math.min(minX, v.x);
      minY = Math.min(minY, v.y);
      maxX = Math.max(maxX, v.x);
      maxY = Math.max(maxY, v.y);
    }
    return { minX, minY, maxX, maxY };
  }

  /**
   * Find canonical loops whose AABB intersects the dirty region
   */
  private findAffectedCanonicalLoops(region: { minX: number; minY: number; maxX: number; maxY: number }): CanonicalLoop[] {
    return this.canonicalLoops.filter(loop => this.aabbsIntersect(loop.aabb, region));
  }

  /**
   * Match new canonical loops to old ones by centroid proximity (greedy).
   */
  private matchNewLoopsToOld(oldLoops: CanonicalLoop[], newLoops: CanonicalLoop[]): Array<{ old: CanonicalLoop; replacement: CanonicalLoop | null }> {
    const remaining = [...newLoops];
    return oldLoops.map(oldLoop => {
      const oldCentroid = computePolygonCentroid(oldLoop.vertices);
      let bestIdx = -1;
      let bestDist = Infinity;
      for (let i = 0; i < remaining.length; i++) {
        const c = computePolygonCentroid(remaining[i].vertices);
        const dx = c.x - oldCentroid.x;
        const dy = c.y - oldCentroid.y;
        const d = dx * dx + dy * dy;
        if (d < bestDist) {
          bestDist = d;
          bestIdx = i;
        }
      }
      if (bestIdx === -1) {
        return { old: oldLoop, replacement: null };
      }
      const repl = remaining.splice(bestIdx, 1)[0];
      return { old: oldLoop, replacement: repl };
    });
  }

  /**
   * Find optimized vertex span overlapping a canonical range
   */
  private findAffectedOptVertices(optLoop: OptVertex[], dirtyStart: number, dirtyEnd: number): { removeStart: number; removeEnd: number } | null {
    let removeStart = -1;
    let removeEnd = -1;
    for (let i = 0; i < optLoop.length; i++) {
      const v = optLoop[i];
      const overlaps = v.canonStart <= dirtyEnd && v.canonEnd >= dirtyStart;
      if (overlaps) {
        if (removeStart === -1) removeStart = i;
        removeEnd = i;
      }
    }
    if (removeStart === -1 || removeEnd === -1) return null;
    return { removeStart, removeEnd };
  }

  /**
   * Rebuild optimized vertices for a canonical slice (inclusive range, clamped)
   */
  private rebuildOptimizedRange(canon: CanonicalLoop, dirtyStart: number, dirtyEnd: number): OptVertex[] {
    const start = Math.max(0, dirtyStart);
    const end = Math.min(canon.vertices.length - 1, dirtyEnd);
    if (end - start < 1) {
      return [];
    }
    const slice: Point[] = [];
    for (let i = start; i <= end; i++) {
      const v = canon.vertices[i];
      slice.push({ x: v.x, y: v.y });
    }
    // Ensure closure
    if (slice.length > 0) {
      const first = slice[0];
      const last = slice[slice.length - 1];
      if (Math.abs(first.x - last.x) > 1e-6 || Math.abs(first.y - last.y) > 1e-6) {
        slice.push({ x: first.x, y: first.y });
      }
    }
    const opt = this.optimizationPipeline.optimize([slice], this.optimizationOptions);
    return opt.finalOptLoops?.[0] ?? [];
  }

  /**
   * Stitch new optimized vertices into an existing optimized loop
   */
  private stitchOptimizedRange(optLoop: OptVertex[], removeStart: number, removeEnd: number, newOpt: OptVertex[]): OptVertex[] {
    return [
      ...optLoop.slice(0, removeStart),
      ...newOpt,
      ...optLoop.slice(removeEnd + 1)
    ];
  }

  /**
   * Compute canonical index range overlapping a region (returns full loop if no overlap found)
   */
  private canonicalDirtyRange(loop: CanonicalLoop, region: { minX: number; minY: number; maxX: number; maxY: number }): { start: number; end: number } {
    let start = -1;
    let end = -1;
    const inside = (v: Point) =>
      v.x >= region.minX && v.x <= region.maxX && v.y >= region.minY && v.y <= region.maxY;
    for (let i = 0; i < loop.vertices.length; i++) {
      const v = loop.vertices[i];
      if (inside(v)) {
        if (start === -1) start = i;
        end = i;
      }
    }
    if (start === -1 || end === -1) {
      return { start: 0, end: loop.vertices.length - 1 };
    }
    return { start, end };
  }

  /**
   * Get current canonical loops (for debug visualization)
   */
  getCanonicalLoops(): CanonicalLoop[] {
    return this.canonicalLoops;
  }

  /**
   * Update optimization options (called when user changes settings)
   */
  updateOptimizationOptions(options: Partial<OptimizationOptions>): void {
    this.optimizationOptions = { ...this.optimizationOptions, ...options };
  }

  /**
   * Trigger a remesh check
   */
  remesh(): RemeshStats | null {
    try {
      console.log('[RemeshManager] remesh() start');
      const now = performance.now();

      // Check if we need a full heal (on-demand only, no periodic heal since carving is disabled)
      if (this.needsFullHeal || this.loopCache.count() === 0) {
        // Full world remesh
        const stats = this.fullHeal();
        this.needsFullHeal = false;
        this.lastFullHealTime = now;
        return stats;
      } else {
        // No remesh needed
        return null;
      }
    } catch (error) {
      const err: any = error;
      console.error('[RemeshManager] Error during remesh:', {
        message: err?.message,
        stack: err?.stack,
        raw: err,
      });
      return null;
    }
  }

  /**
   * Request a full heal on next remesh
   */
  requestFullHeal(): void {
    this.needsFullHeal = true;
  }

  /**
   * Full world remesh - rebuild all loops
   */
  private fullHeal(): RemeshStats {
    const startTime = performance.now();

    // Clear local update debug info (full heal replaces everything)
    this.renderer.clearLocalUpdateDebug();

    // Clear cache
    this.loopCache.clear();

    // Generate all contours for entire field
    const fullField = {
      minX: 0,
      minY: 0,
      maxX: this.densityField.config.width,
      maxY: this.densityField.config.height
    };

    const t0 = performance.now();
    const results = this.marchingSquares.generateContours(fullField, 0);
    const t1 = performance.now();
    const rawLoopCount = results.filter(r => r && r.loop && r.loop.length > 2).length;
    console.log(`[FullHeal] ⏱️ Marching Squares: ${(t1 - t0).toFixed(2)}ms (generated ${rawLoopCount} raw loops)`);

    // Add all loops to cache
    for (const result of results) {
      if (result && result.loop && result.loop.length > 2) {
        this.loopCache.addLoop(result.loop, result.closed);
      }
    }

    // Get all loops and classify them for debugging
    const allLoops = this.loopCache.getAllLoops();
    const allPolylines = allLoops.map(l => l.vertices);

    // Clean all loops BEFORE classification to remove duplicates, tiny edges, etc.
    const t2 = performance.now();
    const gridPitch = this.densityField.config.gridPitch;
    const cleanedLoops = allPolylines.map(loop => cleanLoop(loop, gridPitch));
    const t3 = performance.now();
    const rawVertexCount = allPolylines.reduce((sum, loop) => sum + loop.length, 0);
    const cleanedVertexCount = cleanedLoops.reduce((sum, loop) => sum + loop.length, 0);
    console.log(`[FullHeal] ⏱️ Clean loops: ${(t3 - t2).toFixed(2)}ms (${rawVertexCount} → ${cleanedVertexCount} vertices)`);

    // Classify loops with indices for debugging (but keep ALL loops for rendering)
    const t4 = performance.now();
    const loopMetadata: Array<{
      index: number;
      centroid: { x: number; y: number };
      isRock: boolean;
      samples?: DebugSamplePoint[];
    }> = [];

    const validLoops: Point[][] = [];
    const loopClassifications: boolean[] = []; // Store classifications for later use
    let deletedCount = 0;

    cleanedLoops.forEach((loop, index) => {
      if (loop.length < 3) return;

      const classificationResult = this.isRockLoop(loop, index);

      // Skip loops marked for deletion
      if (classificationResult.shouldDelete) {
        deletedCount++;
        return;
      }

      const isRock = classificationResult.isRock;
      const centroid = computePolygonCentroid(loop);

      loopMetadata.push({
        index,
        centroid,
        isRock,
        samples: classificationResult.samples
      });

      validLoops.push(loop);
      loopClassifications.push(isRock); // Store whether this loop has rock inside
    });
    const t5 = performance.now();
    console.log(`[FullHeal] ⏱️ Classification: ${(t5 - t4).toFixed(2)}ms (${validLoops.length} valid loops, ${deletedCount} deleted)`);

    // Build canonical loops (read-only layer) directly from cleaned marching squares output
    const canonicalLoops = validLoops.map(loop => createCanonicalLoop(loop));
    this.canonicalLoops = canonicalLoops;
    this.assertCanonicalAABBs(canonicalLoops);
    console.log('[Phase1] Created canonical loops', {
      count: canonicalLoops.length,
      totalVertices: canonicalLoops.reduce((sum, l) => sum + l.vertices.length, 0),
      aabbs: canonicalLoops.map(l => l.aabb)
    });
    this.renderer.setCanonicalLoops(canonicalLoops);

    // Pass loop metadata to renderer for debug visualization
    this.renderer.setLoopDebugInfo(loopMetadata);

    // Run vertex optimization pipeline
    const optimizationResult = this.optimizationPipeline.optimize(validLoops, this.optimizationOptions);
    const finalVertexCount = optimizationResult.finalLoops.reduce((sum, loop) => sum + loop.length, 0);
    console.log(`[FullHeal] ⏱️ Optimization: ${optimizationResult.timing.totalMs.toFixed(2)}ms (${cleanedVertexCount} → ${finalVertexCount} vertices)`);
    console.log(`[FullHeal]    ↳ cleanLoop: ${optimizationResult.timing.cleanLoopMs.toFixed(2)}ms`);
    if (optimizationResult.timing.simplificationMs > 0) {
      console.log(`[FullHeal]    ↳ Visvalingam-Whyatt (reduce): ${optimizationResult.timing.simplificationMs.toFixed(2)}ms`);
    }
    if (optimizationResult.timing.chaikinMs > 0) {
      console.log(`[FullHeal]    ↳ Chaikin smoothing (expand): ${optimizationResult.timing.chaikinMs.toFixed(2)}ms`);
    }
    if (optimizationResult.timing.postSimplificationMs > 0) {
      console.log(`[FullHeal]    ↳ Post-simplification (reduce): ${optimizationResult.timing.postSimplificationMs.toFixed(2)}ms`);
    }

    // Store original for debug visualization
    this.renderer.updateOriginalPolylines(optimizationResult.trueOriginalLoops);
    this.optimizedOptLoopsDebug = optimizationResult.finalOptLoops ?? [];
    this.renderer.setOptimizedOptLoops(this.optimizedOptLoopsDebug);

    // Use stored classifications from before optimization (more reliable than reclassifying)
    // Based on testing: reverse if cave inside (rock island), keep if rock inside (cave boundary)
    const shouldReverse = loopClassifications.map((isRock, index) => {
      // CORRECT LOGIC (verified working): Reverse if NOT rock (cave inside = rock island)
      return !isRock;
    });

    // Use final loops for both physics and rendering (canonical representation)
    const t6 = performance.now();
    const canonicalPhysicsLoops = optimizationResult.finalLoops.map(loop => createCanonicalLoop(loop));
    const totalCanonicalVerts = canonicalPhysicsLoops.reduce((sum, cl) => sum + cl.vertices.length, 0);
    console.log(`[FullHeal] Canonical loops: ${canonicalPhysicsLoops.length} (${totalCanonicalVerts} verts total)`);
    this.canonicalPhysicsLoops = canonicalPhysicsLoops.map((loop, index) => ({ loop, shouldReverse: shouldReverse[index] ?? true }));
    // Cache optimized/segment debug on canonical loops
    for (let i = 0; i < canonicalPhysicsLoops.length; i++) {
      canonicalPhysicsLoops[i].optVertices = optimizationResult.finalOptLoops[i];
    }
    const physicsEngine = this.physics.getEngine();
    console.log('[FullHeal] Calling physicsEngine.setCanonicalTerrainLoops');
    try {
      physicsEngine.setCanonicalTerrainLoops(canonicalPhysicsLoops, optimizationResult.finalOptLoops, shouldReverse);
      console.log('[FullHeal] physicsEngine.setCanonicalTerrainLoops completed');
    } catch (err) {
      console.error('[FullHeal] physicsEngine.setCanonicalTerrainLoops threw', err);
      throw err;
    }
    this.renderer.setSegmentDebugData(physicsEngine.getSegmentDebugSnapshot());
    const t7 = performance.now();
    console.log(`[FullHeal] ⏱️ Box2D colliders: ${(t7 - t6).toFixed(2)}ms (created ${optimizationResult.finalLoops.length} bodies)`);

    console.log(`[FullHeal] 🎯 TOTAL (physics only): ${(t7 - t0).toFixed(2)}ms`);

    // Update renderer with final loops
    const t8 = performance.now();
    const finalForRender = canonicalPhysicsLoops.map(loop => loop.vertices.map(p => ({ x: p.x, y: p.y })));
    console.log(`[FullHeal] Updating renderer polylines with ${finalForRender.length} loops`);
    try {
      this.renderer.updatePolylines(finalForRender);
      console.log(`[FullHeal] Render polylines: ${finalForRender.length}, first lengths=${finalForRender.map(l => l.length).join(',')}`);
    } catch (err) {
      console.error('[FullHeal] Renderer.updatePolylines threw', err);
      throw err;
    }
    const t9 = performance.now();
    console.log(`[FullHeal] ⏱️ Re-render walls: ${(t9 - t8).toFixed(2)}ms`);

    console.log(`[FullHeal] 🎯 TOTAL (including rendering): ${(t9 - t0).toFixed(2)}ms`);

    this.densityField.clearDirty();

    return optimizationResult.statistics;
  }

  /**
   * Local update - Phase 6: canonical surgery only, then fallback to full rebuild for optimized/physics.
   */
  localUpdate(expandCells: number = 2): RemeshStats | null {
    const dirtyAABB = this.densityField.getDirtyWorldAABB();
    if (!dirtyAABB) return null;

    const gridPitch = this.densityField.config.gridPitch;
    const paddedAABB = {
      minX: dirtyAABB.minX - expandCells * gridPitch,
      minY: dirtyAABB.minY - expandCells * gridPitch,
      maxX: dirtyAABB.maxX + expandCells * gridPitch,
      maxY: dirtyAABB.maxY + expandCells * gridPitch
    };

    // A) Find affected canonical loops
    const affectedCanonicals = this.findAffectedCanonicalLoops(paddedAABB);

    // B/C) Marching squares in dirty region, then clean
    const msResults = this.marchingSquares.generateContours(paddedAABB, expandCells);
    const cleanedLoops: Point[][] = [];
    for (const res of msResults) {
      if (res && res.loop && res.loop.length > 2) {
        const cleaned = cleanLoop(res.loop, gridPitch);
        if (cleaned.length >= 3) {
          cleanedLoops.push(cleaned);
        }
      }
    }
    const newCanonicalLoops = cleanedLoops.map(loop => createCanonicalLoop(loop));

    // D) Canonical surgery: replace full loop spans for affected loops with matched new loops
    const matches = this.matchNewLoopsToOld(affectedCanonicals, newCanonicalLoops);
    const remainingNew = new Set(newCanonicalLoops);
    const replacements: CanonicalLoop[] = [];
    for (const match of matches) {
      if (!match.replacement) continue;
      const replLoops = replaceCanonicalRange(
        match.old,
        0,
        match.old.vertices.length - 1,
        match.replacement.vertices.map(v => ({ x: v.x, y: v.y })),
        gridPitch
      );
      replLoops.forEach(r => replacements.push(r));
      remainingNew.delete(match.replacement);
    }
    for (const loop of remainingNew) {
      replacements.push(loop);
    }

    this.canonicalLoops = this.canonicalLoops.filter(loop => !affectedCanonicals.includes(loop));
    this.canonicalLoops.push(...replacements);
    this.assertCanonicalAABBs(this.canonicalLoops);
    this.renderer.setCanonicalLoops(this.canonicalLoops);
    this.renderer.setDirtyAABB(paddedAABB);

    console.log('[LocalUpdate] Canonical surgery', {
      dirtyAABB: paddedAABB,
      affectedLoops: affectedCanonicals.length,
      surgeryResults: matches.map(m => ({
        oldLoopId: m.old.id,
        newLoopCount: replacements.filter(r => r.version === m.old.version + 1).length
      })),
      fallbackToFullRebuild: false
    });

    // E) Rebuild optimized vertices locally for affected loops (ancestry-aware)
    const newOptLoopsDebug: OptVertex[][] = [];
    const newSegmentsDebug: PhysicsSegment[][] = [];
    for (const repl of replacements) {
      const dirtyRange = this.canonicalDirtyRange(repl, paddedAABB);
      const optResult = this.optimizationPipeline.optimize([repl.vertices.map(v => ({ x: v.x, y: v.y }))], this.optimizationOptions);
      const optLoop = optResult.finalOptLoops?.[0];
      if (optLoop) {
        newOptLoopsDebug.push(optLoop);
        // Build segments for debug/physics
        const segments = buildSegmentsForLoop(
          repl.id,
          optLoop,
          64,
          20,
          12,
          0.35
        );
        newSegmentsDebug.push(segments);
        console.log('[LocalOptRebuild] Rebuilding range', {
          canonRange: [dirtyRange.start, dirtyRange.end],
          removedOptVerts: 0,
          newOptVerts: optLoop.length,
          ancestryCoverage: optLoop.every(v => v.canonStart !== undefined && v.canonEnd !== undefined)
        });
        repl.optVertices = optLoop;
        repl.segments = segments;
      }
    }

    // Merge optimized debug loops: drop those whose AABB intersects padded region
    const keptOptLoops: OptVertex[][] = [];
    for (const loop of this.optimizedOptLoopsDebug) {
      const aabb = this.computeOptAABB(loop);
      if (!this.aabbsIntersect(aabb, paddedAABB)) {
        keptOptLoops.push(loop);
      }
    }
    this.optimizedOptLoopsDebug = [...keptOptLoops, ...newOptLoopsDebug];
    this.renderer.setOptimizedOptLoops(this.optimizedOptLoopsDebug);

    // Update canonical physics loops with replacements for physics update
    this.canonicalPhysicsLoops = this.canonicalPhysicsLoops.filter(entry => !affectedCanonicals.includes(entry.loop));
    for (const repl of replacements) {
      this.canonicalPhysicsLoops.push({ loop: repl, shouldReverse: true });
    }

    // Physically update only affected region
    const engine = this.physics.getEngine();
    const removed = engine.removeTerrainInRegion(paddedAABB);
    console.log(`[LocalUpdate] ⏱️ Remove bodies (local segments): removed ${removed}`);
    engine.addCanonicalTerrainLoops(
      replacements,
      replacements.map(r => r.optVertices ?? [])
    );
    this.renderer.setSegmentDebugData(engine.getSegmentDebugSnapshot());

    // Refresh visuals using full optimized loops (safe for now)
    const renderLoops = this.optimizedOptLoopsDebug.map(loop => loop.map(v => ({ x: v.x, y: v.y })));
    this.renderer.updatePolylines(renderLoops);

    this.densityField.clearDirty();

    return {
      originalVertexCount: 0,
      finalVertexCount: 0,
      simplificationReduction: 0,
      postSimplificationReduction: 0,
    };
  }

  /**
   * Local patch update - DEPRECATED arc patching path.
   *
   * This method uses the LoopPatcher class for arc-based surgery, which has been
   * superseded by the TerrainSurgery approach. Use TerrainSurgery.extractCarvedLoops()
   * for new carving operations.
   *
   * @deprecated Use TerrainSurgery for carving operations
   */
  localPatchUpdate(expandCells: number = 2): RemeshStats | null {
    const startTime = performance.now();

    // Get dirty region from density field
    const dirtyAABB = this.densityField.getDirtyWorldAABB();
    if (!dirtyAABB) {
      return null;
    }

    console.log(`[LocalPatch] 🔍 Dirty AABB: (${dirtyAABB.minX.toFixed(2)}, ${dirtyAABB.minY.toFixed(2)}) to (${dirtyAABB.maxX.toFixed(2)}, ${dirtyAABB.maxY.toFixed(2)})`);

    // Pad the AABB by expandCells to ensure correct marching squares behavior at boundaries
    const h = this.densityField.config.gridPitch;
    const paddedAABB = {
      minX: dirtyAABB.minX - expandCells * h,
      minY: dirtyAABB.minY - expandCells * h,
      maxX: dirtyAABB.maxX + expandCells * h,
      maxY: dirtyAABB.maxY + expandCells * h
    };

    // Step 1: Run marching squares only in padded region to get new contour fragments
    const t0 = performance.now();
    console.log(`[LocalPatch] 📐 Padded AABB size: ${(paddedAABB.maxX - paddedAABB.minX).toFixed(2)}m x ${(paddedAABB.maxY - paddedAABB.minY).toFixed(2)}m`);
    const results = this.marchingSquares.generateContours(paddedAABB, expandCells);
    const t1 = performance.now();
    const rawLoopCount = results.filter(r => r && r.loop && r.loop.length > 2).length;
    console.log(`[LocalPatch] ⏱️ Marching Squares: ${(t1 - t0).toFixed(2)}ms (generated ${rawLoopCount} raw loops)`);

    // Step 2: Clean new fragments
    const t2 = performance.now();
    const gridPitch = this.densityField.config.gridPitch;
    const newFragments: Point[][] = [];

    for (const result of results) {
      if (result && result.loop && result.loop.length > 2) {
        const cleanedLoop = cleanLoop(result.loop, gridPitch);
        if (cleanedLoop.length >= 3) {
          console.log(`[LocalPatch]    Fragment: ${result.loop.length} vertices (raw) → ${cleanedLoop.length} vertices (cleaned)`);
          newFragments.push(cleanedLoop);
        }
      }
    }
    const t3 = performance.now();
    console.log(`[LocalPatch] ⏱️ Clean fragments: ${(t3 - t2).toFixed(2)}ms (${newFragments.length} fragments)`);

    // Step 3: Find affected terrain bodies and patch them
    const engine = this.physics.getEngine();
    const affectedBodies = engine.getTerrainBodiesInRegion(paddedAABB);
    console.log(`[LocalPatch] 🔍 Found ${affectedBodies.length} affected terrain bodies`);

    const patchDebugInfo: Array<{
      originalLoop: Point[];
      oldArc: Point[];
      newArc: Point[];
      patchedLoop: Point[];
      beforePart: Point[];
      afterPart: Point[];
      dirtyAABB: typeof paddedAABB;
    }> = [];

    const patchedLoops: Point[][] = [];
    const patchedOptLoops: OptVertex[][] = [];
    const patchedShouldReverse: boolean[] = [];
    let totalPatchedCount = 0;

    for (const bodyInfo of affectedBodies) {
      const originalLoop = bodyInfo.originalLoop;
      console.log(`[LocalPatch] 🔧 Attempting to patch loop with ${originalLoop.length} vertices`);

      // Try to patch this loop
      const t4 = performance.now();
      const patchResult = this.loopPatcher.patchLoop(originalLoop, paddedAABB, newFragments);
      const t5 = performance.now();

      if (patchResult) {
        console.log(`[LocalPatch] ✅ Successfully patched loop #${totalPatchedCount}: ${(t5 - t4).toFixed(2)}ms`);
        console.log(`[LocalPatch]    oldArc: ${patchResult.oldArc.length} vertices`);
        console.log(`[LocalPatch]    newArc: ${patchResult.newArc.length} vertices`);
        console.log(`[LocalPatch]    beforePart: ${patchResult.beforePart.length} vertices (KEPT)`);
        console.log(`[LocalPatch]    afterPart: ${patchResult.afterPart.length} vertices (KEPT)`);
        console.log(`[LocalPatch]    patchedLoop: ${patchResult.patchedLoop.length} vertices total`);

        // Optimize the patched loop
        const optimizationResult = this.optimizationPipeline.optimize([patchResult.patchedLoop], this.optimizationOptions);
        const optimizedPatchedLoop = optimizationResult.finalLoops[0];
        const optimizedPatchedOptLoop = optimizationResult.finalOptLoops?.[0];

        // Classify the patched loop
        const classification = this.isRockLoop(optimizedPatchedLoop, totalPatchedCount);
        if (!classification.shouldDelete) {
          patchedLoops.push(optimizedPatchedLoop);
          const fallbackOpt = optimizedPatchedLoop.map((p, idx) => ({
            x: p.x,
            y: p.y,
            canonStart: idx,
            canonEnd: idx,
          }));
          patchedOptLoops.push(optimizedPatchedOptLoop ?? fallbackOpt);
          patchedShouldReverse.push(!classification.isRock);

          // Store debug info
          patchDebugInfo.push({
            originalLoop: patchResult.originalLoop,
            oldArc: patchResult.oldArc,
            newArc: patchResult.newArc,
            patchedLoop: optimizedPatchedLoop,
            beforePart: patchResult.beforePart,
            afterPart: patchResult.afterPart,
            dirtyAABB: patchResult.dirtyAABB,
          });

          totalPatchedCount++;
        }
      } else {
        console.log(`[LocalPatch] ❌ Failed to patch loop (no suitable arc found)`);
      }
    }

    const t6 = performance.now();
    console.log(`[LocalPatch] ⏱️ Total patching: ${(t6 - t0).toFixed(2)}ms (patched ${totalPatchedCount} loops)`);

    // Step 4: Remove old physics bodies and add new patched ones
    const t7 = performance.now();
    const removedCount = engine.removeTerrainInRegion(paddedAABB);
    const t8 = performance.now();
    console.log(`[LocalPatch] ⏱️ Remove old bodies: ${(t8 - t7).toFixed(2)}ms (removed ${removedCount} bodies)`);

    const patchedCanonicalLoops = patchedLoops.map(loop => createCanonicalLoop(loop));
    // Update canonical registry for patch region
    this.canonicalPhysicsLoops = this.canonicalPhysicsLoops.filter(entry => !this.aabbsIntersect(entry.loop.aabb, paddedAABB));
    for (let i = 0; i < patchedCanonicalLoops.length; i++) {
      this.canonicalPhysicsLoops.push({ loop: patchedCanonicalLoops[i], shouldReverse: patchedShouldReverse[i] ?? true });
    }
    console.log(`[LocalPatch] Canonical registry now has ${this.canonicalPhysicsLoops.length} loops (added ${patchedCanonicalLoops.length})`);

    const t9 = performance.now();
    engine.addCanonicalTerrainLoops(patchedCanonicalLoops, patchedOptLoops, patchedShouldReverse);
    const t10 = performance.now();
    console.log(`[LocalPatch] ⏱️ Add patched bodies: ${(t10 - t9).toFixed(2)}ms (created ${patchedLoops.length} bodies)`);
    this.renderer.setSegmentDebugData(engine.getSegmentDebugSnapshot());

    console.log(`[LocalPatch] 🎯 TOTAL (physics only): ${(t10 - t0).toFixed(2)}ms`);

    // Step 5: Set debug info for visualization
    console.log(`[LocalPatch] 🎨 Setting ${patchDebugInfo.length} patch debug infos for visualization`);
    this.renderer.setLoopPatchDebugInfo(patchDebugInfo);

    // Step 6: Update visuals - LOCAL update only (remove old, add new)
    const t11 = performance.now();

    // Remove old polylines in the affected region
    const removedPolylineCount = this.renderer.removePolylinesInRegion(paddedAABB);
    const t11a = performance.now();
    console.log(`[LocalPatch] ⏱️ Remove old polylines: ${(t11a - t11).toFixed(2)}ms (removed ${removedPolylineCount})`);

    // Use the already-computed patched loops for visual update
    // We need to run marching squares on the dirty region to get the visual representation
    const visualResults = this.marchingSquares.generateContours(paddedAABB, expandCells);
    const visualLoops: Point[][] = [];

    for (const result of visualResults) {
      if (result && result.loop && result.loop.length > 2) {
        const cleanedLoop = cleanLoop(result.loop, gridPitch);
        if (cleanedLoop.length >= 3) {
          visualLoops.push(cleanedLoop);
        }
      }
    }

    const t11b = performance.now();
    console.log(`[LocalPatch] ⏱️ Local marching squares for visuals: ${(t11b - t11a).toFixed(2)}ms (${visualLoops.length} loops)`);

    // Optimize the local visual loops
    const visualOptimization = this.optimizationPipeline.optimize(visualLoops, this.optimizationOptions);
    const t11c = performance.now();
    console.log(`[LocalPatch] ⏱️ Optimize local visual loops: ${(t11c - t11b).toFixed(2)}ms`);

    // Add the new optimized polylines
    const finalForRender = visualOptimization.finalLoops.map(loop => loop.map(p => ({ x: p.x, y: p.y })));
    this.renderer.addPolylines(finalForRender, visualOptimization.trueOriginalLoops);

    const t12 = performance.now();
    console.log(`[LocalPatch] ⏱️ Local visual update (remove + add): ${(t12 - t11).toFixed(2)}ms`);

    console.log(`[LocalPatch] 🎯 TOTAL (including rendering): ${(t12 - t0).toFixed(2)}ms`);

    // Clear dirty region
    this.densityField.clearDirty();

    return visualOptimization.statistics;
  }

  /**
   * Incremental update - only update affected loops
   * For physics-enabled mode, we do a full heal to ensure physics bodies are correct
   */
  private incrementalUpdate(): RemeshStats | null {
    // For now, just do a full heal since we have physics
    // In the future, we could optimize this to only update affected physics bodies
    return this.fullHeal();
  }

  /**
   * Determine if a loop represents solid rock or a cave hole
   * Uses signed area and density sampling to classify
   *
   * Samples multiple edges and uses majority voting for robust classification.
   * Edges with ambiguous samples (same sign inside/outside) are ignored.
   * If classification is ambiguous after sampling, the loop is marked for deletion.
   *
   * @param loop - The polygon loop to classify
   * @param loopIndex - Optional index for debug output correlation
   * @returns Object with isRock boolean, shouldDelete flag, and optional sample points
   */
  private isRockLoop(loop: Point[], loopIndex?: number): {
    isRock: boolean;
    shouldDelete: boolean;
    samples?: DebugSamplePoint[]
  } {
    if (loop.length < 3) return { isRock: false, shouldDelete: true };

    // Compute polygon properties using helper functions
    const area = computePolygonArea(loop);
    const centroid = computePolygonCentroid(loop);

    // Epsilon distances for sampling (in world units / metres)
    // Sample just over half a cell away to check the neighboring cell
    const gridPitch = this.densityField.config.gridPitch;
    const epsilonInside = 0.501 * gridPitch;
    const epsilonOutside = 0.501 * gridPitch;

    const n = loop.length;

    const debugInfo: DebugLoopInfo = {
      loopIndex,
      area,
      centroid,
      samples: [],
    };

    // Helper to sample an edge and determine if it votes "rock"
    const sampleEdge = (edgeIndex: number): { isRock: boolean; isValid: boolean } => {
      const p = loop[edgeIndex];
      const q = loop[(edgeIndex + 1) % n];

      // Segment midpoint
      const mx = (p.x + q.x) * 0.5;
      const my = (p.y + q.y) * 0.5;

      // Calculate left normal to edge p->q
      let nx = q.y - p.y;
      let ny = -(q.x - p.x);
      const len = Math.hypot(nx, ny);

      // Skip degenerate edges
      if (len < 1e-10) return { isRock: false, isValid: false };

      nx /= len;
      ny /= len;

      // Flip normal based on winding so it points inward
      // CCW (area > 0): left normal points outward, flip it to point inward
      // CW (area < 0): left normal points inward, keep it
      if (area > 0) {
        nx = -nx;
        ny = -ny;
      }

      // Adjust epsilon based on normal direction
      const maxComponent = Math.max(Math.abs(nx), Math.abs(ny));
      const angleAdjustment = 1.0 / maxComponent;
      const adjustedEpsilonInside = epsilonInside * angleAdjustment;
      const adjustedEpsilonOutside = epsilonOutside * angleAdjustment;

      // Sample inside and outside
      const insideX = mx + nx * adjustedEpsilonInside;
      const insideY = my + ny * adjustedEpsilonInside;
      const outsideX = mx - nx * adjustedEpsilonOutside;
      const outsideY = my - ny * adjustedEpsilonOutside;

      const insideGrid = this.densityField.worldToGrid(insideX, insideY);
      const outsideGrid = this.densityField.worldToGrid(outsideX, outsideY);

      const insideDensity = this.densityField.get(insideGrid.gridX, insideGrid.gridY);
      const outsideDensity = this.densityField.get(outsideGrid.gridX, outsideGrid.gridY);

      // Record samples for debug visualization
      if (DEBUG_LOOP_CLASSIFICATION) {
        debugInfo.samples.push(
          { x: insideX, y: insideY, density: insideDensity, side: "inside", segmentIndex: edgeIndex },
          { x: outsideX, y: outsideY, density: outsideDensity, side: "outside", segmentIndex: edgeIndex }
        );
      }

      // Check if signs differ (valid sample)
      const insideIsRock = insideDensity >= 128;
      const outsideIsRock = outsideDensity >= 128;

      if (insideIsRock === outsideIsRock) {
        // Same sign on both sides - ambiguous, ignore this edge
        return { isRock: false, isValid: false };
      }

      // Valid sample: inside tells us if this is rock or cave
      return { isRock: insideIsRock, isValid: true };
    };

    // Sample edges and collect votes
    let rockVotes = 0;
    let caveVotes = 0;
    let sampledEdges = 0;

    // First round: sample 3 edges distributed evenly around the loop
    // At 0°, 120°, 240° positions
    const firstRoundIndices = [
      0,
      Math.floor(n / 3),
      Math.floor(2 * n / 3)
    ].filter(i => i < n);

    for (const edgeIndex of firstRoundIndices) {
      const result = sampleEdge(edgeIndex);
      if (result.isValid) {
        sampledEdges++;
        if (result.isRock) {
          rockVotes++;
        } else {
          caveVotes++;
        }
      }
    }

    // Check if we need a second round (tie or not enough valid samples)
    if (sampledEdges > 0 && rockVotes !== caveVotes) {
      // We have a clear majority, use it
      const isRock = rockVotes > caveVotes;

      if (DEBUG_LOOP_CLASSIFICATION) {
        this.logClassification(loopIndex, debugInfo, isRock, {
          rockVotes,
          caveVotes,
          sampledEdges,
          round: 1
        });
      }

      return { isRock, shouldDelete: false, samples: DEBUG_LOOP_CLASSIFICATION ? debugInfo.samples : undefined };
    }

    // Second round: sample 3 more edges between the first ones
    // At 60°, 180°, 300° positions
    const secondRoundIndices = [
      Math.floor(n / 6),
      Math.floor(n / 2),
      Math.floor(5 * n / 6)
    ].filter(i => i < n);
    for (const edgeIndex of secondRoundIndices) {
      const result = sampleEdge(edgeIndex);
      if (result.isValid) {
        sampledEdges++;
        if (result.isRock) {
          rockVotes++;
        } else {
          caveVotes++;
        }
      }
    }

    // Final decision
    if (sampledEdges === 0 || rockVotes === caveVotes) {
      // No valid samples or still tied - delete this loop
      if (DEBUG_LOOP_CLASSIFICATION) {
        console.warn(`⚠️ LOOP #${loopIndex}: AMBIGUOUS - deleting`, {
          rockVotes,
          caveVotes,
          sampledEdges,
          area,
          centroid,
          vertexCount: loop.length
        });
      }
      return { isRock: false, shouldDelete: true, samples: DEBUG_LOOP_CLASSIFICATION ? debugInfo.samples : undefined };
    }

    const isRock = rockVotes > caveVotes;

    if (DEBUG_LOOP_CLASSIFICATION) {
      this.logClassification(loopIndex, debugInfo, isRock, {
        rockVotes,
        caveVotes,
        sampledEdges,
        round: 2
      });
    }

    return { isRock, shouldDelete: false, samples: DEBUG_LOOP_CLASSIFICATION ? debugInfo.samples : undefined };
  }

  /**
   * Log classification results with statistics
   */
  private logClassification(
    loopIndex: number | undefined,
    debugInfo: DebugLoopInfo,
    isRock: boolean,
    votingStats: { rockVotes: number; caveVotes: number; sampledEdges: number; round: number }
  ): void {
    const insideSamples = debugInfo.samples.filter(s => s.side === "inside");
    const outsideSamples = debugInfo.samples.filter(s => s.side === "outside");

    const insideDensities = insideSamples.map(s => s.density);
    const outsideDensities = outsideSamples.map(s => s.density);

    const avgInsideDensity = insideDensities.length > 0
      ? insideDensities.reduce((a, b) => a + b, 0) / insideDensities.length
      : 0;
    const avgOutsideDensity = outsideDensities.length > 0
      ? outsideDensities.reduce((a, b) => a + b, 0) / outsideDensities.length
      : 0;

    const insideLowCount = insideSamples.filter(s => s.density < 128).length;
    const insideHighCount = insideSamples.filter(s => s.density >= 128).length;
    const outsideLowCount = outsideSamples.filter(s => s.density < 128).length;
    const outsideHighCount = outsideSamples.filter(s => s.density >= 128).length;

    const extendedDebugInfo = {
      ...debugInfo,
      isRock,
      classification: isRock ? "ROCK" : "CAVE",
      voting: votingStats,
      statistics: {
        avgInsideDensity: avgInsideDensity.toFixed(1),
        avgOutsideDensity: avgOutsideDensity.toFixed(1),
        insideLow: insideLowCount,
        insideHigh: insideHighCount,
        outsideLow: outsideLowCount,
        outsideHigh: outsideHighCount,
      },
    };

    const loopLabel = loopIndex !== undefined ? `LOOP #${loopIndex}` : "LOOP";
    // Logging disabled to reduce console noise
  }
}
