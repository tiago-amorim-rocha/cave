/**
 * Physics simulation using Rapier 2D
 * Drop-in replacement for Matter.js based Physics class
 * Uses segment colliders for exact boundary representation - no decomposition
 */

import RAPIER from '@dimforge/rapier2d-compat';
import { RapierEngine, type PlayerColliders } from './physics/engine';
import type { Point } from './types';
import type { Camera } from './Camera';

export interface PlayerController {
  body: RAPIER.RigidBody;
  colliders: PlayerColliders;
}

/**
 * Wrapper to maintain compatibility with existing code while using Rapier
 */
export class RapierPhysics {
  private engine: RapierEngine;
  private playerController: PlayerController | null = null;

  constructor() {
    this.engine = new RapierEngine();
  }

  /**
   * Initialize Rapier - must be called before use
   */
  async init(): Promise<void> {
    await this.engine.init();
  }

  /**
   * Update physics simulation
   * @param deltaMs - Time step in milliseconds
   */
  update(deltaMs: number): void {
    this.engine.step(deltaMs);
  }

  /**
   * Create static collision bodies from cave contours
   * Uses segment colliders for exact match to marching squares output
   * @param contours - Array of polylines representing cave walls
   */
  setCaveContours(contours: Point[][]): void {
    this.engine.setTerrainLoops(contours);
  }

  /**
   * Create player controller with capsule body and foot sensor
   * @param x - Initial X position (metres)
   * @param y - Initial Y position (metres)
   * @returns Player controller object
   */
  createPlayer(x: number, y: number): PlayerController {
    const result = this.engine.createPlayer(x, y);
    this.playerController = result;
    return result;
  }

  /**
   * Create a test ball
   */
  createBall(x: number, y: number, radius: number): RAPIER.RigidBody {
    return this.engine.createBall(x, y, radius);
  }

  /**
   * Remove a body from the world
   */
  removeBody(body: RAPIER.RigidBody): void {
    this.engine.removeBody(body);
  }

  /**
   * Check if player is grounded using foot sensor
   */
  isPlayerGrounded(): boolean {
    if (!this.playerController) return false;
    return this.engine.isSensorActive(this.playerController.colliders.footSensor);
  }

  /**
   * Get player body mass
   */
  getPlayerMass(): number {
    if (!this.playerController) return 1.0;
    return this.playerController.body.mass();
  }

  /**
   * Get all bodies in the world (for rendering debug)
   */
  getAllBodies(): RAPIER.RigidBody[] {
    return this.engine.getAllBodies();
  }

  /**
   * Enable debug rendering
   */
  setDebugEnabled(enabled: boolean): void {
    this.engine.setDebugEnabled(enabled);
  }

  /**
   * Draw debug visualization
   */
  debugDraw(ctx: CanvasRenderingContext2D, camera: Camera, canvasWidth: number, canvasHeight: number): void {
    this.engine.debugDraw(ctx, camera, canvasWidth, canvasHeight);
  }
}
