import type { AABB, Vec2 } from './types';

/**
 * Cached contour loop with metadata
 */
export interface CachedLoop {
  id: number;
  vertices: Vec2[];
  aabb: AABB;
  closed: boolean;
}

/**
 * Spatial grid index for fast loop queries
 */
export class LoopCache {
  private loops: Map<number, CachedLoop> = new Map();
  private nextId = 0;

  // Spatial grid: bucket size in world units
  private bucketSize = 10; // 10 meters per bucket
  private grid: Map<string, Set<number>> = new Map();

  /**
   * Add a loop to the cache
   */
  addLoop(vertices: Vec2[], closed: boolean): number {
    const id = this.nextId++;
    const aabb = this.computeAABB(vertices);

    const loop: CachedLoop = {
      id,
      vertices,
      aabb,
      closed
    };

    this.loops.set(id, loop);
    this.addToGrid(id, aabb);

    return id;
  }

  /**
   * Remove a loop from the cache
   */
  removeLoop(id: number): void {
    const loop = this.loops.get(id);
    if (!loop) return;

    this.removeFromGrid(id, loop.aabb);
    this.loops.delete(id);
  }

  /**
   * Query loops that intersect with an AABB
   */
  queryAABB(aabb: AABB): CachedLoop[] {
    const candidates = new Set<number>();

    // Get all buckets that overlap the query AABB
    const minBucketX = Math.floor(aabb.minX / this.bucketSize);
    const minBucketY = Math.floor(aabb.minY / this.bucketSize);
    const maxBucketX = Math.floor(aabb.maxX / this.bucketSize);
    const maxBucketY = Math.floor(aabb.maxY / this.bucketSize);

    for (let by = minBucketY; by <= maxBucketY; by++) {
      for (let bx = minBucketX; bx <= maxBucketX; bx++) {
        const key = `${bx},${by}`;
        const bucket = this.grid.get(key);
        if (bucket) {
          bucket.forEach(id => candidates.add(id));
        }
      }
    }

    // Filter to only loops that actually intersect
    const result: CachedLoop[] = [];
    for (const id of candidates) {
      const loop = this.loops.get(id);
      if (loop && this.aabbIntersects(loop.aabb, aabb)) {
        result.push(loop);
      }
    }

    return result;
  }

  /**
   * Get all loops
   */
  getAllLoops(): CachedLoop[] {
    return Array.from(this.loops.values());
  }

  /**
   * Clear all loops
   */
  clear(): void {
    this.loops.clear();
    this.grid.clear();
    this.nextId = 0;
  }

  /**
   * Get loop count
   */
  count(): number {
    return this.loops.size;
  }

  /**
   * Compute AABB for vertices
   */
  private computeAABB(vertices: Vec2[]): AABB {
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
   * Add loop to spatial grid
   */
  private addToGrid(id: number, aabb: AABB): void {
    const minBucketX = Math.floor(aabb.minX / this.bucketSize);
    const minBucketY = Math.floor(aabb.minY / this.bucketSize);
    const maxBucketX = Math.floor(aabb.maxX / this.bucketSize);
    const maxBucketY = Math.floor(aabb.maxY / this.bucketSize);

    for (let by = minBucketY; by <= maxBucketY; by++) {
      for (let bx = minBucketX; bx <= maxBucketX; bx++) {
        const key = `${bx},${by}`;
        let bucket = this.grid.get(key);
        if (!bucket) {
          bucket = new Set();
          this.grid.set(key, bucket);
        }
        bucket.add(id);
      }
    }
  }

  /**
   * Remove loop from spatial grid
   */
  private removeFromGrid(id: number, aabb: AABB): void {
    const minBucketX = Math.floor(aabb.minX / this.bucketSize);
    const minBucketY = Math.floor(aabb.minY / this.bucketSize);
    const maxBucketX = Math.floor(aabb.maxX / this.bucketSize);
    const maxBucketY = Math.floor(aabb.maxY / this.bucketSize);

    for (let by = minBucketY; by <= maxBucketY; by++) {
      for (let bx = minBucketX; bx <= maxBucketX; bx++) {
        const key = `${bx},${by}`;
        const bucket = this.grid.get(key);
        if (bucket) {
          bucket.delete(id);
          if (bucket.size === 0) {
            this.grid.delete(key);
          }
        }
      }
    }
  }

  /**
   * Check if two AABBs intersect
   */
  private aabbIntersects(a: AABB, b: AABB): boolean {
    return !(
      a.maxX < b.minX ||
      a.minX > b.maxX ||
      a.maxY < b.minY ||
      a.minY > b.maxY
    );
  }
}
