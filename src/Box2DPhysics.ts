/**
 * Box2D Physics Wrapper
 * High-level API for physics simulation
 */

import { Box2DEngine } from './physics/Box2DEngine';
import type { Camera } from './Camera';

export interface Point {
  x: number;
  y: number;
}

/**
 * Box2D Physics API
 */
export class Box2DPhysics {
  private engine: Box2DEngine;

  constructor() {
    this.engine = new Box2DEngine();
  }

  /**
   * Initialize physics engine
   */
  async init(): Promise<void> {
    await this.engine.init();
  }

  /**
   * Update physics simulation
   */
  update(deltaMs: number): void {
    this.engine.step(deltaMs);
  }

  /**
   * Set cave terrain from marching squares contours
   */
  setCaveContours(contours: Point[][]): void {
    this.engine.setTerrainLoops(contours);
  }

  /**
   * Enable or disable debug visualization
   */
  setDebugEnabled(enabled: boolean): void {
    this.engine.setDebugEnabled(enabled);
  }

  /**
   * Render debug visualization
   */
  debugDraw(ctx: CanvasRenderingContext2D, camera: Camera, canvasWidth: number, canvasHeight: number): void {
    this.engine.debugDraw(ctx, camera, canvasWidth, canvasHeight);
  }

  /**
   * Get the underlying Box2D engine
   */
  getEngine(): Box2DEngine {
    return this.engine;
  }

  /**
   * Cleanup
   */
  destroy(): void {
    this.engine.destroy();
  }
}
