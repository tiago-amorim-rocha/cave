/**
 * Player controller for Rapier physics
 * SIMPLIFIED: Force + Drag model for left/right movement only
 *
 * Physics:
 * - Movement force applied when input detected
 * - Drag (resistance) always applied proportional to velocity
 * - Terminal velocity: v_max = movementForce / drag
 */

import RAPIER from '@dimforge/rapier2d-compat';
import type { RapierPhysics, PlayerController } from './RapierPhysics';
import type { VirtualJoystick } from './VirtualJoystick';

export interface CharacterControllerConfig {
  /** Movement force applied when moving (N) */
  movementForce: number;
  /** Drag coefficient (resistance proportional to velocity) */
  drag: number;
}

export class RapierPlayer {
  private playerController: PlayerController;
  private physics: RapierPhysics;
  private joystick: VirtualJoystick | null = null;

  // Input state (only left/right now)
  private keys = {
    left: false,
    right: false,
  };

  // Character controller config - just TWO variables!
  private config: CharacterControllerConfig = {
    movementForce: 20.0, // Newtons - experiment with this!
    drag: 5.0, // drag coefficient - experiment with this!
    // Terminal velocity will be: v_max = 20.0 / 5.0 = 4.0 m/s
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
   * Handle key down events (left/right only)
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
    }
  }

  /**
   * Handle key up events (left/right only)
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
    }
  }

  /**
   * Get combined input from keyboard and joystick (horizontal only)
   * Returns -1 (left), 0 (neutral), or +1 (right)
   */
  private getInput(): number {
    let x = 0;

    // Keyboard input
    if (this.keys.left) x -= 1;
    if (this.keys.right) x += 1;

    // Joystick input (overrides keyboard if active)
    if (this.joystick && this.joystick.isActive()) {
      const joystickInput = this.joystick.getInput();
      x = joystickInput.x;
    }

    return x;
  }

  /**
   * Update player physics based on input
   * Called every frame
   *
   * PHYSICS MODEL:
   * 1. Movement force: F_move = movementForce * input_direction
   * 2. Drag force: F_drag = -drag * velocity
   * 3. Terminal velocity: v_max = movementForce / drag
   */
  update(dt: number): void {
    const body = this.playerController.body;
    const input = this.getInput(); // -1, 0, or +1
    const velocity = body.linvel();
    const mass = body.mass();

    // Apply movement force when input detected
    if (input !== 0) {
      const movementForce = this.config.movementForce * input;
      body.addForce({ x: movementForce, y: 0 }, true);
    }

    // Always apply drag (resistance proportional to velocity)
    const dragForce = -this.config.drag * velocity.x;
    body.addForce({ x: dragForce, y: 0 }, true);
  }

  /**
   * Get movement force (for debug UI)
   */
  getMovementForce(): number {
    return this.config.movementForce;
  }

  /**
   * Set movement force (for debug UI)
   */
  setMovementForce(force: number): void {
    this.config.movementForce = force;
  }

  /**
   * Get drag coefficient (for debug UI)
   */
  getDrag(): number {
    return this.config.drag;
  }

  /**
   * Set drag coefficient (for debug UI)
   */
  setDrag(drag: number): void {
    this.config.drag = drag;
  }

  /**
   * Get theoretical max speed: v_max = force / drag
   */
  getTheoreticalMaxSpeed(): number {
    return this.config.drag > 0 ? this.config.movementForce / this.config.drag : Infinity;
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
   * Debug draw player info
   */
  debugDraw(ctx: CanvasRenderingContext2D, camera: any, canvasWidth: number, canvasHeight: number): void {
    const pos = this.getPosition();
    const screenPos = camera.worldToScreen(pos.x, pos.y, canvasWidth, canvasHeight);
    const velocity = this.playerController.body.linvel();
    const isGrounded = this.isGrounded();

    ctx.save();

    // Draw velocity vector (horizontal only now)
    const velScale = 20; // Scale for visualization
    ctx.strokeStyle = 'yellow';
    ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.moveTo(screenPos.x, screenPos.y);
    ctx.lineTo(
      screenPos.x + velocity.x * velScale,
      screenPos.y
    );
    ctx.stroke();

    // Draw stats
    ctx.fillStyle = 'white';
    ctx.font = '12px monospace';
    let yOffset = -60;

    ctx.fillText(`Force: ${this.config.movementForce.toFixed(1)} N`, screenPos.x + 35, screenPos.y + yOffset);
    yOffset += 15;
    ctx.fillText(`Drag: ${this.config.drag.toFixed(1)}`, screenPos.x + 35, screenPos.y + yOffset);
    yOffset += 15;
    ctx.fillText(`v_max: ${this.getTheoreticalMaxSpeed().toFixed(2)} m/s`, screenPos.x + 35, screenPos.y + yOffset);
    yOffset += 15;
    ctx.fillStyle = 'yellow';
    ctx.fillText(`v: ${velocity.x.toFixed(2)} m/s`, screenPos.x + 35, screenPos.y + yOffset);

    // Grounded indicator
    if (isGrounded) {
      ctx.fillStyle = 'lime';
      ctx.fillText('GROUNDED', screenPos.x + 35, screenPos.y - 80);
    }

    ctx.restore();
  }
}
