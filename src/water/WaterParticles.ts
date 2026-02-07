import type { DensityField } from '../DensityField';
import type { BallRenderData } from '../Renderer';

export interface WaterParticlesParams {
  enabled: boolean;

  particleRadius: number;
  gravityY: number; // m/s^2 (positive is down)
  linearDamping: number; // 1/s (approx)

  separationEnabled: boolean;
  separationIterations: number;
  separationStrength: number; // 0..1

  spawnRate: number; // particles/sec
  spawnDuration: number; // seconds (after respawn)
  maxParticles: number;
  spawnXSpread: number; // metres
  spawnYJitter: number; // metres

  substeps: number;
  collisionIterations: number;
  collisionPushStep: number; // metres
  collisionNormalDamping: number; // 0..1
  collisionTangentDamping: number; // 0..1
}

export interface WaterPerfStats {
  steps: number;
  avgParticles: number;
  msTotal: number;
  msSpawn: number;
  msClear: number;
  msPredictCollide: number;
  msSeparation: number;
  msSeparationGrid: number;
  msSeparationNeighbors: number;
  sepPairChecks: number;
  sepPairCorrections: number;
  msPostCollide: number;
  msVelocity: number;
  msPer1kParticles: number;
}

export const DEFAULT_WATER_PARAMS: WaterParticlesParams = {
  enabled: false,

  particleRadius: 0.12,
  gravityY: 10,
  linearDamping: 0.05,

  separationEnabled: true,
  separationIterations: 3,
  separationStrength: 0.85,

  spawnRate: 30,
  spawnDuration: 4,
  maxParticles: 2000,
  spawnXSpread: 1.5,
  spawnYJitter: 0.5,

  substeps: 2,
  collisionIterations: 5,
  collisionPushStep: 0.05,
  collisionNormalDamping: 0.85,
  collisionTangentDamping: 0.1,
};

function clamp(v: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, v));
}

export class WaterParticles {
  private densityField: DensityField;
  private params: WaterParticlesParams;

  private capacity = 0;
  private count = 0;
  private px = new Float32Array(0);
  private py = new Float32Array(0);
  private vx = new Float32Array(0);
  private vy = new Float32Array(0);
  private prevX = new Float32Array(0);
  private prevY = new Float32Array(0);

  private collidedNx = new Float32Array(0);
  private collidedNy = new Float32Array(0);
  private collided = new Uint8Array(0);

  private gridCellSize = 0;
  private gridCols = 0;
  private gridRows = 0;
  private gridHead = new Int32Array(0);
  private gridNext = new Int32Array(0);
  private cellX = new Int32Array(0);
  private cellY = new Int32Array(0);

  private renderCache: BallRenderData[] = [];
  private packedPositions = new Float32Array(0);

  private spawnCenterX = 0;
  private spawnCenterY = 0;
  private spawnTimeRemaining = 0;
  private spawnAccumulator = 0;

  private tmpDensitySample = { density: 0, gradX: 0, gradY: 0 };

  private perfSteps = 0;
  private perfParticles = 0;
  private perfMsTotal = 0;
  private perfMsSpawn = 0;
  private perfMsClear = 0;
  private perfMsPredictCollide = 0;
  private perfMsSeparation = 0;
  private perfMsSeparationGrid = 0;
  private perfMsSeparationNeighbors = 0;
  private perfSepPairChecks = 0;
  private perfSepPairCorrections = 0;
  private perfMsPostCollide = 0;
  private perfMsVelocity = 0;

  constructor(densityField: DensityField, params?: Partial<WaterParticlesParams>) {
    this.densityField = densityField;
    this.params = { ...DEFAULT_WATER_PARAMS, ...params };
    this.applyParamClamps();
    this.ensureCapacity(this.params.maxParticles);
  }

  /**
   * Get the current number of active particles.
   */
  getCount(): number {
    return this.count;
  }

  /**
   * Get the spatial hash cell size used for particle separation (metres).
   */
  getCellSize(): number {
    const { gridPitch } = this.densityField.config;
    const minDist = Math.max(this.params.particleRadius * 2, gridPitch * 0.5);
    return minDist;
  }

  getParams(): WaterParticlesParams {
    return { ...this.params };
  }

  /**
   * Returns averaged timings since the last call, then resets the accumulators.
   * All timings are milliseconds per fixedUpdate step (averaged over steps).
   */
  getPerfStatsAndReset(): WaterPerfStats | null {
    if (this.perfSteps <= 0) return null;

    const steps = this.perfSteps;
    const avgParticles = this.perfParticles / steps;
    const msTotal = this.perfMsTotal / steps;
    const msSpawn = this.perfMsSpawn / steps;
    const msClear = this.perfMsClear / steps;
    const msPredictCollide = this.perfMsPredictCollide / steps;
    const msSeparation = this.perfMsSeparation / steps;
    const msSeparationGrid = this.perfMsSeparationGrid / steps;
    const msSeparationNeighbors = this.perfMsSeparationNeighbors / steps;
    const sepPairChecks = this.perfSepPairChecks / steps;
    const sepPairCorrections = this.perfSepPairCorrections / steps;
    const msPostCollide = this.perfMsPostCollide / steps;
    const msVelocity = this.perfMsVelocity / steps;

    const denom = avgParticles > 0 ? avgParticles / 1000 : 0;
    const msPer1kParticles = denom > 0 ? msTotal / denom : 0;

    this.perfSteps = 0;
    this.perfParticles = 0;
    this.perfMsTotal = 0;
    this.perfMsSpawn = 0;
    this.perfMsClear = 0;
    this.perfMsPredictCollide = 0;
    this.perfMsSeparation = 0;
    this.perfMsSeparationGrid = 0;
    this.perfMsSeparationNeighbors = 0;
    this.perfSepPairChecks = 0;
    this.perfSepPairCorrections = 0;
    this.perfMsPostCollide = 0;
    this.perfMsVelocity = 0;

    return {
      steps,
      avgParticles,
      msTotal,
      msSpawn,
      msClear,
      msPredictCollide,
      msSeparation,
      msSeparationGrid,
      msSeparationNeighbors,
      sepPairChecks,
      sepPairCorrections,
      msPostCollide,
      msVelocity,
      msPer1kParticles,
    };
  }

  updateParams(partial: Partial<WaterParticlesParams>): void {
    this.params = { ...this.params, ...partial };
    this.applyParamClamps();
    this.ensureCapacity(this.params.maxParticles);
    if (this.count > this.params.maxParticles) {
      this.count = this.params.maxParticles;
    }
  }

  setSpawnCenter(x: number, y: number): void {
    this.spawnCenterX = x;
    this.spawnCenterY = y;
  }

  respawn(): void {
    this.clear();
    this.spawnTimeRemaining = this.params.spawnDuration;
    this.spawnAccumulator = 0;
  }

  clear(): void {
    this.count = 0;
    this.spawnTimeRemaining = 0;
    this.spawnAccumulator = 0;
  }

  fixedUpdate(dtMs: number): void {
    if (!this.params.enabled) return;

    const tStart = performance.now();
    let msSpawn = 0;
    let msClear = 0;
    let msPredictCollide = 0;
    let msSeparation = 0;
    let msSeparationGrid = 0;
    let msSeparationNeighbors = 0;
    let sepPairChecks = 0;
    let sepPairCorrections = 0;
    let msPostCollide = 0;
    let msVelocity = 0;

    const dtSec = dtMs / 1000;

    const tSpawn0 = performance.now();
    if (this.spawnTimeRemaining > 0) {
      this.spawnAccumulator += this.params.spawnRate * dtSec;
      while (this.spawnAccumulator >= 1 && this.count < this.params.maxParticles) {
        this.spawnAccumulator -= 1;
        this.spawnOne();
      }
      this.spawnTimeRemaining = Math.max(0, this.spawnTimeRemaining - dtSec);
    }
    msSpawn = performance.now() - tSpawn0;

    if (this.count === 0) {
      const total = performance.now() - tStart;
      this.perfSteps++;
      this.perfParticles += 0;
      this.perfMsTotal += total;
      this.perfMsSpawn += msSpawn;
      return;
    }

    const substeps = Math.max(1, Math.floor(this.params.substeps));
    const subDt = dtSec / substeps;

    const gravityY = this.params.gravityY;
    const dampingFactor = Math.max(0, 1 - this.params.linearDamping * subDt);

    for (let s = 0; s < substeps; s++) {
      const tClear0 = performance.now();
      for (let i = 0; i < this.count; i++) {
        this.prevX[i] = this.px[i];
        this.prevY[i] = this.py[i];
        this.collided[i] = 0;
        this.collidedNx[i] = 0;
        this.collidedNy[i] = 0;
      }
      msClear += performance.now() - tClear0;

      const tPredict0 = performance.now();
      for (let i = 0; i < this.count; i++) {
        this.vx[i] *= dampingFactor;
        this.vy[i] = this.vy[i] * dampingFactor + gravityY * subDt;

        this.px[i] += this.vx[i] * subDt;
        this.py[i] += this.vy[i] * subDt;

        this.resolveCaveCollisionPositions(i);
      }
      msPredictCollide += performance.now() - tPredict0;

      const tSep0 = performance.now();
      const sepPerf = this.applySeparationConstraints();
      msSeparationGrid += sepPerf.msGrid;
      msSeparationNeighbors += sepPerf.msNeighbors;
      sepPairChecks += sepPerf.pairChecks;
      sepPairCorrections += sepPerf.pairCorrections;
      msSeparation += performance.now() - tSep0;

      // After separation, ensure particles didn't get pushed into solid.
      const tPost0 = performance.now();
      for (let i = 0; i < this.count; i++) {
        this.resolveCaveCollisionPositions(i);
      }
      msPostCollide += performance.now() - tPost0;

      // PBD-style: derive velocity from the final corrected positions.
      const tVel0 = performance.now();
      for (let i = 0; i < this.count; i++) {
        this.vx[i] = (this.px[i] - this.prevX[i]) / subDt;
        this.vy[i] = (this.py[i] - this.prevY[i]) / subDt;
        if (this.collided[i]) {
          this.applyCollisionVelocityDamping(i);
        }
      }
      msVelocity += performance.now() - tVel0;
    }

    const total = performance.now() - tStart;
    this.perfSteps++;
    this.perfParticles += this.count;
    this.perfMsTotal += total;
    this.perfMsSpawn += msSpawn;
    this.perfMsClear += msClear;
    this.perfMsPredictCollide += msPredictCollide;
    this.perfMsSeparation += msSeparation;
    this.perfMsSeparationGrid += msSeparationGrid;
    this.perfMsSeparationNeighbors += msSeparationNeighbors;
    this.perfSepPairChecks += sepPairChecks;
    this.perfSepPairCorrections += sepPairCorrections;
    this.perfMsPostCollide += msPostCollide;
    this.perfMsVelocity += msVelocity;
  }

  getRenderData(): BallRenderData[] {
    const r = this.params.particleRadius;
    const out = this.renderCache;
    out.length = this.count;
    for (let i = 0; i < this.count; i++) {
      out[i] = { position: { x: this.px[i], y: this.py[i] }, circleRadius: r };
    }
    return out;
  }

  private applyParamClamps(): void {
    this.params.particleRadius = clamp(this.params.particleRadius, 0.02, 0.5);
    this.params.gravityY = clamp(this.params.gravityY, -50, 50);
    this.params.linearDamping = clamp(this.params.linearDamping, 0, 10);
    this.params.separationIterations = Math.floor(clamp(this.params.separationIterations, 0, 20));
    this.params.separationStrength = clamp(this.params.separationStrength, 0, 1);
    this.params.spawnRate = clamp(this.params.spawnRate, 0, 100000);
    this.params.spawnDuration = clamp(this.params.spawnDuration, 0, 60);
    this.params.maxParticles = Math.floor(clamp(this.params.maxParticles, 0, 20000));
    this.params.spawnXSpread = clamp(this.params.spawnXSpread, 0, 50);
    this.params.spawnYJitter = clamp(this.params.spawnYJitter, 0, 50);
    this.params.substeps = Math.floor(clamp(this.params.substeps, 1, 8));
    this.params.collisionIterations = Math.floor(clamp(this.params.collisionIterations, 0, 20));
    this.params.collisionPushStep = clamp(this.params.collisionPushStep, 0.001, 1);
    this.params.collisionNormalDamping = clamp(this.params.collisionNormalDamping, 0, 1);
    this.params.collisionTangentDamping = clamp(this.params.collisionTangentDamping, 0, 1);
  }

  private ensureCapacity(minCapacity: number): void {
    if (minCapacity <= this.capacity) return;
    this.capacity = minCapacity;
    const newPx = new Float32Array(this.capacity);
    const newPy = new Float32Array(this.capacity);
    const newVx = new Float32Array(this.capacity);
    const newVy = new Float32Array(this.capacity);
    const newPrevX = new Float32Array(this.capacity);
    const newPrevY = new Float32Array(this.capacity);
    const newCollNx = new Float32Array(this.capacity);
    const newCollNy = new Float32Array(this.capacity);
    const newCollided = new Uint8Array(this.capacity);
    const newGridNext = new Int32Array(this.capacity);
    const newCellX = new Int32Array(this.capacity);
    const newCellY = new Int32Array(this.capacity);
    newPx.set(this.px.subarray(0, this.count));
    newPy.set(this.py.subarray(0, this.count));
    newVx.set(this.vx.subarray(0, this.count));
    newVy.set(this.vy.subarray(0, this.count));
    this.px = newPx;
    this.py = newPy;
    this.vx = newVx;
    this.vy = newVy;
    this.prevX = newPrevX;
    this.prevY = newPrevY;
    this.collidedNx = newCollNx;
    this.collidedNy = newCollNy;
    this.collided = newCollided;
    this.gridNext = newGridNext;
    this.cellX = newCellX;
    this.cellY = newCellY;
    const newPacked = new Float32Array(this.capacity * 2);
    newPacked.set(this.packedPositions.subarray(0, this.count * 2));
    this.packedPositions = newPacked;
  }

  /**
   * Packed XY positions for GPU upload (length >= count*2).
   * This is a copy into an internal buffer (so it stays contiguous).
   */
  getPackedPositions(): { positionsXY: Float32Array; count: number } {
    const out = this.packedPositions;
    const n = this.count;
    for (let i = 0; i < n; i++) {
      const o = i * 2;
      out[o] = this.px[i];
      out[o + 1] = this.py[i];
    }
    return { positionsXY: out, count: n };
  }

  private ensureGrid(cellSize: number): void {
    const { width, height } = this.densityField.config;
    const cols = Math.max(1, Math.ceil(width / cellSize));
    const rows = Math.max(1, Math.ceil(height / cellSize));
    const cellCount = cols * rows;

    if (this.gridCols !== cols || this.gridRows !== rows || this.gridCellSize !== cellSize || this.gridHead.length !== cellCount) {
      this.gridCellSize = cellSize;
      this.gridCols = cols;
      this.gridRows = rows;
      this.gridHead = new Int32Array(cellCount);
    }
  }

  private rebuildGrid(cellSize: number): void {
    this.ensureGrid(cellSize);
    this.gridHead.fill(-1);

    const { width, height } = this.densityField.config;
    for (let i = 0; i < this.count; i++) {
      const x = clamp(this.px[i], 0, width);
      const y = clamp(this.py[i], 0, height);
      const cx = clamp(Math.floor(x / cellSize), 0, this.gridCols - 1);
      const cy = clamp(Math.floor(y / cellSize), 0, this.gridRows - 1);
      this.cellX[i] = cx;
      this.cellY[i] = cy;
      const cell = cx + cy * this.gridCols;
      this.gridNext[i] = this.gridHead[cell];
      this.gridHead[cell] = i;
    }
  }

  private applySeparationConstraints(): {
    msGrid: number;
    msNeighbors: number;
    pairChecks: number;
    pairCorrections: number;
  } {
    if (!this.params.separationEnabled) {
      return { msGrid: 0, msNeighbors: 0, pairChecks: 0, pairCorrections: 0 };
    }
    if (this.params.separationIterations <= 0) {
      return { msGrid: 0, msNeighbors: 0, pairChecks: 0, pairCorrections: 0 };
    }
    if (this.count < 2) {
      return { msGrid: 0, msNeighbors: 0, pairChecks: 0, pairCorrections: 0 };
    }

    const { width, height, gridPitch } = this.densityField.config;
    const minDist = Math.max(this.params.particleRadius * 2, gridPitch * 0.5);
    const minDistSq = minDist * minDist;
    const cellSize = minDist;
    const stiffness = this.params.separationStrength;
    const maxCorr = minDist * 0.5;

    let msGrid = 0;
    let msNeighbors = 0;
    let pairChecks = 0;
    let pairCorrections = 0;

    for (let iter = 0; iter < this.params.separationIterations; iter++) {
      const tGrid0 = performance.now();
      this.rebuildGrid(cellSize);
      msGrid += performance.now() - tGrid0;

      const tNeighbors0 = performance.now();
      for (let i = 0; i < this.count; i++) {
        const cx = this.cellX[i];
        const cy = this.cellY[i];

        // Keep local copies for i to both improve convergence and reduce array traffic.
        let ix = this.px[i];
        let iy = this.py[i];

        const processCell = (nx: number, ny: number, requireHigherIndex: boolean) => {
          if (nx < 0 || nx >= this.gridCols) return;
          if (ny < 0 || ny >= this.gridRows) return;

          let j = this.gridHead[nx + ny * this.gridCols];
          while (j !== -1) {
            if (!requireHigherIndex || j > i) {
              pairChecks++;
              let dx = this.px[j] - ix;
              let dy = this.py[j] - iy;
              const d2 = dx * dx + dy * dy;
              if (d2 < minDistSq) {
                pairCorrections++;
                let d = Math.sqrt(d2);
                if (d < 1e-6) {
                  dx = (Math.random() * 2 - 1) * 1e-3;
                  dy = (Math.random() * 2 - 1) * 1e-3;
                  d = Math.sqrt(dx * dx + dy * dy);
                }
                const invD = 1 / d;
                const nxp = dx * invD;
                const nyp = dy * invD;
                const corr = Math.min(maxCorr, (minDist - d) * 0.5 * stiffness);
                const cxp = nxp * corr;
                const cyp = nyp * corr;

                ix = clamp(ix - cxp, 0, width);
                iy = clamp(iy - cyp, 0, height);
                this.px[j] = clamp(this.px[j] + cxp, 0, width);
                this.py[j] = clamp(this.py[j] + cyp, 0, height);
              }
            }
            j = this.gridNext[j];
          }
        };

        // Only visit the minimal set of neighboring cells that covers each pair exactly once:
        // self, right, down-left, down, down-right.
        processCell(cx, cy, true);
        processCell(cx + 1, cy, false);
        processCell(cx - 1, cy + 1, false);
        processCell(cx, cy + 1, false);
        processCell(cx + 1, cy + 1, false);

        this.px[i] = ix;
        this.py[i] = iy;
      }
      msNeighbors += performance.now() - tNeighbors0;
    }

    return { msGrid, msNeighbors, pairChecks, pairCorrections };
  }

  private spawnOne(): void {
    const { width, height, gridPitch } = this.densityField.config;
    const margin = this.params.particleRadius * 2 + gridPitch;
    const baseX = clamp(this.spawnCenterX, margin, width - margin);
    const baseY = clamp(this.spawnCenterY, margin, height - margin);

    const maxTries = 24;
    for (let t = 0; t < maxTries; t++) {
      const x = clamp(baseX + (Math.random() * 2 - 1) * this.params.spawnXSpread, margin, width - margin);
      const y = clamp(baseY + (Math.random() * 2 - 1) * this.params.spawnYJitter, margin, height - margin);

      if (!this.densityField.isEmptyArea(x, y)) continue;

      const i = this.count++;
      this.px[i] = x;
      this.py[i] = y;
      this.vx[i] = (Math.random() * 2 - 1) * 0.2;
      this.vy[i] = 0;
      return;
    }
  }

  private resolveCaveCollisionPositions(i: number): void {
    const { width, height, gridPitch, isoValue } = this.densityField.config;

    // Keep particles within bounds. Cave borders are forced solid, but clamping prevents drift.
    this.px[i] = clamp(this.px[i], 0, width);
    this.py[i] = clamp(this.py[i], 0, height);

    if (this.params.collisionIterations <= 0) return;

    let x = this.px[i];
    let y = this.py[i];

    const r = this.params.particleRadius;
    const maxMove = Math.max(this.params.collisionPushStep, gridPitch * 0.5);
    const bias = gridPitch * 0.01;

    for (let iter = 0; iter < this.params.collisionIterations; iter++) {
      let maxPen = -Infinity;
      let bestGx = 0;
      let bestGy = 0;

      const consider = (sx: number, sy: number) => {
        this.densityField.getDensityAndGradientAtWorld(sx, sy, this.tmpDensitySample);
        const pen = this.tmpDensitySample.density - isoValue;
        if (pen > maxPen) {
          maxPen = pen;
          bestGx = this.tmpDensitySample.gradX;
          bestGy = this.tmpDensitySample.gradY;
        }
      };

      consider(x, y);
      consider(x + r, y);
      consider(x - r, y);
      consider(x, y + r);
      consider(x, y - r);

      if (maxPen <= 0) break;

      const gradLen = Math.hypot(bestGx, bestGy);
      if (gradLen < 1e-6) {
        x += (Math.random() * 2 - 1) * maxMove;
        y += (Math.random() * 2 - 1) * maxMove;
        continue;
      }

      // Density increases into rock; move towards lower density (negative gradient).
      const nx = -bestGx / gradLen;
      const ny = -bestGy / gradLen;

      // Approximate penetration depth to the iso-surface via linearization: d ≈ (density - iso)/|∇density|.
      const desired = maxPen / gradLen + bias;
      const move = Math.min(maxMove, Math.max(0, desired));
      x += nx * move;
      y += ny * move;

      this.collided[i] = 1;
      this.collidedNx[i] = nx;
      this.collidedNy[i] = ny;
    }

    x = clamp(x, 0, width);
    y = clamp(y, 0, height);
    this.px[i] = x;
    this.py[i] = y;
  }

  private applyCollisionVelocityDamping(i: number): void {
    const nx = this.collidedNx[i];
    const ny = this.collidedNy[i];
    if (nx === 0 && ny === 0) return;

    // Remove inward velocity (into the wall)
    const vn0 = this.vx[i] * nx + this.vy[i] * ny;
    if (vn0 < 0) {
      this.vx[i] -= vn0 * nx;
      this.vy[i] -= vn0 * ny;
    }

    const vn = this.vx[i] * nx + this.vy[i] * ny;
    const vtx = this.vx[i] - vn * nx;
    const vty = this.vy[i] - vn * ny;

    const vnDamped = vn * (1 - this.params.collisionNormalDamping);
    const vtDamp = 1 - this.params.collisionTangentDamping;

    this.vx[i] = vtx * vtDamp + vnDamped * nx;
    this.vy[i] = vty * vtDamp + vnDamped * ny;
  }
}
