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
import type { RapierPhysics } from './RapierPhysics';
import type { Renderer } from './Renderer';
import { VertexOptimizationPipeline, type OptimizationOptions } from './VertexOptimizationPipeline';
import type { Point } from './types';

export interface RemeshConfig {
  densityField: DensityField;
  marchingSquares: MarchingSquares;
  loopCache: LoopCache;
  physics: RapierPhysics;
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
  private physics: RapierPhysics;
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

      // Check if we need a full heal (periodic or requested)
      const timeSinceLastHeal = now - this.lastFullHealTime;
      const needsPeriodicHeal = timeSinceLastHeal > 5000; // Every 5 seconds

      if (this.needsFullHeal || needsPeriodicHeal || this.loopCache.count() === 0) {
        // Full world remesh
        const stats = this.fullHeal();
        this.needsFullHeal = false;
        this.lastFullHealTime = now;
        return stats;
      } else {
        // Incremental update (future optimization)
        return this.incrementalUpdate();
      }
    } catch (error) {
      console.error('Error during remesh:', error);
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
    console.log('[FullHeal] Rebuilding all loops...');
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

    // Filter to only rock loops (not cave holes)
    const rockLoops = allPolylines.filter(loop => {
      if (loop.length < 3) return false;
      return this.isRockLoop(loop);
    });

    console.log(`[FullHeal] Classified ${allPolylines.length} loops: ${rockLoops.length} rock, ${allPolylines.length - rockLoops.length} cave`);

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
    console.log(`[FullHeal] Complete. ${allLoops.length} loops in ${elapsed.toFixed(1)}ms`);

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
   */
  private isRockLoop(loop: Point[]): boolean {
    if (loop.length < 3) return false;

    // Calculate signed area to determine winding direction
    let area = 0;
    for (let i = 0; i < loop.length; i++) {
      const p = loop[i];
      const q = loop[(i + 1) % loop.length];
      area += (p.x * q.y - q.x * p.y);
    }

    // Sample a point slightly inside the loop
    const p0 = loop[0];
    const p1 = loop[1];

    // Calculate left normal to first edge
    let nx = p1.y - p0.y;
    let ny = -(p1.x - p0.x);
    const len = Math.hypot(nx, ny) || 1;
    nx /= len;
    ny /= len;

    // Flip normal based on winding direction so it points inward
    if (area >= 0) {
      nx = -nx;
      ny = -ny;
    }

    // Sample point 5cm inside the loop
    const sampleX = p0.x + nx * 0.05;
    const sampleY = p0.y + ny * 0.05;

    // Check density at sample point
    const { gridX, gridY } = this.densityField.worldToGrid(sampleX, sampleY);
    const density = this.densityField.get(gridX, gridY);

    // Rock if density >= isoValue (128)
    return density >= 128;
  }
}
