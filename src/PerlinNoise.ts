/**
 * Simple 2D Perlin Noise implementation
 * Based on Ken Perlin's improved noise algorithm
 */
export class PerlinNoise {
  private permutation: number[];
  private p: number[];

  constructor(seed?: number) {
    // Initialize permutation table
    this.permutation = [];
    for (let i = 0; i < 256; i++) {
      this.permutation[i] = i;
    }

    // Shuffle using seed
    if (seed !== undefined) {
      this.shuffle(this.permutation, seed);
    } else {
      // Random shuffle
      for (let i = 255; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [this.permutation[i], this.permutation[j]] = [this.permutation[j], this.permutation[i]];
      }
    }

    // Duplicate permutation table for overflow
    this.p = new Array(512);
    for (let i = 0; i < 512; i++) {
      this.p[i] = this.permutation[i % 256];
    }
  }

  /**
   * Seeded shuffle using simple LCG (Linear Congruential Generator)
   */
  private shuffle(array: number[], seed: number): void {
    let currentSeed = seed;

    const random = () => {
      currentSeed = (currentSeed * 9301 + 49297) % 233280;
      return currentSeed / 233280;
    };

    for (let i = array.length - 1; i > 0; i--) {
      const j = Math.floor(random() * (i + 1));
      [array[i], array[j]] = [array[j], array[i]];
    }
  }

  /**
   * Fade function for smooth interpolation
   */
  private fade(t: number): number {
    return t * t * t * (t * (t * 6 - 15) + 10);
  }

  /**
   * Linear interpolation
   */
  private lerp(t: number, a: number, b: number): number {
    return a + t * (b - a);
  }

  /**
   * Gradient function with 8 evenly distributed directions
   * This provides better isotropy than the classic 4-gradient version,
   * reducing directional bias toward 45° angles
   */
  private grad(hash: number, x: number, y: number): number {
    const h = hash & 7; // 8 gradient directions instead of 4

    // 8 gradient vectors evenly distributed around the circle:
    // (1,0), (1,1), (0,1), (-1,1), (-1,0), (-1,-1), (0,-1), (1,-1)
    switch (h) {
      case 0: return x;           // (1, 0)   →   0°
      case 1: return x + y;       // (1, 1)   →  45°
      case 2: return y;           // (0, 1)   →  90°
      case 3: return -x + y;      // (-1, 1)  → 135°
      case 4: return -x;          // (-1, 0)  → 180°
      case 5: return -x - y;      // (-1, -1) → 225°
      case 6: return -y;          // (0, -1)  → 270°
      case 7: return x - y;       // (1, -1)  → 315°
      default: return 0;
    }
  }

  /**
   * Get 2D Perlin noise value at (x, y)
   * Returns value in range [-1, 1]
   */
  noise(x: number, y: number): number {
    // Find unit grid cell containing point
    const X = Math.floor(x) & 255;
    const Y = Math.floor(y) & 255;

    // Get relative position within cell
    x -= Math.floor(x);
    y -= Math.floor(y);

    // Compute fade curves
    const u = this.fade(x);
    const v = this.fade(y);

    // Hash coordinates of the 4 corners
    const a = this.p[X] + Y;
    const aa = this.p[a];
    const ab = this.p[a + 1];
    const b = this.p[X + 1] + Y;
    const ba = this.p[b];
    const bb = this.p[b + 1];

    // Blend results from 4 corners
    return this.lerp(
      v,
      this.lerp(u, this.grad(this.p[aa], x, y), this.grad(this.p[ba], x - 1, y)),
      this.lerp(u, this.grad(this.p[ab], x, y - 1), this.grad(this.p[bb], x - 1, y - 1))
    );
  }

  /**
   * Generate octave noise (fractal noise)
   * Combines multiple frequencies of noise for more natural appearance
   *
   * @param x - X coordinate
   * @param y - Y coordinate
   * @param octaves - Number of noise layers to combine
   * @param persistence - How much each octave contributes (typically 0.5)
   * @param lacunarity - Frequency multiplier for each octave (typically 2.0)
   * @returns Noise value in range approximately [-1, 1]
   */
  octaveNoise(
    x: number,
    y: number,
    octaves: number = 4,
    persistence: number = 0.5,
    lacunarity: number = 2.0
  ): number {
    let total = 0;
    let frequency = 1;
    let amplitude = 1;
    let maxValue = 0; // Used for normalizing result

    for (let i = 0; i < octaves; i++) {
      total += this.noise(x * frequency, y * frequency) * amplitude;

      maxValue += amplitude;

      amplitude *= persistence;
      frequency *= lacunarity;
    }

    return total / maxValue;
  }
}
