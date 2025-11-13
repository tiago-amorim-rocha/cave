/**
 * Player controller - just a ball with force control!
 * Same physics as test balls, controlled with forces.
 */

import RAPIER from '@dimforge/rapier2d-compat';
import type { RapierPhysics, PlayerController } from './RapierPhysics';
import type { VirtualJoystick } from './VirtualJoystick';

export interface CharacterControllerConfig {
  /** Movement force applied when moving (N) */
  movementForce: number;
  /** Drag coefficient (linear damping) */
  drag: number;
  /** Ground attraction force to keep player hugging terrain (N) */
  groundAttractionForce: number;
  /** Foot sensor radius multiplier (relative to capsule radius) */
  footSensorRadiusMultiplier: number;
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

  // Character controller config
  private config: CharacterControllerConfig = {
    movementForce: 20.0, // Newtons - experiment with this!
    drag: 5.0, // drag coefficient - experiment with this!
    groundAttractionForce: 15.0, // Newtons - keeps player hugging uneven ground
    footSensorRadiusMultiplier: 1.3, // Ball sensor radius = capsule radius * this
  };

  constructor(physics: RapierPhysics, x: number, y: number) {
    this.physics = physics;
    this.playerController = physics.createPlayer(x, y, this.config.footSensorRadiusMultiplier);
    this.setupInputListeners();
    // Apply initial drag value
    this.playerController.body.setLinearDamping(this.config.drag);
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
        if (!this.keys.left) {
          console.log('[Player] KEY DOWN: LEFT');
        }
        this.keys.left = true;
        break;
      case 'd':
      case 'arrowright':
        if (!this.keys.right) {
          console.log('[Player] KEY DOWN: RIGHT');
        }
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
        console.log('[Player] KEY UP: LEFT');
        this.keys.left = false;
        break;
      case 'd':
      case 'arrowright':
        console.log('[Player] KEY UP: RIGHT');
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
   */
  update(dt: number): void {
    const body = this.playerController.body;
    const input = this.getInput(); // { x, y } - analog from joystick

    // CRITICAL: Reset forces each frame before applying new ones
    // Rapier's addForce() accumulates - forces don't auto-reset after timesteps!
    body.resetForces(true); // true = keep body awake

    // Apply ground attraction force to keep player hugging uneven terrain
    const groundNormal = this.physics.getGroundNormal();
    if (groundNormal && this.config.groundAttractionForce > 0) {
      // Apply force toward ground (negative normal direction)
      const attractionX = -groundNormal.x * this.config.groundAttractionForce;
      const attractionY = -groundNormal.y * this.config.groundAttractionForce;
      body.addForce({ x: attractionX, y: attractionY }, true);
    }

    // Apply movement forces
    const forceX = this.config.movementForce * input.x;
    const forceY = this.config.movementForce * input.y;
    body.addForce({ x: forceX, y: forceY }, true);
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
   * Set drag coefficient (linear damping)
   */
  setDrag(drag: number): void {
    this.config.drag = drag;
    this.playerController.body.setLinearDamping(drag);
  }

  /**
   * Get ground attraction force (for debug UI)
   */
  getGroundAttractionForce(): number {
    return this.config.groundAttractionForce;
  }

  /**
   * Set ground attraction force (for debug UI)
   */
  setGroundAttractionForce(force: number): void {
    this.config.groundAttractionForce = force;
  }

  /**
   * Get foot sensor radius multiplier (for debug UI)
   */
  getFootSensorRadiusMultiplier(): number {
    return this.config.footSensorRadiusMultiplier;
  }

  /**
   * Set foot sensor radius multiplier (for debug UI)
   * Dynamically updates the sensor radius
   */
  setFootSensorRadiusMultiplier(multiplier: number): void {
    this.config.footSensorRadiusMultiplier = multiplier;
    this.physics.updateFootSensorRadius(multiplier);
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
   * Get player ball radius (for rendering)
   */
  getRadius(): number {
    // Ball radius is 0.6m
    return 0.6;
  }

  /**
   * Get player ball height (for rendering) - same as radius since it's a ball
   */
  getHeight(): number {
    // Ball, so height = 2 × radius
    return 1.2;
  }

  /**
   * Check if player is grounded
   */
  isGrounded(): boolean {
    return this.physics.isPlayerGrounded();
  }

  /**
   * Get ground normal (for debug visualization)
   */
  getGroundNormal(): { x: number; y: number } | null {
    return this.physics.getGroundNormal();
  }

  /**
   * Get foot sensor collider (for debug visualization)
   */
  getFootSensor(): any {
    return this.playerController.colliders.footSensor;
  }

  /**
   * Respawn player at new position
   */
  respawn(x: number, y: number): void {
    const body = this.playerController.body;
    body.setTranslation({ x, y }, true);
    body.setLinvel({ x: 0, y: 0 }, true);
    body.setAngvel(0, true);
  }
}
