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

export interface AABB {
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
}

interface TerrainBodyInfo {
  body: b2Body;
  aabb: AABB;
  originalLoop: Point[]; // Store original vertices for loop cutting
}

/**
 * Box2D Physics Engine
 */
export class Box2DEngine {
  private world: b2World | null = null;
  private terrainBodies: TerrainBodyInfo[] = [];
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
    // Create world with gravity (0, 10) m/s² (Y-down)
    const gravity = new b2Vec2(0, 10);
    this.world = b2World.Create(gravity);
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
   * @param loops - Array of vertex loops
   * @param shouldReverse - Optional array indicating which loops to reverse (for cave boundaries vs rock islands)
   */
  setTerrainLoops(loops: Point[][], shouldReverse?: boolean[]): void {
    if (!this.world) {
      return;
    }

    // Remove old terrain bodies
    for (const bodyInfo of this.terrainBodies) {
      this.world.DestroyBody(bodyInfo.body);
    }
    this.terrainBodies = [];

    let totalSegments = 0;
    let closedLoops = 0;
    let openChains = 0;

    for (let loopIndex = 0; loopIndex < loops.length; loopIndex++) {
      const loop = loops[loopIndex];
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

      // CRITICAL FIX: Conditionally reverse winding order based on loop type
      // Cave boundaries (rock inside, cave outside): Reverse CCW→CW so collision faces outward (toward cave)
      // Rock islands (cave inside, rock outside): Keep CCW so collision faces outward (toward cave)
      // Default to reversing if no classification provided (backwards compatibility)
      const shouldReverseLoop = shouldReverse ? shouldReverse[loopIndex] : true;
      const reversedVertices = shouldReverseLoop ? [...vertices].reverse() : vertices;

      // Create chain shape
      const chainShape = new b2ChainShape();

      if (isClosed) {
        // Remove duplicate last vertex and create closed loop
        const loopVertices = reversedVertices.slice(0, -1);
        chainShape.CreateLoop(loopVertices, loopVertices.length);
        closedLoops++;
      } else {
        // Create open chain with ghost vertices
        const prevVertex = reversedVertices[0];
        const nextVertex = reversedVertices[reversedVertices.length - 1];
        chainShape.CreateChain(reversedVertices, reversedVertices.length, prevVertex, nextVertex);
        openChains++;
      }

      // Create fixture with physics properties
      body.CreateFixture({
        shape: chainShape,
        friction: 0.3,
        restitution: 0.1,
        density: 0, // Static body
      });

      // Compute AABB for this loop
      const aabb = this.computeLoopAABB(loop);
      this.terrainBodies.push({ body, aabb, originalLoop: loop });

      totalSegments += loop.length - 1;
    }
  }

  /**
   * Step physics with fixed timestep accumulator
   */
  step(dt: number): void {
    if (!this.world) {
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

    for (const bodyInfo of this.terrainBodies) {
      const body = bodyInfo.body;
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
   * Compute AABB for a loop of points
   */
  private computeLoopAABB(loop: Point[]): AABB {
    let minX = Infinity;
    let minY = Infinity;
    let maxX = -Infinity;
    let maxY = -Infinity;

    for (const p of loop) {
      minX = Math.min(minX, p.x);
      minY = Math.min(minY, p.y);
      maxX = Math.max(maxX, p.x);
      maxY = Math.max(maxY, p.y);
    }

    return { minX, minY, maxX, maxY };
  }

  /**
   * Check if two AABBs intersect
   */
  private aabbsIntersect(a: AABB, b: AABB): boolean {
    return !(a.maxX < b.minX || a.minX > b.maxX || a.maxY < b.minY || a.minY > b.maxY);
  }

  /**
   * Count how many vertices of a loop are inside the given region
   * Returns the count and total vertex count
   */
  private countVerticesInRegion(loop: Point[], region: AABB): { inside: number; total: number } {
    let insideCount = 0;
    for (const vertex of loop) {
      if (vertex.x >= region.minX && vertex.x <= region.maxX &&
          vertex.y >= region.minY && vertex.y <= region.maxY) {
        insideCount++;
      }
    }
    return { inside: insideCount, total: loop.length };
  }

  /**
   * Remove terrain bodies whose vertices significantly intersect the given region
   * Uses vertex-based testing with a threshold to avoid removing barely-touched loops
   * @param region - The dirty region AABB
   * @param vertexThreshold - Minimum fraction of vertices that must be inside (default: 0.05 = 5%)
   * Returns the number of bodies removed
   */
  removeTerrainInRegion(region: AABB, vertexThreshold: number = 0.05): number {
    if (!this.world) {
      console.error('[Box2DEngine] World not initialized!');
      return 0;
    }

    const bodiesToRemove: TerrainBodyInfo[] = [];
    const bodiesToKeep: TerrainBodyInfo[] = [];
    let skippedCount = 0;

    // Partition bodies into remove/keep based on vertex intersection
    for (const bodyInfo of this.terrainBodies) {
      // First check: does AABB intersect at all?
      if (!this.aabbsIntersect(bodyInfo.aabb, region)) {
        bodiesToKeep.push(bodyInfo);
        continue;
      }

      // AABB intersects - now check vertex-level intersection
      const vertexCount = this.countVerticesInRegion(bodyInfo.originalLoop, region);
      const fraction = vertexCount.inside / vertexCount.total;

      if (fraction >= vertexThreshold) {
        // Significant portion of loop is affected - remove it
        bodiesToRemove.push(bodyInfo);
      } else {
        // Only barely touched - keep it to avoid unnecessary regeneration
        bodiesToKeep.push(bodyInfo);
        skippedCount++;
      }
    }

    if (skippedCount > 0) {
      console.log(`[Box2DEngine] Skipped ${skippedCount} loops (vertex overlap < ${(vertexThreshold * 100).toFixed(1)}%)`);
    }

    // Destroy bodies that significantly intersect the region
    for (const bodyInfo of bodiesToRemove) {
      this.world.DestroyBody(bodyInfo.body);
    }

    // Update terrain bodies list
    this.terrainBodies = bodiesToKeep;

    return bodiesToRemove.length;
  }

  /**
   * Add terrain loops without removing existing ones (for incremental updates)
   * Similar to setTerrainLoops but appends instead of replacing
   * @param loops - Array of vertex loops
   * @param shouldReverse - Optional array indicating which loops to reverse
   */
  addTerrainLoops(loops: Point[][], shouldReverse?: boolean[]): number {
    if (!this.world) {
      console.error('[Box2DEngine] World not initialized!');
      return 0;
    }

    let totalSegments = 0;
    let closedLoops = 0;
    let openChains = 0;
    let addedBodies = 0;

    for (let loopIndex = 0; loopIndex < loops.length; loopIndex++) {
      const loop = loops[loopIndex];
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

      // Conditionally reverse winding order based on loop type
      const shouldReverseLoop = shouldReverse ? shouldReverse[loopIndex] : true;
      const reversedVertices = shouldReverseLoop ? [...vertices].reverse() : vertices;

      // Create chain shape
      const chainShape = new b2ChainShape();

      if (isClosed) {
        // Remove duplicate last vertex and create closed loop
        const loopVertices = reversedVertices.slice(0, -1);
        chainShape.CreateLoop(loopVertices, loopVertices.length);
        closedLoops++;
      } else {
        // Create open chain with ghost vertices
        const prevVertex = reversedVertices[0];
        const nextVertex = reversedVertices[reversedVertices.length - 1];
        chainShape.CreateChain(reversedVertices, reversedVertices.length, prevVertex, nextVertex);
        openChains++;
      }

      // Create fixture with physics properties
      body.CreateFixture({
        shape: chainShape,
        friction: 0.3,
        restitution: 0.1,
        density: 0, // Static body
      });

      // Compute AABB for this loop
      const aabb = this.computeLoopAABB(loop);
      this.terrainBodies.push({ body, aabb, originalLoop: loop });

      totalSegments += loop.length - 1;
      addedBodies++;
    }

    return addedBodies;
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
