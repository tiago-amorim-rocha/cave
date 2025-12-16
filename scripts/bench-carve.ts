import { performance } from 'node:perf_hooks';
import { DensityField } from '../src/DensityField';
import { MarchingSquares } from '../src/MarchingSquares';
import { BrushGenerator } from '../src/BrushGenerator';
import { cleanLoop } from '../src/physics/shapeUtils';
import { DEFAULT_CONFIG } from '../src/PipelineConfig';

function fmt(ms: number): string {
  return `${ms.toFixed(2)}ms`;
}

function main(): void {
  const config = DEFAULT_CONFIG;
  const world = config.getWorldConfig();

  const densityField = new DensityField(world);
  densityField.generateCaves(undefined, config.perlinScale, config.perlinOctaves, config.perlinThreshold);

  const marchingSquares = new MarchingSquares(densityField, world.isoValue, config);
  const brush = BrushGenerator.createGaussianBrush(
    config.carveRadius,
    world.gridPitch,
    config.carveBrushSigma,
    config.carveStrength
  );

  const x = world.width / 2;
  const y = world.height / 2;
  densityField.stampBrush(x, y, brush, false);

  const dirtyAabb = densityField.getDirtyWorldAABB();
  if (!dirtyAabb) {
    throw new Error('Expected dirty AABB after stamp');
  }

  const expandCells = config.carveDebugExpandCells;
  const region = {
    minX: dirtyAabb.minX - expandCells * world.gridPitch,
    minY: dirtyAabb.minY - expandCells * world.gridPitch,
    maxX: dirtyAabb.maxX + expandCells * world.gridPitch,
    maxY: dirtyAabb.maxY + expandCells * world.gridPitch
  };

  const iters = 50;
  let totalMs = 0;
  let totalLoops = 0;
  let totalVertices = 0;

  for (let i = 0; i < iters; i++) {
    const t0 = performance.now();
    const results = marchingSquares.generateContours(region, expandCells);
    const cleanedLoops = results
      .filter((r) => r?.loop && r.loop.length > 2)
      .map((r) => cleanLoop(r.loop, world.gridPitch))
      .filter((loop) => loop.length >= 3);
    const t1 = performance.now();

    totalMs += t1 - t0;
    totalLoops += cleanedLoops.length;
    totalVertices += cleanedLoops.reduce((sum, loop) => sum + loop.length, 0);
  }

  const avgMs = totalMs / iters;
  const avgLoops = totalLoops / iters;
  const avgVerts = totalVertices / iters;

  console.log('[bench:carve]');
  console.log(`- world: ${world.width}x${world.height}, gridPitch=${world.gridPitch}`);
  console.log(`- region: expandCells=${expandCells}`);
  console.log(`- marchingSquares+cleanLoop: avg ${fmt(avgMs)} over ${iters} iters`);
  console.log(`- avg loops: ${avgLoops.toFixed(2)}, avg verts: ${avgVerts.toFixed(2)}`);
}

main();

