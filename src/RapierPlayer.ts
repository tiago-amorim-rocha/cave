/**
 * Player controller for Rapier physics
 * Uses force-based movement and virtual joystick input
 */

import RAPIER from '@dimforge/rapier2d-compat';
import type { RapierPhysics, PlayerController } from './RapierPhysics';
import type { VirtualJoystick } from './VirtualJoystick';

export interface CharacterControllerConfig {
  /** Maximum horizontal speed in m/s */
  maxSpeed: number;
  /** Acceleration gain (how quickly to reach target speed) */
  accelGain: number;
  /** Air control multiplier (0-1) when not grounded */
  airControl: number;
  /** Jump impulse magnitude (upward velocity) */
  jumpImpulse: number;
  /** Jump input threshold (y-axis on joystick) */
  jumpThreshold: number;
}

export class RapierPlayer {
  private playerController: PlayerController;
  private physics: RapierPhysics;
  private joystick: VirtualJoystick | null = null;

  // Input state
  private keys = {
    left: false,
    right: false,
    jump: false,
  };

  // Jump debouncing
  private lastJumpTime = 0;
  private jumpCooldown = 200; // ms

  // Character controller config
  private config: CharacterControllerConfig = {
    maxSpeed: 4.0, // m/s, good for cave exploration
    accelGain: 8.0, // snappy but natural
    airControl: 0.3, // reduced control while jumping
    jumpImpulse: -6.0, // upward velocity (Y-down gravity)
    jumpThreshold: 0.6, // joystick Y threshold for jump
  };

  constructor(physics: RapierPhysics, x: number, y: number) {
    this.physics = physics;
    this.playerController = physics.createPlayer(x, y);
    this.setupInputListeners();
  }

  /**
   * Set virtual joystick (for mobile input)
   */
  setJoystick(joystick: VirtualJoystick): void {
    this.joystick = joystick;
  }

  /**
   * Setup keyboard input listeners
   */
  private setupInputListeners(): void {
    window.addEventListener('keydown', (e) => {
      this.handleKeyDown(e.key);
    });

    window.addEventListener('keyup', (e) => {
      this.handleKeyUp(e.key);
    });
  }

  /**
   * Handle key down events
   */
  private handleKeyDown(key: string): void {
    switch (key.toLowerCase()) {
      case 'a':
      case 'arrowleft':
        this.keys.left = true;
        break;
      case 'd':
      case 'arrowright':
        this.keys.right = true;
        break;
      case 'w':
      case 'arrowup':
      case ' ': // Space bar
        this.keys.jump = true;
        break;
    }
  }

  /**
   * Handle key up events
   */
  private handleKeyUp(key: string): void {
    switch (key.toLowerCase()) {
      case 'a':
      case 'arrowleft':
        this.keys.left = false;
        break;
      case 'd':
      case 'arrowright':
        this.keys.right = false;
        break;
      case 'w':
      case 'arrowup':
      case ' ':
        this.keys.jump = false;
        break;
    }
  }

  /**
   * Get combined input from keyboard and joystick
   */
  private getInput(): { x: number; jump: boolean } {
    let x = 0;
    let jump = false;

    // Keyboard input
    if (this.keys.left) x -= 1;
    if (this.keys.right) x += 1;
    if (this.keys.jump) jump = true;

    // Joystick input (overrides keyboard if active)
    if (this.joystick && this.joystick.isActive()) {
      const joystickInput = this.joystick.getInput();
      x = joystickInput.x;

      // Jump when pushing joystick up
      if (joystickInput.y < -this.config.jumpThreshold) {
        jump = true;
      }
    }

    return { x, jump };
  }

  /**
   * Update player physics based on input
   * Called every frame
   */
  update(dt: number): void {
    const body = this.playerController.body;
    const input = this.getInput();
    const isGrounded = this.physics.isPlayerGrounded();

    // Get current velocity
    const velocity = body.linvel();
    const mass = this.physics.getPlayerMass();

    // Horizontal movement with force-based system
    if (input.x !== 0) {
      const targetVx = input.x * this.config.maxSpeed;

      // Calculate acceleration needed to reach target velocity
      let accelGain = this.config.accelGain;

      // Reduce acceleration in air
      if (!isGrounded) {
        accelGain *= this.config.airControl;
      }

      const ax = (targetVx - velocity.x) * accelGain;

      // Apply force (F = ma)
      body.addForce({ x: ax * mass, y: 0 }, true);
    } else if (isGrounded) {
      // Apply ground friction when no input
      const friction = 0.9;
      body.setLinvel({ x: velocity.x * friction, y: velocity.y }, true);
    }

    // Enforce max speed
    if (Math.abs(velocity.x) > this.config.maxSpeed) {
      const sign = velocity.x > 0 ? 1 : -1;
      body.setLinvel({ x: sign * this.config.maxSpeed, y: velocity.y }, true);
    }

    // Jump
    const now = Date.now();
    if (input.jump && isGrounded && (now - this.lastJumpTime > this.jumpCooldown)) {
      // Apply upward impulse (negative Y in our coordinate system)
      body.applyImpulse({ x: 0, y: this.config.jumpImpulse * mass }, true);
      this.lastJumpTime = now;
    }
  }

  /**
   * Get player position
   */
  getPosition(): { x: number; y: number } {
    const translation = this.playerController.body.translation();
    return {
      x: translation.x,
      y: translation.y
    };
  }

  /**
   * Get player rigid body
   */
  getBody(): RAPIER.RigidBody {
    return this.playerController.body;
  }

  /**
   * Get player capsule radius (for rendering)
   */
  getRadius(): number {
    // Capsule radius is 0.6m
    return 0.6;
  }

  /**
   * Get player capsule height (for rendering)
   */
  getHeight(): number {
    // Total capsule height is 1.2m (2 × halfHeight)
    return 1.2;
  }

  /**
   * Check if player is grounded
   */
  isGrounded(): boolean {
    return this.physics.isPlayerGrounded();
  }

  /**
   * Respawn player at new position
   */
  respawn(x: number, y: number): void {
    const body = this.playerController.body;
    body.setTranslation({ x, y }, true);
    body.setLinvel({ x: 0, y: 0 }, true);
    body.setAngvel(0, true);
    console.log(`Player respawned at (${x.toFixed(1)}, ${y.toFixed(1)})`);
  }

  /**
   * Debug draw player colliders
   */
  debugDraw(ctx: CanvasRenderingContext2D, camera: any, canvasWidth: number, canvasHeight: number): void {
    const pos = this.getPosition();
    const screenPos = camera.worldToScreen(pos.x, pos.y, canvasWidth, canvasHeight);
    const isGrounded = this.isGrounded();

    ctx.save();

    // Draw grounded indicator
    if (isGrounded) {
      ctx.fillStyle = 'lime';
      ctx.font = '14px monospace';
      ctx.fillText('GROUNDED', screenPos.x + 30, screenPos.y - 40);
    }

    // Draw velocity vector
    const velocity = this.playerController.body.linvel();
    const velScale = 10; // Scale for visualization
    ctx.strokeStyle = 'yellow';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(screenPos.x, screenPos.y);
    ctx.lineTo(
      screenPos.x + velocity.x * velScale,
      screenPos.y + velocity.y * velScale
    );
    ctx.stroke();

    // Draw velocity text
    ctx.fillStyle = 'yellow';
    ctx.font = '12px monospace';
    ctx.fillText(
      `vel: (${velocity.x.toFixed(2)}, ${velocity.y.toFixed(2)})`,
      screenPos.x + 30,
      screenPos.y - 20
    );

    ctx.restore();
  }
}
