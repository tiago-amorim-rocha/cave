/**
 * Remesh Manager
 *
 * Handles all remeshing operations including:
 * - Full world remesh (periodic and on-demand)
 * - Incremental updates (future)
 * - Loop classification (rock vs cave)
 * - Integration with physics and rendering
 */

import type { DensityField } from './DensityField';
import type { MarchingSquares } from './MarchingSquares';
import type { LoopCache } from './LoopCache';
import type { Box2DPhysics } from './Box2DPhysics';
import type { Renderer } from './Renderer';
import { VertexOptimizationPipeline, type OptimizationOptions } from './VertexOptimizationPipeline';
import type { Point } from './types';
import { simplifyPolyline } from './PolylineSimplifier';
import { cleanLoop } from './physics/shapeUtils';
import { createCanonicalLoop, computeLoopAABB, replaceCanonicalRange, buildSegmentsForLoop, type CanonicalLoop, type CanonicalVertex, type OptVertex, type PhysicsSegment } from './terrain/CanonicalGeometry';
import { chaikinWithAncestry } from './terrain/ChaikinWithAncestry';

// Debug flag for loop classification - set to false to silence logs
const DEBUG_LOOP_CLASSIFICATION = true;

// Debug interfaces for loop classification analysis
interface DebugSamplePoint {
  x: number;
  y: number;
  density: number;
  side: "inside" | "outside";
  segmentIndex: number;
}

interface DebugLoopInfo {
  loopIndex?: number;
  area: number;
  centroid: { x: number; y: number };
  samples: DebugSamplePoint[];
}

/**
 * Compute signed area of a polygon
 * Positive area = CCW winding, Negative area = CW winding
 */
function computePolygonArea(loop: Point[]): number {
  let area = 0;
  const n = loop.length;
  for (let i = 0; i < n; i++) {
    const p = loop[i];
    const q = loop[(i + 1) % n];
    area += (p.x * q.y - q.x * p.y);
  }
  return area * 0.5;
}

/**
 * Compute centroid of a polygon using the shoelace formula
 */
function computePolygonCentroid(loop: Point[]): { x: number; y: number } {
  let areaAcc = 0;
  let cxAcc = 0;
  let cyAcc = 0;
  const n = loop.length;
  for (let i = 0; i < n; i++) {
    const p = loop[i];
    const q = loop[(i + 1) % n];
    const cross = p.x * q.y - q.x * p.y;
    areaAcc += cross;
    cxAcc += (p.x + q.x) * cross;
    cyAcc += (p.y + q.y) * cross;
  }
  const area = areaAcc * 0.5;
  if (Math.abs(area) < 1e-8) {
    // Fallback: simple average of vertices for degenerate cases
    let sx = 0, sy = 0;
    for (let i = 0; i < n; i++) {
      sx += loop[i].x;
      sy += loop[i].y;
    }
    return { x: sx / n, y: sy / n };
  }
  const f = 1 / (6 * area);
  return {
    x: cxAcc * f,
    y: cyAcc * f,
  };
}

export interface RemeshConfig {
  densityField: DensityField;
  marchingSquares: MarchingSquares;
  loopCache: LoopCache;
  physics: Box2DPhysics;
  renderer: Renderer;
  optimizationOptions: OptimizationOptions;
}

export interface RemeshStats {
  originalVertexCount: number;
  finalVertexCount: number;
  simplificationReduction: number;
  postSimplificationReduction: number;
}

export interface LocalUpdateSurgeryResult {
  oldLoopId: number;
  matchedNewLoopId: number | null;
  resultLoops: CanonicalLoop[];
}

export interface LocalUpdateSession {
  expandCells: number;
  gridPitch: number;
  dirtyAABB: { minX: number; minY: number; maxX: number; maxY: number };
  paddedAABB: { minX: number; minY: number; maxX: number; maxY: number };

  affectedCanonicals: CanonicalLoop[];

  msCleanedLoops: Point[][];
  newCanonicalLoops: CanonicalLoop[];

  surgery: {
    matches: Array<{ oldLoopId: number; newLoopId: number | null }>;
    resultsByOld: LocalUpdateSurgeryResult[];
    remainingNewLoopIds: number[];
    deletedOldLoopIds: number[];
    replacements: CanonicalLoop[];
    previewLoops?: CanonicalLoop[];
  };

  opt?: {
    baseOptLoops: OptVertex[][];
    baseInvalidations: Array<{ loopIndex: number; spans: Array<{ startOpt: number; endOpt: number }> }>;
    rebuiltOptLoops: OptVertex[][];
    rebuiltInvalidations: Array<{ loopIndex: number; spans: Array<{ startOpt: number; endOpt: number }> }>;
    rebuiltSegmentDebug: Array<{ loopId: number; vertices: OptVertex[]; segments: PhysicsSegment[] }>;
    rebuiltArcs: Array<{ loopIndex: number; span: { startOpt: number; endOpt: number }; arc: OptVertex[] }>;
    rebuiltFullLoops: Array<{ loopIndex: number; loopId: number; optLoop: OptVertex[] }>;
    splicedOptLoops: OptVertex[][];
    spliceSummary?: Array<{
      oldLoopId: number;
      newLoopId: number;
      oldSpanCount: number;
      newSpanCount: number;
      splicedVertexCount: number;
      usedFallback: boolean;
    }>;
  };

  physics?: {
    affectedBodyCount: number;
    removedBodyCount: number;
  };
}

export class RemeshManager {
  private densityField: DensityField;
  private marchingSquares: MarchingSquares;
  private loopCache: LoopCache;
  private physics: Box2DPhysics;
  private renderer: Renderer;
  private optimizationPipeline: VertexOptimizationPipeline;
  private optimizationOptions: OptimizationOptions;
  private canonicalLoops: CanonicalLoop[] = []; // Read-only canonical layer (cleaned marching squares output)
  private canonicalPhysicsLoops: Array<{ loop: CanonicalLoop; shouldReverse: boolean }> = [];
  private optimizedOptLoopsDebug: OptVertex[][] = []; // For ancestry debug rendering

  private lastFullHealTime = 0;
  private needsFullHeal = false;

  constructor(config: RemeshConfig) {
    this.densityField = config.densityField;
    this.marchingSquares = config.marchingSquares;
    this.loopCache = config.loopCache;
    this.physics = config.physics;
    this.renderer = config.renderer;
    this.optimizationOptions = config.optimizationOptions;
    this.optimizationPipeline = new VertexOptimizationPipeline();
  }

  /**
   * Simple AABB intersection test
   */
  private aabbsIntersect(a: { minX: number; minY: number; maxX: number; maxY: number }, b: { minX: number; minY: number; maxX: number; maxY: number }): boolean {
    return !(a.maxX < b.minX || a.minX > b.maxX || a.maxY < b.minY || a.minY > b.maxY);
  }

  /**
   * Geometry helper: check whether a loop (as points) touches an AABB.
   * Touch = any vertex inside, or any edge segment intersects the AABB.
   */
  private loopTouchesRegion(points: Point[], region: { minX: number; minY: number; maxX: number; maxY: number }): boolean {
    const pointInside = (p: Point) => this.pointInAabb(p, region);
    const segmentIntersectsAABB = (p1: Point, p2: Point): boolean => this.segmentIntersectsAabb(p1, p2, region);

    // Any vertex inside?
    for (const v of points) {
      if (pointInside(v)) return true;
    }

    // Any edge intersect?
    for (let i = 0; i < points.length - 1; i++) {
      if (segmentIntersectsAABB(points[i], points[i + 1])) return true;
    }

    return false;
  }

  private pointInAabb(p: Point, region: { minX: number; minY: number; maxX: number; maxY: number }): boolean {
    return p.x >= region.minX && p.x <= region.maxX && p.y >= region.minY && p.y <= region.maxY;
  }

  private segmentIntersectsAabb(a: Point, b: Point, region: { minX: number; minY: number; maxX: number; maxY: number }): boolean {
    if (this.pointInAabb(a, region) || this.pointInAabb(b, region)) return true;

    // Quick reject using segment AABB
    const minX = Math.min(a.x, b.x);
    const maxX = Math.max(a.x, b.x);
    const minY = Math.min(a.y, b.y);
    const maxY = Math.max(a.y, b.y);
    if (maxX < region.minX || minX > region.maxX || maxY < region.minY || minY > region.maxY) {
      return false;
    }

    const cross = (p: Point, q: Point, r: Point) => (q.x - p.x) * (r.y - p.y) - (q.y - p.y) * (r.x - p.x);
    const onSegment = (p: Point, q: Point, r: Point) =>
      Math.min(p.x, r.x) - 1e-6 <= q.x && q.x <= Math.max(p.x, r.x) + 1e-6 &&
      Math.min(p.y, r.y) - 1e-6 <= q.y && q.y <= Math.max(p.y, r.y) + 1e-6;

    const segmentsIntersect = (p1: Point, p2: Point, p3: Point, p4: Point): boolean => {
      const o1 = cross(p1, p2, p3);
      const o2 = cross(p1, p2, p4);
      const o3 = cross(p3, p4, p1);
      const o4 = cross(p3, p4, p2);

      if (o1 === 0 && onSegment(p1, p3, p2)) return true;
      if (o2 === 0 && onSegment(p1, p4, p2)) return true;
      if (o3 === 0 && onSegment(p3, p1, p4)) return true;
      if (o4 === 0 && onSegment(p3, p2, p4)) return true;

      return (o1 > 0) !== (o2 > 0) && (o3 > 0) !== (o4 > 0);
    };

    // Check against each rectangle edge
    const topLeft = { x: region.minX, y: region.minY };
    const topRight = { x: region.maxX, y: region.minY };
    const bottomLeft = { x: region.minX, y: region.maxY };
    const bottomRight = { x: region.maxX, y: region.maxY };

    return (
      segmentsIntersect(a, b, topLeft, topRight) ||
      segmentsIntersect(a, b, topRight, bottomRight) ||
      segmentsIntersect(a, b, bottomRight, bottomLeft) ||
      segmentsIntersect(a, b, bottomLeft, topLeft)
    );
  }

  private computeOptInvalidationSpansByRegion(
    optLoop: OptVertex[],
    region: { minX: number; minY: number; maxX: number; maxY: number }
  ): Array<{ startOpt: number; endOpt: number }> {
    const n = optLoop.length;
    if (n < 2) return [];

    const invalid = new Array<boolean>(n).fill(false);

    for (let i = 0; i < n; i++) {
      if (this.pointInAabb(optLoop[i], region)) invalid[i] = true;
    }

    for (let i = 0; i < n; i++) {
      const j = (i + 1) % n;
      if (this.segmentIntersectsAabb(optLoop[i], optLoop[j], region)) {
        invalid[i] = true;
        invalid[j] = true;
      }
    }

    const spans: Array<{ startOpt: number; endOpt: number }> = [];
    let spanStart = -1;
    for (let i = 0; i < n; i++) {
      if (invalid[i]) {
        if (spanStart === -1) spanStart = i;
      } else if (spanStart !== -1) {
        spans.push({ startOpt: spanStart, endOpt: i - 1 });
        spanStart = -1;
      }
    }
    if (spanStart !== -1) {
      spans.push({ startOpt: spanStart, endOpt: n - 1 });
    }

    // Merge wrap if both ends are invalid
    if (spans.length >= 2 && invalid[0] && invalid[n - 1]) {
      const first = spans[0];
      const last = spans[spans.length - 1];
      const merged: Array<{ startOpt: number; endOpt: number }> = [];
      merged.push({ startOpt: last.startOpt, endOpt: first.endOpt }); // wrap span
      for (let i = 1; i < spans.length - 1; i++) merged.push(spans[i]);
      return merged;
    }

    return spans;
  }

  private canonicalDirtySpans(
    loop: CanonicalLoop,
    region: { minX: number; minY: number; maxX: number; maxY: number }
  ): Array<{ startIndex: number; endIndex: number }> {
    const n = loop.vertices.length;
    if (n < 3) return [];
    const unique = loop.isClosed && n > 1 ? loop.vertices.slice(0, -1) : loop.vertices.slice();
    const nUnique = unique.length;
    if (nUnique < 3) return [];

    // A span is "dirty" if either:
    // - a vertex is inside the region, OR
    // - an incident edge intersects the region (covers long edges that cross the AABB with no vertices inside).
    const flags = unique.map((v) => this.pointInAabb(v, region));
    for (let i = 0; i < nUnique; i++) {
      const j = (i + 1) % nUnique;
      if (this.segmentIntersectsAabb(unique[i], unique[j], region)) {
        flags[i] = true;
        flags[j] = true;
      }
    }

    const runs: Array<{ startIndex: number; endIndex: number }> = [];
    let runStart = -1;
    for (let i = 0; i < nUnique; i++) {
      if (flags[i]) {
        if (runStart === -1) runStart = i;
      } else if (runStart !== -1) {
        runs.push({ startIndex: runStart, endIndex: i - 1 });
        runStart = -1;
      }
    }
    if (runStart !== -1) runs.push({ startIndex: runStart, endIndex: nUnique - 1 });

    if (runs.length >= 2 && flags[0] && flags[nUnique - 1]) {
      const first = runs[0];
      const last = runs[runs.length - 1];
      const merged: Array<{ startIndex: number; endIndex: number }> = [];
      merged.push({ startIndex: last.startIndex, endIndex: first.endIndex }); // wrap span
      for (let i = 1; i < runs.length - 1; i++) merged.push(runs[i]);
      return merged;
    }

    return runs;
  }

  private optimizeOptChainWithAncestry(vertices: OptVertex[]): OptVertex[] {
    if (vertices.length < 2) return vertices.slice();
    const gridPitch = this.optimizationOptions.gridPitch;
    const dedupeEps = gridPitch * 0.1;
    const minEdgeLen = gridPitch * 0.3;

    const dist = (a: Point, b: Point) => Math.hypot(a.x - b.x, a.y - b.y);

    // 1) Dedupe consecutive points (keep endpoints)
    let working: OptVertex[] = [vertices[0]];
    for (let i = 1; i < vertices.length - 1; i++) {
      const prev = working[working.length - 1];
      const curr = vertices[i];
      if (dist(prev, curr) > dedupeEps) working.push(curr);
    }
    if (vertices.length > 1) {
      const last = vertices[vertices.length - 1];
      const prev = working[working.length - 1];
      if (dist(prev, last) > 1e-12) working.push(last);
    }

    // 2) Cull tiny edges (keep endpoints)
    const culled: OptVertex[] = [working[0]];
    for (let i = 1; i < working.length - 1; i++) {
      const prev = culled[culled.length - 1];
      const curr = working[i];
      if (dist(prev, curr) >= minEdgeLen) culled.push(curr);
    }
    if (working.length > 1) culled.push(working[working.length - 1]);
    working = culled;

    // 3) Simplification (open chain)
    if (this.optimizationOptions.simplificationEpsilon > 0) {
      const areaThreshold = this.optimizationOptions.simplificationEpsilon * this.optimizationOptions.simplificationEpsilon;
      working = simplifyPolyline(working, areaThreshold, false);
    }

    // 4) Chaikin smoothing (open chain)
    if (this.optimizationOptions.chaikinEnabled && this.optimizationOptions.chaikinIterations > 0) {
      working = chaikinWithAncestry(working, this.optimizationOptions.chaikinIterations, 0.25, false);
    }

    // 5) Post-simplification (open chain)
    if (this.optimizationOptions.simplificationEpsilonPost > 0) {
      const areaThresholdPost = this.optimizationOptions.simplificationEpsilonPost * this.optimizationOptions.simplificationEpsilonPost;
      working = simplifyPolyline(working, areaThresholdPost, false);
    }

    return working;
  }

  private resamplePath(points: Point[], count: number): Point[] {
    if (count <= 0) return [];
    if (points.length === 0) return [];
    if (points.length === 1) {
      const p = points[0];
      return Array.from({ length: count }, () => ({ x: p.x, y: p.y }));
    }
    if (count === 1) return [{ x: points[0].x, y: points[0].y }];

    const cumulative: number[] = [0];
    for (let i = 1; i < points.length; i++) {
      const prev = points[i - 1];
      const curr = points[i];
      cumulative.push(cumulative[cumulative.length - 1] + Math.hypot(curr.x - prev.x, curr.y - prev.y));
    }
    const total = cumulative[cumulative.length - 1];
    if (total <= 1e-9) {
      // Degenerate: all points coincide
      return Array.from({ length: count }, () => ({ x: points[0].x, y: points[0].y }));
    }

    const out: Point[] = [];
    for (let k = 0; k < count; k++) {
      const t = (k / (count - 1)) * total;
      let i = 1;
      while (i < cumulative.length && cumulative[i] < t) i++;
      if (i >= cumulative.length) {
        const last = points[points.length - 1];
        out.push({ x: last.x, y: last.y });
        continue;
      }
      const t0 = cumulative[i - 1];
      const t1 = cumulative[i];
      const alpha = t1 > t0 ? (t - t0) / (t1 - t0) : 0;
      const p0 = points[i - 1];
      const p1 = points[i];
      out.push({
        x: p0.x * (1 - alpha) + p1.x * alpha,
        y: p0.y * (1 - alpha) + p1.y * alpha
      });
    }
    return out;
  }

  private extractLoopPath(
    loop: Point[],
    startIndex: number,
    endIndex: number,
    forward: boolean
  ): Point[] {
    const n = loop.length;
    if (n === 0) return [];
    const path: Point[] = [];

    const norm = (i: number) => ((i % n) + n) % n;
    let i = norm(startIndex);
    const end = norm(endIndex);

    path.push({ x: loop[i].x, y: loop[i].y });
    if (i === end) return path;

    const step = forward ? 1 : -1;
    while (i !== end) {
      i = norm(i + step);
      path.push({ x: loop[i].x, y: loop[i].y });
      if (path.length > n + 2) break;
    }
    return path;
  }

  private updateCanonicalSpanFromMatchedLoop(
    oldLoop: CanonicalLoop,
    newLoop: CanonicalLoop,
    span: { startIndex: number; endIndex: number },
    region: { minX: number; minY: number; maxX: number; maxY: number }
  ): void {
    const oldUnique = oldLoop.isClosed ? oldLoop.vertices.slice(0, -1) : oldLoop.vertices;
    const newUnique = newLoop.isClosed ? newLoop.vertices.slice(0, -1) : newLoop.vertices;
    const nOld = oldUnique.length;
    const nNew = newUnique.length;
    if (nOld < 3 || nNew < 3) return;

    const indices: number[] = [];
    const start = span.startIndex;
    const end = span.endIndex;
    if (start <= end) {
      for (let i = start; i <= end; i++) indices.push(i);
    } else {
      for (let i = start; i < nOld; i++) indices.push(i);
      for (let i = 0; i <= end; i++) indices.push(i);
    }
    if (indices.length === 0) return;

    const oldStartPt = oldUnique[indices[0]];
    const oldEndPt = oldUnique[indices[indices.length - 1]];

    const findNearestIndex = (pts: CanonicalVertex[], target: Point): number => {
      let best = 0;
      let bestD = Infinity;
      for (let i = 0; i < pts.length; i++) {
        const dx = pts[i].x - target.x;
        const dy = pts[i].y - target.y;
        const d = dx * dx + dy * dy;
        if (d < bestD) {
          bestD = d;
          best = i;
        }
      }
      return best;
    };

    const ns = findNearestIndex(newUnique, oldStartPt);
    const ne = findNearestIndex(newUnique, oldEndPt);

    const forwardPath = this.extractLoopPath(newUnique, ns, ne, true);
    const backwardPath = this.extractLoopPath(newUnique, ns, ne, false);

    const scorePath = (path: Point[]): { inside: number; touch: number; length: number } => {
      let inside = 0;
      let touch = 0;
      let length = 0;
      for (let i = 0; i < path.length; i++) {
        const p = path[i];
        if (this.pointInAabb(p, region)) inside++;
        if (i > 0) {
          const a = path[i - 1];
          const b = p;
          if (this.segmentIntersectsAabb(a, b, region)) touch++;
          length += Math.hypot(b.x - a.x, b.y - a.y);
        }
      }
      return { inside, touch, length };
    };

    const sf = scorePath(forwardPath);
    const sb = scorePath(backwardPath);
    // Prefer the path that actually touches the region; if tied, prefer shorter path
    // to avoid selecting the "long way around" and creating huge chord artifacts.
    const chooseBackward =
      sb.inside > sf.inside ||
      (sb.inside === sf.inside && (sb.touch > sf.touch || (sb.touch === sf.touch && sb.length < sf.length)));
    const chosen = chooseBackward ? backwardPath : forwardPath;
    const resampled = this.resamplePath(chosen, indices.length);

    for (let k = 0; k < indices.length; k++) {
      const idx = indices[k];
      oldUnique[idx].x = resampled[k].x;
      oldUnique[idx].y = resampled[k].y;
    }

    if (oldLoop.isClosed && oldLoop.vertices.length > 0) {
      const first = oldLoop.vertices[0];
      const last = oldLoop.vertices[oldLoop.vertices.length - 1];
      last.x = first.x;
      last.y = first.y;
    }
  }

  private extractOptSpan(optLoop: OptVertex[], span: { startOpt: number; endOpt: number }): OptVertex[] {
    const n = optLoop.length;
    if (n === 0) return [];
    const { startOpt, endOpt } = span;
    if (startOpt < 0 || endOpt < 0) return [];
    if (startOpt <= endOpt) {
      return optLoop.slice(startOpt, endOpt + 1);
    }
    // wrap
    return [...optLoop.slice(startOpt), ...optLoop.slice(0, endOpt + 1)];
  }

  private spliceOptLoopReplaceSpan(
    optLoop: OptVertex[],
    span: { startOpt: number; endOpt: number },
    insertVertices: OptVertex[],
    epsilon: number
  ): OptVertex[] {
    const n = optLoop.length;
    if (n === 0) return insertVertices.slice();

    const { startOpt, endOpt } = span;

    const dist = (p: Point, q: Point) => Math.hypot(p.x - q.x, p.y - q.y);

    const dedupeEndpoints = (beforeLast: OptVertex | null, afterFirst: OptVertex | null, verts: OptVertex[]): OptVertex[] => {
      let out = verts.slice();
      if (beforeLast && out.length > 0 && dist(beforeLast, out[0]) <= epsilon) {
        out = out.slice(1);
      }
      if (afterFirst && out.length > 0 && dist(afterFirst, out[out.length - 1]) <= epsilon) {
        out = out.slice(0, -1);
      }
      return out;
    };

    if (startOpt <= endOpt) {
      const before = optLoop.slice(0, startOpt);
      const after = optLoop.slice(endOpt + 1);
      const beforeLast = before.length > 0 ? before[before.length - 1] : null;
      const afterFirst = after.length > 0 ? after[0] : null;
      const insert = dedupeEndpoints(beforeLast, afterFirst, insertVertices);
      return [...before, ...insert, ...after];
    }

    // Wrap span: rotate so startOpt becomes 0
    const rotated = [...optLoop.slice(startOpt), ...optLoop.slice(0, startOpt)];
    const rotEnd = (n - startOpt) + endOpt;
    const after = rotated.slice(rotEnd + 1);
    const beforeLast = after.length > 0 ? after[after.length - 1] : null; // previous to insertion in rotated space
    const afterFirst = after.length > 0 ? after[0] : null;
    const insert = dedupeEndpoints(beforeLast, afterFirst, insertVertices);
    return [...insert, ...after];
  }

  /**
   * Dev-only assertion to ensure canonical AABBs contain their vertices
   */
  private assertCanonicalAABBs(canonicalLoops: CanonicalLoop[]): void {
    for (const loop of canonicalLoops) {
      const { aabb } = loop;
      for (const v of loop.vertices) {
        console.assert(
          v.x >= aabb.minX - 1e-6 && v.x <= aabb.maxX + 1e-6 && v.y >= aabb.minY - 1e-6 && v.y <= aabb.maxY + 1e-6,
          '[Phase1] Canonical vertex outside AABB',
          { loopId: loop.id, vertex: { x: v.x, y: v.y }, aabb }
        );
      }
    }
  }

  /**
   * Compute AABB for optimized vertices (ancestry-carrying) - debug only
   */
  private computeOptAABB(loop: OptVertex[]): { minX: number; minY: number; maxX: number; maxY: number } {
    if (loop.length === 0) {
      return { minX: 0, minY: 0, maxX: 0, maxY: 0 };
    }
    let minX = loop[0].x;
    let minY = loop[0].y;
    let maxX = loop[0].x;
    let maxY = loop[0].y;
    for (const v of loop) {
      minX = Math.min(minX, v.x);
      minY = Math.min(minY, v.y);
      maxX = Math.max(maxX, v.x);
      maxY = Math.max(maxY, v.y);
    }
    return { minX, minY, maxX, maxY };
  }

  /**
   * Find canonical loops whose AABB intersects the dirty region
   */
  private findAffectedCanonicalLoops(region: { minX: number; minY: number; maxX: number; maxY: number }): CanonicalLoop[] {
    const pointInRegion = (p: Point): boolean =>
      p.x >= region.minX && p.x <= region.maxX &&
      p.y >= region.minY && p.y <= region.maxY;

    const segmentAabbIntersectsRegion = (p: Point, q: Point): boolean => {
      const minX = Math.min(p.x, q.x);
      const minY = Math.min(p.y, q.y);
      const maxX = Math.max(p.x, q.x);
      const maxY = Math.max(p.y, q.y);
      const segAabb = { minX, minY, maxX, maxY };
      return this.aabbsIntersect(segAabb, region);
    };

    return this.canonicalLoops.filter(loop => {
      if (!this.aabbsIntersect(loop.aabb, region)) {
        return false;
      }

      const verts = loop.vertices;
      const n = verts.length;
      if (n === 0) {
        return false;
      }

      // Quick check: any vertex actually inside the region?
      for (let i = 0; i < n; i++) {
        const v = verts[i];
        if (pointInRegion(v)) {
          return true;
        }
      }

      // Fallback: check if any edge's AABB intersects the region
      for (let i = 0; i < n; i++) {
        const p = verts[i];
        const q = verts[(i + 1) % n];
        if (segmentAabbIntersectsRegion(p, q)) {
          return true;
        }
      }

      // Loop's AABB overlapped, but no vertices or edges touch region => ignore
      return false;
    });
  }

  /**
   * Match new canonical loops to old ones by centroid proximity (greedy).
   */
  private matchNewLoopsToOld(oldLoops: CanonicalLoop[], newLoops: CanonicalLoop[]): Array<{ old: CanonicalLoop; replacement: CanonicalLoop | null }> {
    const remaining = [...newLoops];
    return oldLoops.map(oldLoop => {
      const oldCentroid = computePolygonCentroid(oldLoop.vertices);
      let bestIdx = -1;
      let bestDist = Infinity;
      for (let i = 0; i < remaining.length; i++) {
        const c = computePolygonCentroid(remaining[i].vertices);
        const dx = c.x - oldCentroid.x;
        const dy = c.y - oldCentroid.y;
        const d = dx * dx + dy * dy;
        if (d < bestDist) {
          bestDist = d;
          bestIdx = i;
        }
      }
      if (bestIdx === -1) {
        return { old: oldLoop, replacement: null };
      }
      const repl = remaining.splice(bestIdx, 1)[0];
      return { old: oldLoop, replacement: repl };
    });
  }

  /**
   * Find optimized vertex span overlapping a canonical range
   */
  private findAffectedOptVertices(optLoop: OptVertex[], dirtyStart: number, dirtyEnd: number): { removeStart: number; removeEnd: number } | null {
    let removeStart = -1;
    let removeEnd = -1;
    for (let i = 0; i < optLoop.length; i++) {
      const v = optLoop[i];
      const overlaps = v.canonStartId <= dirtyEnd && v.canonEndId >= dirtyStart;
      if (overlaps) {
        if (removeStart === -1) removeStart = i;
        removeEnd = i;
      }
    }
    if (removeStart === -1 || removeEnd === -1) return null;
    return { removeStart, removeEnd };
  }

  /**
   * Rebuild optimized vertices for a canonical slice (inclusive range, clamped)
   */
  private rebuildOptimizedRange(canon: CanonicalLoop, dirtyStart: number, dirtyEnd: number): OptVertex[] {
    const start = Math.max(0, dirtyStart);
    const end = Math.min(canon.vertices.length - 1, dirtyEnd);
    if (end - start < 1) {
      return [];
    }
    // IMPORTANT: Ancestry is loop-local indices; keep vertex order stable for meaningful ranges.
    const slice: CanonicalVertex[] = [];
    for (let i = start; i <= end; i++) {
      slice.push(canon.vertices[i]);
    }
    // Ensure closure
    if (slice.length > 0) {
      const first = slice[0];
      const last = slice[slice.length - 1];
      if (Math.abs(first.x - last.x) > 1e-6 || Math.abs(first.y - last.y) > 1e-6) {
        slice.push({ ...first });
      }
    }
    const opt = this.optimizationPipeline.optimize([slice], this.optimizationOptions);
    return opt.finalOptLoops?.[0] ?? [];
  }

  /**
   * Stitch new optimized vertices into an existing optimized loop
   */
  private stitchOptimizedRange(optLoop: OptVertex[], removeStart: number, removeEnd: number, newOpt: OptVertex[]): OptVertex[] {
    return [
      ...optLoop.slice(0, removeStart),
      ...newOpt,
      ...optLoop.slice(removeEnd + 1)
    ];
  }

  /**
   * Compute canonical index range overlapping a region (returns full loop if no overlap found)
   */
  private canonicalDirtyRange(loop: CanonicalLoop, region: { minX: number; minY: number; maxX: number; maxY: number }): { start: number; end: number } {
    let start = -1;
    let end = -1;
    const inside = (v: Point) =>
      v.x >= region.minX && v.x <= region.maxX && v.y >= region.minY && v.y <= region.maxY;
    for (let i = 0; i < loop.vertices.length; i++) {
      const v = loop.vertices[i];
      if (inside(v)) {
        if (start === -1) start = i;
        end = i;
      }
    }
    if (start === -1 || end === -1) {
      return { start: 0, end: loop.vertices.length - 1 };
    }
    return { start, end };
  }

  /**
   * Get current canonical loops (for debug visualization)
   */
  getCanonicalLoops(): CanonicalLoop[] {
    return this.canonicalLoops;
  }

  /**
   * Update optimization options (called when user changes settings)
   */
  updateOptimizationOptions(options: Partial<OptimizationOptions>): void {
    this.optimizationOptions = { ...this.optimizationOptions, ...options };
  }

  /**
   * Trigger a remesh check
   */
  remesh(): RemeshStats | null {
    try {
      console.log('[RemeshManager] remesh() start');
      const now = performance.now();

      // Check if we need a full heal (on-demand only, no periodic heal since carving is disabled)
      if (this.needsFullHeal || this.loopCache.count() === 0) {
        // Full world remesh
        const stats = this.fullHeal();
        this.needsFullHeal = false;
        this.lastFullHealTime = now;
        return stats;
      } else {
        // No remesh needed
        return null;
      }
    } catch (error) {
      const err: any = error;
      console.error('[RemeshManager] Error during remesh:', {
        message: err?.message,
        stack: err?.stack,
        raw: err,
      });
      return null;
    }
  }

  /**
   * Request a full heal on next remesh
   */
  requestFullHeal(): void {
    this.needsFullHeal = true;
  }

  /**
   * Full world remesh - rebuild all loops
   */
  private fullHeal(): RemeshStats {
    const startTime = performance.now();

    // Clear local update debug info (full heal replaces everything)
    this.renderer.clearLocalUpdateDebug();

    // Clear cache
    this.loopCache.clear();

    // Generate all contours for entire field
    const fullField = {
      minX: 0,
      minY: 0,
      maxX: this.densityField.config.width,
      maxY: this.densityField.config.height
    };

    const t0 = performance.now();
    const results = this.marchingSquares.generateContours(fullField, 0);
    const t1 = performance.now();
    const rawLoopCount = results.filter(r => r && r.loop && r.loop.length > 2).length;
    console.log(`[FullHeal] ⏱️ Marching Squares: ${(t1 - t0).toFixed(2)}ms (generated ${rawLoopCount} raw loops)`);

    // Add all loops to cache
    for (const result of results) {
      if (result && result.loop && result.loop.length > 2) {
        this.loopCache.addLoop(result.loop, result.closed);
      }
    }

    // Get all loops and classify them for debugging
    const allLoops = this.loopCache.getAllLoops();
    const allPolylines = allLoops.map(l => l.vertices);

    // Clean all loops BEFORE classification to remove duplicates, tiny edges, etc.
    const t2 = performance.now();
    const gridPitch = this.densityField.config.gridPitch;
    const cleanedLoops = allPolylines.map(loop => cleanLoop(loop, gridPitch));
    const t3 = performance.now();
    const rawVertexCount = allPolylines.reduce((sum, loop) => sum + loop.length, 0);
    const cleanedVertexCount = cleanedLoops.reduce((sum, loop) => sum + loop.length, 0);
    console.log(`[FullHeal] ⏱️ Clean loops: ${(t3 - t2).toFixed(2)}ms (${rawVertexCount} → ${cleanedVertexCount} vertices)`);

    // Classify loops with indices for debugging (but keep ALL loops for rendering)
    const t4 = performance.now();
    const loopMetadata: Array<{
      index: number;
      centroid: { x: number; y: number };
      isRock: boolean;
      samples?: DebugSamplePoint[];
    }> = [];

    const validLoops: Point[][] = [];
    const loopClassifications: boolean[] = []; // Store classifications for later use
    let deletedCount = 0;

    cleanedLoops.forEach((loop, index) => {
      if (loop.length < 3) return;

      const classificationResult = this.isRockLoop(loop, index);

      // Skip loops marked for deletion
      if (classificationResult.shouldDelete) {
        deletedCount++;
        return;
      }

      const isRock = classificationResult.isRock;
      const centroid = computePolygonCentroid(loop);

      loopMetadata.push({
        index,
        centroid,
        isRock,
        samples: classificationResult.samples
      });

      validLoops.push(loop);
      loopClassifications.push(isRock); // Store whether this loop has rock inside
    });
    const t5 = performance.now();
    console.log(`[FullHeal] ⏱️ Classification: ${(t5 - t4).toFixed(2)}ms (${validLoops.length} valid loops, ${deletedCount} deleted)`);

    // Build canonical loops (read-only layer) directly from cleaned marching squares output
    const canonicalLoops = validLoops.map(loop => createCanonicalLoop(loop));
    this.canonicalLoops = canonicalLoops;
    this.assertCanonicalAABBs(canonicalLoops);
    console.log('[Phase1] Created canonical loops', {
      count: canonicalLoops.length,
      totalVertices: canonicalLoops.reduce((sum, l) => sum + l.vertices.length, 0),
      aabbs: canonicalLoops.map(l => l.aabb)
    });
    this.renderer.setCanonicalLoops(canonicalLoops);

    // Pass loop metadata to renderer for debug visualization
    this.renderer.setLoopDebugInfo(loopMetadata);

    // Run vertex optimization pipeline
    // IMPORTANT: Pass canonical vertices so we preserve loop order through hygiene,
    // but ancestry tracking uses loop-local indices (0..n-1).
    const canonicalVerticesForOpt = canonicalLoops.map(loop => loop.vertices);
    const optimizationResult = this.optimizationPipeline.optimize(canonicalVerticesForOpt, this.optimizationOptions);
    const finalVertexCount = optimizationResult.finalLoops.reduce((sum, loop) => sum + loop.length, 0);
    console.log(`[FullHeal] ⏱️ Optimization: ${optimizationResult.timing.totalMs.toFixed(2)}ms (${cleanedVertexCount} → ${finalVertexCount} vertices)`);
    console.log(`[FullHeal]    ↳ cleanLoop: ${optimizationResult.timing.cleanLoopMs.toFixed(2)}ms`);
    if (optimizationResult.timing.simplificationMs > 0) {
      console.log(`[FullHeal]    ↳ Visvalingam-Whyatt (reduce): ${optimizationResult.timing.simplificationMs.toFixed(2)}ms`);
    }
    if (optimizationResult.timing.chaikinMs > 0) {
      console.log(`[FullHeal]    ↳ Chaikin smoothing (expand): ${optimizationResult.timing.chaikinMs.toFixed(2)}ms`);
    }
    if (optimizationResult.timing.postSimplificationMs > 0) {
      console.log(`[FullHeal]    ↳ Post-simplification (reduce): ${optimizationResult.timing.postSimplificationMs.toFixed(2)}ms`);
    }

    // Store original for debug visualization
    this.renderer.updateOriginalPolylines(optimizationResult.trueOriginalLoops);
    this.optimizedOptLoopsDebug = optimizationResult.finalOptLoops ?? [];
    this.renderer.setOptimizedOptLoops(this.optimizedOptLoopsDebug);

    // Use stored classifications from before optimization (more reliable than reclassifying)
    // Based on testing: reverse if cave inside (rock island), keep if rock inside (cave boundary)
    const shouldReverse = loopClassifications.map((isRock, index) => {
      // CORRECT LOGIC (verified working): Reverse if NOT rock (cave inside = rock island)
      return !isRock;
    });

    // Store optVertices on the canonical loops (single source of truth for ancestry)
    // This ensures local-update and debug overlays can find optVertices by canonical loop ID
    for (let i = 0; i < canonicalLoops.length; i++) {
      canonicalLoops[i].optVertices = optimizationResult.finalOptLoops[i];
    }
    console.log('[FullHeal] Stored optVertices on canonical loops for ancestry', {
      count: canonicalLoops.length,
      withOptVertices: canonicalLoops.filter(l => l.optVertices).length
    });

    // Debug: Opt ancestry is loop-local indices (0..n-1).

    // Use final loops for both physics and rendering (canonical representation)
    const t6 = performance.now();
    const canonicalPhysicsLoops = optimizationResult.finalLoops.map(loop => createCanonicalLoop(loop));
    const totalCanonicalVerts = canonicalPhysicsLoops.reduce((sum, cl) => sum + cl.vertices.length, 0);
    console.log(`[FullHeal] Canonical loops: ${canonicalPhysicsLoops.length} (${totalCanonicalVerts} verts total)`);
    this.canonicalPhysicsLoops = canonicalPhysicsLoops.map((loop, index) => ({ loop, shouldReverse: shouldReverse[index] ?? true }));
    const physicsEngine = this.physics.getEngine();
    console.log('[FullHeal] Calling physicsEngine.setCanonicalTerrainLoops');
    try {
      physicsEngine.setCanonicalTerrainLoops(canonicalPhysicsLoops, optimizationResult.finalOptLoops, shouldReverse);
      console.log('[FullHeal] physicsEngine.setCanonicalTerrainLoops completed');
    } catch (err) {
      console.error('[FullHeal] physicsEngine.setCanonicalTerrainLoops threw', err);
      throw err;
    }
    this.renderer.setSegmentDebugData(physicsEngine.getSegmentDebugSnapshot());
    const t7 = performance.now();
    console.log(`[FullHeal] ⏱️ Box2D colliders: ${(t7 - t6).toFixed(2)}ms (created ${optimizationResult.finalLoops.length} bodies)`);

    console.log(`[FullHeal] 🎯 TOTAL (physics only): ${(t7 - t0).toFixed(2)}ms`);

    // Update renderer with final loops
    const t8 = performance.now();
    const finalForRender = canonicalPhysicsLoops.map(loop => loop.vertices.map(p => ({ x: p.x, y: p.y })));
    console.log(`[FullHeal] Updating renderer polylines with ${finalForRender.length} loops`);
    try {
      this.renderer.updatePolylines(finalForRender);
      console.log(`[FullHeal] Render polylines: ${finalForRender.length}, first lengths=${finalForRender.map(l => l.length).join(',')}`);
    } catch (err) {
      console.error('[FullHeal] Renderer.updatePolylines threw', err);
      throw err;
    }
    const t9 = performance.now();
    console.log(`[FullHeal] ⏱️ Re-render walls: ${(t9 - t8).toFixed(2)}ms`);

    console.log(`[FullHeal] 🎯 TOTAL (including rendering): ${(t9 - t0).toFixed(2)}ms`);

    this.densityField.clearDirty();

    return optimizationResult.statistics;
  }

  /**
   * Local update - Phase 6: canonical surgery only, then fallback to full rebuild for optimized/physics.
   */
  localUpdate(expandCells: number = 2): RemeshStats | null {
    const session = this.beginLocalUpdateSession(expandCells);
    if (!session) return null;

    this.commitLocalUpdateCanonical(session);
    this.computeLocalUpdateOptAabbInvalidation(session);
    this.rebuildLocalUpdateOpt(session);
    this.commitLocalUpdateOptSplice(session);
    this.applyLocalUpdatePhysics(session);

    return {
      originalVertexCount: 0,
      finalVertexCount: 0,
      simplificationReduction: 0,
      postSimplificationReduction: 0,
    };
  }

  beginLocalUpdateSession(expandCells: number = 2): LocalUpdateSession | null {
    const dirtyAABB = this.densityField.getDirtyWorldAABB();
    if (!dirtyAABB) return null;

    const gridPitch = this.densityField.config.gridPitch;
    const paddedAABB = {
      minX: dirtyAABB.minX - expandCells * gridPitch,
      minY: dirtyAABB.minY - expandCells * gridPitch,
      maxX: dirtyAABB.maxX + expandCells * gridPitch,
      maxY: dirtyAABB.maxY + expandCells * gridPitch
    };

    const affectedCanonicals = this.findAffectedCanonicalLoops(paddedAABB);
    // Superset (AABB-only) used for recovery matching when `findAffectedCanonicalLoops` misses a loop
    // but marching squares still produces its replacement (common around near-misses / topology changes).
    const aabbIntersectingOld = this.canonicalLoops.filter((l) => this.aabbsIntersect(l.aabb, paddedAABB));

    const msResults = this.marchingSquares.generateContours(paddedAABB, expandCells);
    const msCleanedLoops: Point[][] = [];
    for (const res of msResults) {
      if (res && res.loop && res.loop.length > 2) {
        const cleaned = cleanLoop(res.loop, gridPitch);
        if (cleaned.length >= 3) msCleanedLoops.push(cleaned);
      }
    }
    const newCanonicalLoops = msCleanedLoops.map(loop => createCanonicalLoop(loop));

    const matches: Array<{ old: CanonicalLoop; replacement: CanonicalLoop | null }> = this.matchNewLoopsToOld(
      affectedCanonicals,
      newCanonicalLoops
    );

    const affectedSet = new Set<number>(affectedCanonicals.map((l) => l.id));
    const matchedOld = new Set<number>(matches.map((m) => m.old.id));

    const remainingNew = new Set(newCanonicalLoops);
    for (const m of matches) {
      if (m.replacement) remainingNew.delete(m.replacement);
    }

    // Recovery matching pass: if a "new" loop remains but clearly corresponds to an existing old loop
    // whose AABB overlaps the region (yet it wasn't flagged as affected), match it so we update-in-place
    // rather than duplicating the loop (which can flip even-odd fill parity elsewhere).
    const centroidOf = (loop: CanonicalLoop): { x: number; y: number } => computePolygonCentroid(loop.vertices);
    const newCentroids = new Map<number, { x: number; y: number }>();
    for (const nl of remainingNew) newCentroids.set(nl.id, centroidOf(nl));

    const candidateOld = aabbIntersectingOld.filter((l) => !matchedOld.has(l.id));
    const oldCentroids = new Map<number, { x: number; y: number }>();
    for (const ol of candidateOld) oldCentroids.set(ol.id, centroidOf(ol));

    const usedOld = new Set<number>();
    for (const nl of [...remainingNew]) {
      const nc = newCentroids.get(nl.id);
      if (!nc) continue;
      let bestOld: CanonicalLoop | null = null;
      let bestD2 = Infinity;
      for (const ol of candidateOld) {
        if (usedOld.has(ol.id)) continue;
        // Prefer spatial overlap to avoid accidental cross-matching.
        if (!this.aabbsIntersect(ol.aabb, nl.aabb)) continue;
        const oc = oldCentroids.get(ol.id);
        if (!oc) continue;
        const dx = oc.x - nc.x;
        const dy = oc.y - nc.y;
        const d2 = dx * dx + dy * dy;
        if (d2 < bestD2) {
          bestD2 = d2;
          bestOld = ol;
        }
      }

      if (!bestOld) continue;
      usedOld.add(bestOld.id);
      remainingNew.delete(nl);
      matches.push({ old: bestOld, replacement: nl });
      if (!affectedSet.has(bestOld.id)) {
        affectedSet.add(bestOld.id);
        affectedCanonicals.push(bestOld);
      }
    }

    const resultsByOld: LocalUpdateSurgeryResult[] = [];
    const matchSummary: Array<{ oldLoopId: number; newLoopId: number | null }> = [];
    for (const match of matches) {
      matchSummary.push({ oldLoopId: match.old.id, newLoopId: match.replacement?.id ?? null });
      resultsByOld.push({
        oldLoopId: match.old.id,
        matchedNewLoopId: match.replacement?.id ?? null,
        resultLoops: []
      });
    }

    const replacements: CanonicalLoop[] = [...affectedCanonicals, ...remainingNew];

    return {
      expandCells,
      gridPitch,
      dirtyAABB,
      paddedAABB,
      affectedCanonicals,
      msCleanedLoops,
      newCanonicalLoops,
      surgery: {
        matches: matchSummary,
        resultsByOld,
        remainingNewLoopIds: [...remainingNew].map(l => l.id),
        deletedOldLoopIds: [],
        replacements
      }
    };
  }

  commitLocalUpdateCanonical(session: LocalUpdateSession): void {
    // Update affected canonical loops in-place to keep loop-local index ancestry stable.
    const newById = new Map<number, CanonicalLoop>();
    for (const l of session.newCanonicalLoops) newById.set(l.id, l);

    const updatedLoopIds: number[] = [];

    const deletedOldLoopIds = new Set<number>(
      session.surgery.matches.filter(m => m.newLoopId === null).map(m => m.oldLoopId)
    );
    session.surgery.deletedOldLoopIds = [...deletedOldLoopIds];

    for (const match of session.surgery.matches) {
      if (!match.newLoopId) continue;
      const oldLoop = session.affectedCanonicals.find(l => l.id === match.oldLoopId);
      const newLoop = newById.get(match.newLoopId);
      if (!oldLoop || !newLoop) continue;

      const spans = this.canonicalDirtySpans(oldLoop, session.paddedAABB);
      for (const span of spans) {
        this.updateCanonicalSpanFromMatchedLoop(oldLoop, newLoop, span, session.paddedAABB);
      }

      // Refresh closure and AABB
      if (oldLoop.isClosed && oldLoop.vertices.length > 0) {
        const first = oldLoop.vertices[0];
        const last = oldLoop.vertices[oldLoop.vertices.length - 1];
        last.x = first.x;
        last.y = first.y;
      }
      oldLoop.aabb = computeLoopAABB(oldLoop.vertices);
      oldLoop.version += 1;
      updatedLoopIds.push(oldLoop.id);
    }

    // If an affected old loop has no matched replacement, it means topology changed (e.g. a sealed bubble
    // merged into the main cave). Remove the old loop so it doesn't persist as a phantom collider.
    if (deletedOldLoopIds.size > 0) {
      const deletedOptLoops = new Set<OptVertex[]>();
      for (const loop of session.affectedCanonicals) {
        if (!deletedOldLoopIds.has(loop.id)) continue;
        if (loop.optVertices) deletedOptLoops.add(loop.optVertices);
      }

      this.canonicalLoops = this.canonicalLoops.filter(l => !deletedOldLoopIds.has(l.id));
      if (deletedOptLoops.size > 0) {
        this.optimizedOptLoopsDebug = this.optimizedOptLoopsDebug.filter(l => !deletedOptLoops.has(l));
      }
    }

    // Add any unmatched new loops (new topology inside region)
    const matchedNewIds = new Set(session.surgery.matches.map(m => m.newLoopId).filter((v): v is number => v !== null));
    const newLoopsToAdd: CanonicalLoop[] = [];
    for (const loop of session.newCanonicalLoops) {
      if (!matchedNewIds.has(loop.id)) newLoopsToAdd.push(loop);
    }
    if (newLoopsToAdd.length > 0) {
      this.canonicalLoops.push(...newLoopsToAdd);
    }

    // For downstream steps, treat "replacements" as the loops we will (re)build physics for.
    session.surgery.replacements = [
      ...session.affectedCanonicals.filter(l => !deletedOldLoopIds.has(l.id)),
      ...newLoopsToAdd
    ];

    this.assertCanonicalAABBs(this.canonicalLoops);
    this.renderer.setCanonicalLoops(this.canonicalLoops);
    this.renderer.setDirtyAABB(session.paddedAABB);

    if (import.meta.env.DEV || __CARVE_DEBUG__) {
      console.log('[LocalUpdate] Canonical surgery commit', {
        dirtyAABB: session.paddedAABB,
        affectedLoops: session.affectedCanonicals.length,
        updatedLoopIds,
        deletedOldLoopIds: session.surgery.deletedOldLoopIds,
        newLoopsAdded: newLoopsToAdd.map(l => l.id)
      });
    }
  }

  computeLocalUpdateCanonicalPreview(session: LocalUpdateSession): CanonicalLoop[] {
    const newById = new Map<number, CanonicalLoop>();
    for (const l of session.newCanonicalLoops) newById.set(l.id, l);

    const cloneLoop = (loop: CanonicalLoop): CanonicalLoop => {
      const vertices: CanonicalVertex[] = loop.vertices.map((v) => ({
        id: v.id,
        x: v.x,
        y: v.y,
        segmentA: v.segmentA,
        segmentB: v.segmentB
      }));
      return {
        id: loop.id,
        vertices,
        aabb: computeLoopAABB(vertices),
        version: loop.version,
        isClosed: loop.isClosed,
      };
    };

    const previewByOldId = new Map<number, CanonicalLoop>();
    for (const oldLoop of session.affectedCanonicals) {
      previewByOldId.set(oldLoop.id, cloneLoop(oldLoop));
    }

    for (const match of session.surgery.matches) {
      if (!match.newLoopId) continue;
      const previewOld = previewByOldId.get(match.oldLoopId);
      const newLoop = newById.get(match.newLoopId);
      if (!previewOld || !newLoop) continue;

      const spans = this.canonicalDirtySpans(previewOld, session.paddedAABB);
      for (const span of spans) {
        this.updateCanonicalSpanFromMatchedLoop(previewOld, newLoop, span, session.paddedAABB);
      }

      if (previewOld.isClosed && previewOld.vertices.length > 0) {
        const first = previewOld.vertices[0];
        const last = previewOld.vertices[previewOld.vertices.length - 1];
        last.x = first.x;
        last.y = first.y;
      }
      previewOld.aabb = computeLoopAABB(previewOld.vertices);
    }

    const matchedNewIds = new Set(session.surgery.matches.map(m => m.newLoopId).filter((v): v is number => v !== null));
    const newLoopsToAdd: CanonicalLoop[] = [];
    for (const loop of session.newCanonicalLoops) {
      if (!matchedNewIds.has(loop.id)) newLoopsToAdd.push(loop);
    }

    return [...previewByOldId.values(), ...newLoopsToAdd];
  }

  computeLocalUpdateOptAabbInvalidation(session: LocalUpdateSession): void {
    session.opt = session.opt ?? {
      baseOptLoops: [],
      baseInvalidations: [],
      rebuiltOptLoops: [],
      rebuiltInvalidations: [],
      rebuiltSegmentDebug: [],
      rebuiltArcs: [],
      rebuiltFullLoops: [],
      splicedOptLoops: [],
    };
    session.opt.baseOptLoops = this.optimizedOptLoopsDebug.slice();
    session.opt.baseInvalidations = [];

    for (const canon of session.affectedCanonicals) {
      const opt = canon.optVertices;
      if (!opt || opt.length < 2) continue;
      const baseIndex = session.opt.baseOptLoops.findIndex(l => l === opt);
      if (baseIndex < 0) continue;

      const dirtySpans = this.canonicalDirtySpans(canon, session.paddedAABB);
      if (dirtySpans.length === 0) continue;

      const n = canon.isClosed && canon.vertices.length > 1 ? canon.vertices.length - 1 : canon.vertices.length;
      const dirtyIntervalsUnwrapped: Array<{ start: number; end: number }> = [];
      for (const r of dirtySpans) {
        if (n <= 0) continue;
        if (r.startIndex <= r.endIndex) {
          dirtyIntervalsUnwrapped.push({ start: r.startIndex, end: r.endIndex });
          dirtyIntervalsUnwrapped.push({ start: r.startIndex + n, end: r.endIndex + n });
        } else {
          dirtyIntervalsUnwrapped.push({ start: r.startIndex, end: r.endIndex + n });
        }
      }

      const invalidFlags = opt.map((ov) =>
        dirtyIntervalsUnwrapped.some((d) => ov.canonEndId >= d.start && ov.canonStartId <= d.end)
      );

      const spans: Array<{ startOpt: number; endOpt: number }> = [];
      let spanStart = -1;
      for (let i = 0; i < invalidFlags.length; i++) {
        if (invalidFlags[i]) {
          if (spanStart === -1) spanStart = i;
        } else if (spanStart !== -1) {
          spans.push({ startOpt: spanStart, endOpt: i - 1 });
          spanStart = -1;
        }
      }
      if (spanStart !== -1) spans.push({ startOpt: spanStart, endOpt: invalidFlags.length - 1 });

      if (spans.length >= 2 && invalidFlags[0] && invalidFlags[invalidFlags.length - 1]) {
        const first = spans[0];
        const last = spans[spans.length - 1];
        const merged: Array<{ startOpt: number; endOpt: number }> = [];
        merged.push({ startOpt: last.startOpt, endOpt: first.endOpt }); // wrap span
        for (let i = 1; i < spans.length - 1; i++) merged.push(spans[i]);
        session.opt.baseInvalidations.push({ loopIndex: baseIndex, spans: merged });
      } else if (spans.length > 0) {
        session.opt.baseInvalidations.push({ loopIndex: baseIndex, spans });
      }
    }
  }

  rebuildLocalUpdateOpt(session: LocalUpdateSession): void {
    const rebuiltOptLoops: OptVertex[][] = [];
    const rebuiltSegmentDebug: Array<{ loopId: number; vertices: OptVertex[]; segments: PhysicsSegment[] }> = [];
    const rebuiltArcs: Array<{ loopIndex: number; span: { startOpt: number; endOpt: number }; arc: OptVertex[] }> = [];
    const rebuiltFullLoops: Array<{ loopIndex: number; loopId: number; optLoop: OptVertex[] }> = [];

    session.opt = session.opt ?? {
      baseOptLoops: [],
      baseInvalidations: [],
      rebuiltOptLoops: [],
      rebuiltInvalidations: [],
      rebuiltSegmentDebug: [],
      rebuiltArcs: [],
      rebuiltFullLoops: [],
      splicedOptLoops: []
    };

    // Ensure invalidation spans exist (Step 5d output)
    if (session.opt.baseOptLoops.length === 0) {
      this.computeLocalUpdateOptAabbInvalidation(session);
    }

    const invalidByLoopIndex = new Map<number, Array<{ startOpt: number; endOpt: number }>>();
    for (const entry of session.opt.baseInvalidations) {
      invalidByLoopIndex.set(entry.loopIndex, entry.spans);
    }

    // A) For matched/affected loops: rebuild only the invalidated span (open chain)
    for (const canon of session.affectedCanonicals) {
      const opt = canon.optVertices;
      if (!opt || opt.length < 2) continue;
      const baseIndex = session.opt.baseOptLoops.findIndex(l => l === opt);
      if (baseIndex < 0) continue;

      const spans = invalidByLoopIndex.get(baseIndex) ?? [];
      if (spans.length === 0) continue;

      if (spans.length > 1) {
        // Correctness-first fallback: rebuild the full optimized loop for this canonical.
        // This happens when the dirty AABB touches the loop in multiple disjoint places.
        const optResult = this.optimizationPipeline.optimize([canon.vertices], this.optimizationOptions);
        const optLoop = optResult.finalOptLoops?.[0];
        if (!optLoop || optLoop.length < 2) continue;

        rebuiltFullLoops.push({ loopIndex: baseIndex, loopId: canon.id, optLoop });
        rebuiltOptLoops.push(optLoop);
        rebuiltSegmentDebug.push({
          loopId: canon.id,
          vertices: optLoop,
          segments: buildSegmentsForLoop(canon.id, optLoop, 64, 20, 12, 0.35)
        });

        console.warn('[LocalOptRebuild] Multiple invalid spans; rebuilt full loop', {
          loopId: canon.id,
          spanCount: spans.length
        });
        continue;
      }

      // Single invalid span: rebuild only that arc for speed.
      const targetSpan = spans[0];

      const dirtySpans = this.canonicalDirtySpans(canon, session.paddedAABB);
      if (dirtySpans.length === 0) continue;

      const nUnique = canon.isClosed && canon.vertices.length > 1 ? canon.vertices.length - 1 : canon.vertices.length;
      if (nUnique < 3) continue;

      // Merge dirty spans into a single unwrapped canonical interval.
      let mergedStart = Infinity;
      let mergedEnd = -Infinity;
      for (const r of dirtySpans) {
        if (r.startIndex <= r.endIndex) {
          mergedStart = Math.min(mergedStart, r.startIndex);
          mergedEnd = Math.max(mergedEnd, r.endIndex);
        } else {
          mergedStart = Math.min(mergedStart, r.startIndex);
          mergedEnd = Math.max(mergedEnd, r.endIndex + nUnique);
        }
      }
      if (!Number.isFinite(mergedStart) || !Number.isFinite(mergedEnd) || mergedEnd < mergedStart) continue;

      // Add 1-vertex anchor on each side to improve continuity.
      const startAnchor = Math.max(0, mergedStart - 1);
      const endAnchor = Math.min(mergedEnd + 1, mergedStart + nUnique); // clamp to one wrap max

      const seed: OptVertex[] = [];
      for (let canonId = startAnchor; canonId <= endAnchor; canonId++) {
        const idx = canonId % nUnique;
        const v = canon.vertices[idx];
        seed.push({
          x: v.x,
          y: v.y,
          canonStartId: canonId,
          canonEndId: canonId
        });
      }

      const arc = this.optimizeOptChainWithAncestry(seed);
      rebuiltArcs.push({ loopIndex: baseIndex, span: targetSpan, arc });
      rebuiltOptLoops.push(arc);

      console.log('[LocalOptRebuild] Rebuilt opt span only', {
        loopId: canon.id,
        baseLoopIndex: baseIndex,
        dirtyCanonRange: [mergedStart, mergedEnd],
        optimizedCanonicalVerts: seed.length,
        oldOptSpan: [targetSpan.startOpt, targetSpan.endOpt],
        newOptVerts: arc.length
      });
    }

    // B) For newly created loops: optimize the full loop (these are expected to be local/topology changes)
    const affectedIds = new Set(session.affectedCanonicals.map(l => l.id));
    for (const loop of session.surgery.replacements) {
      if (affectedIds.has(loop.id)) continue;
      const optResult = this.optimizationPipeline.optimize([loop.vertices], this.optimizationOptions);
      const optLoop = optResult.finalOptLoops?.[0];
      if (!optLoop || optLoop.length < 2) continue;
      const segments = buildSegmentsForLoop(loop.id, optLoop, 64, 20, 12, 0.35);
      loop.optVertices = optLoop;
      loop.segments = segments;
      rebuiltOptLoops.push(optLoop);
      rebuiltSegmentDebug.push({ loopId: loop.id, vertices: optLoop, segments });
    }

    session.opt.rebuiltOptLoops = rebuiltOptLoops;
    session.opt.rebuiltSegmentDebug = rebuiltSegmentDebug;
    session.opt.rebuiltArcs = rebuiltArcs;
    session.opt.rebuiltFullLoops = rebuiltFullLoops;
    session.opt.rebuiltInvalidations = [];
  }

  commitLocalUpdateOptSplice(session: LocalUpdateSession): void {
    session.opt = session.opt ?? {
      baseOptLoops: [],
      baseInvalidations: [],
      rebuiltOptLoops: [],
      rebuiltInvalidations: [],
      rebuiltSegmentDebug: [],
      rebuiltArcs: [],
      rebuiltFullLoops: [],
      splicedOptLoops: []
    };
    this.computeLocalUpdateOptAabbInvalidation(session);

    const splicedOptLoops = session.opt.baseOptLoops.slice();
    const spliceSummary: NonNullable<LocalUpdateSession['opt']>['spliceSummary'] = [];

    const gridPitch = this.densityField.config.gridPitch;
    const epsilon = gridPitch * 0.15;

    const chooseOrientation = (segment: OptVertex[], prev: OptVertex, next: OptVertex): OptVertex[] => {
      if (segment.length < 2) return segment;
      const d = (a: Point, b: Point) => Math.hypot(a.x - b.x, a.y - b.y);
      const dForward = d(prev, segment[0]) + d(next, segment[segment.length - 1]);
      const dReverse = d(prev, segment[segment.length - 1]) + d(next, segment[0]);
      return dReverse < dForward ? segment.slice().reverse() : segment;
    };

    // Apply full-loop rebuilds (multiple invalid spans fallback).
    for (const rebuilt of session.opt.rebuiltFullLoops) {
      const baseLoop = splicedOptLoops[rebuilt.loopIndex];
      if (!baseLoop) continue;
      splicedOptLoops[rebuilt.loopIndex] = rebuilt.optLoop;

      const canon =
        session.affectedCanonicals.find(l => l.optVertices === baseLoop) ??
        session.affectedCanonicals.find(l => l.id === rebuilt.loopId);
      if (canon) {
        canon.optVertices = rebuilt.optLoop;
        canon.segments = buildSegmentsForLoop(canon.id, rebuilt.optLoop, 64, 20, 12, 0.35);
      }

      spliceSummary.push({
        oldLoopId: canon?.id ?? rebuilt.loopId,
        newLoopId: canon?.id ?? rebuilt.loopId,
        oldSpanCount: 0,
        newSpanCount: 1,
        splicedVertexCount: rebuilt.optLoop.length,
        usedFallback: true
      });
    }

    // Apply arc rebuilds into existing opt loops (replace only invalidated span)
    for (const rebuilt of session.opt.rebuiltArcs) {
      const baseLoop = splicedOptLoops[rebuilt.loopIndex];
      if (!baseLoop || baseLoop.length < 3) continue;
      const span = rebuilt.span;
      const insertRaw = rebuilt.arc;
      if (insertRaw.length < 2) continue;

      const prev = baseLoop[(span.startOpt - 1 + baseLoop.length) % baseLoop.length];
      const next = baseLoop[(span.endOpt + 1) % baseLoop.length];
      const oriented = chooseOrientation(insertRaw, prev, next);
      const spliced = this.spliceOptLoopReplaceSpan(baseLoop, span, oriented, epsilon);
      splicedOptLoops[rebuilt.loopIndex] = spliced;

      // Update canonical loop reference if we can identify it by opt pointer
      const canon = session.affectedCanonicals.find(l => l.optVertices === baseLoop);
      if (canon) {
        canon.optVertices = spliced;
        canon.segments = buildSegmentsForLoop(canon.id, spliced, 64, 20, 12, 0.35);
      }

      spliceSummary.push({
        oldLoopId: canon?.id ?? -1,
        newLoopId: canon?.id ?? -1,
        oldSpanCount: 1,
        newSpanCount: 1,
        splicedVertexCount: spliced.length,
        usedFallback: false
      });
    }

    // Append any new (unmatched) replacement loops
    for (const repl of session.surgery.replacements) {
      if (!repl.optVertices || repl.optVertices.length < 2) continue;
      const isAlreadyPresent = splicedOptLoops.some(l => l === repl.optVertices);
      if (!isAlreadyPresent) splicedOptLoops.push(repl.optVertices);
    }

    session.opt.splicedOptLoops = splicedOptLoops;
    session.opt.spliceSummary = spliceSummary;
    this.optimizedOptLoopsDebug = splicedOptLoops;
    this.renderer.setOptimizedOptLoops(this.optimizedOptLoopsDebug);
  }

  computeLocalUpdatePhysicsPlan(session: LocalUpdateSession): void {
    const engine = this.physics.getEngine();
    const bodies = engine.getTerrainBodiesInRegion(session.paddedAABB);
    session.physics = session.physics ?? { affectedBodyCount: 0, removedBodyCount: 0 };
    session.physics.affectedBodyCount = bodies.length;
  }

  applyLocalUpdatePhysics(session: LocalUpdateSession): void {
    // Keep physics registry consistent with canonical surgery.
    const affectedIds = new Set(session.affectedCanonicals.map(l => l.id));
    this.canonicalPhysicsLoops = this.canonicalPhysicsLoops.filter(entry => !affectedIds.has(entry.loop.id));
    for (const repl of session.surgery.replacements) {
      this.canonicalPhysicsLoops.push({ loop: repl, shouldReverse: true });
    }

    const engine = this.physics.getEngine();
    const removed = engine.removeTerrainInRegion(session.paddedAABB);
    engine.addCanonicalTerrainLoops(
      session.surgery.replacements,
      session.surgery.replacements.map(r => r.optVertices ?? [])
    );
    this.renderer.setSegmentDebugData(engine.getSegmentDebugSnapshot());

    const renderLoops = this.optimizedOptLoopsDebug.map(loop => loop.map(v => ({ x: v.x, y: v.y })));
    this.renderer.updatePolylines(renderLoops);

    session.physics = session.physics ?? { affectedBodyCount: 0, removedBodyCount: 0 };
    session.physics.removedBodyCount = removed;
    if (import.meta.env.DEV || __CARVE_DEBUG__) {
      console.log(`[LocalUpdate] ⏱️ Remove bodies (local segments): removed ${removed}`);
    }

    this.densityField.clearDirty();
  }

  /**
   * Incremental update - only update affected loops
   * For physics-enabled mode, we do a full heal to ensure physics bodies are correct
   */
  private incrementalUpdate(): RemeshStats | null {
    // For now, just do a full heal since we have physics
    // In the future, we could optimize this to only update affected physics bodies
    return this.fullHeal();
  }

  /**
   * Determine if a loop represents solid rock or a cave hole
   * Uses signed area and density sampling to classify
   *
   * Samples multiple edges and uses majority voting for robust classification.
   * Edges with ambiguous samples (same sign inside/outside) are ignored.
   * If classification is ambiguous after sampling, the loop is marked for deletion.
   *
   * @param loop - The polygon loop to classify
   * @param loopIndex - Optional index for debug output correlation
   * @returns Object with isRock boolean, shouldDelete flag, and optional sample points
   */
  private isRockLoop(loop: Point[], loopIndex?: number): {
    isRock: boolean;
    shouldDelete: boolean;
    samples?: DebugSamplePoint[]
  } {
    if (loop.length < 3) return { isRock: false, shouldDelete: true };

    // Compute polygon properties using helper functions
    const area = computePolygonArea(loop);
    const centroid = computePolygonCentroid(loop);

    // Epsilon distances for sampling (in world units / metres)
    // Sample just over half a cell away to check the neighboring cell
    const gridPitch = this.densityField.config.gridPitch;
    const epsilonInside = 0.501 * gridPitch;
    const epsilonOutside = 0.501 * gridPitch;

    const n = loop.length;

    const debugInfo: DebugLoopInfo = {
      loopIndex,
      area,
      centroid,
      samples: [],
    };

    // Helper to sample an edge and determine if it votes "rock"
    const sampleEdge = (edgeIndex: number): { isRock: boolean; isValid: boolean } => {
      const p = loop[edgeIndex];
      const q = loop[(edgeIndex + 1) % n];

      // Segment midpoint
      const mx = (p.x + q.x) * 0.5;
      const my = (p.y + q.y) * 0.5;

      // Calculate left normal to edge p->q
      let nx = q.y - p.y;
      let ny = -(q.x - p.x);
      const len = Math.hypot(nx, ny);

      // Skip degenerate edges
      if (len < 1e-10) return { isRock: false, isValid: false };

      nx /= len;
      ny /= len;

      // Flip normal based on winding so it points inward
      // CCW (area > 0): left normal points outward, flip it to point inward
      // CW (area < 0): left normal points inward, keep it
      if (area > 0) {
        nx = -nx;
        ny = -ny;
      }

      // Adjust epsilon based on normal direction
      const maxComponent = Math.max(Math.abs(nx), Math.abs(ny));
      const angleAdjustment = 1.0 / maxComponent;
      const adjustedEpsilonInside = epsilonInside * angleAdjustment;
      const adjustedEpsilonOutside = epsilonOutside * angleAdjustment;

      // Sample inside and outside
      const insideX = mx + nx * adjustedEpsilonInside;
      const insideY = my + ny * adjustedEpsilonInside;
      const outsideX = mx - nx * adjustedEpsilonOutside;
      const outsideY = my - ny * adjustedEpsilonOutside;

      const insideGrid = this.densityField.worldToGrid(insideX, insideY);
      const outsideGrid = this.densityField.worldToGrid(outsideX, outsideY);

      const insideDensity = this.densityField.get(insideGrid.gridX, insideGrid.gridY);
      const outsideDensity = this.densityField.get(outsideGrid.gridX, outsideGrid.gridY);

      // Record samples for debug visualization
      if (DEBUG_LOOP_CLASSIFICATION) {
        debugInfo.samples.push(
          { x: insideX, y: insideY, density: insideDensity, side: "inside", segmentIndex: edgeIndex },
          { x: outsideX, y: outsideY, density: outsideDensity, side: "outside", segmentIndex: edgeIndex }
        );
      }

      // Check if signs differ (valid sample)
      const insideIsRock = insideDensity >= 128;
      const outsideIsRock = outsideDensity >= 128;

      if (insideIsRock === outsideIsRock) {
        // Same sign on both sides - ambiguous, ignore this edge
        return { isRock: false, isValid: false };
      }

      // Valid sample: inside tells us if this is rock or cave
      return { isRock: insideIsRock, isValid: true };
    };

    // Sample edges and collect votes
    let rockVotes = 0;
    let caveVotes = 0;
    let sampledEdges = 0;

    // First round: sample 3 edges distributed evenly around the loop
    // At 0°, 120°, 240° positions
    const firstRoundIndices = [
      0,
      Math.floor(n / 3),
      Math.floor(2 * n / 3)
    ].filter(i => i < n);

    for (const edgeIndex of firstRoundIndices) {
      const result = sampleEdge(edgeIndex);
      if (result.isValid) {
        sampledEdges++;
        if (result.isRock) {
          rockVotes++;
        } else {
          caveVotes++;
        }
      }
    }

    // Check if we need a second round (tie or not enough valid samples)
    if (sampledEdges > 0 && rockVotes !== caveVotes) {
      // We have a clear majority, use it
      const isRock = rockVotes > caveVotes;

      if (DEBUG_LOOP_CLASSIFICATION) {
        this.logClassification(loopIndex, debugInfo, isRock, {
          rockVotes,
          caveVotes,
          sampledEdges,
          round: 1
        });
      }

      return { isRock, shouldDelete: false, samples: DEBUG_LOOP_CLASSIFICATION ? debugInfo.samples : undefined };
    }

    // Second round: sample 3 more edges between the first ones
    // At 60°, 180°, 300° positions
    const secondRoundIndices = [
      Math.floor(n / 6),
      Math.floor(n / 2),
      Math.floor(5 * n / 6)
    ].filter(i => i < n);
    for (const edgeIndex of secondRoundIndices) {
      const result = sampleEdge(edgeIndex);
      if (result.isValid) {
        sampledEdges++;
        if (result.isRock) {
          rockVotes++;
        } else {
          caveVotes++;
        }
      }
    }

    // Final decision
    if (sampledEdges === 0 || rockVotes === caveVotes) {
      // No valid samples or still tied - delete this loop
      if (DEBUG_LOOP_CLASSIFICATION) {
        console.warn(`⚠️ LOOP #${loopIndex}: AMBIGUOUS - deleting`, {
          rockVotes,
          caveVotes,
          sampledEdges,
          area,
          centroid,
          vertexCount: loop.length
        });
      }
      return { isRock: false, shouldDelete: true, samples: DEBUG_LOOP_CLASSIFICATION ? debugInfo.samples : undefined };
    }

    const isRock = rockVotes > caveVotes;

    if (DEBUG_LOOP_CLASSIFICATION) {
      this.logClassification(loopIndex, debugInfo, isRock, {
        rockVotes,
        caveVotes,
        sampledEdges,
        round: 2
      });
    }

    return { isRock, shouldDelete: false, samples: DEBUG_LOOP_CLASSIFICATION ? debugInfo.samples : undefined };
  }

  /**
   * Log classification results with statistics
   */
  private logClassification(
    loopIndex: number | undefined,
    debugInfo: DebugLoopInfo,
    isRock: boolean,
    votingStats: { rockVotes: number; caveVotes: number; sampledEdges: number; round: number }
  ): void {
    const insideSamples = debugInfo.samples.filter(s => s.side === "inside");
    const outsideSamples = debugInfo.samples.filter(s => s.side === "outside");

    const insideDensities = insideSamples.map(s => s.density);
    const outsideDensities = outsideSamples.map(s => s.density);

    const avgInsideDensity = insideDensities.length > 0
      ? insideDensities.reduce((a, b) => a + b, 0) / insideDensities.length
      : 0;
    const avgOutsideDensity = outsideDensities.length > 0
      ? outsideDensities.reduce((a, b) => a + b, 0) / outsideDensities.length
      : 0;

    const insideLowCount = insideSamples.filter(s => s.density < 128).length;
    const insideHighCount = insideSamples.filter(s => s.density >= 128).length;
    const outsideLowCount = outsideSamples.filter(s => s.density < 128).length;
    const outsideHighCount = outsideSamples.filter(s => s.density >= 128).length;

    const extendedDebugInfo = {
      ...debugInfo,
      isRock,
      classification: isRock ? "ROCK" : "CAVE",
      voting: votingStats,
      statistics: {
        avgInsideDensity: avgInsideDensity.toFixed(1),
        avgOutsideDensity: avgOutsideDensity.toFixed(1),
        insideLow: insideLowCount,
        insideHigh: insideHighCount,
        outsideLow: outsideLowCount,
        outsideHigh: outsideHighCount,
      },
    };

    const loopLabel = loopIndex !== undefined ? `LOOP #${loopIndex}` : "LOOP";
    // Logging disabled to reduce console noise
  }
}
