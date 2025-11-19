/**
 * Simple Capsule Controller
 *
 * A minimal controller that:
 * - Uses dynamic physics with zero gravity
 * - Force-based movement with high damping for responsive controls
 * - Properly collides with cave walls (static terrain)
 * - Free movement in all directions
 * - Fixed rotation (no spinning)
 *
 * Perfect for testing and prototyping without complex physics.
 */

import {
  b2World,
  b2BodyDef,
  b2FixtureDef,
  b2PolygonShape,
  b2CircleShape,
  b2BodyType,
  b2Vec2,
  type b2Body,
} from '@box2d/core';
import type { IPlayerController } from './IPlayerController';

/**
 * Capsule controller configuration
 */
export interface CapsuleConfig {
  /** Circle radius (metres) */
  radius?: number;
  /** Movement speed (metres/second) */
  speed?: number;
  /** Rotation speed (degrees/second) */
  rotationSpeed?: number;
}

/**
 * Default configuration
 */
const DEFAULT_CONFIG: Required<CapsuleConfig> = {
  radius: 1.0,     // 1.0m radius circle
  speed: 5.0,      // 5 m/s movement speed
  rotationSpeed: 180.0, // 180 deg/s rotation speed
};

/**
 * Simple Capsule Controller
 *
 * Features:
 * - Dynamic body with zero gravity (free flight)
 * - Force-based movement with high damping
 * - Properly collides with static terrain
 * - WASD/Joystick input
 * - Fixed rotation for stability
 */
export class CapsuleController implements IPlayerController {
  private world: b2World;
  private body: b2Body;
  private config: Required<CapsuleConfig>;

  // Input state
  private inputX = 0; // -1 to 1
  private inputY = 0; // -1 to 1
  private joystick = { x: 0, y: 0 };

  // Direction tracking (angle in radians, 0 = right, PI/2 = down, etc.)
  private direction = 0; // Default facing right

  constructor(
    world: b2World,
    x: number,
    y: number,
    config: CapsuleConfig = {}
  ) {
    this.world = world;
    this.config = { ...DEFAULT_CONFIG, ...config };

    // Create dynamic body with no gravity - pure force-driven movement
    const bodyDef: b2BodyDef = {
      type: b2BodyType.b2_dynamicBody,
      position: { x, y },
      angle: 0,
      linearDamping: 1.0,    // Low dampening for responsive movement
      angularDamping: 0.0,   // No angular damping
      fixedRotation: true,   // Lock rotation completely
      gravityScale: 0.0,     // No gravity (free flight)
      bullet: true,          // Enable CCD to prevent tunneling through walls
    };

    this.body = world.CreateBody(bodyDef);

    // Create circle shape with 1m radius
    const circleShape = new b2CircleShape();
    circleShape.m_radius = this.config.radius;

    this.body.CreateFixture({
      shape: circleShape,
      density: 1.0,
      friction: 0.3,
      restitution: 0.0,
    });

    console.log(`[CapsuleController] Created at (${x.toFixed(2)}, ${y.toFixed(2)}) - radius: ${this.config.radius}m`);

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

    // Update direction based on movement (only if actually moving)
    if (magnitude > 0.1) {
      this.direction = Math.atan2(moveY, moveX);
    }

    // Apply forces for responsive movement
    const forceMagnitude = 25.0;
    const force = new b2Vec2(
      moveX * forceMagnitude,
      moveY * forceMagnitude
    );

    this.body.ApplyForceToCenter(force, true);
  }

  /**
   * Get player position in world coordinates
   */
  getPosition(): { x: number; y: number } {
    const pos = this.body.GetPosition();
    return { x: pos.x, y: pos.y };
  }

  /**
   * Get circle radius (for rendering)
   */
  getRadius(): number {
    return this.config.radius;
  }

  /**
   * Get circle height (diameter)
   */
  getHeight(): number {
    return this.config.radius * 2;
  }

  /**
   * Get current direction angle in radians
   */
  getDirection(): number {
    return this.direction;
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
   * Check if grounded (this controller has free flight)
   */
  isGrounded(): boolean {
    return false; // Free-flying controller
  }

  /**
   * Get controller type name
   */
  getTypeName(): string {
    return 'Capsule Controller';
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
    const screen = worldToScreen(pos.x, pos.y);

    ctx.save();
    ctx.translate(screen.x, screen.y);

    // Draw circle body
    ctx.strokeStyle = '#00ff00';
    ctx.lineWidth = 2;
    const radiusPixels = this.config.radius * 50; // Assuming ~50 pixels per meter
    ctx.beginPath();
    ctx.arc(0, 0, radiusPixels, 0, Math.PI * 2);
    ctx.stroke();

    // Draw direction indicator (triangle pointing in movement direction)
    ctx.rotate(this.direction);

    ctx.fillStyle = '#ff00ff';
    ctx.beginPath();
    ctx.moveTo(radiusPixels, 0); // Tip of triangle at edge of circle
    ctx.lineTo(radiusPixels - 15, -10); // Left base
    ctx.lineTo(radiusPixels - 15, 10); // Right base
    ctx.closePath();
    ctx.fill();

    ctx.restore();
  }
}
