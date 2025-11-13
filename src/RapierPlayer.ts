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
   * Get combined input from keyboard and joystick (both X and Y)
   * Returns { x, y } with analog values from joystick or -1/0/+1 from keyboard
   */
  private getInput(): { x: number; y: number } {
    let x = 0;
    let y = 0;

    // Keyboard input (digital)
    if (this.keys.left) x -= 1;
    if (this.keys.right) x += 1;

    // Joystick input (analog - overrides keyboard if active)
    if (this.joystick && this.joystick.isActive()) {
      const joystickInput = this.joystick.getInput();
      x = joystickInput.x;
      y = joystickInput.y;
    }

    return { x, y };
  }

  /**
   * Update player physics based on input
   * Called every frame
   *
   * PHYSICS MODEL:
   * 1. Movement force: F_move = movementForce * input (in X and Y!)
   * 2. Drag: Uses Rapier's built-in linearDamping (engine handles it)
   */
  update(dt: number): void {
    const body = this.playerController.body;
    const input = this.getInput(); // { x, y } - analog from joystick

    // Debug log every 60 frames (~1 second)
    if (Math.random() < 0.016) {
      const vel = body.linvel();
      const isDynamic = body.isDynamic();
      const gravScale = body.gravityScale();
      console.log(`[Player] isDynamic: ${isDynamic}, gravScale: ${gravScale}, vel: (${vel.x.toFixed(2)}, ${vel.y.toFixed(2)}), input: (${input.x.toFixed(2)}, ${input.y.toFixed(2)})`);
    }

    // Update linear damping to match drag coefficient
    body.setLinearDamping(this.config.drag);

    // Apply movement force in BOTH directions (no restrictions!)
    // Input is multiplied by force for fine analog control
    const forceX = this.config.movementForce * input.x;
    const forceY = this.config.movementForce * input.y;
    body.addForce({ x: forceX, y: forceY }, true);

    // That's it - let the engine handle everything!
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
    const input = this.getInput();
    const body = this.playerController.body;

    ctx.save();

    // Draw velocity vector (yellow)
    const velScale = 20; // Scale for visualization
    ctx.strokeStyle = 'yellow';
    ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.moveTo(screenPos.x, screenPos.y);
    ctx.lineTo(
      screenPos.x + velocity.x * velScale,
      screenPos.y + velocity.y * velScale
    );
    ctx.stroke();

    // Draw force vector (magenta/pink)
    const forceX = this.config.movementForce * input.x;
    const forceY = this.config.movementForce * input.y;
    const forceScale = 5; // Scale for visualization (forces are larger than velocities)
    ctx.strokeStyle = '#ff00ff'; // Magenta
    ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.moveTo(screenPos.x, screenPos.y);
    ctx.lineTo(
      screenPos.x + forceX * forceScale,
      screenPos.y + forceY * forceScale
    );
    ctx.stroke();

    // Calculate total force magnitude
    const forceMagnitude = Math.sqrt(forceX * forceX + forceY * forceY);

    // Get body status for debugging
    const bodyType = body.isDynamic() ? 'dynamic' : (body.isKinematic() ? 'kinematic' : 'static');
    const isAwake = !body.isSleeping();
    const mass = body.mass();
    const damping = body.linearDamping();
    const gravityScale = body.gravityScale();

    // Draw stats
    ctx.fillStyle = 'yellow';
    ctx.font = '12px monospace';
    let yOffset = -100;

    // Body status (important for debugging)
    ctx.fillStyle = body.isDynamic() ? '#00ff00' : '#ff0000';
    ctx.fillText(`Body: ${bodyType} (awake: ${isAwake})`, screenPos.x + 35, screenPos.y + yOffset);
    yOffset += 15;

    ctx.fillStyle = '#00ffff';
    ctx.fillText(`Mass: ${mass.toFixed(2)} kg`, screenPos.x + 35, screenPos.y + yOffset);
    yOffset += 15;

    ctx.fillText(`Damping: ${damping.toFixed(2)}`, screenPos.x + 35, screenPos.y + yOffset);
    yOffset += 15;

    ctx.fillText(`GravScale: ${gravityScale.toFixed(2)}`, screenPos.x + 35, screenPos.y + yOffset);
    yOffset += 15;

    ctx.fillStyle = 'yellow';
    ctx.fillText(`vX: ${velocity.x.toFixed(2)} m/s`, screenPos.x + 35, screenPos.y + yOffset);
    yOffset += 15;
    ctx.fillText(`vY: ${velocity.y.toFixed(2)} m/s`, screenPos.x + 35, screenPos.y + yOffset);
    yOffset += 15;

    ctx.fillStyle = '#ff00ff'; // Magenta for force
    ctx.fillText(`F: ${forceMagnitude.toFixed(1)} N`, screenPos.x + 35, screenPos.y + yOffset);

    ctx.restore();
  }
}
