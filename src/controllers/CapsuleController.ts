/**
 * Simple Capsule Kinematic Controller
 *
 * A minimal controller that:
 * - Uses kinematic physics (no gravity, no forces)
 * - Provides direct position-based movement
 * - Collides with cave walls (static terrain)
 * - Free movement in all directions
 *
 * Perfect for testing and prototyping without complex physics.
 */

import {
  b2World,
  b2BodyDef,
  b2FixtureDef,
  b2PolygonShape,
  b2BodyType,
  b2Vec2,
  type b2Body,
} from '@box2d/core';
import type { IPlayerController } from './IPlayerController';

/**
 * Capsule controller configuration
 */
export interface CapsuleConfig {
  /** Capsule width (metres) */
  width?: number;
  /** Capsule height (metres) */
  height?: number;
  /** Movement speed (metres/second) */
  speed?: number;
  /** Rotation speed (degrees/second) */
  rotationSpeed?: number;
}

/**
 * Default configuration
 */
const DEFAULT_CONFIG: Required<CapsuleConfig> = {
  width: 0.5,      // 0.5m wide
  height: 1.0,     // 1.0m tall (2:1 aspect ratio)
  speed: 5.0,      // 5 m/s movement speed
  rotationSpeed: 180.0, // 180 deg/s rotation speed
};

/**
 * Simple Capsule Kinematic Controller
 *
 * Features:
 * - Kinematic body (not affected by gravity/forces)
 * - Direct velocity-based movement
 * - Collides with static terrain
 * - WASD/Joystick input
 */
export class CapsuleController implements IPlayerController {
  private world: b2World;
  private body: b2Body;
  private config: Required<CapsuleConfig>;

  // Input state
  private inputX = 0; // -1 to 1
  private inputY = 0; // -1 to 1
  private joystick = { x: 0, y: 0 };

  constructor(
    world: b2World,
    x: number,
    y: number,
    config: CapsuleConfig = {}
  ) {
    this.world = world;
    this.config = { ...DEFAULT_CONFIG, ...config };

    // Create kinematic body
    const bodyDef: b2BodyDef = {
      type: b2BodyType.b2_kinematicBody, // Kinematic: not affected by forces/gravity
      position: { x, y },
      angle: 0,
      linearDamping: 0,
      angularDamping: 0,
    };

    this.body = world.CreateBody(bodyDef);

    // Create capsule-like shape (rounded rectangle)
    const shape = new b2PolygonShape();
    shape.SetAsBox(
      this.config.width / 2,  // Half-width
      this.config.height / 2  // Half-height
    );

    const fixtureDef: b2FixtureDef = {
      shape,
      density: 1.0,      // Doesn't matter for kinematic bodies
      friction: 0.3,     // Wall sliding friction
      restitution: 0.0,  // No bounce
    };

    this.body.CreateFixture(fixtureDef);

    console.log(`[CapsuleController] Created at (${x.toFixed(2)}, ${y.toFixed(2)}) - size: ${this.config.width}m × ${this.config.height}m`);

    // Listen for keyboard input
    this.setupKeyboardInput();
  }

  /**
   * Setup keyboard input listeners
   */
  private setupKeyboardInput(): void {
    window.addEventListener('keydown', (e) => this.onKeyDown(e));
    window.addEventListener('keyup', (e) => this.onKeyUp(e));
  }

  /**
   * Handle keydown events
   */
  private onKeyDown(e: KeyboardEvent): void {
    switch (e.key.toLowerCase()) {
      case 'w':
      case 'arrowup':
        this.inputY = -1; // Move up (Y-up in rendering, Y-down in physics)
        break;
      case 's':
      case 'arrowdown':
        this.inputY = 1; // Move down
        break;
      case 'a':
      case 'arrowleft':
        this.inputX = -1; // Move left
        break;
      case 'd':
      case 'arrowright':
        this.inputX = 1; // Move right
        break;
    }
  }

  /**
   * Handle keyup events
   */
  private onKeyUp(e: KeyboardEvent): void {
    switch (e.key.toLowerCase()) {
      case 'w':
      case 'arrowup':
        if (this.inputY === -1) this.inputY = 0;
        break;
      case 's':
      case 'arrowdown':
        if (this.inputY === 1) this.inputY = 0;
        break;
      case 'a':
      case 'arrowleft':
        if (this.inputX === -1) this.inputX = 0;
        break;
      case 'd':
      case 'arrowright':
        if (this.inputX === 1) this.inputX = 0;
        break;
    }
  }

  /**
   * Update controller (called at 60Hz)
   * @param dt - Delta time in milliseconds (16.67ms for 60Hz)
   */
  update(dt: number): void {
    // Convert dt from milliseconds to seconds
    const dtSec = dt / 1000;

    // Combine keyboard and joystick input
    let moveX = this.inputX + this.joystick.x;
    let moveY = this.inputY + this.joystick.y;

    // Normalize if magnitude > 1 (diagonal movement)
    const magnitude = Math.sqrt(moveX * moveX + moveY * moveY);
    if (magnitude > 1) {
      moveX /= magnitude;
      moveY /= magnitude;
    }

    // Set velocity directly (kinematic bodies use velocity, not forces)
    const velocity = new b2Vec2(
      moveX * this.config.speed,
      moveY * this.config.speed
    );

    this.body.SetLinearVelocity(velocity);

    // Optional: Rotate to face movement direction
    // if (magnitude > 0.1) {
    //   const targetAngle = Math.atan2(moveY, moveX);
    //   this.body.SetTransform(this.body.GetPosition(), targetAngle);
    // }
  }

  /**
   * Get player position in world coordinates
   */
  getPosition(): { x: number; y: number } {
    const pos = this.body.GetPosition();
    return { x: pos.x, y: pos.y };
  }

  /**
   * Get capsule radius (for rendering)
   * Returns the width/2 (used for collision detection visualization)
   */
  getRadius(): number {
    return this.config.width / 2;
  }

  /**
   * Get capsule height
   */
  getHeight(): number {
    return this.config.height;
  }

  /**
   * Get the main rigid body
   */
  getBody(): b2Body {
    return this.body;
  }

  /**
   * Get all bodies (just the one capsule body)
   */
  getAllBodies(): b2Body[] {
    return [this.body];
  }

  /**
   * Respawn at new position
   */
  respawn(x: number, y: number): void {
    // Reset position and rotation
    this.body.SetTransformXY(x, y, 0);

    // Reset velocities
    this.body.SetLinearVelocity(new b2Vec2(0, 0));
    this.body.SetAngularVelocity(0);

    console.log(`[CapsuleController] Respawned at (${x.toFixed(2)}, ${y.toFixed(2)})`);
  }

  /**
   * Set virtual joystick input
   */
  setJoystick(joystick: { x: number; y: number }): void {
    this.joystick = joystick;
  }

  /**
   * Check if grounded (kinematic controller is never "grounded" in physics sense)
   */
  isGrounded(): boolean {
    return false; // Kinematic controllers fly freely
  }

  /**
   * Get controller type name
   */
  getTypeName(): string {
    return 'Capsule (Kinematic)';
  }

  /**
   * Cleanup controller
   */
  destroy(): void {
    console.log('[CapsuleController] Destroying controller');

    // Remove keyboard listeners
    window.removeEventListener('keydown', (e) => this.onKeyDown(e));
    window.removeEventListener('keyup', (e) => this.onKeyUp(e));

    // Destroy physics body
    if (this.body) {
      this.world.DestroyBody(this.body);
    }
  }

  /**
   * Optional debug draw
   */
  debugDraw(
    ctx: CanvasRenderingContext2D,
    worldToScreen: (x: number, y: number) => { x: number; y: number }
  ): void {
    const pos = this.body.GetPosition();
    const angle = this.body.GetAngle();
    const screen = worldToScreen(pos.x, pos.y);

    ctx.save();
    ctx.translate(screen.x, screen.y);
    ctx.rotate(angle);

    // Draw capsule body
    ctx.strokeStyle = '#00ff00';
    ctx.lineWidth = 2;
    ctx.strokeRect(
      -this.config.width * 25, // Assuming ~50 pixels per meter
      -this.config.height * 25,
      this.config.width * 50,
      this.config.height * 50
    );

    // Draw direction indicator
    ctx.strokeStyle = '#ff00ff';
    ctx.beginPath();
    ctx.moveTo(0, 0);
    ctx.lineTo(30, 0);
    ctx.stroke();

    ctx.restore();
  }
}
