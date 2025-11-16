/**
 * Factory for creating and managing player controllers
 * Supports multiple controller types and runtime switching
 */

import type { RapierEngine } from '../physics/engine';
import type { IPlayerController, ControllerConfig } from './IPlayerController';
import { ControllerType } from './IPlayerController';
import { ForcePlayerController } from './ForcePlayerController';

/**
 * Factory for creating player controllers
 */
export class ControllerFactory {
  private engine: RapierEngine;

  constructor(engine: RapierEngine) {
    this.engine = engine;
  }

  /**
   * Create a new controller of the specified type
   * @param type - Controller type to create
   * @param config - Controller configuration (position, options)
   * @returns New controller instance
   */
  createController(type: ControllerType, config: ControllerConfig): IPlayerController {
    switch (type) {
      case ControllerType.FORCE:
        return new ForcePlayerController(this.engine, config.x, config.y);

      case ControllerType.SPIDER:
        // TODO: Implement SpiderController
        throw new Error(`[ControllerFactory] Spider controller not yet implemented`);

      default:
        throw new Error(`[ControllerFactory] Unknown controller type: ${type}`);
    }
  }

  /**
   * Get available controller types
   */
  getAvailableTypes(): ControllerType[] {
    return [
      ControllerType.FORCE,
      // ControllerType.SPIDER will be added when implemented
    ];
  }

  /**
   * Get human-readable name for a controller type
   */
  getTypeName(type: ControllerType): string {
    switch (type) {
      case ControllerType.FORCE:
        return 'Force Controller';
      case ControllerType.SPIDER:
        return 'Spider Controller';
      default:
        return 'Unknown';
    }
  }
}

/**
 * Manager for switching between different controllers
 * Handles cleanup of old controller and creation of new one
 */
export class ControllerManager {
  private factory: ControllerFactory;
  private currentController: IPlayerController | null = null;
  private currentType: ControllerType | null = null;

  constructor(engine: RapierEngine) {
    this.factory = new ControllerFactory(engine);
  }

  /**
   * Get current controller
   */
  getCurrentController(): IPlayerController | null {
    return this.currentController;
  }

  /**
   * Get current controller type
   */
  getCurrentType(): ControllerType | null {
    return this.currentType;
  }

  /**
   * Switch to a different controller type
   * @param type - Controller type to switch to
   * @param preservePosition - If true, spawn new controller at old controller's position
   * @returns New controller instance
   */
  switchController(type: ControllerType, preservePosition: boolean = true): IPlayerController {
    let spawnX = 25; // Default spawn X (center of 50m world)
    let spawnY = 15; // Default spawn Y (center of 30m world)

    // Get current position if we want to preserve it
    if (preservePosition && this.currentController) {
      const pos = this.currentController.getPosition();
      spawnX = pos.x;
      spawnY = pos.y;
    }

    // Destroy old controller if it exists
    if (this.currentController) {
      console.log(`[ControllerManager] Destroying ${this.currentController.getTypeName()}`);
      this.currentController.destroy();
    }

    // Create new controller
    console.log(`[ControllerManager] Creating ${this.factory.getTypeName(type)} at (${spawnX.toFixed(2)}, ${spawnY.toFixed(2)})`);
    this.currentController = this.factory.createController(type, { x: spawnX, y: spawnY });
    this.currentType = type;

    return this.currentController;
  }

  /**
   * Initialize with a specific controller type
   */
  initialize(type: ControllerType, x: number, y: number): IPlayerController {
    this.currentController = this.factory.createController(type, { x, y });
    this.currentType = type;
    return this.currentController;
  }

  /**
   * Get factory (for accessing available types, etc.)
   */
  getFactory(): ControllerFactory {
    return this.factory;
  }

  /**
   * Cleanup (destroy current controller)
   */
  destroy(): void {
    if (this.currentController) {
      this.currentController.destroy();
      this.currentController = null;
      this.currentType = null;
    }
  }
}
