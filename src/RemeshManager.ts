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

    // Get all loops and classify them
    const allLoops = this.loopCache.getAllLoops();
    const allPolylines = allLoops.map(l => l.vertices);

    // Classify loops with indices for debugging
    const rockLoops: Point[][] = [];
    const loopMetadata: Array<{
      index: number;
      centroid: { x: number; y: number };
      isRock: boolean;
      samples?: DebugSamplePoint[];
    }> = [];

    allPolylines.forEach((loop, index) => {
      if (loop.length < 3) return;
      const classificationResult = this.isRockLoop(loop, index);
      const isRock = classificationResult.isRock;
      const centroid = computePolygonCentroid(loop);

      loopMetadata.push({
        index,
        centroid,
        isRock,
        samples: classificationResult.samples
      });

      if (isRock) {
        rockLoops.push(loop);
      }
    });

    // Pass loop metadata to renderer for debug visualization
    this.renderer.setLoopDebugInfo(loopMetadata);

    // console.log(`[FullHeal] Classified ${allPolylines.length} loops: ${rockLoops.length} rock, ${allPolylines.length - rockLoops.length} cave`);

    // Run vertex optimization pipeline
    const optimizationResult = this.optimizationPipeline.optimize(rockLoops, this.optimizationOptions);

    // Store original for debug visualization
    this.renderer.updateOriginalPolylines(optimizationResult.trueOriginalLoops);

    // Use final loops for both physics and rendering
    this.physics.setCaveContours(optimizationResult.finalLoops);

    // Update renderer with final loops
    const finalForRender = optimizationResult.finalLoops.map(loop => loop.map(p => ({ x: p.x, y: p.y })));
    this.renderer.updatePolylines(finalForRender);

    this.densityField.clearDirty();

    const elapsed = performance.now() - startTime;
    // console.log(`[FullHeal] Complete. ${allLoops.length} loops in ${elapsed.toFixed(1)}ms`);

    return optimizationResult.statistics;
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
   * With DEBUG_LOOP_CLASSIFICATION enabled, samples multiple segments
   * on both inside and outside to help diagnose misclassifications
   *
   * @param loop - The polygon loop to classify
   * @param loopIndex - Optional index for debug output correlation
   * @returns Object containing isRock boolean and optional sample points for visualization
   */
  private isRockLoop(loop: Point[], loopIndex?: number): { isRock: boolean; samples?: DebugSamplePoint[] } {
    if (loop.length < 3) return { isRock: false };

    // Compute polygon properties using helper functions
    const area = computePolygonArea(loop);
    const centroid = computePolygonCentroid(loop);

    // Epsilon distances for sampling (in world units / metres)
    // Sample just over half a cell away to check the neighboring cell
    const gridPitch = this.densityField.config.gridPitch;
    const epsilonInside = 0.501 * gridPitch;
    const epsilonOutside = 0.501 * gridPitch;

    const n = loop.length;
    const maxSamples = 8; // Number of segments to sample for debug
    const step = Math.max(1, Math.floor(n / maxSamples));

    const debugInfo: DebugLoopInfo = {
      loopIndex,
      area,
      centroid,
      samples: [],
    };

    // Sample multiple segments around the loop for debugging
    if (DEBUG_LOOP_CLASSIFICATION) {
      for (let i = 0, sampleIndex = 0; i < n && sampleIndex < maxSamples; i += step, sampleIndex++) {
        const p = loop[i];
        const q = loop[(i + 1) % n];

        // Segment midpoint
        const mx = (p.x + q.x) * 0.5;
        const my = (p.y + q.y) * 0.5;

        // Calculate left normal to edge p->q
        let nx = q.y - p.y;
        let ny = -(q.x - p.x);
        const len = Math.hypot(nx, ny) || 1;
        nx /= len;
        ny /= len;

        // Flip normal based on winding so it points inward
        // CW (area < 0): left normal points outward, flip it
        // CCW (area >= 0): left normal points inward, keep it
        if (area < 0) {
          nx = -nx;
          ny = -ny;
        }

        // Adjust epsilon based on normal direction to ensure we cross cell boundary
        // At 45°, we need sqrt(2) times the distance to cross diagonally
        const angleAdjustment = 1.0 / Math.max(Math.abs(nx), Math.abs(ny));
        const adjustedEpsilonInside = epsilonInside * angleAdjustment;
        const adjustedEpsilonOutside = epsilonOutside * angleAdjustment;

        // Sample inside the loop
        const insideX = mx + nx * adjustedEpsilonInside;
        const insideY = my + ny * adjustedEpsilonInside;

        // Sample outside the loop
        const outsideX = mx - nx * adjustedEpsilonOutside;
        const outsideY = my - ny * adjustedEpsilonOutside;

        // Convert to grid coordinates and query density
        const insideGrid = this.densityField.worldToGrid(insideX, insideY);
        const outsideGrid = this.densityField.worldToGrid(outsideX, outsideY);

        const insideDensity = this.densityField.get(insideGrid.gridX, insideGrid.gridY);
        const outsideDensity = this.densityField.get(outsideGrid.gridX, outsideGrid.gridY);

        // Record inside sample
        debugInfo.samples.push({
          x: insideX,
          y: insideY,
          density: insideDensity,
          side: "inside",
          segmentIndex: i,
        });

        // Record outside sample
        debugInfo.samples.push({
          x: outsideX,
          y: outsideY,
          density: outsideDensity,
          side: "outside",
          segmentIndex: i,
        });
      }
    }

    // Existing classification logic - sample first edge
    const p0 = loop[0];
    const p1 = loop[1];

    // Calculate left normal to first edge
    let nx0 = p1.y - p0.y;
    let ny0 = -(p1.x - p0.x);
    const len0 = Math.hypot(nx0, ny0) || 1;
    nx0 /= len0;
    ny0 /= len0;

    // Flip normal based on winding direction so it points inward
    if (area < 0) {
      nx0 = -nx0;
      ny0 = -ny0;
    }

    // Adjust epsilon based on normal direction to ensure we cross cell boundary
    // At 45°, we need sqrt(2) times the distance to cross diagonally
    const angleAdjustment0 = 1.0 / Math.max(Math.abs(nx0), Math.abs(ny0));
    const adjustedEpsilon0 = epsilonInside * angleAdjustment0;

    // Sample point inside the loop at first edge (0.501 * cell size, angle-adjusted)
    const sampleX = p0.x + nx0 * adjustedEpsilon0;
    const sampleY = p0.y + ny0 * adjustedEpsilon0;

    // Check density at sample point
    const { gridX, gridY } = this.densityField.worldToGrid(sampleX, sampleY);
    const sampleDensity = this.densityField.get(gridX, gridY);

    // Rock if density >= isoValue (128)
    const isRock = sampleDensity >= 128;

    // Debug logging - only for problematic loops
    if (DEBUG_LOOP_CLASSIFICATION && debugInfo.samples.length > 0) {
      // Analyze samples to detect suspicious patterns
      const insideSamples = debugInfo.samples.filter(s => s.side === "inside");
      const outsideSamples = debugInfo.samples.filter(s => s.side === "outside");

      const insideDensities = insideSamples.map(s => s.density);
      const outsideDensities = outsideSamples.map(s => s.density);

      const avgInsideDensity = insideDensities.reduce((a, b) => a + b, 0) / insideDensities.length;
      const avgOutsideDensity = outsideDensities.reduce((a, b) => a + b, 0) / outsideDensities.length;

      const insideLowCount = insideSamples.filter(s => s.density < 128).length;
      const insideHighCount = insideSamples.filter(s => s.density >= 128).length;
      const outsideLowCount = outsideSamples.filter(s => s.density < 128).length;
      const outsideHighCount = outsideSamples.filter(s => s.density >= 128).length;

      // Detect problematic patterns
      const problems: string[] = [];

      // Pattern 1: Classified as rock but inside samples are mostly low density
      if (isRock && insideLowCount > insideHighCount) {
        problems.push(`ROCK but ${insideLowCount}/${insideSamples.length} inside samples < 128`);
      }

      // Pattern 2: Classified as cave but inside samples are mostly high density
      if (!isRock && insideHighCount > insideLowCount) {
        problems.push(`CAVE but ${insideHighCount}/${insideSamples.length} inside samples >= 128`);
      }

      // Pattern 3: Outside samples contradict inside samples
      if (isRock && outsideLowCount < outsideHighCount) {
        problems.push(`ROCK but outside samples mostly HIGH (${outsideHighCount}/${outsideSamples.length} >= 128)`);
      }

      if (!isRock && outsideHighCount < outsideLowCount) {
        problems.push(`CAVE but outside samples mostly LOW (${outsideLowCount}/${outsideSamples.length} < 128)`);
      }

      // Pattern 4: Final sample disagrees with average of debug samples
      const avgDifference = Math.abs(sampleDensity - avgInsideDensity);
      if (avgDifference > 30) {
        problems.push(`Final sample (${sampleDensity}) differs significantly from avg inside (${avgInsideDensity.toFixed(1)})`);
      }

      // Log all loops (removed filtering to debug disappearing cave islands)
      const extendedDebugInfo = {
        ...debugInfo,
        finalSample: {
          x: sampleX,
          y: sampleY,
          density: sampleDensity,
        },
        isRock,
        vertexCount: loop.length,
        statistics: {
          avgInsideDensity: avgInsideDensity.toFixed(1),
          avgOutsideDensity: avgOutsideDensity.toFixed(1),
          insideLow: insideLowCount,
          insideHigh: insideHighCount,
          outsideLow: outsideLowCount,
          outsideHigh: outsideHighCount,
        },
        problems: problems.length > 0 ? problems : undefined,
      };

      // Use warn for problematic loops, log for normal ones
      const loopLabel = loopIndex !== undefined ? `LOOP #${loopIndex}` : "LOOP";
      if (problems.length > 0) {
        // eslint-disable-next-line no-console
        console.warn(`⚠️ ${loopLabel} (PROBLEMATIC):`, extendedDebugInfo);
      } else {
        // eslint-disable-next-line no-console
        console.log(`${loopLabel}:`, extendedDebugInfo);
      }
    }

    return {
      isRock,
      samples: DEBUG_LOOP_CLASSIFICATION ? debugInfo.samples : undefined
    };
  }
}
