/**
 * Box2D Physics Engine
 * Handles world creation, terrain collision, and physics stepping
 */

import {
  b2World,
  b2Vec2,
  b2Body,
  b2BodyType,
  b2ChainShape,
  b2Color,
} from '@box2d/core';
import type { Camera } from '../Camera';

export interface Point {
  x: number;
  y: number;
}

/**
 * Box2D Physics Engine
 */
export class Box2DEngine {
  private world: b2World | null = null;
  private terrainBodies: b2Body[] = [];
  private accumulator = 0;
  private debugDrawEnabled = false;
  private fixedUpdateCallbacks: ((dt: number) => void)[] = [];

  // Physics constants
  private readonly PHYSICS_HZ = 60;
  private readonly PHYSICS_DT = 1 / 60; // ~16.67ms
  private readonly FIXED_DT_MS = 1000 / 60; // 16.67ms
  private readonly VELOCITY_ITERATIONS = 8;
  private readonly POSITION_ITERATIONS = 8; // Increased for better CCD and collision resolution

  constructor() {}

  /**
   * Initialize the Box2D world
   */
  async init(): Promise<void> {
    // console.log('[Box2DEngine] Initializing Box2D world...');

    // Create world with gravity (0, 10) m/s² (Y-down)
    const gravity = new b2Vec2(0, 10);
    this.world = b2World.Create(gravity);

    // console.log('[Box2DEngine] Box2D world initialized');
  }

  /**
   * Get the Box2D world
   */
  getWorld(): b2World {
    if (!this.world) {
      throw new Error('[Box2DEngine] World not initialized! Call init() first.');
    }
    return this.world;
  }

  /**
   * Register a fixed update callback
   * These callbacks are called before each physics step at 60Hz
   */
  registerFixedUpdate(callback: (dt: number) => void): void {
    this.fixedUpdateCallbacks.push(callback);
  }

  /**
   * Update terrain colliders from marching squares loops
   * Uses b2ChainShape for exact boundary representation
   */
  setTerrainLoops(loops: Point[][]): void {
    if (!this.world) {
      // console.error('[Box2DEngine] World not initialized!');
      return;
    }

    // Remove old terrain bodies
    for (const body of this.terrainBodies) {
      this.world.DestroyBody(body);
    }
    this.terrainBodies = [];

    let totalSegments = 0;
    let closedLoops = 0;
    let openChains = 0;

    for (const loop of loops) {
      if (loop.length < 2) continue;

      // Create static body for this terrain loop
      const body = this.world.CreateBody({
        type: b2BodyType.b2_staticBody,
      });

      // Convert loop to b2Vec2 array
      const vertices = loop.map(p => new b2Vec2(p.x, p.y));

      // Check if loop is properly closed (first ≈ last)
      const firstPoint = vertices[0];
      const lastPoint = vertices[vertices.length - 1];
      const dx = lastPoint.x - firstPoint.x;
      const dy = lastPoint.y - firstPoint.y;
      const distance = Math.sqrt(dx * dx + dy * dy);
      const isClosed = distance < 0.01; // Within 1cm tolerance

      // CRITICAL FIX: Reverse winding order for correct Box2D collision surface direction
      // Our loops are CCW with rock INSIDE, but Box2D CreateLoop needs collision surface
      // facing OUTWARD toward the cave. Reversing to CW accomplishes this.
      const reversedVertices = [...vertices].reverse();

      // Create chain shape
      const chainShape = new b2ChainShape();

      if (isClosed) {
        // Remove duplicate last vertex and create closed loop
        const loopVertices = reversedVertices.slice(0, -1);
        console.log(`[Box2D] Created closed loop with ${loopVertices.length} vertices (REVERSED winding for collision surface)`);
        chainShape.CreateLoop(loopVertices, loopVertices.length);
        closedLoops++;
      } else {
        // Create open chain with ghost vertices (also reversed)
        const prevVertex = reversedVertices[0];
        const nextVertex = reversedVertices[reversedVertices.length - 1];
        console.log(`[Box2D] Created open chain with ${reversedVertices.length} vertices (REVERSED winding)`);
        chainShape.CreateChain(reversedVertices, reversedVertices.length, prevVertex, nextVertex);
        openChains++;
        console.warn(`[Box2DEngine] Non-closed loop detected! Distance: ${distance.toFixed(4)}m`);
      }

      // Create fixture with physics properties
      body.CreateFixture({
        shape: chainShape,
        friction: 0.3,
        restitution: 0.1,
        density: 0, // Static body
      });
      this.terrainBodies.push(body);

      totalSegments += loop.length - 1;
    }

    // console.log(`[Box2DEngine] Created ${this.terrainBodies.length} terrain bodies (${totalSegments} segments)`);
    // console.log(`[Box2DEngine] Loop closure: ${closedLoops} closed, ${openChains} open`);
  }

  /**
   * Step physics with fixed timestep accumulator
   */
  step(dt: number): void {
    if (!this.world) {
      // console.error('[Box2DEngine] World not initialized!');
      return;
    }

    // Convert dt to seconds
    const dtSeconds = dt / 1000;
    this.accumulator += dtSeconds;

    // Step physics at fixed rate (60 Hz)
    while (this.accumulator >= this.PHYSICS_DT) {
      // Call fixed update callbacks BEFORE physics step
      for (const callback of this.fixedUpdateCallbacks) {
        callback(this.FIXED_DT_MS); // Pass dt in milliseconds
      }

      // Step Box2D physics
      this.world.Step(
        this.PHYSICS_DT,
        {
          velocityIterations: this.VELOCITY_ITERATIONS,
          positionIterations: this.POSITION_ITERATIONS,
        }
      );

      this.accumulator -= this.PHYSICS_DT;
    }
  }

  /**
   * Enable or disable debug rendering
   */
  setDebugEnabled(enabled: boolean): void {
    this.debugDrawEnabled = enabled;
  }

  /**
   * Render debug visualization
   * TODO: Implement proper debug drawing when @box2d/debug-draw is working
   */
  debugDraw(ctx: CanvasRenderingContext2D, camera: Camera, canvasWidth: number, canvasHeight: number): void {
    if (!this.world || !this.debugDrawEnabled) return;

    ctx.save();

    // Draw terrain bodies (green)
    ctx.strokeStyle = 'rgba(0, 255, 0, 0.5)';
    ctx.lineWidth = 2;

    for (const body of this.terrainBodies) {
      const fixtures = [];
      let fixture = body.GetFixtureList();
      while (fixture) {
        fixtures.push(fixture);
        fixture = fixture.GetNext();
      }

      for (const fixture of fixtures) {
        const shape = fixture.GetShape();
        if (shape.GetType() === 3) { // b2Shape.e_chain
          // Draw chain shape
          const chainShape = shape as any;
          const vertexCount = chainShape.m_count;
          const vertices = chainShape.m_vertices;

          if (vertexCount > 0) {
            ctx.beginPath();
            const firstScreen = camera.worldToScreen(vertices[0].x, vertices[0].y, canvasWidth, canvasHeight);
            ctx.moveTo(firstScreen.x, firstScreen.y);

            for (let i = 1; i < vertexCount; i++) {
              const screen = camera.worldToScreen(vertices[i].x, vertices[i].y, canvasWidth, canvasHeight);
              ctx.lineTo(screen.x, screen.y);
            }

            ctx.stroke();
          }
        }
      }
    }

    // Draw all other bodies (kinematic and dynamic) - blue
    ctx.strokeStyle = 'rgba(0, 150, 255, 0.8)';
    ctx.fillStyle = 'rgba(0, 150, 255, 0.3)';
    ctx.lineWidth = 2;

    let body = this.world.GetBodyList();
    while (body) {
      const bodyType = body.GetType();

      // Skip static bodies (already drawn as terrain)
      if (bodyType !== b2BodyType.b2_staticBody) {
        const position = body.GetPosition();
        const angle = body.GetAngle();

        let fixture = body.GetFixtureList();
        while (fixture) {
          const shape = fixture.GetShape();

          if (shape.GetType() === 0) { // b2Shape.e_circle
            const circleShape = shape as any;
            const circlePos = circleShape.m_p; // Local position of circle center
            const radius = circleShape.m_radius;

            // Transform circle center to world space
            const worldX = position.x + circlePos.x * Math.cos(angle) - circlePos.y * Math.sin(angle);
            const worldY = position.y + circlePos.x * Math.sin(angle) + circlePos.y * Math.cos(angle);
            const screen = camera.worldToScreen(worldX, worldY, canvasWidth, canvasHeight);
            const screenRadius = radius * camera.zoom;

            ctx.beginPath();
            ctx.arc(screen.x, screen.y, screenRadius, 0, Math.PI * 2);
            ctx.fill();
            ctx.stroke();
          } else if (shape.GetType() === 2) { // b2Shape.e_polygon
            const polygonShape = shape as any;
            const vertices = polygonShape.m_vertices;
            const vertexCount = polygonShape.m_count;

            if (vertexCount > 0) {
              ctx.beginPath();

              // Transform and draw first vertex
              const x0 = position.x + vertices[0].x * Math.cos(angle) - vertices[0].y * Math.sin(angle);
              const y0 = position.y + vertices[0].x * Math.sin(angle) + vertices[0].y * Math.cos(angle);
              const screen0 = camera.worldToScreen(x0, y0, canvasWidth, canvasHeight);
              ctx.moveTo(screen0.x, screen0.y);

              // Draw remaining vertices
              for (let i = 1; i < vertexCount; i++) {
                const xi = position.x + vertices[i].x * Math.cos(angle) - vertices[i].y * Math.sin(angle);
                const yi = position.y + vertices[i].x * Math.sin(angle) + vertices[i].y * Math.cos(angle);
                const screeni = camera.worldToScreen(xi, yi, canvasWidth, canvasHeight);
                ctx.lineTo(screeni.x, screeni.y);
              }

              ctx.closePath();
              ctx.fill();
              ctx.stroke();
            }
          }

          fixture = fixture.GetNext();
        }
      }

      body = body.GetNext();
    }

    ctx.restore();
  }

  /**
   * Cleanup
   */
  destroy(): void {
    if (this.world) {
      // Bodies are destroyed automatically when world is destroyed
      this.terrainBodies = [];
      this.world = null;
    }
    this.fixedUpdateCallbacks = [];
  }
}
