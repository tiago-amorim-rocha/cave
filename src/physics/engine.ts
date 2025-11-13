/**
 * Physics engine abstraction for Rapier 2D
 * All coordinates in world units (metres), physics runs at fixed timestep
 */

import RAPIER from '@dimforge/rapier2d-compat';
import type { Camera } from '../Camera';
import type { Point } from '../types';

export interface PlayerColliders {
  body: RAPIER.Collider;
  footSensor: RAPIER.Collider | null;
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

  // Track collider contacts for debug visualization
  private colliderContacts = new Map<number, number>(); // collider handle -> contact count

  /**
   * Initialize Rapier and create the physics world
   * Must be called before using the engine
   */
  async init(): Promise<void> {
    if (this.initialized) return;

    console.log('[RapierEngine] Initializing with enhanced debug visualization...');
    await RAPIER.init();

    // Create world with gravity pointing down (Y-down coordinate system)
    // Gravity in m/s² - using 10 m/s² (similar to Earth but in game units)
    this.world = new RAPIER.World({ x: 0.0, y: 10.0 });

    this.initialized = true;
    console.log('[RapierEngine] Initialized with gravity (0, 10) m/s² - collision tracking active');
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
   * Also tracks regular collider contacts for debug visualization
   */
  private updateSensorContacts(): void {
    if (!this.world) return;

    // Reset all contact counts
    this.sensorContacts.clear();
    this.colliderContacts.clear();

    // Iterate through all colliders
    this.world.forEachCollider((collider: RAPIER.Collider) => {
      // For sensors, use intersectionPairsWith
      if (collider.isSensor()) {
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
      }
      // For regular colliders on dynamic bodies, check contact pairs
      else if (collider.parent()?.isDynamic()) {
        let contactCount = 0;
        this.world!.contactPairsWith(collider, (otherCollider: RAPIER.Collider) => {
          // Count contacts with terrain (static bodies)
          if (otherCollider.parent() === null || otherCollider.parent()!.isFixed()) {
            contactCount++;
          }
        });

        if (contactCount > 0) {
          this.colliderContacts.set(collider.handle, contactCount);
        }
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
    let nonClosedLoops = 0;
    let closedLoops = 0;

    // Build polyline colliders for each loop
    for (const loop of loops) {
      if (loop.length < 2) continue;

      // Check if loop is properly closed
      const firstPoint = loop[0];
      const lastPoint = loop[loop.length - 1];
      const distance = Math.sqrt(
        Math.pow(lastPoint.x - firstPoint.x, 2) +
        Math.pow(lastPoint.y - firstPoint.y, 2)
      );
      const isClosed = distance < 0.01; // Within 1cm tolerance

      if (!isClosed) {
        nonClosedLoops++;
        console.warn(`[RapierEngine] Non-closed loop detected! First: (${firstPoint.x.toFixed(3)}, ${firstPoint.y.toFixed(3)}), Last: (${lastPoint.x.toFixed(3)}, ${lastPoint.y.toFixed(3)}), Distance: ${distance.toFixed(4)}m`);
      } else {
        closedLoops++;
      }

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
    console.log(`[RapierEngine] Loop closure stats: ${closedLoops} closed, ${nonClosedLoops} non-closed`);
    if (nonClosedLoops > 0) {
      console.warn(`[RapierEngine] ⚠️ ${nonClosedLoops} non-closed loops detected! This may cause wall sticking issues.`);
    }
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
   * Create player body with capsule collider (no foot sensor)
   */
  createPlayer(x: number, y: number): { body: RAPIER.RigidBody; colliders: PlayerColliders } {
    if (!this.world) {
      throw new Error('[RapierEngine] World not initialized!');
    }

    // Player dimensions
    const capsuleRadius = 0.6; // 3× grid pitch (0.2m)
    const capsuleHalfHeight = 0.6; // Total height: 1.2m

    // Create dynamic rigid body with CCD
    const rbDesc = RAPIER.RigidBodyDesc.dynamic()
      .setTranslation(x, y)
      .setCcdEnabled(true)
      .setCanSleep(false) // Prevent sleeping for responsive controls
      .setLinearDamping(0.0); // Initial damping - will be set dynamically by controller

    const rigidBody = this.world.createRigidBody(rbDesc);

    // Lock rotation for platformer-style control
    rigidBody.lockRotations(true, false);

    // Create capsule collider (vertical capsule)
    const bodyColliderDesc = RAPIER.ColliderDesc.capsule(capsuleHalfHeight, capsuleRadius)
      .setFriction(0.0) // Zero friction to prevent wall sticking
      .setRestitution(0.0) // No bounce
      .setDensity(1.0); // Standard density

    const bodyCollider = this.world.createCollider(bodyColliderDesc, rigidBody);

    console.log(`[RapierEngine] Created player at (${x.toFixed(2)}, ${y.toFixed(2)}) with capsule (r=${capsuleRadius}m, h=${capsuleHalfHeight * 2}m) - no foot sensor`);

    return {
      body: rigidBody,
      colliders: {
        body: bodyCollider,
        footSensor: null, // No foot sensor anymore
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

            // Check if collider is in contact with terrain
            const isColliding = this.colliderContacts.has(collider.handle);
            const friction = collider.friction();

            // Change color based on collision state
            if (isColliding) {
              ctx.strokeStyle = '#ff0000'; // Red when colliding
              ctx.fillStyle = 'rgba(255, 0, 0, 0.2)'; // Red fill
              ctx.lineWidth = 4; // Thicker line when colliding
            } else {
              ctx.strokeStyle = '#00ffff'; // Cyan when not colliding
              ctx.fillStyle = 'rgba(0, 255, 255, 0.1)'; // Cyan fill
              ctx.lineWidth = 3;
            }

            // Draw filled capsule
            ctx.beginPath();
            // Top circle
            ctx.arc(0, -screenHalfHeight, screenRadius, Math.PI, 0);
            // Right line
            ctx.lineTo(screenRadius, screenHalfHeight);
            // Bottom circle
            ctx.arc(0, screenHalfHeight, screenRadius, 0, Math.PI);
            // Left line
            ctx.lineTo(-screenRadius, -screenHalfHeight);
            ctx.closePath();
            ctx.fill();
            ctx.stroke();

            // Draw friction label
            ctx.fillStyle = isColliding ? '#ff0000' : '#ffffff';
            ctx.font = '12px monospace';
            ctx.textAlign = 'center';
            ctx.fillText(`friction: ${friction.toFixed(2)}`, 0, screenHalfHeight + screenRadius + 15);

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
              const contactCount = this.sensorContacts.get(collider.handle) || 0;

              // Enhanced visual feedback for ground sensor
              if (isActive) {
                ctx.strokeStyle = '#00ff00'; // Bright green when touching ground
                ctx.fillStyle = 'rgba(0, 255, 0, 0.4)'; // More opaque green fill
                ctx.lineWidth = 4; // Thicker line when active
              } else {
                ctx.strokeStyle = '#ffff00'; // Yellow when not touching
                ctx.fillStyle = 'rgba(255, 255, 0, 0.2)'; // Transparent yellow fill
                ctx.lineWidth = 2;
              }

              ctx.fillRect(-screenHalfWidth, -screenHalfHeight, screenHalfWidth * 2, screenHalfHeight * 2);
              ctx.strokeRect(-screenHalfWidth, -screenHalfHeight, screenHalfWidth * 2, screenHalfHeight * 2);

              // Draw contact count label
              ctx.fillStyle = isActive ? '#00ff00' : '#ffffff';
              ctx.font = '10px monospace';
              ctx.textAlign = 'center';
              ctx.fillText(isActive ? `GROUND (${contactCount})` : 'SENSOR', 0, screenHalfHeight + 12);
            } else {
              ctx.strokeStyle = 'cyan';
              ctx.lineWidth = 2;
              ctx.strokeRect(-screenHalfWidth, -screenHalfHeight, screenHalfWidth * 2, screenHalfHeight * 2);
            }

            ctx.restore();
          }
        }
      }
    });

    ctx.restore();
  }
}
