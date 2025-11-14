/**
 * Consolidated Player Controller
 * All player-specific physics, body creation, ground detection, and movement in one file
 *
 * This file contains:
 * - Player body/sensor creation (capsule + foot sensor)
 * - Ground detection via raycasts
 * - Force-based character controller
 * - Input handling (keyboard + joystick)
 * - All player-specific configuration
 *
 * Input handling is included but could be separated if desired.
 */

import RAPIER from '@dimforge/rapier2d-compat';
import type { RapierEngine } from './physics/engine';
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

export interface PlayerColliders {
  body: RAPIER.Collider;
  footSensor: RAPIER.Collider;
}

/**
 * Consolidated player controller with all player-specific physics logic
 */
export class PlayerController {
  private engine: RapierEngine;
  private body: RAPIER.RigidBody;
  private colliders: PlayerColliders;
  private joystick: VirtualJoystick | null = null;

  // Player dimensions (in metres)
  private readonly capsuleRadius = 0.6;
  private readonly capsuleHalfHeight = 0.4;

  // Input state (left/right movement)
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

  constructor(engine: RapierEngine, x: number, y: number) {
    this.engine = engine;

    // Create player body and colliders
    const result = this.createPlayerBody(x, y);
    this.body = result.body;
    this.colliders = result.colliders;

    // Setup input listeners
    this.setupInputListeners();

    // Apply initial drag value
    this.body.setLinearDamping(this.config.drag);
  }

  /**
   * Create player with capsule shape, locked rotation, and foot sensor
   * This replaces the createPlayer() method from engine.ts
   */
  private createPlayerBody(x: number, y: number): { body: RAPIER.RigidBody; colliders: PlayerColliders } {
    const world = this.engine.getWorld();
    if (!world) {
      throw new Error('[PlayerController] Physics world not initialized!');
    }

    // Create dynamic rigid body with locked rotation
    const rbDesc = RAPIER.RigidBodyDesc.dynamic()
      .setTranslation(x, y)
      .setCcdEnabled(true) // Enable continuous collision detection
      .lockRotations(); // Lock rotation to prevent capsule from tipping

    const rigidBody = world.createRigidBody(rbDesc);

    // Create capsule collider (no friction for smooth movement, no bounce)
    const colliderDesc = RAPIER.ColliderDesc.capsule(this.capsuleHalfHeight, this.capsuleRadius)
      .setFriction(0.0)
      .setRestitution(0.0)
      .setDensity(1);

    const bodyCollider = world.createCollider(colliderDesc, rigidBody);

    // Create ball foot sensor for ground detection
    // Ball sensor smooths normals over uneven terrain and doesn't catch on spikes
    // Position sensor at bottom of cylindrical part of capsule
    const sensorRadius = this.capsuleRadius * this.config.footSensorRadiusMultiplier;
    const sensorOffsetY = this.capsuleHalfHeight; // Exactly at bottom of cylinder

    const sensorDesc = RAPIER.ColliderDesc.ball(sensorRadius)
      .setTranslation(0, sensorOffsetY)
      .setSensor(true);

    const footSensor = world.createCollider(sensorDesc, rigidBody);

    console.log(`[PlayerController] Created player at (${x.toFixed(2)}, ${y.toFixed(2)}) with capsule radius ${this.capsuleRadius}m and foot sensor radius ${sensorRadius.toFixed(2)}m`);

    return {
      body: rigidBody,
      colliders: {
        body: bodyCollider,
        footSensor: footSensor,
      },
    };
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
          console.log('[PlayerController] KEY DOWN: LEFT');
        }
        this.keys.left = true;
        break;
      case 'd':
      case 'arrowright':
        if (!this.keys.right) {
          console.log('[PlayerController] KEY DOWN: RIGHT');
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
        console.log('[PlayerController] KEY UP: LEFT');
        this.keys.left = false;
        break;
      case 'd':
      case 'arrowright':
        console.log('[PlayerController] KEY UP: RIGHT');
        this.keys.right = false;
        break;
    }
  }

  /**
   * Set virtual joystick (for mobile input)
   */
  setJoystick(joystick: VirtualJoystick): void {
    this.joystick = joystick;
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
   * Check if player is grounded using foot sensor
   */
  isGrounded(): boolean {
    return this.engine.isSensorActive(this.colliders.footSensor);
  }

  /**
   * Get averaged ground normal from foot sensor via raycasts
   * Returns null if no valid ground contacts exist
   */
  getGroundNormal(): { x: number; y: number } | null {
    return this.engine.getGroundNormal(this.colliders.footSensor);
  }

  /**
   * Update player physics based on input
   */
  update(dt: number): void {
    const input = this.getInput(); // { x, y } - analog from joystick

    // CRITICAL: Reset forces each frame before applying new ones
    // Rapier's addForce() accumulates - forces don't auto-reset after timesteps!
    this.body.resetForces(true); // true = keep body awake

    // Apply ground attraction force to keep player hugging uneven terrain
    const groundNormal = this.getGroundNormal();

    if (groundNormal && this.config.groundAttractionForce > 0) {
      // Apply force toward ground (negative normal direction)
      const attractionX = -groundNormal.x * this.config.groundAttractionForce;
      const attractionY = -groundNormal.y * this.config.groundAttractionForce;
      this.body.addForce({ x: attractionX, y: attractionY }, true);
    }

    // Apply movement forces
    const forceX = this.config.movementForce * input.x;
    const forceY = this.config.movementForce * input.y;
    this.body.addForce({ x: forceX, y: forceY }, true);
  }

  /**
   * Get player position
   */
  getPosition(): { x: number; y: number } {
    const translation = this.body.translation();
    return {
      x: translation.x,
      y: translation.y
    };
  }

  /**
   * Get player rigid body
   */
  getBody(): RAPIER.RigidBody {
    return this.body;
  }

  /**
   * Get player capsule radius (for rendering)
   */
  getRadius(): number {
    return this.capsuleRadius;
  }

  /**
   * Get player capsule total height (for rendering)
   * Capsule height = 2*halfHeight + 2*radius = 2*0.4 + 2*0.6 = 2.0m
   */
  getHeight(): number {
    return 2 * this.capsuleHalfHeight + 2 * this.capsuleRadius;
  }

  /**
   * Get ground normal (for debug visualization)
   */
  getGroundNormalForDebug(): { x: number; y: number } | null {
    return this.getGroundNormal();
  }

  /**
   * Get foot sensor collider (for debug visualization)
   */
  getFootSensor(): RAPIER.Collider {
    return this.colliders.footSensor;
  }

  /**
   * Respawn player at new position
   */
  respawn(x: number, y: number): void {
    this.body.setTranslation({ x, y }, true);
    this.body.setLinvel({ x: 0, y: 0 }, true);
    this.body.setAngvel(0, true);
  }

  // === Configuration getters/setters for debug UI ===

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
    this.body.setLinearDamping(drag);
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
    console.log(`[PlayerController] Ground attraction force set to ${force.toFixed(1)}N`);
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
    const world = this.engine.getWorld();
    if (!world) {
      throw new Error('[PlayerController] Physics world not initialized!');
    }

    this.config.footSensorRadiusMultiplier = multiplier;

    // Remove old sensor
    world.removeCollider(this.colliders.footSensor, false);

    // Create new sensor with updated radius
    const sensorRadius = this.capsuleRadius * multiplier;
    const sensorOffsetY = this.capsuleHalfHeight;

    const sensorDesc = RAPIER.ColliderDesc.ball(sensorRadius)
      .setTranslation(0, sensorOffsetY)
      .setSensor(true);

    this.colliders.footSensor = world.createCollider(sensorDesc, this.body);

    console.log(`[PlayerController] Updated foot sensor radius to ${sensorRadius.toFixed(2)}m (multiplier: ${multiplier.toFixed(2)})`);
  }

  /**
   * Get player body mass (for debug/physics calculations)
   */
  getMass(): number {
    return this.body.mass();
  }
}
