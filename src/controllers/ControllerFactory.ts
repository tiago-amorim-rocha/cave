/**
 * Factory for creating and managing player controllers
 * Supports multiple controller types and runtime switching
 */

import type { Box2DEngine } from '../physics/Box2DEngine';
import type { IPlayerController, ControllerConfig } from './IPlayerController';
import { ControllerType } from './IPlayerController';
// import { ForcePlayerController } from './ForcePlayerController'; // TODO: Implement for Box2D
import { SpiderController } from './spider/SpiderController';
import { CapsuleController } from './CapsuleController';

/**
 * Factory for creating player controllers
 */
export class ControllerFactory {
  private engine: Box2DEngine;

  constructor(engine: Box2DEngine) {
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
        throw new Error(`[ControllerFactory] ForcePlayerController not yet implemented for Box2D`);
        // return new ForcePlayerController(this.engine, config.x, config.y);

      case ControllerType.SPIDER:
        return new SpiderController(this.engine.getWorld(), config.x, config.y);

      case ControllerType.CAPSULE:
        return new CapsuleController(this.engine.getWorld(), config.x, config.y);

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
      ControllerType.SPIDER,
      ControllerType.CAPSULE,
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
      case ControllerType.CAPSULE:
        return 'Capsule Controller';
      default:
        return 'Unknown';
    }
  }
}

/**
 * Manager for switching between different controllers
 * Handles cleanup of old controller and creation of new one
 * Registers controllers for fixed timestep updates (60Hz)
 */
export class ControllerManager {
  private factory: ControllerFactory;
  private currentController: IPlayerController | null = null;
  private currentType: ControllerType | null = null;
  private engine: Box2DEngine;
  private currentUpdateCallback: ((dt: number) => void) | null = null;

  constructor(engine: Box2DEngine) {
    this.factory = new ControllerFactory(engine);
    this.engine = engine;
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
    let spawnX = 32; // Default spawn X (center of 64m world)
    let spawnY = 32; // Default spawn Y (center of 64m world)

    // Get current position if we want to preserve it
    if (preservePosition && this.currentController) {
      const pos = this.currentController.getPosition();
      spawnX = pos.x;
      spawnY = pos.y;
    }

    // Unregister old controller's update callback
    // TODO: Implement unregisterFixedUpdate in Box2DEngine
    // if (this.currentUpdateCallback) {
    //   this.engine.unregisterFixedUpdate(this.currentUpdateCallback);
    //   this.currentUpdateCallback = null;
    // }

    // Destroy old controller if it exists
    if (this.currentController) {
      console.log(`[ControllerManager] Destroying ${this.currentController.getTypeName()}`);
      this.currentController.destroy();
    }

    // Create new controller
    console.log(`[ControllerManager] Creating ${this.factory.getTypeName(type)} at (${spawnX.toFixed(2)}, ${spawnY.toFixed(2)})`);
    this.currentController = this.factory.createController(type, { x: spawnX, y: spawnY });
    this.currentType = type;

    // Register new controller's update callback for fixed timestep (60Hz)
    this.currentUpdateCallback = (dt: number) => {
      if (this.currentController) {
        this.currentController.update(dt);
      }
    };
    this.engine.registerFixedUpdate(this.currentUpdateCallback);
    console.log(`[ControllerManager] Registered ${this.factory.getTypeName(type)} for fixed timestep updates (60Hz)`);

    return this.currentController;
  }

  /**
   * Initialize with a specific controller type
   */
  initialize(type: ControllerType, x: number, y: number): IPlayerController {
    this.currentController = this.factory.createController(type, { x, y });
    this.currentType = type;

    // Register controller's update callback for fixed timestep (60Hz)
    this.currentUpdateCallback = (dt: number) => {
      if (this.currentController) {
        this.currentController.update(dt);
      }
    };
    this.engine.registerFixedUpdate(this.currentUpdateCallback);
    console.log(`[ControllerManager] Registered ${this.factory.getTypeName(type)} for fixed timestep updates (60Hz)`);

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
    // Unregister update callback
    // TODO: Implement unregisterFixedUpdate in Box2DEngine
    // if (this.currentUpdateCallback) {
    //   this.engine.unregisterFixedUpdate(this.currentUpdateCallback);
    //   this.currentUpdateCallback = null;
    // }

    if (this.currentController) {
      this.currentController.destroy();
      this.currentController = null;
      this.currentType = null;
    }
  }
}
