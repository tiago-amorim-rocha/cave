import type { AABB, Vec2 } from './types';
import { PerlinNoise } from './PerlinNoise';

/**
 * Cave generation parameters for noise-based bubble generation
 */
export type CaveGenParams = {
  // World
  worldAabb: AABB;
  h: number;
  ISO: number;
  seed: number;

  // ═══════════════════════════════════════
  // START BUBBLE (clean & predictable)
  // ═══════════════════════════════════════
  startAt: Vec2;
  startRadii: { a: number; b: number; theta: number };

  // ═══════════════════════════════════════
  // DISTRIBUTION (where bubbles appear)
  // ═══════════════════════════════════════
  bubbleCount: number;

  clusteriness: number;  // 0=uniform, 1=very clustered
  clusterScale: number;  // Average cluster size in meters

  // ═══════════════════════════════════════
  // SIZE DISTRIBUTION (how big are bubbles)
  // ═══════════════════════════════════════
  sizeMin: number;
  sizeMax: number;
  sizeDistribution: 'uniform' | 'powerLaw' | 'normal';

  // ═══════════════════════════════════════
  // SHAPE VARIETY (noise-based deformation)
  // ═══════════════════════════════════════
  shapeComplexity: number;      // Noise octaves (1-4)
  shapeIrregularity: number;    // Radial amplitude (0-1)
  shapeAngularFreq: number;     // Angular frequency (2-12)
  shapeVariation: number;       // Per-bubble randomness (0-1)

  // ═══════════════════════════════════════
  // OVERLAP (how bubbles interact)
  // ═══════════════════════════════════════
  overlapChance: number;           // 0-1 probability of overlap
  separationWhenNoOverlap: number; // Gap in meters

  // ═══════════════════════════════════════
  // BLENDING (softness of merging)
  // ═══════════════════════════════════════
  softK: number;  // Soft minimum k (0.5-2.0)
};

/**
 * Default cave generation parameters
 */
export const DEFAULT_CAVE_PARAMS: CaveGenParams = {
  worldAabb: { minX: 0, minY: 0, maxX: 50, maxY: 30 },
  h: 0.2,
  ISO: 128,
  seed: Date.now(),

  // Start
  startAt: { x: 25, y: 15 },
  startRadii: { a: 4, b: 2, theta: 0 },

  // Distribution
  bubbleCount: 30,
  clusteriness: 0.6,
  clusterScale: 8,

  // Size
  sizeMin: 1.5,
  sizeMax: 5,
  sizeDistribution: 'powerLaw',

  // Shape
  shapeComplexity: 2,
  shapeIrregularity: 0.4,
  shapeAngularFreq: 6,
  shapeVariation: 0.7,

  // Overlap
  overlapChance: 0.3,
  separationWhenNoOverlap: 1.0,

  // Blending
  softK: 1.2
};

/**
 * Noise-based bubble with radial deformation
 */
class NoiseBubble {
  center: Vec2;
  baseRadius: number;

  // Per-bubble random variation
  noiseOffset: Vec2;
  angularPhase: number;

  // Shape parameters
  complexity: number;
  irregularity: number;
  angularFreq: number;

  private perlin: PerlinNoise;

  constructor(
    center: Vec2,
    baseRadius: number,
    perlin: PerlinNoise,
    rng: () => number,
    params: CaveGenParams
  ) {
    this.center = center;
    this.baseRadius = baseRadius;
    this.perlin = perlin;

    // Random variation per bubble
    const variation = params.shapeVariation;
    this.noiseOffset = {
      x: rng() * 1000,
      y: rng() * 1000
    };
    this.angularPhase = rng() * Math.PI * 2;

    // Shape parameters with variation
    this.complexity = Math.max(1, Math.round(
      params.shapeComplexity * (1 + (rng() - 0.5) * variation)
    ));
    this.irregularity = params.shapeIrregularity * (1 + (rng() - 0.5) * variation);
    this.angularFreq = params.shapeAngularFreq * (1 + (rng() - 0.5) * variation * 0.5);
  }

  /**
   * Calculate radius at given angle
   */
  radiusAt(theta: number): number {
    const t = this.angularFreq * (theta + this.angularPhase);

    let noise = 0;
    let amplitude = this.irregularity;
    let frequency = 1;

    // Fractal noise (octaves = complexity)
    for (let i = 0; i < this.complexity; i++) {
      noise += amplitude * this.perlin.noise(
        frequency * Math.cos(t) + this.noiseOffset.x,
        frequency * Math.sin(t) + this.noiseOffset.y
      );
      amplitude *= 0.5;
      frequency *= 2;
    }

    return this.baseRadius * (1 + noise);
  }

  /**
   * Signed distance function for this bubble
   */
  sdf(p: Vec2): number {
    const dx = p.x - this.center.x;
    const dy = p.y - this.center.y;
    const theta = Math.atan2(dy, dx);
    const r = Math.sqrt(dx * dx + dy * dy);

    return r - this.radiusAt(theta);
  }
}

/**
 * Elliptical bubble (for start area)
 */
class EllipseBubble {
  center: Vec2;
  a: number;
  b: number;
  theta: number;

  constructor(center: Vec2, a: number, b: number, theta: number) {
    this.center = center;
    this.a = a;
    this.b = b;
    this.theta = theta;
  }

  /**
   * Signed distance function for ellipse
   */
  sdf(p: Vec2): number {
    // Transform to ellipse local space
    const dx = p.x - this.center.x;
    const dy = p.y - this.center.y;

    const cos_t = Math.cos(this.theta);
    const sin_t = Math.sin(this.theta);

    const x_local = dx * cos_t + dy * sin_t;
    const y_local = -dx * sin_t + dy * cos_t;

    // Approximate ellipse SDF
    const px = Math.abs(x_local);
    const py = Math.abs(y_local);

    const k0 = Math.sqrt(px * px / (this.a * this.a) + py * py / (this.b * this.b));
    return (k0 - 1) * Math.max(this.a, this.b);
  }
}

/**
 * Soft minimum blend function
 */
function softMin(d1: number, d2: number, k: number): number {
  if (k <= 0) return Math.min(d1, d2);

  const h = Math.max(0, Math.min(1, (d2 - d1) / (2 * k) + 0.5));
  return d1 * h + d2 * (1 - h) - k * h * (1 - h);
}

/**
 * Seeded random number generator
 */
class SeededRandom {
  private seed: number;

  constructor(seed: number) {
    this.seed = seed;
  }

  next(): number {
    this.seed = (this.seed * 9301 + 49297) % 233280;
    return this.seed / 233280;
  }

  /**
   * Gaussian random (Box-Muller transform)
   */
  gaussian(): number {
    const u1 = this.next();
    const u2 = this.next();
    return Math.sqrt(-2 * Math.log(u1)) * Math.cos(2 * Math.PI * u2);
  }
}

/**
 * Sample bubble size based on distribution
 */
function sampleSize(rng: SeededRandom, params: CaveGenParams): number {
  const { sizeMin, sizeMax, sizeDistribution } = params;

  switch (sizeDistribution) {
    case 'uniform':
      return sizeMin + rng.next() * (sizeMax - sizeMin);

    case 'powerLaw': {
      // Power law: many small, few large
      const alpha = 2.5;
      const u = rng.next();
      const ratio = Math.pow(u, 1 / alpha);
      return sizeMin + ratio * (sizeMax - sizeMin);
    }

    case 'normal': {
      const mean = (sizeMin + sizeMax) / 2;
      const stdDev = (sizeMax - sizeMin) / 4;
      let size = mean + rng.gaussian() * stdDev;
      size = Math.max(sizeMin, Math.min(sizeMax, size));
      return size;
    }
  }
}

/**
 * Generate bubble centers with clustering
 */
function generateBubbleCenters(params: CaveGenParams, rng: SeededRandom): Vec2[] {
  const { worldAabb, bubbleCount, clusteriness, clusterScale, startAt } = params;

  const points: Vec2[] = [startAt]; // Start bubble first

  if (clusteriness === 0) {
    // Uniform random distribution
    for (let i = 1; i < bubbleCount; i++) {
      points.push({
        x: worldAabb.minX + rng.next() * (worldAabb.maxX - worldAabb.minX),
        y: worldAabb.minY + rng.next() * (worldAabb.maxY - worldAabb.minY)
      });
    }
  } else {
    // Hierarchical clustering
    const clusterCount = Math.max(3, Math.ceil(bubbleCount / 8));
    const clusterCenters: Vec2[] = [];

    // Generate cluster centers
    for (let i = 0; i < clusterCount; i++) {
      clusterCenters.push({
        x: worldAabb.minX + rng.next() * (worldAabb.maxX - worldAabb.minX),
        y: worldAabb.minY + rng.next() * (worldAabb.maxY - worldAabb.minY)
      });
    }

    // Distribute bubbles around cluster centers
    const bubblesPerCluster = Math.ceil((bubbleCount - 1) / clusterCount);
    const spreadRadius = clusterScale * (1.5 - clusteriness * 0.8);

    for (let i = 1; i < bubbleCount; i++) {
      const clusterIdx = Math.floor(rng.next() * clusterCount);
      const cc = clusterCenters[clusterIdx];

      // Gaussian distribution around cluster center
      const angle = rng.next() * Math.PI * 2;
      const dist = Math.abs(rng.gaussian()) * spreadRadius;

      points.push({
        x: cc.x + Math.cos(angle) * dist,
        y: cc.y + Math.sin(angle) * dist
      });
    }
  }

  return points;
}

/**
 * Generate caves as noise-based bubbles
 */
export function generateBubbleCaves(params: CaveGenParams): Uint8Array {
  const { worldAabb, h, ISO } = params;
  // Use same formula as DensityField constructor: Math.floor(...) + 1
  const width = Math.floor((worldAabb.maxX - worldAabb.minX) / h) + 1;
  const height = Math.floor((worldAabb.maxY - worldAabb.minY) / h) + 1;

  const rng = new SeededRandom(params.seed);
  const perlin = new PerlinNoise(params.seed);

  // Generate bubble centers
  const centers = generateBubbleCenters(params, rng);

  // Create bubbles
  const bubbles: (NoiseBubble | EllipseBubble)[] = [];

  // First bubble: start ellipse
  bubbles.push(new EllipseBubble(
    params.startAt,
    params.startRadii.a,
    params.startRadii.b,
    params.startRadii.theta
  ));

  // Rest: noise bubbles
  for (let i = 1; i < centers.length; i++) {
    const size = sampleSize(rng, params);
    bubbles.push(new NoiseBubble(
      centers[i],
      size,
      perlin,
      () => rng.next(),
      params
    ));
  }

  // Fill density field
  const densityField = new Uint8Array(width * height);
  const scale = 255 / (2 * h);

  for (let j = 0; j < height; j++) {
    for (let i = 0; i < width; i++) {
      const x = worldAabb.minX + i * h;
      const y = worldAabb.minY + j * h;
      const p = { x, y };

      // Compute soft minimum of all bubble SDFs
      let d = bubbles[0].sdf(p);
      for (let k = 1; k < bubbles.length; k++) {
        d = softMin(d, bubbles[k].sdf(p), params.softK);
      }

      // Convert SDF to density (negative inside = low density = cave)
      const density = Math.round(ISO - scale * d);
      densityField[j * width + i] = Math.max(0, Math.min(255, density));
    }
  }

  return densityField;
}
