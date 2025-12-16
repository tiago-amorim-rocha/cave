import type { DensityField } from '../DensityField';
import type { MacVelocityGrid } from './MacVelocityGrid';

export interface WaterGridConfig {
  worldWidthM: number;
  worldHeightM: number;
  cellSizeM: number;
}

export class WaterGrid {
  readonly cellSizeM: number;
  readonly widthCells: number;
  readonly heightCells: number;
  readonly worldWidthM: number;
  readonly worldHeightM: number;

  readonly solid: Uint8Array;
  private w: Float32Array;
  private wNext: Float32Array;
  private flowDown: Float32Array;
  private flowSide: Float32Array;
  private outL: Float32Array;
  private outR: Float32Array;
  private outU: Float32Array;
  private outD: Float32Array;
  private acceptScaleOrInTotal: Float32Array;

  private source: {
    enabled: boolean;
    remainingMs: number;
    intervalMs: number;
    accMs: number;
    minX: number;
    maxX: number;
    y: number;
  } | null = null;

  private lateralMaxTransferPerSubstep = 0.2;

  constructor(config: WaterGridConfig) {
    if (!(config.cellSizeM > 0)) {
      throw new Error('[WaterGrid] cellSizeM must be > 0');
    }
    this.cellSizeM = config.cellSizeM;
    this.worldWidthM = config.worldWidthM;
    this.worldHeightM = config.worldHeightM;

    this.widthCells = Math.ceil(this.worldWidthM / this.cellSizeM);
    this.heightCells = Math.ceil(this.worldHeightM / this.cellSizeM);

    const n = this.widthCells * this.heightCells;
    this.solid = new Uint8Array(n);
    this.w = new Float32Array(n);
    this.wNext = new Float32Array(n);
    this.flowDown = new Float32Array(n);
    this.flowSide = new Float32Array(n);
    this.outL = new Float32Array(n);
    this.outR = new Float32Array(n);
    this.outU = new Float32Array(n);
    this.outD = new Float32Array(n);
    this.acceptScaleOrInTotal = new Float32Array(n);
  }

  get water(): Readonly<Float32Array> {
    return this.w;
  }

  get debugFlowDown(): Readonly<Float32Array> {
    return this.flowDown;
  }

  get debugFlowSide(): Readonly<Float32Array> {
    return this.flowSide;
  }

  getSourceInfo(): { enabled: boolean; minX: number; maxX: number; y: number } | null {
    if (!this.source) return null;
    return { enabled: this.source.enabled, minX: this.source.minX, maxX: this.source.maxX, y: this.source.y };
  }

  setFromParticles(particles: ReadonlyArray<{ x: number; y: number }>, massPerParticle: number): void {
    this.w.fill(0);
    this.flowDown.fill(0);
    this.flowSide.fill(0);

    for (const p of particles) {
      const fx = p.x / this.cellSizeM - 0.5;
      const fy = p.y / this.cellSizeM - 0.5;
      const ix = Math.floor(fx);
      const iy = Math.floor(fy);
      const tx = fx - ix;
      const ty = fy - iy;

      const x0 = Math.max(0, Math.min(this.widthCells - 1, ix));
      const y0 = Math.max(0, Math.min(this.heightCells - 1, iy));
      const x1 = Math.max(0, Math.min(this.widthCells - 1, ix + 1));
      const y1 = Math.max(0, Math.min(this.heightCells - 1, iy + 1));

      const w00 = (1 - tx) * (1 - ty) * massPerParticle;
      const w10 = tx * (1 - ty) * massPerParticle;
      const w01 = (1 - tx) * ty * massPerParticle;
      const w11 = tx * ty * massPerParticle;

      const i00 = this.idx(x0, y0);
      const i10 = this.idx(x1, y0);
      const i01 = this.idx(x0, y1);
      const i11 = this.idx(x1, y1);

      if (!this.solid[i00]) this.w[i00] += w00;
      if (!this.solid[i10]) this.w[i10] += w10;
      if (!this.solid[i01]) this.w[i01] += w01;
      if (!this.solid[i11]) this.w[i11] += w11;
    }

    for (let i = 0; i < this.solid.length; i++) {
      if (this.solid[i]) {
        this.w[i] = 0;
      } else {
        const v = this.w[i];
        this.w[i] = v < 0 ? 0 : (v > 1 ? 1 : v);
      }
    }
  }

  resetWater(): void {
    this.w.fill(0);
    this.wNext.fill(0);
    this.flowDown.fill(0);
    this.flowSide.fill(0);
    this.outL.fill(0);
    this.outR.fill(0);
    this.outU.fill(0);
    this.outD.fill(0);
    this.acceptScaleOrInTotal.fill(0);
    this.source = null;
  }

  rebuildSolidFromDensityField(field: DensityField): void {
    const iso = field.config.isoValue;

    for (let y = 0; y < this.heightCells; y++) {
      const wy = (y + 0.5) * this.cellSizeM;
      for (let x = 0; x < this.widthCells; x++) {
        const wx = (x + 0.5) * this.cellSizeM;
        const density = field.getDensityAtWorld(wx, wy);
        this.solid[this.idx(x, y)] = density >= iso ? 1 : 0;
      }
    }

    for (let i = 0; i < this.solid.length; i++) {
      if (this.solid[i]) {
        this.w[i] = 0;
        this.wNext[i] = 0;
      }
    }
  }

  stepGravityOnly(substeps: number): void {
    const steps = Math.max(1, Math.floor(substeps));
    for (let i = 0; i < steps; i++) {
      this.applySource();
      this.gravityPass();
      this.lateralPass();
    }
  }

  step(dtMs: number, substeps: number = 1): void {
    this.tickSource(dtMs);
    this.stepGravityOnly(substeps);
  }

  tickSource(dtMs: number): void {
    if (this.source?.enabled) {
      this.source.remainingMs -= dtMs;
      if (this.source.remainingMs <= 0) {
        this.source.enabled = false;
      } else {
        this.source.accMs += dtMs;
      }
    }
  }

  consumeSourceDrops(maxDrops: number = 64): number {
    if (!this.source?.enabled) return 0;
    const m = Math.max(0, Math.floor(maxDrops));
    if (m === 0) return 0;

    const interval = this.source.intervalMs;
    if (interval <= 0) return 0;

    const drops = Math.min(m, Math.floor(this.source.accMs / interval));
    if (drops > 0) {
      this.source.accMs -= drops * interval;
    }
    return drops;
  }

  clearWaterOnly(): void {
    this.w.fill(0);
    this.wNext.fill(0);
    this.flowDown.fill(0);
    this.flowSide.fill(0);
  }

  advectWithVelocity(dtMs: number, velocity: MacVelocityGrid, substeps: number = 2): void {
    const steps = Math.max(1, Math.floor(substeps));
    const dt = Math.max(0, dtMs) / 1000;
    if (dt <= 0) return;

    const dtSub = dt / steps;
    for (let i = 0; i < steps; i++) {
      this.advectMacSubstep(dtSub, velocity);
    }
  }

  startSource(durationMs: number, config: { y: number; minX: number; maxX: number; intervalMs?: number }): void {
    const intervalMs = config.intervalMs ?? 120;
    const y = this.clampCellY(config.y);
    const minX = this.clampCellX(Math.min(config.minX, config.maxX));
    const maxX = this.clampCellX(Math.max(config.minX, config.maxX));

    this.source = {
      enabled: durationMs > 0,
      remainingMs: Math.max(0, durationMs),
      intervalMs: Math.max(16, intervalMs),
      accMs: 0,
      minX,
      maxX,
      y
    };
  }

  spawnRectWorld(worldX: number, worldY: number, widthM: number, heightM: number, fill: number = 1): void {
    const x0 = this.clampCellX(Math.floor(worldX / this.cellSizeM));
    const y0 = this.clampCellY(Math.floor(worldY / this.cellSizeM));
    const x1 = this.clampCellX(Math.floor((worldX + widthM) / this.cellSizeM));
    const y1 = this.clampCellY(Math.floor((worldY + heightM) / this.cellSizeM));

    for (let y = y0; y <= y1; y++) {
      for (let x = x0; x <= x1; x++) {
        const k = this.idx(x, y);
        if (this.solid[k]) continue;
        this.w[k] = Math.max(0, Math.min(1, this.w[k] + fill));
      }
    }
  }

  spawnDebugDrop(minVerticalClearCells: number = 12): boolean {
    const minClear = Math.max(2, Math.floor(minVerticalClearCells));
    let best: { x: number; y: number } | null = null;

    for (let x = 0; x < this.widthCells; x++) {
      for (let y = 0; y <= this.heightCells - minClear; y++) {
        if (this.isSolidCell(x, y)) continue;

        let ok = true;
        for (let dy = 1; dy < minClear; dy++) {
          if (this.isSolidCell(x, y + dy)) {
            ok = false;
            break;
          }
        }

        if (ok) {
          best = { x, y };
          break;
        }
      }
      if (best) break;
    }

    if (!best) {
      for (let i = 0; i < this.solid.length; i++) {
        if (!this.solid[i]) {
          best = { x: i % this.widthCells, y: Math.floor(i / this.widthCells) };
          break;
        }
      }
    }

    if (!best) return false;

    const pad = 2;
    const x0 = this.clampCellX(best.x - pad);
    const x1 = this.clampCellX(best.x + pad);
    const y0 = this.clampCellY(best.y - pad);
    const y1 = this.clampCellY(best.y + pad);

    for (let y = y0; y <= y1; y++) {
      for (let x = x0; x <= x1; x++) {
        const k = this.idx(x, y);
        if (this.solid[k]) continue;
        this.w[k] = 1;
      }
    }

    this.startSource(10_000, { y: best.y, minX: x0, maxX: x1 });

    return true;
  }

  worldToCell(worldX: number, worldY: number): { cx: number; cy: number } {
    return {
      cx: this.clampCellX(Math.floor(worldX / this.cellSizeM)),
      cy: this.clampCellY(Math.floor(worldY / this.cellSizeM)),
    };
  }

  cellToWorld(cx: number, cy: number): { wx: number; wy: number } {
    return { wx: cx * this.cellSizeM, wy: cy * this.cellSizeM };
  }

  private gravityPass(): void {
    this.flowDown.fill(0);
    this.wNext.set(this.w);

    for (let y = this.heightCells - 2; y >= 0; y--) {
      for (let x = 0; x < this.widthCells; x++) {
        const k = this.idx(x, y);
        if (this.solid[k]) continue;

        const amountHere = this.w[k];
        if (amountHere <= 0) continue;

        const kb = this.idx(x, y + 1);
        if (this.solid[kb]) continue;

        const spaceBelow = 1 - this.w[kb];
        if (spaceBelow <= 0) continue;

        const moved = amountHere < spaceBelow ? amountHere : spaceBelow;
        this.wNext[k] -= moved;
        this.wNext[kb] += moved;
        this.flowDown[k] += moved;
      }
    }

    const tmp = this.w;
    this.w = this.wNext;
    this.wNext = tmp;

    for (let i = 0; i < this.solid.length; i++) {
      if (this.solid[i]) {
        this.w[i] = 0;
      } else {
        const v = this.w[i];
        this.w[i] = v < 0 ? 0 : (v > 1 ? 1 : v);
      }
    }
  }

  private advectMacSubstep(dt: number, velocity: MacVelocityGrid): void {
    const W = this.widthCells;
    const H = this.heightCells;
    const h = this.cellSizeM;
    const invH = 1 / h;
    const cfl = 0.9;

    const U = velocity.debugU;
    const V = velocity.debugV;

    this.outL.fill(0);
    this.outR.fill(0);
    this.outU.fill(0);
    this.outD.fill(0);

    this.flowDown.fill(0);
    this.flowSide.fill(0);

    // Vertical faces (u): internal faces only, boundaries are assumed 0.
    for (let y = 0; y < H; y++) {
      const uRow = y * (W + 1);
      const cellRow = y * W;
      for (let x = 1; x < W; x++) {
        const u = U[uRow + x];
        if (u === 0) continue;

        const left = cellRow + (x - 1);
        const right = cellRow + x;
        if (this.solid[left] || this.solid[right]) continue;

        const frac = Math.min(cfl, Math.abs(u) * dt * invH);
        if (frac <= 0) continue;

        if (u > 0) {
          const w = this.w[left];
          if (w > 0) {
            this.outR[left] += frac * w;
          }
        } else {
          const w = this.w[right];
          if (w > 0) {
            this.outL[right] += frac * w;
          }
        }
      }
    }

    // Horizontal faces (v): internal faces only, boundaries are assumed 0.
    for (let yFace = 1; yFace < H; yFace++) {
      const vRow = yFace * W;
      const topRow = (yFace - 1) * W;
      const bottomRow = yFace * W;
      for (let x = 0; x < W; x++) {
        const v = V[vRow + x];
        if (v === 0) continue;

        const top = topRow + x;
        const bottom = bottomRow + x;
        if (this.solid[top] || this.solid[bottom]) continue;

        const frac = Math.min(cfl, Math.abs(v) * dt * invH);
        if (frac <= 0) continue;

        if (v > 0) {
          const w = this.w[top];
          if (w > 0) {
            this.outD[top] += frac * w;
          }
        } else {
          const w = this.w[bottom];
          if (w > 0) {
            this.outU[bottom] += frac * w;
          }
        }
      }
    }

    // Donor-limited: can't send more than you have.
    for (let i = 0; i < this.solid.length; i++) {
      if (this.solid[i]) {
        this.w[i] = 0;
        this.outL[i] = 0;
        this.outR[i] = 0;
        this.outU[i] = 0;
        this.outD[i] = 0;
        continue;
      }

      const totalOut = this.outL[i] + this.outR[i] + this.outU[i] + this.outD[i];
      const available = this.w[i];
      if (totalOut > available && totalOut > 1e-8) {
        const s = available / totalOut;
        this.outL[i] *= s;
        this.outR[i] *= s;
        this.outU[i] *= s;
        this.outD[i] *= s;
      }
    }

    // Compute in-totals per receiver.
    this.acceptScaleOrInTotal.fill(0);
    for (let y = 0; y < H; y++) {
      const row = y * W;
      for (let x = 0; x < W; x++) {
        const i = row + x;
        const oL = this.outL[i];
        const oR = this.outR[i];
        const oU = this.outU[i];
        const oD = this.outD[i];

        if (oL > 0 && x > 0) this.acceptScaleOrInTotal[i - 1] += oL;
        if (oR > 0 && x + 1 < W) this.acceptScaleOrInTotal[i + 1] += oR;
        if (oU > 0 && y > 0) this.acceptScaleOrInTotal[i - W] += oU;
        if (oD > 0 && y + 1 < H) this.acceptScaleOrInTotal[i + W] += oD;
      }
    }

    // Convert in-totals to accept scales to enforce max fill = 1.
    for (let i = 0; i < this.solid.length; i++) {
      if (this.solid[i]) {
        this.acceptScaleOrInTotal[i] = 0;
        continue;
      }

      const inTotal = this.acceptScaleOrInTotal[i];
      if (inTotal <= 1e-8) {
        this.acceptScaleOrInTotal[i] = 1;
        continue;
      }

      const free = 1 - this.w[i];
      if (free <= 0) {
        this.acceptScaleOrInTotal[i] = 0;
      } else if (inTotal > free) {
        this.acceptScaleOrInTotal[i] = free / inTotal;
      } else {
        this.acceptScaleOrInTotal[i] = 1;
      }
    }

    // Apply receiver acceptance to each directed outflow (keeps volume conserved).
    for (let y = 0; y < H; y++) {
      const row = y * W;
      for (let x = 0; x < W; x++) {
        const i = row + x;

        const oL = this.outL[i];
        if (oL > 0 && x > 0) this.outL[i] = oL * this.acceptScaleOrInTotal[i - 1];

        const oR = this.outR[i];
        if (oR > 0 && x + 1 < W) this.outR[i] = oR * this.acceptScaleOrInTotal[i + 1];

        const oU = this.outU[i];
        if (oU > 0 && y > 0) this.outU[i] = oU * this.acceptScaleOrInTotal[i - W];

        const oD = this.outD[i];
        if (oD > 0 && y + 1 < H) this.outD[i] = oD * this.acceptScaleOrInTotal[i + W];
      }
    }

    // Apply transfers.
    this.wNext.set(this.w);

    for (let y = 0; y < H; y++) {
      const row = y * W;
      for (let x = 0; x < W; x++) {
        const i = row + x;
        if (this.solid[i]) {
          this.wNext[i] = 0;
          continue;
        }

        const oL = this.outL[i];
        const oR = this.outR[i];
        const oU = this.outU[i];
        const oD = this.outD[i];

        this.wNext[i] -= (oL + oR + oU + oD);

        if (oL > 0 && x > 0) {
          this.wNext[i - 1] += oL;
          this.flowSide[i] += oL;
        }
        if (oR > 0 && x + 1 < W) {
          this.wNext[i + 1] += oR;
          this.flowSide[i] += oR;
        }
        if (oU > 0 && y > 0) {
          this.wNext[i - W] += oU;
          this.flowDown[i] += oU;
        }
        if (oD > 0 && y + 1 < H) {
          this.wNext[i + W] += oD;
          this.flowDown[i] += oD;
        }
      }
    }

    const tmp = this.w;
    this.w = this.wNext;
    this.wNext = tmp;

    for (let i = 0; i < this.solid.length; i++) {
      if (this.solid[i]) {
        this.w[i] = 0;
      } else {
        const v = this.w[i];
        this.w[i] = v < 0 ? 0 : (v > 1 ? 1 : v);
      }
    }
  }

  private lateralPass(): void {
    const maxTransfer = this.lateralMaxTransferPerSubstep;
    if (maxTransfer <= 0) return;

    this.flowSide.fill(0);
    this.wNext.set(this.w);

    for (let y = 0; y < this.heightCells; y++) {
      const row = y * this.widthCells;
      for (let x = 0; x < this.widthCells - 1; x++) {
        const a = row + x;
        const b = a + 1;

        if (this.solid[a] || this.solid[b]) continue;

        const wa = this.w[a];
        const wb = this.w[b];
        const diff = wa - wb;
        if (Math.abs(diff) <= 1e-6) continue;

        const supportedA = y >= this.heightCells - 1 || this.solid[a + this.widthCells] !== 0 || this.w[a + this.widthCells] >= 0.999;
        const supportedB = y >= this.heightCells - 1 || this.solid[b + this.widthCells] !== 0 || this.w[b + this.widthCells] >= 0.999;

        // Let water spill sideways out of supported cells (pool surface / landed column),
        // even if the receiving cell isn't supported yet (it will fall next gravity pass).
        if (diff > 0) {
          if (!supportedA) continue;
          let moved = diff * 0.5;
          if (moved > maxTransfer) moved = maxTransfer;

          const available = wa;
          const space = 1 - wb;
          const clamped = Math.min(moved, available, space);
          if (clamped > 0) {
            this.wNext[a] -= clamped;
            this.wNext[b] += clamped;
            this.flowSide[a] += clamped;
          }
        } else {
          if (!supportedB) continue;
          let moved = (-diff) * 0.5;
          if (moved > maxTransfer) moved = maxTransfer;

          const available = wb;
          const space = 1 - wa;
          const clamped = Math.min(moved, available, space);
          if (clamped > 0) {
            this.wNext[a] += clamped;
            this.wNext[b] -= clamped;
            this.flowSide[b] += clamped;
          }
        }
      }
    }

    const tmp = this.w;
    this.w = this.wNext;
    this.wNext = tmp;

    for (let i = 0; i < this.solid.length; i++) {
      if (this.solid[i]) {
        this.w[i] = 0;
      } else {
        const v = this.w[i];
        this.w[i] = v < 0 ? 0 : (v > 1 ? 1 : v);
      }
    }
  }

  private applySource(): void {
    if (!this.source?.enabled) return;
    if (this.source.accMs < this.source.intervalMs) return;

    const drops = this.consumeSourceDrops(128);
    for (let n = 0; n < drops; n++) {
      const span = this.source.maxX - this.source.minX + 1;
      const x = this.source.minX + Math.floor(Math.random() * span);
      const y = this.source.y;

      const k = this.idx(x, y);
      if (!this.solid[k]) {
        this.w[k] = 1;
      }
    }
  }

  private isSolidCell(x: number, y: number): boolean {
    return this.solid[this.idx(x, y)] !== 0;
  }

  private idx(x: number, y: number): number {
    return y * this.widthCells + x;
  }

  private clampCellX(x: number): number {
    if (x < 0) return 0;
    if (x >= this.widthCells) return this.widthCells - 1;
    return x;
  }

  private clampCellY(y: number): number {
    if (y < 0) return 0;
    if (y >= this.heightCells) return this.heightCells - 1;
    return y;
  }
}
