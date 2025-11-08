/**
 * Physics engine abstraction for Rapier 2D
 * All coordinates in world units (metres), physics runs at fixed timestep
 */

import RAPIER from '@dimforge/rapier2d-compat';
import type { Camera } from '../Camera';
import type { Point } from '../PolylineSimplifier';

export interface PhysicsEngine {
  /**
   * Step the physics simulation with accumulator for fixed timestep
   * @param dt - Delta time in milliseconds
   */
  step(dt: number): void;

  /**
   * Update terrain colliders from marching squares loops
   * @param loops - Array of polylines representing cave walls
   */
  setTerrainLoops(loops: Point[][]): void;

  /**
   * Create a dynamic ball body for testing
   * @param x - X position in metres
   * @param y - Y position in metres
   * @param radius - Ball radius in metres
   * @returns Handle to the rigid body
   */
  createBall(x: number, y: number, radius: number): RAPIER.RigidBody;

  /**
   * Create player dynamic body
   * @param x - X position in metres
   * @param y - Y position in metres
   * @param radius - Player radius in metres
   * @returns Handle to the player rigid body
   */
  createPlayer(x: number, y: number, radius: number): RAPIER.RigidBody;

  /**
   * Remove a body from the world
   */
  removeBody(body: RAPIER.RigidBody): void;

  /**
   * Get all rigid bodies for rendering
   */
  getAllBodies(): RAPIER.RigidBody[];

  /**
   * Enable/disable debug rendering
   */
  setDebugEnabled(enabled: boolean): void;

  /**
   * Render debug overlay (physics shapes over world coordinates)
   */
  debugDraw(ctx: CanvasRenderingContext2D, camera: Camera, canvasWidth: number, canvasHeight: number): void;
}

/**
 * Rapier 2D physics engine implementation
 */
export class RapierEngine implements PhysicsEngine {
  private world: RAPIER.World | null = null;
  private initialized = false;
  private accumulator = 0;
  private readonly FIXED_DT = 1 / 60; // 60 Hz physics
  private readonly FIXED_DT_MS = 1000 / 60; // In milliseconds for comparison

  private terrainColliders: RAPIER.Collider[] = [];
  private debugEnabled = false;
  private debugSegments: Array<{ p1: { x: number; y: number }; p2: { x: number; y: number } }> = [];

  /**
   * Initialize Rapier and create the physics world
   * Must be called before using the engine
   */
  async init(): Promise<void> {
    if (this.initialized) return;

    console.log('[RapierEngine] Initializing...');
    await RAPIER.init();

    // Create world with gravity pointing down (Y-down coordinate system)
    // Gravity in m/s² - using 10 m/s² (similar to Earth but in game units)
    this.world = new RAPIER.World({ x: 0.0, y: 10.0 });

    this.initialized = true;
    console.log('[RapierEngine] Initialized with gravity (0, 10) m/s²');
  }

  /**
   * Step physics with fixed timestep accumulator
   */
  step(dt: number): void {
    if (!this.world) {
      console.error('[RapierEngine] World not initialized!');
      return;
    }

    // Convert dt to seconds
    const dtSeconds = dt / 1000;
    this.accumulator += dtSeconds;

    // Step physics at fixed rate
    while (this.accumulator >= this.FIXED_DT) {
      this.world.step();
      this.accumulator -= this.FIXED_DT;
    }
  }

  /**
   * Update terrain from marching squares loops
   * Uses segment colliders for exact boundary representation
   */
  setTerrainLoops(loops: Point[][]): void {
    if (!this.world) {
      console.error('[RapierEngine] World not initialized!');
      return;
    }

    // Remove old terrain colliders
    for (const collider of this.terrainColliders) {
      this.world.removeCollider(collider, false);
    }
    this.terrainColliders = [];
    this.debugSegments = [];

    let totalSegments = 0;

    // Build segment colliders for each loop
    for (const loop of loops) {
      if (loop.length < 2) continue;

      // Create segment collider for each edge
      for (let i = 0; i < loop.length - 1; i++) {
        const p1 = loop[i];
        const p2 = loop[i + 1];

        // Skip degenerate segments
        const dx = p2.x - p1.x;
        const dy = p2.y - p1.y;
        const length = Math.sqrt(dx * dx + dy * dy);

        if (length < 0.001) continue; // Skip tiny segments

        // Create segment collider
        const segmentDesc = RAPIER.ColliderDesc.segment(
          { x: p1.x, y: p1.y },
          { x: p2.x, y: p2.y }
        )
          .setFriction(0.3)
          .setRestitution(0.1);

        const collider = this.world.createCollider(segmentDesc);
        this.terrainColliders.push(collider);
        totalSegments++;

        // Store for debug rendering
        if (this.debugEnabled) {
          this.debugSegments.push({ p1: { x: p1.x, y: p1.y }, p2: { x: p2.x, y: p2.y } });
        }
      }
    }

    console.log(`[RapierEngine] Created ${totalSegments} segment colliders from ${loops.length} loops`);
  }

  /**
   * Create a ball for testing physics
   */
  createBall(x: number, y: number, radius: number): RAPIER.RigidBody {
    if (!this.world) {
      throw new Error('[RapierEngine] World not initialized!');
    }

    // Create dynamic rigid body
    const rbDesc = RAPIER.RigidBodyDesc.dynamic()
      .setTranslation(x, y)
      .setCcdEnabled(true); // Enable continuous collision detection

    const rigidBody = this.world.createRigidBody(rbDesc);

    // Create ball collider
    const colliderDesc = RAPIER.ColliderDesc.ball(radius)
      .setFriction(0.3)
      .setRestitution(0.3)
      .setDensity(0.001);

    this.world.createCollider(colliderDesc, rigidBody);

    return rigidBody;
  }

  /**
   * Create player body
   */
  createPlayer(x: number, y: number, radius: number): RAPIER.RigidBody {
    if (!this.world) {
      throw new Error('[RapierEngine] World not initialized!');
    }

    // Create dynamic rigid body with CCD
    const rbDesc = RAPIER.RigidBodyDesc.dynamic()
      .setTranslation(x, y)
      .setCcdEnabled(true)
      .setCanSleep(true)
      .setLinearDamping(0.5); // Add damping for better control

    const rigidBody = this.world.createRigidBody(rbDesc);

    // Lock rotation for platformer-style control
    rigidBody.lockRotations(true, false);

    // Create ball collider
    const colliderDesc = RAPIER.ColliderDesc.ball(radius)
      .setFriction(0.3)
      .setRestitution(0.1)
      .setDensity(0.001);

    this.world.createCollider(colliderDesc, rigidBody);

    console.log(`[RapierEngine] Created player at (${x.toFixed(2)}, ${y.toFixed(2)}) with radius ${radius}m`);

    return rigidBody;
  }

  /**
   * Remove a rigid body from the world
   */
  removeBody(body: RAPIER.RigidBody): void {
    if (!this.world) return;
    this.world.removeRigidBody(body);
  }

  /**
   * Get all rigid bodies (for rendering)
   */
  getAllBodies(): RAPIER.RigidBody[] {
    if (!this.world) return [];

    const bodies: RAPIER.RigidBody[] = [];
    this.world.forEachRigidBody((body) => {
      bodies.push(body);
    });

    return bodies;
  }

  /**
   * Enable/disable debug rendering
   */
  setDebugEnabled(enabled: boolean): void {
    this.debugEnabled = enabled;
  }

  /**
   * Debug draw physics shapes in world coordinates
   */
  debugDraw(ctx: CanvasRenderingContext2D, camera: Camera, canvasWidth: number, canvasHeight: number): void {
    if (!this.debugEnabled || !this.world) return;

    ctx.save();

    // Draw terrain segments in green
    ctx.strokeStyle = 'lime';
    ctx.lineWidth = 2;

    for (const segment of this.debugSegments) {
      const screen1 = camera.worldToScreen(segment.p1.x, segment.p1.y, canvasWidth, canvasHeight);
      const screen2 = camera.worldToScreen(segment.p2.x, segment.p2.y, canvasWidth, canvasHeight);

      ctx.beginPath();
      ctx.moveTo(screen1.x, screen1.y);
      ctx.lineTo(screen2.x, screen2.y);
      ctx.stroke();
    }

    // Draw dynamic bodies (balls/player) in cyan
    ctx.fillStyle = 'cyan';
    ctx.strokeStyle = 'cyan';
    ctx.lineWidth = 2;

    this.world.forEachRigidBody((body) => {
      if (body.isDynamic()) {
        const translation = body.translation();
        const screenPos = camera.worldToScreen(translation.x, translation.y, canvasWidth, canvasHeight);

        // Get collider to determine shape
        const collider = body.collider(0);
        if (collider) {
          const shape = collider.shape;

          // For ball shapes, draw circle
          if (shape.type === RAPIER.ShapeType.Ball) {
            const radius = (shape as RAPIER.Ball).radius;
            const screenRadius = radius * camera.zoom;

            ctx.beginPath();
            ctx.arc(screenPos.x, screenPos.y, screenRadius, 0, Math.PI * 2);
            ctx.stroke();
          }
        }
      }
    });

    ctx.restore();
  }
}
