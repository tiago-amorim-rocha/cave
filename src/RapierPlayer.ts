/**
 * Player controller for Rapier physics
 * Handles player state, input, and physics body
 */

import RAPIER from '@dimforge/rapier2d-compat';
import type { RapierPhysics } from './RapierPhysics';

export class RapierPlayer {
  public body: RAPIER.RigidBody;
  private physics: RapierPhysics;

  // Input state
  private keys = {
    left: false,
    right: false,
    jump: false,
  };

  constructor(physics: RapierPhysics, x: number, y: number) {
    this.physics = physics;
    this.body = physics.createPlayer(x, y);
    this.setupInputListeners();
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
   * Update player physics based on input
   * Called every frame
   */
  update(): void {
    // Horizontal movement
    let moveDirection = 0;
    if (this.keys.left) moveDirection -= 1;
    if (this.keys.right) moveDirection += 1;

    if (moveDirection !== 0) {
      this.physics.applyPlayerMovement(this.body, moveDirection);
    }

    // Apply damping to horizontal velocity for better control
    const velocity = this.body.linvel();
    this.body.setLinvel({ x: velocity.x * 0.95, y: velocity.y }, true);

    // Jump
    if (this.keys.jump) {
      this.physics.jumpPlayer(this.body);
      // Prevent continuous jumping by clearing the jump key
      this.keys.jump = false;
    }
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
   * Get player radius (for rendering)
   */
  getRadius(): number {
    // Player body is a circle with radius 0.5m
    return 0.5;
  }

  /**
   * Respawn player at new position
   */
  respawn(x: number, y: number): void {
    this.body.setTranslation({ x, y }, true);
    this.body.setLinvel({ x: 0, y: 0 }, true);
    this.body.setAngvel(0, true);
    console.log(`Player respawned at (${x.toFixed(1)}, ${y.toFixed(1)})`);
  }
}
