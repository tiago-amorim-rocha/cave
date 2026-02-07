import { Box2DEngine } from './physics/Box2DEngine';

/**
 * Minimal Box2D wrapper for stepping and world access.
 */
export class Box2DPhysics {
  private engine: Box2DEngine;

  constructor() {
    this.engine = new Box2DEngine();
  }

  async init(): Promise<void> {
    await this.engine.init();
  }

  update(deltaMs: number): void {
    this.engine.step(deltaMs);
  }

  getEngine(): Box2DEngine {
    return this.engine;
  }

  destroy(): void {
    this.engine.destroy();
  }
}
