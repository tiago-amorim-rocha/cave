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
      // console.error('Error during remesh:', error);
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

    // Use stored classifications from before optimization (more reliable than reclassifying)
    // Based on testing: reverse if cave inside (rock island), keep if rock inside (cave boundary)
    const shouldReverse = loopClassifications.map((isRock, index) => {
      // CORRECT LOGIC (verified working): Reverse if NOT rock (cave inside = rock island)
      return !isRock;
    });

    // Use final loops for both physics and rendering
    const t6 = performance.now();
    this.physics.setCaveContours(optimizationResult.finalLoops, shouldReverse);
    const t7 = performance.now();
    console.log(`[FullHeal] ⏱️ Box2D colliders: ${(t7 - t6).toFixed(2)}ms (created ${optimizationResult.finalLoops.length} bodies)`);

    console.log(`[FullHeal] 🎯 TOTAL (physics only): ${(t7 - t0).toFixed(2)}ms`);

    // Update renderer with final loops
    const t8 = performance.now();
    const finalForRender = optimizationResult.finalLoops.map(loop => loop.map(p => ({ x: p.x, y: p.y })));
    this.renderer.updatePolylines(finalForRender);
    const t9 = performance.now();
    console.log(`[FullHeal] ⏱️ Re-render walls: ${(t9 - t8).toFixed(2)}ms`);

    console.log(`[FullHeal] 🎯 TOTAL (including rendering): ${(t9 - t0).toFixed(2)}ms`);

    this.densityField.clearDirty();

    return optimizationResult.statistics;
  }

  /**
   * Local update - only update affected region
   * Uses the dirty AABB from density field to do a local rebuild
   */
  localUpdate(expandCells: number = 2): RemeshStats | null {
    const startTime = performance.now();

    // Get dirty region from density field
    const dirtyAABB = this.densityField.getDirtyWorldAABB();
    if (!dirtyAABB) {
      return null;
    }

    // Pad the AABB by expandCells to ensure correct marching squares behavior at boundaries
    const h = this.densityField.config.gridPitch;
    const paddedAABB = {
      minX: dirtyAABB.minX - expandCells * h,
      minY: dirtyAABB.minY - expandCells * h,
      maxX: dirtyAABB.maxX + expandCells * h,
      maxY: dirtyAABB.maxY + expandCells * h
    };

    // Step 1: Remove physics bodies in padded region
    const engine = this.physics.getEngine();
    const t0 = performance.now();
    const removedCount = engine.removeTerrainInRegion(paddedAABB);
    const t1 = performance.now();
    console.log(`[LocalUpdate] ⏱️ Remove bodies: ${(t1 - t0).toFixed(2)}ms (removed ${removedCount} bodies)`);

    // Step 2: Run marching squares only in padded region
    const t2 = performance.now();
    const results = this.marchingSquares.generateContours(paddedAABB, expandCells);
    const t3 = performance.now();
    const rawLoopCount = results.filter(r => r && r.loop && r.loop.length > 2).length;
    console.log(`[LocalUpdate] ⏱️ Marching Squares: ${(t3 - t2).toFixed(2)}ms (generated ${rawLoopCount} raw loops)`);

    // Step 3: Clean loops
    const t4 = performance.now();
    const gridPitch = this.densityField.config.gridPitch;
    const cleanedLoops: Point[][] = [];
    let rawVertexCount = 0;
    let cleanedVertexCount = 0;

    for (const result of results) {
      if (result && result.loop && result.loop.length > 2) {
        rawVertexCount += result.loop.length;
        const cleanedLoop = cleanLoop(result.loop, gridPitch);
        if (cleanedLoop.length >= 3) {
          cleanedLoops.push(cleanedLoop);
          cleanedVertexCount += cleanedLoop.length;
        }
      }
    }
    const t5 = performance.now();
    console.log(`[LocalUpdate] ⏱️ Clean loops: ${(t5 - t4).toFixed(2)}ms (${rawVertexCount} → ${cleanedVertexCount} vertices, ${cleanedLoops.length} loops)`);

    // Step 4: Classify loops
    const t6 = performance.now();
    const validLoops: Point[][] = [];
    const loopClassifications: boolean[] = [];

    for (const cleanedLoop of cleanedLoops) {
      const classificationResult = this.isRockLoop(cleanedLoop, validLoops.length);

      // Skip loops marked for deletion
      if (classificationResult.shouldDelete) {
        continue;
      }

      validLoops.push(cleanedLoop);
      loopClassifications.push(classificationResult.isRock);
    }
    const t7 = performance.now();
    console.log(`[LocalUpdate] ⏱️ Classification: ${(t7 - t6).toFixed(2)}ms (${validLoops.length} valid loops after filtering)`);

    // Step 5: Optimize loops
    const optimizationResult = this.optimizationPipeline.optimize(validLoops, this.optimizationOptions);
    const finalVertexCount = optimizationResult.finalLoops.reduce((sum, loop) => sum + loop.length, 0);
    console.log(`[LocalUpdate] ⏱️ Optimization: ${optimizationResult.timing.totalMs.toFixed(2)}ms (${cleanedVertexCount} → ${finalVertexCount} vertices)`);
    console.log(`[LocalUpdate]    ↳ cleanLoop: ${optimizationResult.timing.cleanLoopMs.toFixed(2)}ms`);
    if (optimizationResult.timing.simplificationMs > 0) {
      console.log(`[LocalUpdate]    ↳ Visvalingam-Whyatt (reduce): ${optimizationResult.timing.simplificationMs.toFixed(2)}ms`);
    }
    if (optimizationResult.timing.chaikinMs > 0) {
      console.log(`[LocalUpdate]    ↳ Chaikin smoothing (expand): ${optimizationResult.timing.chaikinMs.toFixed(2)}ms`);
    }
    if (optimizationResult.timing.postSimplificationMs > 0) {
      console.log(`[LocalUpdate]    ↳ Post-simplification (reduce): ${optimizationResult.timing.postSimplificationMs.toFixed(2)}ms`);
    }

    // Step 6: Build shouldReverse array
    const shouldReverse = loopClassifications.map((isRock) => !isRock);

    // Step 7: Add new physics bodies (Box2D collider creation)
    const t8 = performance.now();
    engine.addTerrainLoops(optimizationResult.finalLoops, shouldReverse);
    const t9 = performance.now();
    console.log(`[LocalUpdate] ⏱️ Box2D colliders: ${(t9 - t8).toFixed(2)}ms (created ${optimizationResult.finalLoops.length} bodies)`);

    console.log(`[LocalUpdate] 🎯 TOTAL (physics only): ${(t9 - t0).toFixed(2)}ms`);

    // Step 8: Set debug info for visualization
    this.renderer.setDirtyAABB(paddedAABB);
    this.renderer.setRebuiltChains(optimizationResult.finalLoops);

    // Step 9: For rendering, regenerate full visual mesh (but don't touch physics)
    // This is acceptable because rendering is fast, and it keeps the visual mesh consistent
    const t10 = performance.now();

    // Generate full contours for rendering only
    const fullField = {
      minX: 0,
      minY: 0,
      maxX: this.densityField.config.width,
      maxY: this.densityField.config.height
    };

    const fullResults = this.marchingSquares.generateContours(fullField, 0);

    // Clean and optimize for rendering (reuse gridPitch from above)
    const renderLoops: Point[][] = [];

    for (const result of fullResults) {
      if (result && result.loop && result.loop.length > 2) {
        const cleanedLoop = cleanLoop(result.loop, gridPitch);
        if (cleanedLoop.length >= 3) {
          renderLoops.push(cleanedLoop);
        }
      }
    }

    // Optimize for rendering
    const renderOptimization = this.optimizationPipeline.optimize(renderLoops, this.optimizationOptions);

    // Update renderer with final loops (but don't touch physics!)
    this.renderer.updateOriginalPolylines(renderOptimization.trueOriginalLoops);
    const finalForRender = renderOptimization.finalLoops.map(loop => loop.map(p => ({ x: p.x, y: p.y })));
    this.renderer.updatePolylines(finalForRender);

    const t11 = performance.now();
    console.log(`[LocalUpdate] ⏱️ Re-render walls: ${(t11 - t10).toFixed(2)}ms (full world remesh for visuals)`);

    console.log(`[LocalUpdate] 🎯 TOTAL (including rendering): ${(t11 - t0).toFixed(2)}ms`);

    // Clear dirty region
    this.densityField.clearDirty();

    return renderOptimization.statistics;
  }

  /**
   * Local patch update - only patch affected arcs in loops
   * This is the most efficient update mode, replacing only the changed arcs
   * instead of rebuilding entire loops or regions
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
      dirtyAABB: typeof paddedAABB;
    }> = [];

    const patchedLoops: Point[][] = [];
    const patchedShouldReverse: boolean[] = [];
    let totalPatchedCount = 0;

    for (const bodyInfo of affectedBodies) {
      const originalLoop = bodyInfo.originalLoop;

      // Try to patch this loop
      const t4 = performance.now();
      const patchResult = this.loopPatcher.patchLoop(originalLoop, paddedAABB, newFragments);
      const t5 = performance.now();

      if (patchResult) {
        console.log(`[LocalPatch] ⏱️ Patch loop #${totalPatchedCount}: ${(t5 - t4).toFixed(2)}ms (${patchResult.oldArc.length} → ${patchResult.newArc.length} vertices in arc)`);

        // Optimize the patched loop
        const optimizationResult = this.optimizationPipeline.optimize([patchResult.patchedLoop], this.optimizationOptions);
        const optimizedPatchedLoop = optimizationResult.finalLoops[0];

        // Classify the patched loop
        const classification = this.isRockLoop(optimizedPatchedLoop, totalPatchedCount);
        if (!classification.shouldDelete) {
          patchedLoops.push(optimizedPatchedLoop);
          patchedShouldReverse.push(!classification.isRock);

          // Store debug info
          patchDebugInfo.push({
            originalLoop: patchResult.originalLoop,
            oldArc: patchResult.oldArc,
            newArc: patchResult.newArc,
            patchedLoop: optimizedPatchedLoop,
            dirtyAABB: patchResult.dirtyAABB,
          });

          totalPatchedCount++;
        }
      }
    }

    const t6 = performance.now();
    console.log(`[LocalPatch] ⏱️ Total patching: ${(t6 - t0).toFixed(2)}ms (patched ${totalPatchedCount} loops)`);

    // Step 4: Remove old physics bodies and add new patched ones
    const t7 = performance.now();
    const removedCount = engine.removeTerrainInRegion(paddedAABB);
    const t8 = performance.now();
    console.log(`[LocalPatch] ⏱️ Remove old bodies: ${(t8 - t7).toFixed(2)}ms (removed ${removedCount} bodies)`);

    const t9 = performance.now();
    engine.addTerrainLoops(patchedLoops, patchedShouldReverse);
    const t10 = performance.now();
    console.log(`[LocalPatch] ⏱️ Add patched bodies: ${(t10 - t9).toFixed(2)}ms (created ${patchedLoops.length} bodies)`);

    console.log(`[LocalPatch] 🎯 TOTAL (physics only): ${(t10 - t0).toFixed(2)}ms`);

    // Step 5: Set debug info for visualization
    this.renderer.setLoopPatchDebugInfo(patchDebugInfo);

    // Step 6: For rendering, regenerate full visual mesh (but don't touch physics)
    const t11 = performance.now();

    const fullField = {
      minX: 0,
      minY: 0,
      maxX: this.densityField.config.width,
      maxY: this.densityField.config.height
    };

    const fullResults = this.marchingSquares.generateContours(fullField, 0);

    const renderLoops: Point[][] = [];
    for (const result of fullResults) {
      if (result && result.loop && result.loop.length > 2) {
        const cleanedLoop = cleanLoop(result.loop, gridPitch);
        if (cleanedLoop.length >= 3) {
          renderLoops.push(cleanedLoop);
        }
      }
    }

    const renderOptimization = this.optimizationPipeline.optimize(renderLoops, this.optimizationOptions);
    this.renderer.updateOriginalPolylines(renderOptimization.trueOriginalLoops);
    const finalForRender = renderOptimization.finalLoops.map(loop => loop.map(p => ({ x: p.x, y: p.y })));
    this.renderer.updatePolylines(finalForRender);

    const t12 = performance.now();
    console.log(`[LocalPatch] ⏱️ Re-render walls: ${(t12 - t11).toFixed(2)}ms (full world remesh for visuals)`);

    console.log(`[LocalPatch] 🎯 TOTAL (including rendering): ${(t12 - t0).toFixed(2)}ms`);

    // Clear dirty region
    this.densityField.clearDirty();

    return renderOptimization.statistics;
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
