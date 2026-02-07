import { b2World, b2Vec2 } from '@box2d/core';

export class Box2DEngine {
  private world: b2World | null = null;
  private accumulator = 0;
  private fixedUpdateCallbacks: Array<(dtMs: number) => void> = [];
  private postStepCallbacks: Array<(dtMs: number) => void> = [];

  private readonly PHYSICS_HZ = 60;
  private readonly PHYSICS_DT = 1 / 60;
  private readonly FIXED_DT_MS = 1000 / 60;
  private readonly VELOCITY_ITERATIONS = 8;
  private readonly POSITION_ITERATIONS = 8;

  async init(): Promise<void> {
    const gravity = new b2Vec2(0, 10);
    this.world = b2World.Create(gravity);
  }

  getWorld(): b2World {
    if (!this.world) {
      throw new Error('[Box2DEngine] World not initialized. Call init() first.');
    }
    return this.world;
  }

  registerFixedUpdate(callback: (dtMs: number) => void): void {
    this.fixedUpdateCallbacks.push(callback);
  }

  registerPostStep(callback: (dtMs: number) => void): void {
    this.postStepCallbacks.push(callback);
  }

  step(dtMs: number): void {
    if (!this.world) return;

    this.accumulator += dtMs / 1000;

    while (this.accumulator >= this.PHYSICS_DT) {
      for (const callback of this.fixedUpdateCallbacks) {
        callback(this.FIXED_DT_MS);
      }

      this.world.Step(this.PHYSICS_DT, {
        velocityIterations: this.VELOCITY_ITERATIONS,
        positionIterations: this.POSITION_ITERATIONS,
      });

      for (const callback of this.postStepCallbacks) {
        callback(this.FIXED_DT_MS);
      }

      this.accumulator -= this.PHYSICS_DT;
    }
  }

  destroy(): void {
    this.world = null;
    this.fixedUpdateCallbacks = [];
    this.postStepCallbacks = [];
  }
}
