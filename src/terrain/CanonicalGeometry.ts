import { b2Body, b2ChainShape, b2Fixture, b2Vec2 } from '@box2d/core';
import type { Point } from '../types';

export type VertexId = number;
export type SegmentId = number;
export type LoopId = number;

export interface AABB {
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
}

export interface CanonicalVertex {
  id: VertexId;
  x: number;
  y: number;
  segmentA: SegmentId | null;
  segmentB: SegmentId | null;
}

export interface CanonicalLoop {
  id: LoopId;
  vertices: CanonicalVertex[];
  aabb: AABB;
  isClosed: boolean;
}

export interface PhysicsSegment {
  id: SegmentId;
  loopId: LoopId;
  startIndex: number;
  endIndex: number; // inclusive
  fixture: b2Fixture | null;
  aabb: AABB;
}

/**
 * ID allocation (simple monotonic counters – acceptable for runtime use)
 */
let nextLoopId: LoopId = 1;
let nextVertexId: VertexId = 1;
let nextSegmentId: SegmentId = 1;

export function allocateLoopId(): LoopId {
  return nextLoopId++;
}

export function allocateVertexId(): VertexId {
  return nextVertexId++;
}

export function allocateSegmentId(): SegmentId {
  return nextSegmentId++;
}

/**
 * Build a canonical loop from a raw Point[].
 * - Drops duplicate last vertex if the loop is already closed
 * - Assigns stable vertex IDs
 * - Computes and caches AABB
 */
export function createCanonicalLoop(points: Point[], loopId?: LoopId): CanonicalLoop {
  const id = loopId ?? allocateLoopId();
  const verts: CanonicalVertex[] = [];

  if (points.length === 0) {
    return {
      id,
      vertices: [],
      aabb: { minX: 0, minY: 0, maxX: 0, maxY: 0 },
      isClosed: false,
    };
  }

  // Detect duplicate last vertex to mark closed loops (keep vertex to preserve closing edge)
  const first = points[0];
  const last = points[points.length - 1];
  const dx = last.x - first.x;
  const dy = last.y - first.y;
  const isClosed = Math.hypot(dx, dy) < 0.01;

  for (const p of points) {
    verts.push({
      id: allocateVertexId(),
      x: p.x,
      y: p.y,
      segmentA: null,
      segmentB: null,
    });
  }

  const aabb = computeLoopAabbFromVertices(verts);

  return {
    id,
    vertices: verts,
    aabb,
    isClosed,
  };
}

/**
 * Compute AABB for a canonical loop
 */
export function computeLoopAabbFromVertices(vertices: CanonicalVertex[]): AABB {
  if (vertices.length === 0) {
    return { minX: 0, minY: 0, maxX: 0, maxY: 0 };
  }

  let minX = vertices[0].x;
  let minY = vertices[0].y;
  let maxX = vertices[0].x;
  let maxY = vertices[0].y;

  for (const v of vertices) {
    minX = Math.min(minX, v.x);
    minY = Math.min(minY, v.y);
    maxX = Math.max(maxX, v.x);
    maxY = Math.max(maxY, v.y);
  }

  return { minX, minY, maxX, maxY };
}

/**
 * Compute AABB for a segment within a canonical loop (inclusive indices)
 */
export function computeSegmentAabb(loop: CanonicalLoop, startIndex: number, endIndex: number): AABB {
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;

  for (let i = startIndex; i <= endIndex; i++) {
    const v = loop.vertices[i];
    minX = Math.min(minX, v.x);
    minY = Math.min(minY, v.y);
    maxX = Math.max(maxX, v.x);
    maxY = Math.max(maxY, v.y);
  }

  return { minX, minY, maxX, maxY };
}

/**
 * Split a canonical loop into bounded physics segments.
 * Segment boundaries align to canonical vertices only.
 */
export function buildSegmentsForLoop(
  loop: CanonicalLoop,
  maxSegmentVerts: number,
  maxSegmentLength: number
): PhysicsSegment[] {
  const result: PhysicsSegment[] = [];
  const verts = loop.vertices;

  // Clear back-links before reassigning
  for (const v of verts) {
    v.segmentA = null;
    v.segmentB = null;
  }

  const lastIndex = verts.length - 1;
  let startIndex = 0;

  while (startIndex < lastIndex) {
    let endIndex = startIndex;
    let length = 0;
    let count = 1;

    while (endIndex < lastIndex) {
      const v0 = verts[endIndex];
      const v1 = verts[endIndex + 1];
      length += Math.hypot(v1.x - v0.x, v1.y - v0.y);
      endIndex++;
      count++;

      const overVerts = count >= maxSegmentVerts;
      const overLen = length >= maxSegmentLength;
      if (overVerts || overLen) break;
    }

    const segId = allocateSegmentId();
    const seg: PhysicsSegment = {
      id: segId,
      loopId: loop.id,
      startIndex,
      endIndex,
      fixture: null,
      aabb: computeSegmentAabb(loop, startIndex, endIndex),
    };

    // Update vertex → segment back-links
    for (let i = startIndex; i <= endIndex; i++) {
      const cv = verts[i];
      if (cv.segmentA === null) cv.segmentA = segId;
      else if (cv.segmentB === null) cv.segmentB = segId;
      else {
        // This should never happen; keep going but surface noise in dev.
        if (typeof process === 'undefined' || process.env?.NODE_ENV !== 'production') {
          console.warn('[CanonicalGeometry] Vertex used by >2 segments', cv.id);
        }
      }
    }

    result.push(seg);
    startIndex = endIndex;
  }

  return result;
}

/**
 * Build a chain fixture for a physics segment on the provided body.
 * Returns null if the segment is degenerate or invalid.
 */
export function createFixtureForSegment(
  worldBody: b2Body,
  loop: CanonicalLoop,
  seg: PhysicsSegment,
  friction: number,
  restitution: number,
  reverseWinding: boolean = false
): b2Fixture | null {
  // Guard against invalid index ranges
  if (seg.startIndex < 0 || seg.endIndex >= loop.vertices.length || seg.startIndex >= seg.endIndex) {
    console.warn('[CanonicalGeometry] Skipping invalid segment in fixture creation', {
      loopId: loop.id,
      startIndex: seg.startIndex,
      endIndex: seg.endIndex,
      vertexCount: loop.vertices.length,
    });
    seg.fixture = null;
    return null;
  }

  const verts: b2Vec2[] = [];
  for (let i = seg.startIndex; i <= seg.endIndex; i++) {
    const v = loop.vertices[i];
    if (!v) {
      console.warn('[CanonicalGeometry] Skipping segment with out-of-range vertex during fixture build', {
        loopId: loop.id,
        index: i,
        startIndex: seg.startIndex,
        endIndex: seg.endIndex,
        vertexCount: loop.vertices.length,
      });
      seg.fixture = null;
      return null;
    }
    verts.push(new b2Vec2(v.x, v.y));
  }

  if (verts.length < 2) {
    console.warn('[CanonicalGeometry] Skipping segment with <2 verts in fixture build', {
      loopId: loop.id,
      startIndex: seg.startIndex,
      endIndex: seg.endIndex,
      vertsLength: verts.length,
    });
    seg.fixture = null;
    return null;
  }

  if (reverseWinding) {
    verts.reverse();
  }

  const chain = new b2ChainShape();
  // Box2D requires ghost vertices (prev/next) for chain shapes
  const prev = verts[0];
  const next = verts[verts.length - 1];
  chain.CreateChain(verts, verts.length, prev, next);

  const fixture = worldBody.CreateFixture({
    shape: chain,
    friction,
    restitution,
    density: 0, // static
  });
  seg.fixture = fixture;
  return fixture;
}

/**
 * Dev-only sanity checks to keep invariant drift visible.
 */
export function validateSegments(loop: CanonicalLoop, segments: PhysicsSegment[]): void {
  if (typeof process !== 'undefined' && process.env.NODE_ENV === 'production') return;

  for (const seg of segments) {
    if (seg.startIndex < 0 || seg.endIndex >= loop.vertices.length || seg.startIndex >= seg.endIndex) {
      console.warn('[CanonicalGeometry] Invalid segment indices', seg);
    }
    for (let i = seg.startIndex; i <= seg.endIndex; i++) {
      const v = loop.vertices[i];
      const owns =
        v.segmentA === seg.id ||
        v.segmentB === seg.id;
      if (!owns) {
        console.warn('[CanonicalGeometry] Vertex missing back-link', { vertex: v.id, seg: seg.id });
      }
    }

    const { minX, minY, maxX, maxY } = seg.aabb;
    if (minX > maxX || minY > maxY) {
      console.warn('[CanonicalGeometry] Invalid segment AABB', seg);
    }
  }
}
