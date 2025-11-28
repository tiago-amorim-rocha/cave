import { b2Body, b2ChainShape, b2Fixture, b2Vec2 } from '@box2d/core';
import type { Point } from '../types';
import { cleanLoop } from '../physics/shapeUtils';

export type VertexId = number;
export type SegmentId = number;
export type LoopId = number;

export interface AABB {
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
}

export interface CanonVertex {
  x: number;
  y: number;
}

export interface CanonicalVertex extends CanonVertex {
  id: VertexId;
  segmentA: SegmentId | null;
  segmentB: SegmentId | null;
}

export interface OptVertex {
  x: number;
  y: number;
  canonStartId: VertexId;
  canonEndId: VertexId;
}

export type ReusePlanSegmentKind = 'reuse-head' | 'reuse-tail' | 'dirty';

export interface ReusePlanSegment {
  kind: ReusePlanSegmentKind;
  points: Point[];
}

export interface ReusePlanDebug {
  sourceCanonicalId: LoopId;
  stitchedLoopId: number;
  segments: ReusePlanSegment[];
}

export interface CanonicalLoop {
  id: LoopId;
  vertices: CanonicalVertex[];
  aabb: AABB;
  version: number;
  isClosed: boolean;
  // Cached optimized/segment ancestry (for local updates)
  optVertices?: OptVertex[];
  segments?: PhysicsSegment[];
  // Debug-only preview for reuse plan visualization
  debugPreviewOptVertices?: OptVertex[];
  debugReusePlan?: ReusePlanDebug;
}

export interface PhysicsSegment {
  id: SegmentId;
  loopCanonicalId: LoopId;
  optStart: number;
  optEnd: number; // inclusive
  canonicalStart: number;
  canonicalEnd: number;
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
      version: 1,
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

  const aabb = computeLoopAABB(verts);

  return {
    id,
    vertices: verts,
    aabb,
    version: 1,
    isClosed,
  };
}

/**
 * Compute AABB for a canonical loop
 */
export function computeLoopAABB(vertices: CanonVertex[]): AABB {
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

// Backwards compatibility alias (legacy naming)
export function computeLoopAabbFromVertices(vertices: CanonicalVertex[]): AABB {
  return computeLoopAABB(vertices);
}

/**
 * Compute AABB for a segment within a canonical loop (inclusive indices)
 */
export function computeSegmentAabb(loop: { vertices: CanonVertex[] | OptVertex[] }, startIndex: number, endIndex: number): AABB {
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
  loopId: LoopId,
  vertices: OptVertex[],
  maxSegmentVerts: number,
  maxSegmentLength: number,
  targetSegmentLength: number,
  lengthTolerance: number
): PhysicsSegment[] {
  const result: PhysicsSegment[] = [];
  const verts = vertices;

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
      const minLen = targetSegmentLength * (1 - lengthTolerance);
      const maxLen = targetSegmentLength * (1 + lengthTolerance);
      const hitTargetBand = length >= minLen && length <= maxLen;
      if (overVerts || overLen || hitTargetBand) break;
    }

    const segId = allocateSegmentId();
    let canonStart = Infinity;
    let canonEnd = -Infinity;
    for (let i = startIndex; i <= endIndex; i++) {
      canonStart = Math.min(canonStart, verts[i].canonStartId);
      canonEnd = Math.max(canonEnd, verts[i].canonEndId);
    }

    const seg: PhysicsSegment = {
      id: segId,
      loopCanonicalId: loopId,
      optStart: startIndex,
      optEnd: endIndex,
      canonicalStart: canonStart,
      canonicalEnd: canonEnd,
      fixture: null,
      aabb: computeSegmentAabb({ vertices: verts }, startIndex, endIndex),
    };

    result.push(seg);
    startIndex = endIndex;
  }

  return result;
}

/**
 * Replace a canonical range with new vertices. Returns new canonical loops (can split/merge).
 * gridPitch is required for cleanLoop hygiene.
 */
export function replaceCanonicalRange(
  loop: CanonicalLoop,
  startIdx: number,
  endIdx: number,
  newVertices: CanonVertex[],
  gridPitch: number
): CanonicalLoop[] {
  if (startIdx < 0 || endIdx >= loop.vertices.length || startIdx > endIdx) {
    throw new Error('[CanonSurgery] Invalid range');
  }

  const before = loop.vertices.slice(0, startIdx).map(v => ({ x: v.x, y: v.y }));
  const after = loop.vertices.slice(endIdx + 1).map(v => ({ x: v.x, y: v.y }));
  const replacement = newVertices.map(v => ({ x: v.x, y: v.y }));

  const combined: Point[] = [...before, ...replacement, ...after];
  const cleaned = cleanLoop(combined, gridPitch);

  const resultLoops: CanonicalLoop[] = [];
  if (cleaned.length === 0) {
    console.log('[CanonSurgery] Replacing range yielded empty loop', { loopId: loop.id });
    return resultLoops;
  }

  // Split into sub-loops if concatenated closures appear (simple splitter)
  const loops: Point[][] = [];
  let current: Point[] = [];
  for (let i = 0; i < cleaned.length; i++) {
    const p = cleaned[i];
    if (current.length === 0) {
      current.push({ x: p.x, y: p.y });
      continue;
    }
    current.push({ x: p.x, y: p.y });
    const first = current[0];
    const isClosure = Math.abs(p.x - first.x) < 1e-6 && Math.abs(p.y - first.y) < 1e-6 && current.length > 2;
    if (isClosure) {
      loops.push(current.slice());
      current = [];
    }
  }
  if (current.length >= 3) {
    // Ensure closure for the last loop
    const first = current[0];
    const last = current[current.length - 1];
    if (Math.abs(first.x - last.x) > 1e-6 || Math.abs(first.y - last.y) > 1e-6) {
      current.push({ x: first.x, y: first.y });
    }
    loops.push(current);
  }

  const loopsToBuild = loops.length > 0 ? loops : [cleaned];
  for (const pts of loopsToBuild) {
    const canon = createCanonicalLoop(pts);
    canon.version = loop.version + 1;
    resultLoops.push(canon);
  }

  console.log('[CanonSurgery] Replacing range', {
    loopId: loop.id,
    oldRange: [startIdx, endIdx],
    newVerts: newVertices.length,
    resultLoops: resultLoops.length,
    topologyChange: resultLoops.length !== 1
  });

  return resultLoops;
}

/**
 * Build a chain fixture for a physics segment on the provided body.
 * Returns null if the segment is degenerate or invalid.
 */
export function createFixtureForSegment(
  worldBody: b2Body,
  vertices: OptVertex[],
  seg: PhysicsSegment,
  friction: number,
  restitution: number,
  reverseWinding: boolean = false
): b2Fixture | null {
  // Guard against invalid index ranges
  if (seg.optStart < 0 || seg.optEnd >= vertices.length || seg.optStart >= seg.optEnd) {
    console.warn('[CanonicalGeometry] Skipping invalid segment in fixture creation', {
      loopId: seg.loopCanonicalId,
      startIndex: seg.optStart,
      endIndex: seg.optEnd,
      vertexCount: vertices.length,
    });
    seg.fixture = null;
    return null;
  }

  const verts: b2Vec2[] = [];
  for (let i = seg.optStart; i <= seg.optEnd; i++) {
    const v = vertices[i];
    if (!v) {
      console.warn('[CanonicalGeometry] Skipping segment with out-of-range vertex during fixture build', {
        loopId: seg.loopCanonicalId,
        index: i,
        startIndex: seg.optStart,
        endIndex: seg.optEnd,
        vertexCount: vertices.length,
      });
      seg.fixture = null;
      return null;
    }
    verts.push(new b2Vec2(v.x, v.y));
  }

  if (verts.length < 2) {
    console.warn('[CanonicalGeometry] Skipping segment with <2 verts in fixture build', {
      loopId: seg.loopCanonicalId,
      startIndex: seg.optStart,
      endIndex: seg.optEnd,
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
export function validateSegments(vertices: OptVertex[], segments: PhysicsSegment[]): void {
  if (typeof process !== 'undefined' && process.env.NODE_ENV === 'production') return;

  for (const seg of segments) {
    if (seg.optStart < 0 || seg.optEnd >= vertices.length || seg.optStart >= seg.optEnd) {
      console.warn('[CanonicalGeometry] Invalid segment indices', seg);
    }

    const { minX, minY, maxX, maxY } = seg.aabb;
    if (minX > maxX || minY > maxY) {
      console.warn('[CanonicalGeometry] Invalid segment AABB', seg);
    }
  }
}
