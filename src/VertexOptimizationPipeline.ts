/**
 * Vertex Optimization Pipeline
 *
 * Handles the multi-stage vertex optimization process:
 * 1. Shape hygiene (dedupe, cull tiny edges, ensure CCW)
 * 2. Optional Visvalingam-Whyatt simplification
 * 3. Optional Chaikin corner-cutting smoothing
 * 4. Optional post-smoothing simplification
 */

import { simplifyPolylines } from './PolylineSimplifier';
import { chaikinSmoothMultiple } from './ChaikinSmoothing';
import { cleanLoop } from './physics/shapeUtils';
import type { Point } from './types';
import type { OptVertex } from './terrain/CanonicalGeometry';

export interface OptimizationOptions {
  gridPitch: number;
  simplificationEpsilon: number; // Pre-Chaikin simplification (0 = disabled)
  chaikinEnabled: boolean;
  chaikinIterations: number;
  simplificationEpsilonPost: number; // Post-Chaikin simplification (0 = disabled)
}

export interface OptimizationResult {
  finalLoops: Point[][];
  trueOriginalLoops: Point[][];
  chaikinOptLoops: OptVertex[][] | null;
  finalOptLoops: OptVertex[][];
  statistics: {
    originalVertexCount: number;
    finalVertexCount: number;
    simplificationReduction: number; // percentage
    postSimplificationReduction: number; // percentage
  };
  timing: {
    cleanLoopMs: number;
    simplificationMs: number;
    chaikinMs: number;
    postSimplificationMs: number;
    totalMs: number;
  };
}

export class VertexOptimizationPipeline {
  /**
   * Run the complete optimization pipeline on a set of polylines
   */
  optimize(rockLoops: Point[][], options: OptimizationOptions): OptimizationResult {
    const t0 = performance.now();

    // Store TRUE ORIGINAL vertices before ANY optimization (for debug visualization)
    const trueOriginalLoops = rockLoops.map(loop => loop.map(v => ({ x: v.x, y: v.y })));
    const trueOriginalCount = trueOriginalLoops.reduce((sum, loop) => sum + loop.length, 0);
    let chaikinOptLoops: OptVertex[][] | null = null;
    let finalOptLoops: OptVertex[][] = [];

    // Apply shape hygiene: dedupe, cull tiny edges, ensure CCW
    const t1 = performance.now();
    const cleanedLoops = rockLoops.map(loop => {
      const asPoints = loop.map(v => ({ x: v.x, y: v.y } as Point));
      return cleanLoop(asPoints, options.gridPitch);
    }).filter(loop => loop.length >= 3);
    const t2 = performance.now();
    const cleanLoopMs = t2 - t1;

    const cleanedVertexCount = cleanedLoops.reduce((sum, loop) => sum + loop.length, 0);
    const cleanReduction = ((trueOriginalCount - cleanedVertexCount) / trueOriginalCount * 100);

    // console.log(`[VertexOpt] Pipeline started:`);
    // console.log(`  1. Original: ${rockLoops.length} contours, ${trueOriginalCount} vertices`);
    // console.log(`  2. After cleanLoop: ${cleanedLoops.length} contours, ${cleanedVertexCount} vertices`);
    // console.log(`     → cleanLoop reduction: ${cleanReduction.toFixed(1)}% (${trueOriginalCount - cleanedVertexCount} vertices removed)`);

    // Apply Visvalingam-Whyatt simplification if epsilon > 0
    let finalLoops = cleanedLoops;
    let simplificationReduction = 0;
    let simplificationMs = 0;
    let workingOptLoops: OptVertex[][] | null = null;

    if (options.simplificationEpsilon > 0) {
      const t3 = performance.now();
      const areaThreshold = options.simplificationEpsilon * options.simplificationEpsilon;
      const simplified = simplifyPolylines(cleanedLoops, areaThreshold, true);
      finalLoops = simplified.map(loop => loop.map(p => ({ x: p.x, y: p.y })));
      const t4 = performance.now();
      simplificationMs = t4 - t3;

      const simplifiedCount = finalLoops.reduce((sum, loop) => sum + loop.length, 0);
      simplificationReduction = ((cleanedVertexCount - simplifiedCount) / cleanedVertexCount * 100);
      const totalReduction = ((trueOriginalCount - simplifiedCount) / trueOriginalCount * 100);

      // console.log(`  3. After Visvalingam-Whyatt (ε=${options.simplificationEpsilon.toFixed(3)}m): ${finalLoops.length} contours, ${simplifiedCount} vertices`);
      // console.log(`     → simplification reduction: ${simplificationReduction.toFixed(1)}% (${cleanedVertexCount - simplifiedCount} vertices removed)`);
      // console.log(`     → TOTAL reduction: ${totalReduction.toFixed(1)}%`);
    }

    // Apply Chaikin smoothing if enabled
    let chaikinMs = 0;
    if (options.chaikinEnabled) {
      const t5 = performance.now();
      const beforeChaikin = finalLoops.reduce((sum, loop) => sum + loop.length, 0);
      chaikinOptLoops = finalLoops.map(loop => chaikinSmoothMultiple(loop, options.chaikinIterations, 0.25, true));
      workingOptLoops = chaikinOptLoops;
      finalLoops = workingOptLoops.map(loop => loop.map(p => ({ x: p.x, y: p.y } as Point)));
      const t6 = performance.now();
      chaikinMs = t6 - t5;

      const afterChaikin = finalLoops.reduce((sum, loop) => sum + loop.length, 0);
      const chaikinIncrease = ((afterChaikin - beforeChaikin) / beforeChaikin * 100);

      // console.log(`  ${options.simplificationEpsilon > 0 ? '4' : '3'}. After Chaikin (${options.chaikinIterations} iteration${options.chaikinIterations > 1 ? 's' : ''}): ${finalLoops.length} contours, ${afterChaikin} vertices`);
      // console.log(`     → vertex increase: +${chaikinIncrease.toFixed(1)}% (+${afterChaikin - beforeChaikin} vertices)`);
    }

    // Apply post-smoothing simplification
    let postSimplificationReduction = 0;
    let postSimplificationMs = 0;

    if (options.simplificationEpsilonPost > 0) {
      const t7 = performance.now();
      const beforePostSimplify = finalLoops.reduce((sum, loop) => sum + loop.length, 0);
      const areaThresholdPost = options.simplificationEpsilonPost * options.simplificationEpsilonPost;

      if (workingOptLoops) {
        const simplifiedOpt = simplifyPolylines(workingOptLoops, areaThresholdPost, true);
        const before = workingOptLoops.reduce((sum, loop) => sum + loop.length, 0);
        const after = simplifiedOpt.reduce((sum, loop) => sum + loop.length, 0);
        console.log('[Visvalingam] Simplification', {
          before,
          after,
          reduction: ((before - after) / before * 100).toFixed(1) + '%',
          ancestryPreserved: simplifiedOpt.every(loop => loop.every(v => v.canonStart !== undefined))
        });
        workingOptLoops = simplifiedOpt;
        finalLoops = workingOptLoops.map(loop => loop.map(p => ({ x: p.x, y: p.y } as Point)));
      } else {
        const simplifiedPost = simplifyPolylines(finalLoops, areaThresholdPost, true);
        finalLoops = simplifiedPost.map(loop => loop.map(p => ({ x: p.x, y: p.y })));
      }
      const t8 = performance.now();
      postSimplificationMs = t8 - t7;

      const afterPostSimplify = finalLoops.reduce((sum, loop) => sum + loop.length, 0);
      postSimplificationReduction = ((beforePostSimplify - afterPostSimplify) / beforePostSimplify * 100);

      const stepNum = (options.simplificationEpsilon > 0 ? (options.chaikinEnabled ? 5 : 4) : (options.chaikinEnabled ? 4 : 3));
      // console.log(`  ${stepNum}. After post-smoothing simplification (ε=${options.simplificationEpsilonPost.toFixed(3)}m): ${finalLoops.length} contours, ${afterPostSimplify} vertices`);
      // console.log(`     → post-smoothing reduction: ${postSimplificationReduction.toFixed(1)}% (${beforePostSimplify - afterPostSimplify} vertices removed)`);
    }

    finalOptLoops = workingOptLoops
      ? workingOptLoops
      : finalLoops.map(loop => loop.map((p, i) => ({ x: p.x, y: p.y, canonStart: i, canonEnd: i })));

    const finalVertexCount = finalLoops.reduce((sum, loop) => sum + loop.length, 0);
    const tEnd = performance.now();
    const totalMs = tEnd - t0;

    return {
      finalLoops,
      trueOriginalLoops,
      chaikinOptLoops,
      finalOptLoops,
      statistics: {
        originalVertexCount: trueOriginalCount,
        finalVertexCount,
        simplificationReduction,
        postSimplificationReduction
      },
      timing: {
        cleanLoopMs,
        simplificationMs,
        chaikinMs,
        postSimplificationMs,
        totalMs
      }
    };
  }
}
