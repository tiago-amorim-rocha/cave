import { b2Vec2, type b2Body } from '@box2d/core';
import type { DensityField } from '../DensityField';

export interface ImplicitCollisionParams {
  iterations: number;
  pushStep: number;
  normalDamping: number;
  tangentDamping: number;
}

export class ImplicitTerrainCollider {
  private densityField: DensityField;
  private params: ImplicitCollisionParams;
  private tmpSample = { density: 0, gradX: 0, gradY: 0 };

  constructor(densityField: DensityField, params: ImplicitCollisionParams) {
    this.densityField = densityField;
    this.params = params;
  }

  resolveCircleBody(body: b2Body, radius: number): void {
    const pos = body.GetPosition();
    const result = this.resolveCirclePosition(pos.x, pos.y, radius);
    if (!result.collided) return;

    body.SetTransformXY(result.x, result.y, body.GetAngle());
    this.applyVelocityDamping(body, result.nx, result.ny);
  }

  private resolveCirclePosition(x0: number, y0: number, radius: number): { x: number; y: number; nx: number; ny: number; collided: boolean } {
    const { width, height, gridPitch, isoValue } = this.densityField.config;

    let x = Math.max(0, Math.min(width, x0));
    let y = Math.max(0, Math.min(height, y0));

    const maxMove = Math.max(this.params.pushStep, gridPitch * 0.5);
    const bias = gridPitch * 0.01;

    let collided = false;
    let nx = 0;
    let ny = 0;

    for (let iter = 0; iter < this.params.iterations; iter++) {
      let maxPen = -Infinity;
      let bestGx = 0;
      let bestGy = 0;

      const consider = (sx: number, sy: number): void => {
        this.densityField.getDensityAndGradientAtWorld(sx, sy, this.tmpSample);
        const pen = this.tmpSample.density - isoValue;
        if (pen > maxPen) {
          maxPen = pen;
          bestGx = this.tmpSample.gradX;
          bestGy = this.tmpSample.gradY;
        }
      };

      consider(x, y);
      consider(x + radius, y);
      consider(x - radius, y);
      consider(x, y + radius);
      consider(x, y - radius);

      if (maxPen <= 0) break;

      const gradLen = Math.hypot(bestGx, bestGy);
      if (gradLen < 1e-6) {
        x += (Math.random() * 2 - 1) * maxMove;
        y += (Math.random() * 2 - 1) * maxMove;
        continue;
      }

      nx = -bestGx / gradLen;
      ny = -bestGy / gradLen;
      collided = true;

      const desired = maxPen / gradLen + bias;
      const move = Math.min(maxMove, Math.max(0, desired));
      x += nx * move;
      y += ny * move;
    }

    x = Math.max(0, Math.min(width, x));
    y = Math.max(0, Math.min(height, y));

    return { x, y, nx, ny, collided };
  }

  private applyVelocityDamping(body: b2Body, nx: number, ny: number): void {
    if (nx === 0 && ny === 0) return;

    const v = body.GetLinearVelocity();
    let vx = v.x;
    let vy = v.y;
    const vn0 = vx * nx + vy * ny;
    if (vn0 < 0) {
      vx -= vn0 * nx;
      vy -= vn0 * ny;
    }

    const vn = vx * nx + vy * ny;
    const vtx = vx - vn * nx;
    const vty = vy - vn * ny;

    const vnDamped = vn * (1 - this.params.normalDamping);
    const vtDamped = 1 - this.params.tangentDamping;

    body.SetLinearVelocity(new b2Vec2(vtx * vtDamped + vnDamped * nx, vty * vtDamped + vnDamped * ny));
  }
}
