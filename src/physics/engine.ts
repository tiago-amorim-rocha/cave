/**
 * Physics engine abstraction for Rapier 2D
 * All coordinates in world units (metres), physics runs at fixed timestep
 */

import RAPIER from '@dimforge/rapier2d-compat';
import type { Camera } from '../Camera';
import type { Point } from '../types';

export interface PlayerColliders {
  body: RAPIER.Collider;
  footSensor: RAPIER.Collider;
}

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
   * Create player dynamic body with capsule collider and foot sensor
   * @param x - X position in metres
   * @param y - Y position in metres
   * @returns Object containing rigid body and collider handles
   */
  createPlayer(x: number, y: number): { body: RAPIER.RigidBody; colliders: PlayerColliders };

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

  /**
   * Check if a sensor collider is currently in contact with terrain
   */
  isSensorActive(sensor: RAPIER.Collider): boolean;
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

  // Track sensor contacts for ground detection
  private sensorContacts = new Map<number, number>(); // sensor handle -> contact count

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

    // Update sensor contacts after physics step
    this.updateSensorContacts();
  }

  /**
   * Update sensor contact counts by checking intersections
   * Uses intersectionPairsWith for spatial overlap detection
   */
  private updateSensorContacts(): void {
    if (!this.world) return;

    // Reset all sensor contact counts
    this.sensorContacts.clear();

    // Iterate through all colliders and check sensors
    this.world.forEachCollider((collider: RAPIER.Collider) => {
      if (!collider.isSensor()) return;

      // Check if this sensor has contacts with anything
      // Use intersectionPairsWith instead of contactPairsWith for sensors
      let contactCount = 0;
      this.world!.intersectionPairsWith(collider, (otherCollider: RAPIER.Collider) => {
        // Ignore contacts with other sensors or same body
        if (!otherCollider.isSensor() && otherCollider.parent() !== collider.parent()) {
          contactCount++;
        }
      });

      if (contactCount > 0) {
        this.sensorContacts.set(collider.handle, contactCount);
      }
    });
  }

  /**
   * Update terrain from marching squares loops
   * Uses polyline colliders to prevent internal edge artifacts (wall sticking)
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

    // Build polyline colliders for each loop
    for (const loop of loops) {
      if (loop.length < 2) continue;

      // Convert loop to Float32Array of vertices [x0, y0, x1, y1, ...]
      const vertices = new Float32Array(loop.length * 2);
      for (let i = 0; i < loop.length; i++) {
        vertices[i * 2] = loop[i].x;
        vertices[i * 2 + 1] = loop[i].y;
      }

      // Create polyline collider (one collider per loop)
      // This prevents "internal edge" artifacts where character catches on segment junctions
      const polylineDesc = RAPIER.ColliderDesc.polyline(vertices)
        .setFriction(0.3)
        .setRestitution(0.1);

      const collider = this.world.createCollider(polylineDesc);
      this.terrainColliders.push(collider);

      // Store segments for debug rendering
      for (let i = 0; i < loop.length - 1; i++) {
        const p1 = loop[i];
        const p2 = loop[i + 1];
        this.debugSegments.push({ p1: { x: p1.x, y: p1.y }, p2: { x: p2.x, y: p2.y } });
        totalSegments++;
      }
    }

    console.log(`[RapierEngine] Created ${this.terrainColliders.length} polyline colliders (${totalSegments} segments) from ${loops.length} loops`);
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
   * Create player body with capsule collider and foot sensor
   */
  createPlayer(x: number, y: number): { body: RAPIER.RigidBody; colliders: PlayerColliders } {
    if (!this.world) {
      throw new Error('[RapierEngine] World not initialized!');
    }

    // Player dimensions
    const capsuleRadius = 0.6; // 3× grid pitch (0.2m)
    const capsuleHalfHeight = 0.6; // Total height: 1.2m
    const footSensorHeight = 0.1;
    const footSensorWidth = capsuleRadius * 1.5; // Wider than body for edge detection

    // Create dynamic rigid body with CCD
    const rbDesc = RAPIER.RigidBodyDesc.dynamic()
      .setTranslation(x, y)
      .setCcdEnabled(true)
      .setCanSleep(false) // Prevent sleeping for responsive controls
      .setLinearDamping(0.0); // No damping - we handle friction manually in controller

    const rigidBody = this.world.createRigidBody(rbDesc);

    // Lock rotation for platformer-style control
    rigidBody.lockRotations(true, false);

    // Create capsule collider (vertical capsule)
    const bodyColliderDesc = RAPIER.ColliderDesc.capsule(capsuleHalfHeight, capsuleRadius)
      .setFriction(0.0) // Zero friction to prevent wall sticking
      .setRestitution(0.0) // No bounce
      .setDensity(1.0); // Standard density

    const bodyCollider = this.world.createCollider(bodyColliderDesc, rigidBody);

    // Create foot sensor below the capsule
    // Position it at the bottom of the capsule
    const sensorY = capsuleHalfHeight + capsuleRadius; // Bottom of capsule
    const footSensorDesc = RAPIER.ColliderDesc.cuboid(footSensorWidth, footSensorHeight)
      .setTranslation(0, sensorY) // Relative to body center
      .setSensor(true) // Make it a sensor (no collision response)
      .setActiveEvents(RAPIER.ActiveEvents.COLLISION_EVENTS); // Enable collision events

    const footSensor = this.world.createCollider(footSensorDesc, rigidBody);

    console.log(`[RapierEngine] Created player at (${x.toFixed(2)}, ${y.toFixed(2)}) with capsule (r=${capsuleRadius}m, h=${capsuleHalfHeight * 2}m)`);

    return {
      body: rigidBody,
      colliders: {
        body: bodyCollider,
        footSensor,
      },
    };
  }

  /**
   * Check if a sensor collider is currently in contact
   */
  isSensorActive(sensor: RAPIER.Collider): boolean {
    const contactCount = this.sensorContacts.get(sensor.handle) || 0;
    return contactCount > 0;
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
    this.world.forEachRigidBody((body: RAPIER.RigidBody) => {
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
    ctx.strokeStyle = 'cyan';
    ctx.lineWidth = 2;

    this.world.forEachRigidBody((body: RAPIER.RigidBody) => {
      if (body.isDynamic()) {
        const translation = body.translation();
        const rotation = body.rotation();

        // Iterate through all colliders on this body
        for (let i = 0; i < body.numColliders(); i++) {
          const collider = body.collider(i);
          if (!collider) continue;

          const shape = collider.shape;
          const colliderTranslation = collider.translation();

          // For ball shapes, draw circle
          if (shape.type === RAPIER.ShapeType.Ball) {
            const radius = (shape as RAPIER.Ball).radius;
            const screenPos = camera.worldToScreen(colliderTranslation.x, colliderTranslation.y, canvasWidth, canvasHeight);
            const screenRadius = radius * camera.zoom;

            ctx.beginPath();
            ctx.arc(screenPos.x, screenPos.y, screenRadius, 0, Math.PI * 2);
            ctx.stroke();
          }
          // For capsule shapes, draw as rounded rectangle
          else if (shape.type === RAPIER.ShapeType.Capsule) {
            const capsule = shape as RAPIER.Capsule;
            const halfHeight = capsule.halfHeight;
            const radius = capsule.radius;

            const screenPos = camera.worldToScreen(colliderTranslation.x, colliderTranslation.y, canvasWidth, canvasHeight);
            const screenRadius = radius * camera.zoom;
            const screenHalfHeight = halfHeight * camera.zoom;

            ctx.save();
            ctx.translate(screenPos.x, screenPos.y);
            ctx.rotate(rotation);

            // Draw capsule as two circles connected by lines
            ctx.beginPath();
            // Top circle
            ctx.arc(0, -screenHalfHeight, screenRadius, 0, Math.PI * 2);
            ctx.moveTo(screenRadius, -screenHalfHeight);
            // Right line
            ctx.lineTo(screenRadius, screenHalfHeight);
            // Bottom circle
            ctx.arc(0, screenHalfHeight, screenRadius, 0, Math.PI * 2);
            ctx.moveTo(-screenRadius, screenHalfHeight);
            // Left line
            ctx.lineTo(-screenRadius, -screenHalfHeight);
            ctx.stroke();

            ctx.restore();
          }
          // For cuboid shapes (foot sensor), draw rectangle
          else if (shape.type === RAPIER.ShapeType.Cuboid) {
            const cuboid = shape as RAPIER.Cuboid;
            const halfExtents = cuboid.halfExtents;

            const screenPos = camera.worldToScreen(colliderTranslation.x, colliderTranslation.y, canvasWidth, canvasHeight);
            const screenHalfWidth = halfExtents.x * camera.zoom;
            const screenHalfHeight = halfExtents.y * camera.zoom;

            ctx.save();
            ctx.translate(screenPos.x, screenPos.y);
            ctx.rotate(rotation);

            // Different color for sensors
            if (collider.isSensor()) {
              const isActive = this.isSensorActive(collider);
              ctx.strokeStyle = isActive ? 'lime' : 'yellow';
              ctx.fillStyle = isActive ? 'rgba(0, 255, 0, 0.2)' : 'rgba(255, 255, 0, 0.1)';
              ctx.fillRect(-screenHalfWidth, -screenHalfHeight, screenHalfWidth * 2, screenHalfHeight * 2);
            } else {
              ctx.strokeStyle = 'cyan';
            }

            ctx.strokeRect(-screenHalfWidth, -screenHalfHeight, screenHalfWidth * 2, screenHalfHeight * 2);

            ctx.restore();
          }
        }
      }
    });

    ctx.restore();
  }
}
