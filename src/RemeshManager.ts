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
    // console.log('[FullHeal] Rebuilding all loops...');
    const startTime = performance.now();

    // Clear cache
    this.loopCache.clear();

    // Generate all contours for entire field
    const fullField = {
      minX: 0,
      minY: 0,
      maxX: this.densityField.config.width,
      maxY: this.densityField.config.height
    };

    const results = this.marchingSquares.generateContours(fullField, 0);

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
    const gridPitch = this.densityField.config.gridPitch;
    const cleanedLoops = allPolylines.map(loop => cleanLoop(loop, gridPitch));

    // Classify loops with indices for debugging (but keep ALL loops for rendering)
    const loopMetadata: Array<{
      index: number;
      centroid: { x: number; y: number };
      isRock: boolean;
      samples?: DebugSamplePoint[];
    }> = [];

    const validLoops: Point[][] = [];
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
    });

    // Pass loop metadata to renderer for debug visualization
    this.renderer.setLoopDebugInfo(loopMetadata);

    // Run vertex optimization pipeline
    const optimizationResult = this.optimizationPipeline.optimize(validLoops, this.optimizationOptions);

    // Store original for debug visualization
    this.renderer.updateOriginalPolylines(optimizationResult.trueOriginalLoops);

    // Reclassify optimized loops for physics winding order
    // Rock boundaries (rock inside) should be reversed, rock islands (cave inside) should not
    const shouldReverse = optimizationResult.finalLoops.map((loop, index) => {
      const classification = this.isRockLoop(loop, index);
      // Reverse if it's a rock loop (rock inside, cave outside) - these are cave boundaries
      // Don't reverse if it's a cave loop (cave inside, rock outside) - these are rock islands
      return classification.isRock && !classification.shouldDelete;
    });

    // Use final loops for both physics and rendering
    this.physics.setCaveContours(optimizationResult.finalLoops, shouldReverse);

    // Update renderer with final loops
    const finalForRender = optimizationResult.finalLoops.map(loop => loop.map(p => ({ x: p.x, y: p.y })));
    this.renderer.updatePolylines(finalForRender);

    this.densityField.clearDirty();

    const elapsed = performance.now() - startTime;
    // console.log(`[FullHeal] Complete. ${allLoops.length} loops in ${elapsed.toFixed(1)}ms`);

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
    engine.removeTerrainInRegion(paddedAABB);

    // Step 2: Run marching squares only in padded region
    const results = this.marchingSquares.generateContours(paddedAABB, expandCells);

    // Step 3: Process local contours (clean, classify, optimize)
    const gridPitch = this.densityField.config.gridPitch;
    const validLoops: Point[][] = [];

    for (const result of results) {
      if (result && result.loop && result.loop.length > 2) {
        const cleanedLoop = cleanLoop(result.loop, gridPitch);
        if (cleanedLoop.length >= 3) {
          validLoops.push(cleanedLoop);
        }
      }
    }

    // Step 4: Optimize local loops
    const optimizationResult = this.optimizationPipeline.optimize(validLoops, this.optimizationOptions);

    // Step 5: Add new physics bodies for local region
    engine.addTerrainLoops(optimizationResult.finalLoops);

    // Step 6: For rendering, regenerate full visual mesh (but don't touch physics)
    // This is acceptable because rendering is fast, and it keeps the visual mesh consistent

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
    console.log(`${loopLabel}:`, extendedDebugInfo);
  }
}
