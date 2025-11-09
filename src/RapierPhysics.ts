/**
 * Physics simulation using Rapier 2D
 * Drop-in replacement for Matter.js based Physics class
 * Uses segment colliders for exact boundary representation - no decomposition
 */

import RAPIER from '@dimforge/rapier2d-compat';
import { RapierEngine } from './physics/engine';
import type { Point } from './types';
import type { Camera } from './Camera';

/**
 * Wrapper to maintain compatibility with existing code while using Rapier
 */
export class RapierPhysics {
  private engine: RapierEngine;
  private playerBody: RAPIER.RigidBody | null = null;

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
   * Create player body
   * @param x - Initial X position (metres)
   * @param y - Initial Y position (metres)
   * @returns Player rigid body handle
   */
  createPlayer(x: number, y: number): RAPIER.RigidBody {
    const radius = 0.5; // Same as Matter.js version
    this.playerBody = this.engine.createPlayer(x, y, radius);
    return this.playerBody;
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
   * Apply horizontal force to player for movement
   */
  applyPlayerMovement(player: RAPIER.RigidBody, direction: number, force: number = 0.002): void {
    const velocity = player.linvel();

    // Apply impulse for movement (Rapier uses impulses, not forces)
    // Scale the impulse to match Matter.js behavior
    const impulse = { x: direction * force * 10, y: 0 }; // Scale up for similar feel
    player.applyImpulse(impulse, true);
  }

  /**
   * Make player jump if grounded
   */
  jumpPlayer(player: RAPIER.RigidBody, impulse: number = 0.15): void {
    if (this.isGrounded(player)) {
      const velocity = player.linvel();
      // Set upward velocity for jump (negative Y is up in screen coords, but our gravity is +Y down)
      player.setLinvel({ x: velocity.x, y: -impulse * 10 }, true); // Scale for similar feel
    }
  }

  /**
   * Check if player is on the ground
   * Uses a simple downward ray cast
   */
  private isGrounded(player: RAPIER.RigidBody): boolean {
    // Simple velocity check - if moving up, not grounded
    const velocity = player.linvel();
    if (velocity.y < -0.1) return false; // Moving up

    // Check if there's ground below using raycasting
    // Cast a ray slightly below the player
    const translation = player.translation();
    const rayOrigin = { x: translation.x, y: translation.y };
    const rayDir = { x: 0, y: 1 }; // Down
    const maxDist = 0.55; // Slightly more than player radius (0.5m)

    // Get the world from the engine (we'll need to expose this)
    // For now, use a simple velocity heuristic
    return Math.abs(velocity.y) < 0.5; // Nearly stationary vertically
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
