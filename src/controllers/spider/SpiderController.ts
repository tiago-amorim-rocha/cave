/**
 * Spider Controller - Multi-Body Character Controller
 *
 * CURRENT STATE: Minimal stub for visual testing (Phase 2.5)
 * - Creates spider rig using SpiderBuilder
 * - Implements IPlayerController interface
 * - Does NOT move yet (update() is empty)
 * - Use physics debug view to see the rig structure
 *
 * TODO Phase 3: Implement full controller
 * - computeLegForces() - force distribution
 * - applyLegTorques() - Jacobian transpose kinematics
 * - Joint limit springs
 * - Input handling
 */

import RAPIER from '@dimforge/rapier2d-compat';
import type { RapierEngine } from '../../physics/engine';
import type { IPlayerController } from '../IPlayerController';
import type { VirtualJoystick } from '../../VirtualJoystick';
import type { SpiderAssembly, SpiderConfig } from './SpiderTypes';
import { DEFAULT_SPIDER_CONFIG } from './SpiderTypes';
import { buildSpider } from './SpiderBuilder';

/**
 * Spider Controller (Minimal Stub)
 *
 * Creates and manages a multi-body spider rig.
 * Currently just creates the physical structure - movement logic TODO in Phase 3.
 */
export class SpiderController implements IPlayerController {
  private engine: RapierEngine;
  private spider: SpiderAssembly;
  private config: SpiderConfig;
  private joystick: VirtualJoystick | null = null;

  constructor(engine: RapierEngine, x: number, y: number, config?: SpiderConfig) {
    this.engine = engine;
    this.config = config || DEFAULT_SPIDER_CONFIG;

    console.log('[SpiderController] Creating spider controller at (', x.toFixed(2), ',', y.toFixed(2), ')');

    // Build the spider rig
    const world = engine.getWorld();
    if (!world) {
      throw new Error('[SpiderController] Physics world not initialized');
    }

    this.spider = buildSpider(world, x, y, this.config);

    console.log('[SpiderController] Spider controller created successfully');
    console.log('[SpiderController] NOTE: Spider does not move yet - Phase 3 will implement movement');
    console.log('[SpiderController] Enable physics debug view to see the rig structure');
  }

  /**
   * Update controller (currently does nothing - spider is frozen)
   * TODO Phase 3: Implement force distribution and torque application
   */
  update(dt: number): void {
    // TODO Phase 3: Implement movement logic
    // 1. Read input from joystick
    // 2. computeLegForces() - distribute forces between legs
    // 3. applyLegTorques() - convert forces to joint torques using Jacobian
    // 4. Apply soft joint limits
  }

  /**
   * Get player position (returns body position)
   */
  getPosition(): { x: number; y: number } {
    const translation = this.spider.body.translation();
    return {
      x: translation.x,
      y: translation.y
    };
  }

  /**
   * Get player radius (for rendering)
   * Returns body size (1m × 1m square, so radius ≈ 0.7m for enclosing circle)
   */
  getRadius(): number {
    return 0.7; // Body is 1m × 1m, diagonal = √2 ≈ 1.4, radius ≈ 0.7
  }

  /**
   * Get player height (for rendering and collision)
   * Spider height depends on leg pose, but body is 1m tall
   */
  getHeight(): number {
    return 1.0; // Body height
  }

  /**
   * Get main player rigid body (returns spider body)
   */
  getBody(): RAPIER.RigidBody {
    return this.spider.body;
  }

  /**
   * Get all rigid bodies managed by this controller
   * Returns all spider bodies (body + legs + feet)
   */
  getAllBodies(): RAPIER.RigidBody[] {
    return this.spider.allBodies;
  }

  /**
   * Respawn spider at new position
   */
  respawn(x: number, y: number): void {
    console.log('[SpiderController] Respawn not yet implemented');
    // TODO Phase 3: Implement respawn
    // Need to reposition all bodies maintaining relative positions
  }

  /**
   * Set virtual joystick for mobile input
   */
  setJoystick(joystick: VirtualJoystick): void {
    this.joystick = joystick;
  }

  /**
   * Check if player is grounded
   * TODO Phase 3: Implement ground detection via foot sensors
   */
  isGrounded(): boolean {
    // TODO: Check if feet are in contact with ground
    return true; // Assume grounded for now (feet are kinematic)
  }

  /**
   * Cleanup controller (remove all spider bodies)
   */
  destroy(): void {
    const world = this.engine.getWorld();
    if (!world) return;

    console.log('[SpiderController] Destroying spider (', this.spider.allBodies.length, 'bodies)');

    // Remove all bodies (colliders are removed automatically by Rapier)
    for (const body of this.spider.allBodies) {
      world.removeRigidBody(body);
    }

    console.log('[SpiderController] Spider destroyed');
  }

  /**
   * Get controller type name
   */
  getTypeName(): string {
    return 'Spider Controller (Stub)';
  }

  /**
   * Optional debug draw
   * Spider bodies will be visible in physics debug view automatically
   */
  debugDraw?(ctx: CanvasRenderingContext2D, worldToScreen: (x: number, y: number) => { x: number; y: number }): void {
    // Optional: Draw custom debug info
    // For now, physics debug view is sufficient
  }
}
