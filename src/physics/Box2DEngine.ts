/**
 * Box2D Physics Engine
 * Handles world creation, terrain collision, and physics stepping
 */

import {
  b2World,
  b2Vec2,
  b2Body,
  b2BodyType,
} from '@box2d/core';
import type { Camera } from '../Camera';
import {
  createCanonicalLoop,
  buildSegmentsForLoop,
  createFixtureForSegment,
  type CanonicalLoop,
  type PhysicsSegment,
  computeLoopAabbFromVertices,
  validateSegments,
  type OptVertex,
} from '../terrain/CanonicalGeometry';

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

export interface TerrainBodyInfo {
  body: b2Body;
  canonicalLoop: CanonicalLoop;
  optimizedLoop: OptVertex[];
  segments: PhysicsSegment[];
  aabb: AABB;
  shouldReverse: boolean;
  originalLoop: Point[];
}

const MAX_SEGMENT_VERTS = 64;
const MAX_SEGMENT_LENGTH = 20; // metres (absolute safety cap)
const TARGET_SEGMENT_LENGTH = 10; // metres (preferred, keeps well below 64 verts at 0.2m pitch)
const SEGMENT_LENGTH_TOLERANCE = 0.35; // ±35% around target
const TERRAIN_FRICTION = 0.3;
const TERRAIN_RESTITUTION = 0.1;

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

    const canonicalLoops = loops.map(createCanonicalLoop);
    const optLoops: OptVertex[][] = loops.map(loop =>
      loop.map((p, i) => ({ x: p.x, y: p.y, canonStart: i, canonEnd: i }))
    );
    this.setCanonicalTerrainLoops(canonicalLoops, optLoops, shouldReverse);
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

    // Draw terrain chains (green) and highlight individual segments
    for (const bodyInfo of this.terrainBodies) {
      const body = bodyInfo.body;

      // 1) Raw Box2D chain fixtures in green (baseline terrain)
      ctx.strokeStyle = 'rgba(0, 255, 0, 0.5)';
      ctx.lineWidth = 2;

      const fixtures: any[] = [];
      let fixture = body.GetFixtureList();
      while (fixture) {
        fixtures.push(fixture);
        fixture = fixture.GetNext();
      }

      for (const f of fixtures) {
        const shape = f.GetShape();
        if (shape.GetType() === 3) { // b2Shape.e_chain
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

      // 2) Canonical segments overlay: each PhysicsSegment range highlighted
      const loop = bodyInfo.optimizedLoop;
      const segments = bodyInfo.segments;
      if (loop && segments && segments.length > 0) {
        segments.forEach((seg, idx) => {
          if (seg.optStart < 0 || seg.optEnd >= loop.length) return;

          // Vary hue per segment to see stitching
          const hue = (idx * 47) % 360;
          ctx.strokeStyle = `hsla(${hue}, 80%, 60%, 0.9)`;
          ctx.lineWidth = 3;

          ctx.beginPath();
          const first = loop[seg.optStart];
          const firstScreen = camera.worldToScreen(first.x, first.y, canvasWidth, canvasHeight);
          ctx.moveTo(firstScreen.x, firstScreen.y);

          for (let i = seg.optStart + 1; i <= seg.optEnd; i++) {
            const v = loop[i];
            const s = camera.worldToScreen(v.x, v.y, canvasWidth, canvasHeight);
            ctx.lineTo(s.x, s.y);
          }
          ctx.stroke();

          // Mark segment endpoints
          const start = loop[seg.optStart];
          const end = loop[seg.optEnd];
          const startScreen = camera.worldToScreen(start.x, start.y, canvasWidth, canvasHeight);
          const endScreen = camera.worldToScreen(end.x, end.y, canvasWidth, canvasHeight);

          ctx.fillStyle = '#ff0000';
          ctx.beginPath();
          ctx.arc(startScreen.x, startScreen.y, 3, 0, Math.PI * 2);
          ctx.fill();

          ctx.fillStyle = '#0000ff';
          ctx.beginPath();
          ctx.arc(endScreen.x, endScreen.y, 3, 0, Math.PI * 2);
          ctx.fill();
        });
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
  /**
   * Check if two AABBs intersect
   */
  private aabbsIntersect(a: AABB, b: AABB): boolean {
    return !(a.maxX < b.minX || a.minX > b.maxX || a.maxY < b.minY || a.minY > b.maxY);
  }

  /**
   * Geometry helper: check whether a canonical loop touches an AABB (vertex inside or edge crosses).
   */
  private loopTouchesRegion(loop: CanonicalLoop, region: AABB): boolean {
    const pointInside = (p: Point) =>
      p.x >= region.minX && p.x <= region.maxX && p.y >= region.minY && p.y <= region.maxY;

    const segmentsIntersect = (a: Point, b: Point, c: Point, d: Point): boolean => {
      const cross = (p: Point, q: Point, r: Point) => (q.x - p.x) * (r.y - p.y) - (q.y - p.y) * (r.x - p.x);
      const onSegment = (p: Point, q: Point, r: Point) =>
        Math.min(p.x, r.x) - 1e-6 <= q.x && q.x <= Math.max(p.x, r.x) + 1e-6 &&
        Math.min(p.y, r.y) - 1e-6 <= q.y && q.y <= Math.max(p.y, r.y) + 1e-6;

      const o1 = cross(a, b, c);
      const o2 = cross(a, b, d);
      const o3 = cross(c, d, a);
      const o4 = cross(c, d, b);

      if (o1 === 0 && onSegment(a, c, b)) return true;
      if (o2 === 0 && onSegment(a, d, b)) return true;
      if (o3 === 0 && onSegment(c, a, d)) return true;
      if (o4 === 0 && onSegment(c, b, d)) return true;

      return (o1 > 0) !== (o2 > 0) && (o3 > 0) !== (o4 > 0);
    };

    const segmentIntersectsAABB = (p1: Point, p2: Point): boolean => {
      if (pointInside(p1) || pointInside(p2)) return true;

      // Quick reject by segment AABB
      const minX = Math.min(p1.x, p2.x);
      const maxX = Math.max(p1.x, p2.x);
      const minY = Math.min(p1.y, p2.y);
      const maxY = Math.max(p1.y, p2.y);
      if (maxX < region.minX || minX > region.maxX || maxY < region.minY || minY > region.maxY) {
        return false;
      }

      // Rectangle corners/edges
      const topLeft = { x: region.minX, y: region.minY };
      const topRight = { x: region.maxX, y: region.minY };
      const bottomLeft = { x: region.minX, y: region.maxY };
      const bottomRight = { x: region.maxX, y: region.maxY };

      return (
        segmentsIntersect(p1, p2, topLeft, topRight) ||
        segmentsIntersect(p1, p2, topRight, bottomRight) ||
        segmentsIntersect(p1, p2, bottomRight, bottomLeft) ||
        segmentsIntersect(p1, p2, bottomLeft, topLeft)
      );
    };

    // Any vertex inside?
    for (const v of loop.vertices) {
      if (pointInside(v)) return true;
    }

    // Any edge intersections?
    for (let i = 0; i < loop.vertices.length - 1; i++) {
      const p1 = loop.vertices[i];
      const p2 = loop.vertices[i + 1];
      if (segmentIntersectsAABB(p1, p2)) return true;
    }

    return false;
  }

  /**
   * Remove terrain bodies whose AABBs intersect the given region
   * Returns the number of bodies removed
   */
  removeTerrainInRegion(region: AABB): number {
    if (!this.world) {
      console.error('[Box2DEngine] World not initialized!');
      return 0;
    }

    const bodiesToRemove: TerrainBodyInfo[] = [];
    const bodiesToKeep: TerrainBodyInfo[] = [];

    // Partition bodies into remove/keep based on AABB intersection
    for (const bodyInfo of this.terrainBodies) {
      if (this.loopTouchesRegion(bodyInfo.canonicalLoop, region)) {
        bodiesToRemove.push(bodyInfo);
      } else {
        bodiesToKeep.push(bodyInfo);
      }
    }

    // Destroy bodies that intersect the region
    for (const bodyInfo of bodiesToRemove) {
      this.world.DestroyBody(bodyInfo.body);
    }

    // Update terrain bodies list
    this.terrainBodies = bodiesToKeep;

    return bodiesToRemove.length;
  }

  /**
   * Get terrain bodies that intersect with a given region
   * Used for loop patching - returns bodies without destroying them
   * @param region - AABB region to check for intersection
   * @returns Array of terrain body infos that intersect the region
   */
  getTerrainBodiesInRegion(region: AABB): TerrainBodyInfo[] {
    const affectedBodies: TerrainBodyInfo[] = [];

    for (const bodyInfo of this.terrainBodies) {
      if (this.aabbsIntersect(bodyInfo.aabb, region)) {
        affectedBodies.push(bodyInfo);
      }
    }

    return affectedBodies;
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

    const canonicalLoops = loops.map(createCanonicalLoop);
    return this.addCanonicalTerrainLoops(canonicalLoops, undefined, shouldReverse);
  }

  /**
   * Set terrain using canonical loops (single source of truth)
   */
  setCanonicalTerrainLoops(canonicalLoops: CanonicalLoop[], optimizedLoops?: OptVertex[][], shouldReverse?: boolean[]): void {
    if (!this.world) {
      console.error('[Box2DEngine] setCanonicalTerrainLoops called before world init');
      return;
    }

    console.log(`[Box2DEngine] setCanonicalTerrainLoops called with ${canonicalLoops.length} loops`);

    // Remove old terrain bodies
    for (const bodyInfo of this.terrainBodies) {
      this.world.DestroyBody(bodyInfo.body);
    }
    this.terrainBodies = [];

    for (let i = 0; i < canonicalLoops.length; i++) {
      const loop = canonicalLoops[i];
      const optLoop = optimizedLoops ? optimizedLoops[i] : loop.vertices.map((v, idx) => ({
        x: v.x,
        y: v.y,
        canonStart: idx,
        canonEnd: idx,
      }));
      if (loop.vertices.length < 2) {
        console.warn('[Box2DEngine] Skipping canonical loop with <2 verts', loop);
        continue;
      }
      const reverse = shouldReverse ? shouldReverse[i] : true;
      console.log(`[Box2DEngine] Building terrain body for loop #${i}, verts=${loop.vertices.length}, reverse=${reverse}`);
      const bodyInfo = this.buildTerrainBodyFromCanonical(loop, optLoop, reverse);
      this.terrainBodies.push(bodyInfo);
    }
    console.log(`[Box2DEngine] setCanonicalTerrainLoops finished; terrainBodies=${this.terrainBodies.length}`);
  }

  /**
   * Append terrain using canonical loops.
   */
  addCanonicalTerrainLoops(canonicalLoops: CanonicalLoop[], optimizedLoops?: OptVertex[][], shouldReverse?: boolean[]): number {
    if (!this.world) {
      console.error('[Box2DEngine] World not initialized!');
      return 0;
    }

    let added = 0;
    for (let i = 0; i < canonicalLoops.length; i++) {
      const loop = canonicalLoops[i];
      if (loop.vertices.length < 2) continue;
      const reverse = shouldReverse ? shouldReverse[i] : true;
      const optLoop = optimizedLoops ? optimizedLoops[i] : loop.vertices.map((v, idx) => ({
        x: v.x,
        y: v.y,
        canonStart: idx,
        canonEnd: idx,
      }));
      const bodyInfo = this.buildTerrainBodyFromCanonical(loop, optLoop, reverse);
      this.terrainBodies.push(bodyInfo);
      added++;
    }
    return added;
  }

  /**
   * Expose physics segments for a given loop ID (debug)
   */
  getSegmentsForLoop(loopId: number): PhysicsSegment[] {
    const segments: PhysicsSegment[] = [];
    for (const bodyInfo of this.terrainBodies) {
      if (bodyInfo.canonicalLoop.id === loopId) {
        segments.push(...bodyInfo.segments);
      }
    }
    return segments;
  }

  /**
   * Snapshot of all segments + optimized vertices for debug rendering
   */
  getSegmentDebugSnapshot(): Array<{ loopId: number; vertices: OptVertex[]; segments: PhysicsSegment[] }> {
    return this.terrainBodies.map(bodyInfo => ({
      loopId: bodyInfo.canonicalLoop.id,
      vertices: bodyInfo.optimizedLoop,
      segments: bodyInfo.segments,
    }));
  }

  /**
   * Build a physics body + fixtures from a canonical loop (keeps canonical ordering intact).
   */
  private buildTerrainBodyFromCanonical(loop: CanonicalLoop, optimizedLoop: OptVertex[], shouldReverse: boolean): TerrainBodyInfo {
    if (!this.world) {
      throw new Error('[Box2DEngine] buildTerrainBodyFromCanonical called without world');
    }

    const body = this.world.CreateBody({
      type: b2BodyType.b2_staticBody,
    });

    // Build fresh segments each time (resets vertex back-links)
    const segments = buildSegmentsForLoop(
      loop.id,
      optimizedLoop,
      MAX_SEGMENT_VERTS,
      MAX_SEGMENT_LENGTH,
      TARGET_SEGMENT_LENGTH,
      SEGMENT_LENGTH_TOLERANCE
    );
    validateSegments(optimizedLoop, segments);
    console.log(`[Box2DEngine] Loop ${loop.id}: built ${segments.length} segments (verts=${optimizedLoop.length})`);
    if (segments.length === 0) {
      console.warn('[Box2DEngine] No segments built for loop', { loopId: loop.id, vertices: loop.vertices.length });
    }

    segments.forEach((seg, idx) => {
      console.log('[Box2DEngine]  Segment', idx, {
        id: seg.id,
        optStart: seg.optStart,
        optEnd: seg.optEnd,
        canonRange: [seg.canonicalStart, seg.canonicalEnd],
      });
      const fixture = createFixtureForSegment(body, optimizedLoop, seg, TERRAIN_FRICTION, TERRAIN_RESTITUTION, shouldReverse);
      if (!fixture) {
        console.warn('[Box2DEngine]  Segment produced no fixture (skipped)');
      }
    });
    console.log('[Box2D] Created segments', {
      loopId: loop.id,
      segmentCount: segments.length,
      segments: segments.map(s => ({
        id: s.id,
        optRange: [s.optStart, s.optEnd],
        canonRange: [s.canonicalStart, s.canonicalEnd],
      }))
    });

    const aabb = loop.aabb ?? computeLoopAabbFromVertices(loop.vertices);

    return {
      body,
      canonicalLoop: loop,
      optimizedLoop,
      segments,
      aabb,
      shouldReverse,
      originalLoop: loop.vertices.map(v => ({ x: v.x, y: v.y })),
    };
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
