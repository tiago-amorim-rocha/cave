/**
 * Core Game - Headless game simulation
 *
 * Runs the spider controller with physics, but no rendering or UI.
 * All game state is logged to JSONL for analysis.
 */

import RAPIER from '@dimforge/rapier2d-compat';
import { RapierEngine } from '../physics/engine';
import { SpiderController } from '../controllers/spider/SpiderController';
import type { SpiderConfig } from '../controllers/spider/SpiderTypes';
import type { JSONLLogger } from './logger';
import type { Point } from '../types';
import type { InputEvent } from './scenarios/types';

export interface CoreGameConfig {
  /** Physics timestep in seconds (default: 1/60) */
  fixedDt?: number;

  /** Spider configuration (optional, uses defaults if not provided) */
  spiderConfig?: SpiderConfig;
}

/**
 * Headless game core
 *
 * Manages:
 * - Rapier physics world
 * - Spider controller
 * - Terrain colliders
 * - Fixed timestep simulation
 * - State logging
 */
export class CoreGame {
  private engine: RapierEngine;
  private spider: SpiderController | null = null;
  private logger: JSONLLogger;
  private fixedDt: number;
  private stepCount: number = 0;
  private spiderUpdateCallback: ((dt: number) => void) | null = null;

  constructor(logger: JSONLLogger, config: CoreGameConfig = {}) {
    this.logger = logger;
    this.engine = new RapierEngine();
    this.fixedDt = config.fixedDt ?? (1 / 60); // 60 Hz default

    this.logger.info('CoreGame created', {
      fixedDt: this.fixedDt,
      fixedFps: Math.round(1 / this.fixedDt)
    });
  }

  /**
   * Initialize physics engine (async - must be called before use)
   */
  async init(): Promise<void> {
    await this.engine.init();
    this.logger.info('Physics engine initialized');
  }

  /**
   * Set terrain from polyline loops
   * @param loops - Array of closed polylines representing terrain
   */
  setTerrain(loops: Point[][]): void {
    this.logger.info('Setting terrain', {
      loopCount: loops.length,
      totalVertices: loops.reduce((sum, loop) => sum + loop.length, 0)
    });

    this.engine.setTerrainLoops(loops);

    this.logger.info('Terrain created');
  }

  /**
   * Create spider at position
   * @param x - X position (metres)
   * @param y - Y position (metres)
   * @param config - Spider configuration (optional)
   */
  createSpider(x: number, y: number, config?: SpiderConfig): void {
    // Unregister old callback if spider exists
    if (this.spiderUpdateCallback) {
      this.engine.unregisterFixedUpdate(this.spiderUpdateCallback);
      this.spiderUpdateCallback = null;
    }

    if (this.spider) {
      this.logger.warn('Spider already exists, destroying old spider');
      this.spider.destroy();
    }

    this.logger.info('Creating spider', { x, y });

    this.spider = new SpiderController(this.engine, x, y, config);

    // Create a fake joystick interface for headless mode
    const fakeJoystick = {
      getInput: () => this.currentInput,
      reset: () => {},
      setEnabled: () => {}
    };

    this.spider.setJoystick(fakeJoystick as any);

    // CRITICAL: Register spider.update() for fixed timestep (60Hz)
    // Without this, spider controller never runs and spider won't move!
    this.spiderUpdateCallback = (dt: number) => {
      if (this.spider) {
        this.spider.update(dt);
      }
    };
    this.engine.registerFixedUpdate(this.spiderUpdateCallback);

    this.logger.info('Spider created', {
      typeName: this.spider.getTypeName(),
      bodyCount: this.spider.getAllBodies().length
    });
  }

  /**
   * Current input state (set by handleInput)
   */
  private currentInput: InputEvent = { x: 0, y: 0, magnitude: 0 };

  /**
   * Handle input event (called by scenario)
   * @param event - Input event
   */
  handleInput(event: InputEvent): void {
    this.currentInput = event;
  }

  /**
   * Step the simulation by one fixed timestep
   * This is the main game loop iteration
   */
  update(): void {
    if (!this.spider) {
      this.logger.error('Cannot update: no spider created');
      return;
    }

    // Step physics (this calls spider.update via fixed update callback)
    const dtMs = this.fixedDt * 1000;
    this.engine.step(dtMs);

    // Log spider state after physics step
    this.logSpiderState();

    this.stepCount++;
  }

  /**
   * Log current spider state to JSONL
   */
  private logSpiderState(): void {
    if (!this.spider) return;

    const body = this.spider.getBody();
    const pos = body.translation();
    const vel = body.linvel();
    const angVel = body.angvel();
    const rotation = body.rotation();

    // Get all body positions for detailed analysis
    const allBodies = this.spider.getAllBodies();
    const bodyStates = allBodies.map((b) => {
      const p = b.translation();
      const v = b.linvel();
      return {
        x: p.x,
        y: p.y,
        vx: v.x,
        vy: v.y,
        rot: b.rotation(),
        angVel: b.angvel()
      };
    });

    this.logger.data('spider_state', {
      step: this.stepCount,
      time: this.stepCount * this.fixedDt,
      mainBody: {
        x: pos.x,
        y: pos.y,
        vx: vel.x,
        vy: vel.y,
        rotation: rotation,
        angVel: angVel
      },
      input: this.currentInput,
      allBodies: bodyStates,
      isGrounded: this.spider.isGrounded()
    });
  }

  /**
   * Get current step count
   */
  getStepCount(): number {
    return this.stepCount;
  }

  /**
   * Get current simulation time
   */
  getTime(): number {
    return this.stepCount * this.fixedDt;
  }

  /**
   * Get spider controller (for inspection)
   */
  getSpider(): SpiderController | null {
    return this.spider;
  }

  /**
   * Clean up resources
   */
  destroy(): void {
    // Unregister update callback
    if (this.spiderUpdateCallback) {
      this.engine.unregisterFixedUpdate(this.spiderUpdateCallback);
      this.spiderUpdateCallback = null;
    }

    if (this.spider) {
      this.spider.destroy();
      this.spider = null;
    }

    this.logger.info('CoreGame destroyed');
  }
}
