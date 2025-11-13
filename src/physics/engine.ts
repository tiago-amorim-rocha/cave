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
   * @param footSensorRadiusMultiplier - Multiplier for foot sensor radius
   * @returns Object containing rigid body and collider handles
   */
  createPlayer(x: number, y: number, footSensorRadiusMultiplier: number): { body: RAPIER.RigidBody; colliders: PlayerColliders };

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

  /**
   * Get averaged ground normal from collider contacts
   * Filters normals by gravity alignment (only accepts ground-like surfaces)
   * @param collider - The collider to check (works with both sensors and regular colliders)
   * @returns Averaged normal vector, or null if no valid ground contacts
   */
  getGroundNormal(collider: RAPIER.Collider): { x: number; y: number } | null;

  /**
   * Get ground normal and contact point for visualization
   * @param sensor - The sensor collider to check
   * @returns Object with normal and contact point, or null if no valid ground contacts
   */
  getGroundNormalWithPoint(sensor: RAPIER.Collider): { normal: { x: number; y: number }; point: { x: number; y: number } } | null;

  /**
   * Update foot sensor radius for player
   * @param body - Player rigid body
   * @param oldSensor - Old sensor collider to remove
   * @param radiusMultiplier - New radius multiplier
   * @returns New sensor collider
   */
  updateFootSensorRadius(body: RAPIER.RigidBody, oldSensor: RAPIER.Collider, radiusMultiplier: number): RAPIER.Collider;
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
        .setRestitution(0.1)
        .setActiveEvents(RAPIER.ActiveEvents.COLLISION_EVENTS); // Enable collision events

      const collider = this.world.createCollider(polylineDesc);
      this.terrainColliders.push(collider);

      // DEBUG: Log collider properties
      if (this.terrainColliders.length === 1) {
        console.log(`[RapierEngine] First terrain collider - handle: ${collider.handle}, isSensor: ${collider.isSensor()}, shape type: ${collider.shape.type}`);
      }

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
      .setDensity(1);

    this.world.createCollider(colliderDesc, rigidBody);

    return rigidBody;
  }

  /**
   * Create player with capsule shape and locked rotation
   */
  createPlayer(x: number, y: number, footSensorRadiusMultiplier: number): { body: RAPIER.RigidBody; colliders: PlayerColliders } {
    if (!this.world) {
      throw new Error('[RapierEngine] World not initialized!');
    }

    const radius = 0.6;
    const halfHeight = 0.4; // Total height = 2.0m (capsule = 2*halfHeight + 2*radius = 0.8 + 1.2 = 2.0m)

    // Create dynamic rigid body with locked rotation
    const rbDesc = RAPIER.RigidBodyDesc.dynamic()
      .setTranslation(x, y)
      .setCcdEnabled(true) // Enable continuous collision detection
      .lockRotations(); // Lock rotation to prevent capsule from tipping

    const rigidBody = this.world.createRigidBody(rbDesc);

    // Create capsule collider (no friction for smooth movement, no bounce)
    const colliderDesc = RAPIER.ColliderDesc.capsule(halfHeight, radius)
      .setFriction(0.0)
      .setRestitution(0.0)
      .setDensity(1);

    const bodyCollider = this.world.createCollider(colliderDesc, rigidBody);

    // Create ball foot sensor for ground detection
    // Ball sensor smooths normals over uneven terrain and doesn't catch on spikes
    // Position sensor at bottom of cylindrical part of capsule
    const sensorRadius = radius * footSensorRadiusMultiplier;
    const sensorOffsetY = halfHeight; // Exactly at bottom of cylinder

    const sensorDesc = RAPIER.ColliderDesc.ball(sensorRadius)
      .setTranslation(0, sensorOffsetY)
      .setSensor(true);

    const footSensor = this.world.createCollider(sensorDesc, rigidBody);

    return {
      body: rigidBody,
      colliders: {
        body: bodyCollider,
        footSensor: footSensor,
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
   * Get averaged ground normal from collider contacts
   * Filters normals by gravity alignment to only accept ground-like surfaces
   */
  getGroundNormal(collider: RAPIER.Collider): { x: number; y: number } | null {
    const result = this.getGroundNormalWithPoint(collider);
    return result ? result.normal : null;
  }

  // Store raycast debug info for visualization
  private raycastDebugInfo: Array<{
    origin: { x: number; y: number };
    dir: { x: number; y: number };
    length: number;
    hit: boolean;
    hitPoint?: { x: number; y: number };
  }> = [];

  /**
   * Get ground normal and contact point for visualization
   * Uses raycasts from ABOVE sensor position to find ground and extract normals
   */
  getGroundNormalWithPoint(collider: RAPIER.Collider): { normal: { x: number; y: number }; point: { x: number; y: number } } | null {
    if (!this.world) return null;

    // Clear previous raycast debug info
    this.raycastDebugInfo = [];

    // Get parent body position (center of player)
    const parent = collider.parent();
    if (!parent) return null;

    const bodyPos = parent.translation();

    // Get sensor world position and radius
    const sensorPos = collider.translation();
    const sensorRadius = collider.isSensor() && collider.shape.type === RAPIER.ShapeType.Ball
      ? (collider.shape as RAPIER.Ball).radius
      : 0.5;

    // Cast rays from ABOVE the capsule downward
    // Player capsule: halfHeight=0.4m, radius=0.6m → total height = 2.0m
    // Top of capsule is at body.y - 1.0m, so start rays from above that
    const rayStartOffsetY = -1.5; // Start 1.5m above body center (0.5m above capsule top)
    const rayOrigins = [
      { x: bodyPos.x, y: bodyPos.y + rayStartOffsetY }, // Center
      { x: bodyPos.x - sensorRadius * 0.7, y: bodyPos.y + rayStartOffsetY }, // Left
      { x: bodyPos.x + sensorRadius * 0.7, y: bodyPos.y + rayStartOffsetY }, // Right
      { x: bodyPos.x - sensorRadius * 0.5, y: bodyPos.y + rayStartOffsetY }, // Left-mid
      { x: bodyPos.x + sensorRadius * 0.5, y: bodyPos.y + rayStartOffsetY }, // Right-mid
    ];

    // Cast down far enough to reach ground from above capsule
    const rayLength = 4.0; // Cast 4m downward - enough to reach ground from above player
    const rayDir = { x: 0, y: 1 }; // Downward (Y-down coordinate system)

    const validNormals: Array<{ x: number; y: number }> = [];
    const validPoints: Array<{ x: number; y: number }> = [];
    const gravityDirection = { x: 0, y: 1 };
    const cosThreshold = -0.4; // Accept normals pointing mostly upward

    let totalRaycasts = 0;
    let totalHits = 0;

    // Cast rays from each origin point
    for (const origin of rayOrigins) {
      totalRaycasts++;

      const ray = new RAPIER.Ray(origin, rayDir);
      // CRITICAL FIX: Exclude player's rigid body from raycast
      // Without this, raycast hits player first and never reaches terrain!
      const hit = this.world.castRayAndGetNormal(
        ray,
        rayLength,
        true, // solid
        undefined, // filterFlags (use default)
        undefined, // filterGroups (use default)
        undefined, // filterExcludeCollider
        parent // filterExcludeRigidBody - exclude the player's rigid body!
      );

      // Store debug info
      const debugInfo: typeof this.raycastDebugInfo[0] = {
        origin,
        dir: rayDir,
        length: rayLength,
        hit: false,
      };

      if (hit) {
        // Filter predicate already excluded player's colliders, so any hit is valid terrain
        totalHits++;
        const hitPoint = ray.pointAt(hit.timeOfImpact);
        const normal = hit.normal;

        debugInfo.hit = true;
        debugInfo.hitPoint = { x: hitPoint.x, y: hitPoint.y };

        // Calculate dot product with gravity
        const cos = normal.x * gravityDirection.x + normal.y * gravityDirection.y;

        // Filter: only accept ground-like normals
        if (cos <= cosThreshold) {
          validNormals.push({ x: normal.x, y: normal.y });
          validPoints.push({ x: hitPoint.x, y: hitPoint.y });
        }
      }

      this.raycastDebugInfo.push(debugInfo);
    }

    if (validNormals.length === 0 || validPoints.length === 0) {
      return null;
    }

    // Average all valid normals
    let sumNormalX = 0;
    let sumNormalY = 0;
    for (const normal of validNormals) {
      sumNormalX += normal.x;
      sumNormalY += normal.y;
    }
    const avgNormalX = sumNormalX / validNormals.length;
    const avgNormalY = sumNormalY / validNormals.length;

    // Normalize the averaged normal
    const normalLength = Math.sqrt(avgNormalX * avgNormalX + avgNormalY * avgNormalY);
    if (normalLength < 0.001) return null;

    // Average all valid contact points
    let sumPointX = 0;
    let sumPointY = 0;
    for (const point of validPoints) {
      sumPointX += point.x;
      sumPointY += point.y;
    }
    const avgPointX = sumPointX / validPoints.length;
    const avgPointY = sumPointY / validPoints.length;

    return {
      normal: {
        x: avgNormalX / normalLength,
        y: avgNormalY / normalLength,
      },
      point: {
        x: avgPointX,
        y: avgPointY,
      },
    };
  }

  /**
   * Update foot sensor radius dynamically
   */
  updateFootSensorRadius(body: RAPIER.RigidBody, oldSensor: RAPIER.Collider, radiusMultiplier: number): RAPIER.Collider {
    if (!this.world) {
      throw new Error('[RapierEngine] World not initialized!');
    }

    // Remove old sensor
    this.world.removeCollider(oldSensor, false);

    // Create new sensor with updated radius
    const capsuleRadius = 0.6; // Same as in createPlayer
    const halfHeight = 0.4;
    const sensorRadius = capsuleRadius * radiusMultiplier;
    const sensorOffsetY = halfHeight; // Exactly at bottom of cylinder

    const sensorDesc = RAPIER.ColliderDesc.ball(sensorRadius)
      .setTranslation(0, sensorOffsetY)
      .setSensor(true);

    const newSensor = this.world.createCollider(sensorDesc, body);

    console.log(`[RapierEngine] Updated foot sensor radius to ${sensorRadius.toFixed(2)}m (multiplier: ${radiusMultiplier.toFixed(2)})`);

    return newSensor;
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
   * Debug draw physics shapes in world coordinates (always enabled)
   */
  debugDraw(ctx: CanvasRenderingContext2D, camera: Camera, canvasWidth: number, canvasHeight: number): void {
    if (!this.world) return; // Always draw debug visualization

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

            // Check if this is a sensor (foot sensor)
            if (collider.isSensor()) {
              const isActive = this.isSensorActive(collider);
              const contactCount = this.sensorContacts.get(collider.handle) || 0;

              // Draw sensor with distinct colors
              ctx.save();
              if (isActive) {
                ctx.strokeStyle = '#00ff00'; // Bright green when touching ground
                ctx.fillStyle = 'rgba(0, 255, 0, 0.3)'; // Semi-transparent green fill
                ctx.lineWidth = 3;
              } else {
                ctx.strokeStyle = '#ffff00'; // Yellow when not touching
                ctx.fillStyle = 'rgba(255, 255, 0, 0.2)'; // Transparent yellow fill
                ctx.lineWidth = 2;
              }

              ctx.beginPath();
              ctx.arc(screenPos.x, screenPos.y, screenRadius, 0, Math.PI * 2);
              ctx.fill();
              ctx.stroke();

              // Draw line from body center to sensor center to show offset
              const bodyTranslation = collider.parent()!.translation();
              const bodyScreenPos = camera.worldToScreen(bodyTranslation.x, bodyTranslation.y, canvasWidth, canvasHeight);
              ctx.strokeStyle = '#ffffff';
              ctx.lineWidth = 1;
              ctx.setLineDash([5, 5]);
              ctx.beginPath();
              ctx.moveTo(bodyScreenPos.x, bodyScreenPos.y);
              ctx.lineTo(screenPos.x, screenPos.y);
              ctx.stroke();
              ctx.setLineDash([]);

              // Draw raycasts for ground detection (always show for debugging)
              // Draw all raycasts
              for (const rayInfo of this.raycastDebugInfo) {
                const originScreen = camera.worldToScreen(rayInfo.origin.x, rayInfo.origin.y, canvasWidth, canvasHeight);
                const endX = rayInfo.origin.x + rayInfo.dir.x * rayInfo.length;
                const endY = rayInfo.origin.y + rayInfo.dir.y * rayInfo.length;
                const endScreen = camera.worldToScreen(endX, endY, canvasWidth, canvasHeight);

                // Draw ray line
                ctx.strokeStyle = rayInfo.hit ? '#00ff00' : '#ff0000'; // Green if hit, red if miss
                ctx.lineWidth = 2;
                ctx.setLineDash([5, 5]);
                ctx.beginPath();
                ctx.moveTo(originScreen.x, originScreen.y);
                ctx.lineTo(endScreen.x, endScreen.y);
                ctx.stroke();
                ctx.setLineDash([]);

                // Draw ray origin
                ctx.fillStyle = '#ffffff';
                ctx.beginPath();
                ctx.arc(originScreen.x, originScreen.y, 3, 0, Math.PI * 2);
                ctx.fill();

                // Draw hit point if hit
                if (rayInfo.hit && rayInfo.hitPoint) {
                  const hitScreen = camera.worldToScreen(rayInfo.hitPoint.x, rayInfo.hitPoint.y, canvasWidth, canvasHeight);
                  ctx.fillStyle = '#00ff00';
                  ctx.beginPath();
                  ctx.arc(hitScreen.x, hitScreen.y, 5, 0, Math.PI * 2);
                  ctx.fill();
                }
              }

              // Draw ground normal if sensor is active (from contact point)
              if (isActive) {
                const result = this.getGroundNormalWithPoint(collider);
                if (result) {
                  const { normal, point } = result;
                  const normalScale = 150; // Scale for visualization (increased for visibility)

                  // Convert contact point to screen coordinates
                  const contactScreenPos = camera.worldToScreen(point.x, point.y, canvasWidth, canvasHeight);

                  // Draw contact point marker
                  ctx.fillStyle = '#ff00ff';
                  ctx.beginPath();
                  ctx.arc(contactScreenPos.x, contactScreenPos.y, 4, 0, Math.PI * 2);
                  ctx.fill();

                  // Draw normal arrow from contact point
                  ctx.strokeStyle = '#ff00ff'; // Magenta for normal
                  ctx.lineWidth = 3;
                  ctx.beginPath();
                  ctx.moveTo(contactScreenPos.x, contactScreenPos.y);
                  ctx.lineTo(
                    contactScreenPos.x + normal.x * normalScale,
                    contactScreenPos.y + normal.y * normalScale
                  );
                  ctx.stroke();

                  // Draw arrowhead
                  const angle = Math.atan2(normal.y, normal.x);
                  const arrowSize = 10;
                  ctx.beginPath();
                  ctx.moveTo(
                    contactScreenPos.x + normal.x * normalScale,
                    contactScreenPos.y + normal.y * normalScale
                  );
                  ctx.lineTo(
                    contactScreenPos.x + normal.x * normalScale - arrowSize * Math.cos(angle - Math.PI / 6),
                    contactScreenPos.y + normal.y * normalScale - arrowSize * Math.sin(angle - Math.PI / 6)
                  );
                  ctx.moveTo(
                    contactScreenPos.x + normal.x * normalScale,
                    contactScreenPos.y + normal.y * normalScale
                  );
                  ctx.lineTo(
                    contactScreenPos.x + normal.x * normalScale - arrowSize * Math.cos(angle + Math.PI / 6),
                    contactScreenPos.y + normal.y * normalScale - arrowSize * Math.sin(angle + Math.PI / 6)
                  );
                  ctx.stroke();
                }
              }

              // Draw label
              ctx.fillStyle = isActive ? '#00ff00' : '#ffffff';
              ctx.font = '10px monospace';
              ctx.textAlign = 'center';
              ctx.fillText(isActive ? `GROUND (${contactCount})` : 'SENSOR', screenPos.x, screenPos.y + screenRadius + 12);

              ctx.restore();
            } else {
              // Regular ball (not sensor)
              ctx.strokeStyle = 'cyan';
              ctx.lineWidth = 2;
              ctx.beginPath();
              ctx.arc(screenPos.x, screenPos.y, screenRadius, 0, Math.PI * 2);
              ctx.stroke();
            }
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
