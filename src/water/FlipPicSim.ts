import type { WaterGrid } from './WaterGrid';
import type { VelocityField } from './VelocityField';

export interface FlipPicParticle {
  x: number;
  y: number;
  vx: number;
  vy: number;
}

export interface FlipPicSimConfig {
  flipRatio: number; // 0 = PIC, 1 = FLIP
  particlesPerCellSide: number; // e.g. 2 => 4 per cell, 4 => 16 per cell
  maxParticles: number;
  projectionIterations: number;
}

const enum CellType {
  SOLID = 0,
  AIR = 1,
  FLUID = 2,
}

export class FlipPicSim implements VelocityField {
  private readonly grid: WaterGrid;
  private readonly h: number;
  private readonly W: number;
  private readonly H: number;

  private readonly config: FlipPicSimConfig;

  private particles: FlipPicParticle[] = [];

  // MAC velocities
  private u: Float32Array; // (W+1) x H
  private v: Float32Array; // W x (H+1)
  private uPrev: Float32Array;
  private vPrev: Float32Array;
  private uW: Float32Array;
  private vW: Float32Array;

  // Pressure solve on cells
  private cellType: Uint8Array; // W x H
  private divergence: Float32Array;
  private pressure: Float32Array;
  private pressureNext: Float32Array;

  private gravity = 30;
  private maxFaceSpeed = 60;
  private substeps = 1;
  private particleDampingPerSecond = 0.9;

  // Particle separation (position-based push-apart).
  private pushApartSteps = 2;
  private minDistanceFactor = 0.9; // multiples of particle spacing (h / particlesPerCellSide)
  private particleCellHead: Int32Array; // W x H, head index for linked list
  private particleCellNext: Int32Array; // maxParticles, next index per particle

  constructor(grid: WaterGrid, config: Partial<FlipPicSimConfig> = {}) {
    this.grid = grid;
    this.h = grid.cellSizeM;
    this.W = grid.widthCells;
    this.H = grid.heightCells;

    this.config = {
      flipRatio: config.flipRatio ?? 0.95,
      particlesPerCellSide: config.particlesPerCellSide ?? 4,
      maxParticles: config.maxParticles ?? 60_000,
      projectionIterations: config.projectionIterations ?? 30,
    };

    this.u = new Float32Array((this.W + 1) * this.H);
    this.v = new Float32Array(this.W * (this.H + 1));
    this.uPrev = new Float32Array(this.u.length);
    this.vPrev = new Float32Array(this.v.length);
    this.uW = new Float32Array(this.u.length);
    this.vW = new Float32Array(this.v.length);

    this.cellType = new Uint8Array(this.W * this.H);
    this.divergence = new Float32Array(this.W * this.H);
    this.pressure = new Float32Array(this.W * this.H);
    this.pressureNext = new Float32Array(this.W * this.H);

    this.particleCellHead = new Int32Array(this.W * this.H);
    this.particleCellNext = new Int32Array(this.config.maxParticles);
  }

  getParticles(): ReadonlyArray<FlipPicParticle> {
    return this.particles;
  }

  setFlipRatio(value: number): void {
    this.config.flipRatio = Math.max(0, Math.min(1, value));
  }

  setGravity(value: number): void {
    this.gravity = Math.max(0, value);
  }

  setSubsteps(value: number): void {
    const v = Math.floor(value);
    this.substeps = Math.max(1, Math.min(8, v));
  }

  setProjectionIterations(value: number): void {
    const v = Math.floor(value);
    this.config.projectionIterations = Math.max(1, Math.min(200, v));
  }

  setMaxFaceSpeed(value: number): void {
    this.maxFaceSpeed = Math.max(0, value);
  }

  setParticleDampingPerSecond(value: number): void {
    this.particleDampingPerSecond = Math.max(0, value);
  }

  setPushApartSteps(value: number): void {
    const v = Math.floor(value);
    this.pushApartSteps = Math.max(0, Math.min(32, v));
  }

  setMinDistanceFactor(value: number): void {
    this.minDistanceFactor = Math.max(0, value);
  }

  setMaxParticles(maxParticles: number): void {
    const target = Math.max(1, Math.floor(maxParticles));
    this.config.maxParticles = target;
    if (this.particleCellNext.length < target) {
      this.particleCellNext = new Int32Array(target);
    }
    if (this.particles.length > target) {
      this.particles.length = target;
    }
  }

  reset(): void {
    this.particles = [];
    this.u.fill(0);
    this.v.fill(0);
    this.uPrev.fill(0);
    this.vPrev.fill(0);
    this.uW.fill(0);
    this.vW.fill(0);
    this.cellType.fill(CellType.AIR);
    this.divergence.fill(0);
    this.pressure.fill(0);
    this.pressureNext.fill(0);
  }

  seedFromWaterGrid(water: Readonly<Float32Array>, fillThreshold: number = 0.05): void {
    const pps = Math.max(1, Math.floor(this.config.particlesPerCellSide));
    const invPps = 1 / pps;
    const maxPerCell = pps * pps;
    const jitter = 0.15 * this.h;

    for (let cy = 0; cy < this.H; cy++) {
      for (let cx = 0; cx < this.W; cx++) {
        const i = cy * this.W + cx;
        if (this.grid.solid[i]) continue;
        const w = water[i];
        if (w <= fillThreshold) continue;

        const count = Math.max(1, Math.min(maxPerCell, Math.floor(w * maxPerCell)));
        for (let n = 0; n < count; n++) {
          if (this.particles.length >= this.config.maxParticles) return;

          const ox = (n % pps + 0.5) * invPps;
          const oy = (Math.floor(n / pps) + 0.5) * invPps;
          const x = (cx + ox) * this.h + (Math.random() - 0.5) * jitter;
          const y = (cy + oy) * this.h + (Math.random() - 0.5) * jitter;
          this.particles.push({ x, y, vx: 0, vy: 0 });
        }
      }
    }
  }

  step(dtMs: number): void {
    const dt = Math.max(0, dtMs) / 1000;
    if (dt <= 0) return;

    // Keep particles fed from the existing timed source (for now).
    const src = this.grid.getSourceInfo();
    if (src?.enabled) {
      const drops = this.grid.consumeSourceDrops(24);
      if (drops > 0) {
        this.spawnSourceParticles(src.minX, src.maxX, src.y, drops * 10);
      }
    }

    const steps = Math.max(1, Math.floor(this.substeps));
    const dtSub = dt / steps;
    for (let i = 0; i < steps; i++) {
      this.stepSub(dtSub);
    }
  }

  private stepSub(dt: number): void {
    // Store previous grid velocities for FLIP delta
    this.uPrev.set(this.u);
    this.vPrev.set(this.v);

    // Particle -> grid (PIC transfer)
    this.u.fill(0);
    this.v.fill(0);
    this.uW.fill(0);
    this.vW.fill(0);

    this.buildCellTypes();
    this.scatterParticlesToGrid();
    this.normalizeGridVelocities();
    this.applySolidFaceBounds();

    // External forces
    this.applyGravity(dt);

    // Project only in FLUID cells (free surface: pressure=0 in AIR)
    this.project(dt);
    this.clampFaceSpeeds();

    // Grid -> particle (PIC/FLIP blend) and advect
    this.updateParticlesFromGrid(dt);
    this.advectParticles(dt);
    this.pushApartAndResolveSolids();
  }

  // VelocityField
  getCellVelocity(x: number, y: number): { u: number; v: number } {
    const u0 = this.uAt(x, y);
    const u1 = this.uAt(x + 1, y);
    const v0 = this.vAt(x, y);
    const v1 = this.vAt(x, y + 1);
    return { u: 0.5 * (u0 + u1), v: 0.5 * (v0 + v1) };
  }

  writeDensityToWaterGrid(out: WaterGrid): void {
    const massPerParticle = 1 / (this.config.particlesPerCellSide * this.config.particlesPerCellSide);
    out.setFromParticles(this.particles, massPerParticle);
  }

  private spawnSourceParticles(minX: number, maxX: number, yCell: number, perStep: number): void {
    if (this.particles.length >= this.config.maxParticles) return;
    const x0 = Math.max(0, Math.min(this.W - 1, minX));
    const x1 = Math.max(0, Math.min(this.W - 1, maxX));
    const y = Math.max(0, Math.min(this.H - 1, yCell));

    for (let i = 0; i < perStep; i++) {
      if (this.particles.length >= this.config.maxParticles) return;
      const cx = x0 + Math.floor(Math.random() * (x1 - x0 + 1));
      const x = (cx + 0.5 + (Math.random() - 0.5) * 0.6) * this.h;
      const yy = (y + 0.5 + (Math.random() - 0.5) * 0.6) * this.h;
      this.particles.push({ x, y: yy, vx: 0, vy: 4 });
    }
  }

  private buildCellTypes(): void {
    // Base: SOLID from terrain mask, else AIR.
    for (let i = 0; i < this.cellType.length; i++) {
      this.cellType[i] = this.grid.solid[i] ? CellType.SOLID : CellType.AIR;
    }

    // Mark FLUID cells containing particles (and a small dilation for stability).
    for (const p of this.particles) {
      const cx = Math.floor(p.x / this.h);
      const cy = Math.floor(p.y / this.h);
      if (cx < 0 || cx >= this.W || cy < 0 || cy >= this.H) continue;

      const i = cy * this.W + cx;
      if (this.cellType[i] === CellType.SOLID) continue;
      this.cellType[i] = CellType.FLUID;

      // Light dilation (4-neighborhood) to reduce checkerboarding at the surface.
      if (cx > 0) this.markFluid(cx - 1, cy);
      if (cx + 1 < this.W) this.markFluid(cx + 1, cy);
      if (cy > 0) this.markFluid(cx, cy - 1);
      if (cy + 1 < this.H) this.markFluid(cx, cy + 1);
    }
  }

  private markFluid(cx: number, cy: number): void {
    const i = cy * this.W + cx;
    if (this.cellType[i] !== CellType.SOLID) this.cellType[i] = CellType.FLUID;
  }

  private scatterParticlesToGrid(): void {
    for (const p of this.particles) {
      this.scatterToU(p.x, p.y, p.vx);
      this.scatterToV(p.x, p.y, p.vy);
    }
  }

  private normalizeGridVelocities(): void {
    for (let i = 0; i < this.u.length; i++) {
      const w = this.uW[i];
      if (w > 0) this.u[i] /= w;
    }
    for (let i = 0; i < this.v.length; i++) {
      const w = this.vW[i];
      if (w > 0) this.v[i] /= w;
    }
  }

  private applyGravity(dt: number): void {
    // Apply to v faces adjacent to FLUID cells.
    for (let y = 1; y < this.H; y++) {
      for (let x = 0; x < this.W; x++) {
        const top = this.cellIdx(x, y - 1);
        const bottom = this.cellIdx(x, y);

        const topFluid = this.cellType[top] === CellType.FLUID;
        const botFluid = this.cellType[bottom] === CellType.FLUID;
        if (!topFluid && !botFluid) continue;
        if (this.cellType[top] === CellType.SOLID || this.cellType[bottom] === CellType.SOLID) continue;

        this.v[this.vIdx(x, y)] += this.gravity * dt;
      }
    }
  }

  private project(dt: number): void {
    this.computeDivergence();
    this.solvePressure(dt);
    this.subtractPressureGradient(dt);
    this.applySolidFaceBounds();
  }

  private computeDivergence(): void {
    const invH = 1 / this.h;
    for (let y = 0; y < this.H; y++) {
      for (let x = 0; x < this.W; x++) {
        const c = this.cellIdx(x, y);
        if (this.cellType[c] !== CellType.FLUID) {
          this.divergence[c] = 0;
          continue;
        }

        const du = this.uAt(x + 1, y) - this.uAt(x, y);
        const dv = this.vAt(x, y + 1) - this.vAt(x, y);
        this.divergence[c] = (du + dv) * invH;
      }
    }
  }

  private solvePressure(dt: number): void {
    this.pressure.fill(0);
    this.pressureNext.fill(0);

    const h2OverDt = (this.h * this.h) / dt;

    for (let iter = 0; iter < this.config.projectionIterations; iter++) {
      for (let y = 0; y < this.H; y++) {
        for (let x = 0; x < this.W; x++) {
          const c = this.cellIdx(x, y);
          if (this.cellType[c] !== CellType.FLUID) {
            this.pressureNext[c] = 0;
            continue;
          }

          let sum = 0;
          let count = 0;

          // Neighbors: SOLID excluded, AIR contributes p=0 but still counts (free surface).
          if (x > 0) {
            const n = this.cellIdx(x - 1, y);
            if (this.cellType[n] !== CellType.SOLID) {
              sum += this.pressure[n];
              count++;
            }
          }
          if (x + 1 < this.W) {
            const n = this.cellIdx(x + 1, y);
            if (this.cellType[n] !== CellType.SOLID) {
              sum += this.pressure[n];
              count++;
            }
          }
          if (y > 0) {
            const n = this.cellIdx(x, y - 1);
            if (this.cellType[n] !== CellType.SOLID) {
              sum += this.pressure[n];
              count++;
            }
          }
          if (y + 1 < this.H) {
            const n = this.cellIdx(x, y + 1);
            if (this.cellType[n] !== CellType.SOLID) {
              sum += this.pressure[n];
              count++;
            }
          }

          if (count === 0) {
            this.pressureNext[c] = 0;
            continue;
          }

          const rhs = this.divergence[c] * h2OverDt;
          this.pressureNext[c] = (sum - rhs) / count;
        }
      }

      const tmp = this.pressure;
      this.pressure = this.pressureNext;
      this.pressureNext = tmp;
    }
  }

  private subtractPressureGradient(dt: number): void {
    const scale = dt / this.h;

    // u faces
    for (let y = 0; y < this.H; y++) {
      this.u[this.uIdx(0, y)] = 0;
      this.u[this.uIdx(this.W, y)] = 0;
      for (let x = 1; x < this.W; x++) {
        const left = this.cellIdx(x - 1, y);
        const right = this.cellIdx(x, y);

        if (this.cellType[left] === CellType.SOLID || this.cellType[right] === CellType.SOLID) {
          this.u[this.uIdx(x, y)] = 0;
          continue;
        }

        const pL = this.cellType[left] === CellType.AIR ? 0 : this.pressure[left];
        const pR = this.cellType[right] === CellType.AIR ? 0 : this.pressure[right];
        this.u[this.uIdx(x, y)] -= scale * (pR - pL);
      }
    }

    // v faces
    for (let x = 0; x < this.W; x++) {
      this.v[this.vIdx(x, 0)] = 0;
      this.v[this.vIdx(x, this.H)] = 0;
      for (let y = 1; y < this.H; y++) {
        const bottom = this.cellIdx(x, y - 1);
        const top = this.cellIdx(x, y);

        if (this.cellType[bottom] === CellType.SOLID || this.cellType[top] === CellType.SOLID) {
          this.v[this.vIdx(x, y)] = 0;
          continue;
        }

        const pB = this.cellType[bottom] === CellType.AIR ? 0 : this.pressure[bottom];
        const pT = this.cellType[top] === CellType.AIR ? 0 : this.pressure[top];
        this.v[this.vIdx(x, y)] -= scale * (pT - pB);
      }
    }
  }

  private clampFaceSpeeds(): void {
    const m = this.maxFaceSpeed;
    for (let i = 0; i < this.u.length; i++) {
      const v = this.u[i];
      this.u[i] = v < -m ? -m : (v > m ? m : v);
    }
    for (let i = 0; i < this.v.length; i++) {
      const v = this.v[i];
      this.v[i] = v < -m ? -m : (v > m ? m : v);
    }
  }

  private updateParticlesFromGrid(dt: number): void {
    const flip = Math.max(0, Math.min(1, this.config.flipRatio));
    const damp = Math.max(0, 1 - this.particleDampingPerSecond * dt);

    for (const p of this.particles) {
      const pic = this.sampleGridVelocity(p.x, p.y);

      const du = this.sampleGridVelocityDeltaU(p.x, p.y);
      const dv = this.sampleGridVelocityDeltaV(p.x, p.y);
      const flipVel = { u: p.vx + du, v: p.vy + dv };

      p.vx = pic.u * (1 - flip) + flipVel.u * flip;
      p.vy = pic.v * (1 - flip) + flipVel.v * flip;
      p.vx *= damp;
      p.vy *= damp;
    }
  }

  private advectParticles(dt: number): void {
    const maxX = this.W * this.h;
    const maxY = this.H * this.h;

    for (const p of this.particles) {
      const px0 = p.x;
      const py0 = p.y;

      p.x += p.vx * dt;
      p.y += p.vy * dt;

      // World bounds
      if (p.x < 0) {
        p.x = 0;
        p.vx = 0;
      } else if (p.x > maxX) {
        p.x = maxX;
        p.vx = 0;
      }
      if (p.y < 0) {
        p.y = 0;
        p.vy = 0;
      } else if (p.y > maxY) {
        p.y = maxY;
        p.vy = 0;
      }

      // Solid collision (cell-based, minimal)
      let cx = Math.floor(p.x / this.h);
      let cy = Math.floor(p.y / this.h);
      if (cx < 0) cx = 0;
      if (cx >= this.W) cx = this.W - 1;
      if (cy < 0) cy = 0;
      if (cy >= this.H) cy = this.H - 1;

      const i = cy * this.W + cx;
      if (this.grid.solid[i]) {
        // Push out of the solid cell along the shortest axis and allow sliding.
        const fx = p.x / this.h - cx;
        const fy = p.y / this.h - cy;

        const left = fx;
        const right = 1 - fx;
        const up = fy;
        const down = 1 - fy;

        const eps = 1e-3;
        let best = left;
        let dir: 'L' | 'R' | 'U' | 'D' = 'L';
        if (right < best) { best = right; dir = 'R'; }
        if (up < best) { best = up; dir = 'U'; }
        if (down < best) { best = down; dir = 'D'; }

        if (dir === 'L') {
          p.x = cx * this.h - eps;
          if (p.vx > 0) p.vx = 0;
        } else if (dir === 'R') {
          p.x = (cx + 1) * this.h + eps;
          if (p.vx < 0) p.vx = 0;
        } else if (dir === 'U') {
          p.y = cy * this.h - eps;
          if (p.vy > 0) p.vy = 0;
        } else {
          p.y = (cy + 1) * this.h + eps;
          if (p.vy < 0) p.vy = 0;
        }

        // If we're still inside due to numeric issues, revert.
        let ccx = Math.floor(p.x / this.h);
        let ccy = Math.floor(p.y / this.h);
        ccx = Math.max(0, Math.min(this.W - 1, ccx));
        ccy = Math.max(0, Math.min(this.H - 1, ccy));
        if (this.grid.solid[ccy * this.W + ccx]) {
          p.x = px0;
          p.y = py0;
          p.vx = 0;
          if (p.vy > 0) p.vy = 0;
        }
      }
    }
  }

  private pushApartAndResolveSolids(): void {
    let iterations = Math.max(0, Math.floor(this.pushApartSteps));
    if (iterations === 0) return;
    if (this.particles.length < 2) return;

    const particleCount = this.particles.length;
    // Adaptive cap: separation is the most expensive step; keep the UI responsive under load.
    if (particleCount > 45_000) iterations = Math.min(iterations, 1);
    if (particleCount > 60_000) iterations = 0;
    if (iterations === 0) return;

    const pps = Math.max(1, Math.floor(this.config.particlesPerCellSide));
    const baseSpacing = this.h / pps;
    const minDist = Math.max(0, this.minDistanceFactor) * baseSpacing;
    if (minDist <= 0) return;

    const minDistSq = minDist * minDist;
    const range = Math.max(1, Math.ceil(minDist / this.h));
    const eps = 1e-12;

    for (let iter = 0; iter < iterations; iter++) {
      this.buildParticleCellLists();

      const particles = this.particles;
      const next = this.particleCellNext;
      const head = this.particleCellHead;
      const maxX = this.W * this.h;
      const maxY = this.H * this.h;

      for (let i = 0; i < particles.length; i++) {
        const pi = particles[i];
        const cx = Math.max(0, Math.min(this.W - 1, Math.floor(pi.x / this.h)));
        const cy = Math.max(0, Math.min(this.H - 1, Math.floor(pi.y / this.h)));

        for (let dy = -range; dy <= range; dy++) {
          const ny = cy + dy;
          if (ny < 0 || ny >= this.H) continue;
          for (let dx = -range; dx <= range; dx++) {
            const nx = cx + dx;
            if (nx < 0 || nx >= this.W) continue;
            let j = head[ny * this.W + nx];
            while (j !== -1) {
              if (j > i) {
                const pj = particles[j];
                const dxp = pi.x - pj.x;
                const dyp = pi.y - pj.y;
                const distSq = dxp * dxp + dyp * dyp;
                if (distSq < minDistSq && distSq > eps) {
                  const dist = Math.sqrt(distSq);
                  const push = 0.5 * (minDist - dist) / dist;
                  const px = dxp * push;
                  const py = dyp * push;

                  pi.x += px;
                  pi.y += py;
                  pj.x -= px;
                  pj.y -= py;

                  // Keep within world bounds during relaxation (cheap clamp).
                  if (pi.x < 0) pi.x = 0;
                  else if (pi.x > maxX) pi.x = maxX;
                  if (pi.y < 0) pi.y = 0;
                  else if (pi.y > maxY) pi.y = maxY;

                  if (pj.x < 0) pj.x = 0;
                  else if (pj.x > maxX) pj.x = maxX;
                  if (pj.y < 0) pj.y = 0;
                  else if (pj.y > maxY) pj.y = maxY;
                }
              }
              j = next[j];
            }
          }
        }
      }

      // After each relaxation pass, push particles out of solids.
      this.enforceParticleWorldAndSolids();
    }
  }

  private buildParticleCellLists(): void {
    this.particleCellHead.fill(-1);

    const n = this.particles.length;
    if (n > this.particleCellNext.length) {
      const newCap = Math.max(n, this.config.maxParticles);
      this.particleCellNext = new Int32Array(newCap);
    }

    for (let i = 0; i < n; i++) {
      const p = this.particles[i];
      let cx = Math.floor(p.x / this.h);
      let cy = Math.floor(p.y / this.h);
      if (cx < 0) cx = 0;
      else if (cx >= this.W) cx = this.W - 1;
      if (cy < 0) cy = 0;
      else if (cy >= this.H) cy = this.H - 1;

      const cell = cy * this.W + cx;
      this.particleCellNext[i] = this.particleCellHead[cell];
      this.particleCellHead[cell] = i;
    }
  }

  private enforceParticleWorldAndSolids(): void {
    const maxX = this.W * this.h;
    const maxY = this.H * this.h;

    for (const p of this.particles) {
      if (p.x < 0) {
        p.x = 0;
        if (p.vx < 0) p.vx = 0;
      } else if (p.x > maxX) {
        p.x = maxX;
        if (p.vx > 0) p.vx = 0;
      }
      if (p.y < 0) {
        p.y = 0;
        if (p.vy < 0) p.vy = 0;
      } else if (p.y > maxY) {
        p.y = maxY;
        if (p.vy > 0) p.vy = 0;
      }

      let cx = Math.floor(p.x / this.h);
      let cy = Math.floor(p.y / this.h);
      if (cx < 0) cx = 0;
      if (cx >= this.W) cx = this.W - 1;
      if (cy < 0) cy = 0;
      if (cy >= this.H) cy = this.H - 1;

      const i = cy * this.W + cx;
      if (!this.grid.solid[i]) continue;

      const fx = p.x / this.h - cx;
      const fy = p.y / this.h - cy;

      const left = fx;
      const right = 1 - fx;
      const up = fy;
      const down = 1 - fy;

      const eps = 1e-3;
      let best = left;
      let dir: 'L' | 'R' | 'U' | 'D' = 'L';
      if (right < best) { best = right; dir = 'R'; }
      if (up < best) { best = up; dir = 'U'; }
      if (down < best) { best = down; dir = 'D'; }

      if (dir === 'L') {
        p.x = cx * this.h - eps;
        if (p.vx > 0) p.vx = 0;
      } else if (dir === 'R') {
        p.x = (cx + 1) * this.h + eps;
        if (p.vx < 0) p.vx = 0;
      } else if (dir === 'U') {
        p.y = cy * this.h - eps;
        if (p.vy > 0) p.vy = 0;
      } else {
        p.y = (cy + 1) * this.h + eps;
        if (p.vy < 0) p.vy = 0;
      }

      if (p.x < 0) p.x = 0;
      else if (p.x > maxX) p.x = maxX;
      if (p.y < 0) p.y = 0;
      else if (p.y > maxY) p.y = maxY;
    }
  }

  private applySolidFaceBounds(): void {
    // Zero faces touching solids.
    for (let y = 0; y < this.H; y++) {
      for (let x = 0; x < this.W; x++) {
        const c = this.cellIdx(x, y);
        if (!this.grid.solid[c]) continue;

        this.u[this.uIdx(x, y)] = 0;
        this.u[this.uIdx(x + 1, y)] = 0;
        this.v[this.vIdx(x, y)] = 0;
        this.v[this.vIdx(x, y + 1)] = 0;
      }
    }

    for (let y = 0; y < this.H; y++) {
      this.u[this.uIdx(0, y)] = 0;
      this.u[this.uIdx(this.W, y)] = 0;
    }
    for (let x = 0; x < this.W; x++) {
      this.v[this.vIdx(x, 0)] = 0;
      this.v[this.vIdx(x, this.H)] = 0;
    }
  }

  private sampleGridVelocity(x: number, y: number): { u: number; v: number } {
    return {
      u: this.sampleU(x, y, this.u),
      v: this.sampleV(x, y, this.v),
    };
  }

  private sampleGridVelocityDeltaU(x: number, y: number): number {
    return this.sampleU(x, y, this.u) - this.sampleU(x, y, this.uPrev);
  }

  private sampleGridVelocityDeltaV(x: number, y: number): number {
    return this.sampleV(x, y, this.v) - this.sampleV(x, y, this.vPrev);
  }

  private sampleU(x: number, y: number, src: Float32Array): number {
    // u at (i*h, (j+0.5)h)
    const fx = x / this.h;
    const fy = y / this.h - 0.5;
    let i = Math.floor(fx);
    let j = Math.floor(fy);
    const tx = fx - i;
    const ty = fy - j;

    i = Math.max(0, Math.min(this.W, i));
    j = Math.max(0, Math.min(this.H - 1, j));

    const i1 = Math.min(this.W, i + 1);
    const j1 = Math.min(this.H - 1, j + 1);

    const a = src[this.uIdx(i, j)];
    const b = src[this.uIdx(i1, j)];
    const c = src[this.uIdx(i, j1)];
    const d = src[this.uIdx(i1, j1)];

    const ab = a * (1 - tx) + b * tx;
    const cd = c * (1 - tx) + d * tx;
    return ab * (1 - ty) + cd * ty;
  }

  private sampleV(x: number, y: number, src: Float32Array): number {
    // v at ((i+0.5)h, j*h)
    const fx = x / this.h - 0.5;
    const fy = y / this.h;
    let i = Math.floor(fx);
    let j = Math.floor(fy);
    const tx = fx - i;
    const ty = fy - j;

    i = Math.max(0, Math.min(this.W - 1, i));
    j = Math.max(0, Math.min(this.H, j));

    const i1 = Math.min(this.W - 1, i + 1);
    const j1 = Math.min(this.H, j + 1);

    const a = src[this.vIdx(i, j)];
    const b = src[this.vIdx(i1, j)];
    const c = src[this.vIdx(i, j1)];
    const d = src[this.vIdx(i1, j1)];

    const ab = a * (1 - tx) + b * tx;
    const cd = c * (1 - tx) + d * tx;
    return ab * (1 - ty) + cd * ty;
  }

  private scatterToU(x: number, y: number, value: number): void {
    const fx = x / this.h;
    const fy = y / this.h - 0.5;
    let i = Math.floor(fx);
    let j = Math.floor(fy);
    const tx = fx - i;
    const ty = fy - j;

    i = Math.max(0, Math.min(this.W, i));
    j = Math.max(0, Math.min(this.H - 1, j));

    const i1 = Math.min(this.W, i + 1);
    const j1 = Math.min(this.H - 1, j + 1);

    const w00 = (1 - tx) * (1 - ty);
    const w10 = tx * (1 - ty);
    const w01 = (1 - tx) * ty;
    const w11 = tx * ty;

    const a = this.uIdx(i, j);
    const b = this.uIdx(i1, j);
    const c = this.uIdx(i, j1);
    const d = this.uIdx(i1, j1);

    this.u[a] += value * w00; this.uW[a] += w00;
    this.u[b] += value * w10; this.uW[b] += w10;
    this.u[c] += value * w01; this.uW[c] += w01;
    this.u[d] += value * w11; this.uW[d] += w11;
  }

  private scatterToV(x: number, y: number, value: number): void {
    const fx = x / this.h - 0.5;
    const fy = y / this.h;
    let i = Math.floor(fx);
    let j = Math.floor(fy);
    const tx = fx - i;
    const ty = fy - j;

    i = Math.max(0, Math.min(this.W - 1, i));
    j = Math.max(0, Math.min(this.H, j));

    const i1 = Math.min(this.W - 1, i + 1);
    const j1 = Math.min(this.H, j + 1);

    const w00 = (1 - tx) * (1 - ty);
    const w10 = tx * (1 - ty);
    const w01 = (1 - tx) * ty;
    const w11 = tx * ty;

    const a = this.vIdx(i, j);
    const b = this.vIdx(i1, j);
    const c = this.vIdx(i, j1);
    const d = this.vIdx(i1, j1);

    this.v[a] += value * w00; this.vW[a] += w00;
    this.v[b] += value * w10; this.vW[b] += w10;
    this.v[c] += value * w01; this.vW[c] += w01;
    this.v[d] += value * w11; this.vW[d] += w11;
  }

  private cellIdx(x: number, y: number): number {
    return y * this.W + x;
  }
  private uIdx(x: number, y: number): number {
    return y * (this.W + 1) + x;
  }
  private vIdx(x: number, y: number): number {
    return y * this.W + x;
  }
  private uAt(x: number, y: number): number {
    return this.u[this.uIdx(x, y)];
  }
  private vAt(x: number, y: number): number {
    return this.v[this.vIdx(x, y)];
  }
}
