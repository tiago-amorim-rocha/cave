import type { WaterGrid } from './WaterGrid';

export interface MacVelocityGridConfig {
  widthCells: number;
  heightCells: number;
  cellSizeM: number;
  solidCells: Uint8Array;
}

export class MacVelocityGrid {
  readonly widthCells: number;
  readonly heightCells: number;
  readonly cellSizeM: number;

  private readonly solidCells: Uint8Array;

  private u: Float32Array;
  private v: Float32Array;
  private uNext: Float32Array;
  private vNext: Float32Array;

  private divergence: Float32Array;
  private pressure: Float32Array;
  private pressureNext: Float32Array;

  private projectionIterations = 30;
  private dampingPerSecond = 0.25;
  private gravity = 10;
  private maxFaceSpeed = 15;

  constructor(config: MacVelocityGridConfig) {
    this.widthCells = config.widthCells;
    this.heightCells = config.heightCells;
    this.cellSizeM = config.cellSizeM;
    this.solidCells = config.solidCells;

    const uCount = (this.widthCells + 1) * this.heightCells;
    const vCount = this.widthCells * (this.heightCells + 1);
    const cellCount = this.widthCells * this.heightCells;

    this.u = new Float32Array(uCount);
    this.v = new Float32Array(vCount);
    this.uNext = new Float32Array(uCount);
    this.vNext = new Float32Array(vCount);

    this.divergence = new Float32Array(cellCount);
    this.pressure = new Float32Array(cellCount);
    this.pressureNext = new Float32Array(cellCount);
  }

  get debugU(): Readonly<Float32Array> {
    return this.u;
  }

  get debugV(): Readonly<Float32Array> {
    return this.v;
  }

  get debugPressure(): Readonly<Float32Array> {
    return this.pressure;
  }

  reset(): void {
    this.u.fill(0);
    this.v.fill(0);
    this.uNext.fill(0);
    this.vNext.fill(0);
    this.divergence.fill(0);
    this.pressure.fill(0);
    this.pressureNext.fill(0);
  }

  step(dtMs: number, water: WaterGrid | null): void {
    const dt = Math.max(0, dtMs) / 1000;
    if (dt <= 0) return;

    const damp = Math.max(0, 1 - this.dampingPerSecond * dt);
    for (let i = 0; i < this.u.length; i++) this.u[i] *= damp;
    for (let i = 0; i < this.v.length; i++) this.v[i] *= damp;

    this.applySolidFaceBounds();

    if (water) {
      const src = water.getSourceInfo();
      if (src?.enabled) {
        this.injectDownwardJet(src.minX, src.maxX, src.y, 6);
      }
    }

    if (water) {
      this.applyGravity(dt, water);
    }

    this.project(dt);

    this.clampFaceSpeeds();
  }

  getCellVelocity(x: number, y: number): { u: number; v: number } {
    const ux0 = this.uAt(x, y);
    const ux1 = this.uAt(x + 1, y);
    const vy0 = this.vAt(x, y);
    const vy1 = this.vAt(x, y + 1);
    return { u: 0.5 * (ux0 + ux1), v: 0.5 * (vy0 + vy1) };
  }

  private injectDownwardJet(minX: number, maxX: number, yCell: number, speed: number): void {
    const yFace = yCell + 1;
    if (yFace < 0 || yFace > this.heightCells) return;

    const x0 = Math.max(0, Math.min(this.widthCells - 1, minX));
    const x1 = Math.max(0, Math.min(this.widthCells - 1, maxX));

    for (let x = x0; x <= x1; x++) {
      const aboveY = yFace - 1;
      const belowY = yFace;
      if (aboveY < 0 || aboveY >= this.heightCells) continue;
      if (belowY < 0 || belowY >= this.heightCells) continue;

      const cellAbove = this.cellIdx(x, aboveY);
      const cellBelow = this.cellIdx(x, belowY);
      if (this.solidCells[cellAbove] || this.solidCells[cellBelow]) continue;

      this.v[this.vIdx(x, yFace)] = speed;
    }
  }

  private project(dt: number): void {
    this.computeDivergence();
    this.solvePressure(dt);
    this.subtractPressureGradient(dt);
    this.applySolidFaceBounds();
  }

  private applyGravity(dt: number, water: WaterGrid): void {
    const W = this.widthCells;
    const H = this.heightCells;
    const w = water.water;
    const eps = 0.001;

    // Apply to horizontal faces where either adjacent cell has water.
    for (let y = 1; y < H; y++) {
      for (let x = 0; x < W; x++) {
        const top = this.cellIdx(x, y - 1);
        const bottom = this.cellIdx(x, y);
        if (this.solidCells[top] || this.solidCells[bottom]) continue;
        if (w[top] <= eps && w[bottom] <= eps) continue;

        const i = this.vIdx(x, y);
        this.v[i] += this.gravity * dt;
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

  private computeDivergence(): void {
    const invH = 1 / this.cellSizeM;
    for (let y = 0; y < this.heightCells; y++) {
      for (let x = 0; x < this.widthCells; x++) {
        const c = this.cellIdx(x, y);
        if (this.solidCells[c]) {
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

    const h2OverDt = (this.cellSizeM * this.cellSizeM) / dt;

    for (let iter = 0; iter < this.projectionIterations; iter++) {
      for (let y = 0; y < this.heightCells; y++) {
        for (let x = 0; x < this.widthCells; x++) {
          const c = this.cellIdx(x, y);
          if (this.solidCells[c]) {
            this.pressureNext[c] = 0;
            continue;
          }

          let sum = 0;
          let count = 0;

          if (x > 0) {
            const n = this.cellIdx(x - 1, y);
            if (!this.solidCells[n]) {
              sum += this.pressure[n];
              count++;
            }
          }
          if (x < this.widthCells - 1) {
            const n = this.cellIdx(x + 1, y);
            if (!this.solidCells[n]) {
              sum += this.pressure[n];
              count++;
            }
          }
          if (y > 0) {
            const n = this.cellIdx(x, y - 1);
            if (!this.solidCells[n]) {
              sum += this.pressure[n];
              count++;
            }
          }
          if (y < this.heightCells - 1) {
            const n = this.cellIdx(x, y + 1);
            if (!this.solidCells[n]) {
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
    const scale = dt / this.cellSizeM;

    for (let y = 0; y < this.heightCells; y++) {
      this.u[this.uIdx(0, y)] = 0;
      this.u[this.uIdx(this.widthCells, y)] = 0;

      for (let x = 1; x < this.widthCells; x++) {
        const left = this.cellIdx(x - 1, y);
        const right = this.cellIdx(x, y);

        if (this.solidCells[left] || this.solidCells[right]) {
          this.u[this.uIdx(x, y)] = 0;
          continue;
        }

        const grad = this.pressure[right] - this.pressure[left];
        this.u[this.uIdx(x, y)] -= scale * grad;
      }
    }

    for (let x = 0; x < this.widthCells; x++) {
      this.v[this.vIdx(x, 0)] = 0;
      this.v[this.vIdx(x, this.heightCells)] = 0;

      for (let y = 1; y < this.heightCells; y++) {
        const bottom = this.cellIdx(x, y - 1);
        const top = this.cellIdx(x, y);

        if (this.solidCells[bottom] || this.solidCells[top]) {
          this.v[this.vIdx(x, y)] = 0;
          continue;
        }

        const grad = this.pressure[top] - this.pressure[bottom];
        this.v[this.vIdx(x, y)] -= scale * grad;
      }
    }
  }

  private applySolidFaceBounds(): void {
    for (let y = 0; y < this.heightCells; y++) {
      for (let x = 0; x < this.widthCells; x++) {
        const c = this.cellIdx(x, y);
        if (!this.solidCells[c]) continue;

        this.u[this.uIdx(x, y)] = 0;
        this.u[this.uIdx(x + 1, y)] = 0;
        this.v[this.vIdx(x, y)] = 0;
        this.v[this.vIdx(x, y + 1)] = 0;
      }
    }

    for (let y = 0; y < this.heightCells; y++) {
      this.u[this.uIdx(0, y)] = 0;
      this.u[this.uIdx(this.widthCells, y)] = 0;
    }
    for (let x = 0; x < this.widthCells; x++) {
      this.v[this.vIdx(x, 0)] = 0;
      this.v[this.vIdx(x, this.heightCells)] = 0;
    }
  }

  private cellIdx(x: number, y: number): number {
    return y * this.widthCells + x;
  }

  private uIdx(x: number, y: number): number {
    return y * (this.widthCells + 1) + x;
  }

  private vIdx(x: number, y: number): number {
    return y * this.widthCells + x;
  }

  private uAt(x: number, y: number): number {
    return this.u[this.uIdx(x, y)];
  }

  private vAt(x: number, y: number): number {
    return this.v[this.vIdx(x, y)];
  }
}
