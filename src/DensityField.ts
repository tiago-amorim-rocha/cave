import type { AABB, WorldConfig } from './types';
import { PerlinNoise } from './PerlinNoise';
import { generateBubbleCaves, type CaveGenParams } from './BubbleGenerator';

/**
 * Density field backed by Uint8Array
 * Grid pitch h is in metres
 */
export class DensityField {
  data: Uint8Array;
  gridWidth: number; // number of grid points
  gridHeight: number;
  config: WorldConfig;

  // Track dirty region in grid coordinates
  dirtyAABB: AABB | null = null;

  constructor(config: WorldConfig) {
    this.config = config;
    this.gridWidth = Math.floor(config.width / config.gridPitch) + 1;
    this.gridHeight = Math.floor(config.height / config.gridPitch) + 1;
    this.data = new Uint8Array(this.gridWidth * this.gridHeight);
    this.reset();
  }

  /**
   * Reset to full rock (density = 255)
   */
  reset(): void {
    this.data.fill(255);
    this.markAllDirty();
  }

  /**
   * Resize the density field to new dimensions
   */
  resize(newWidth: number, newHeight: number): void {
    this.config.width = newWidth;
    this.config.height = newHeight;
    this.gridWidth = Math.floor(newWidth / this.config.gridPitch) + 1;
    this.gridHeight = Math.floor(newHeight / this.config.gridPitch) + 1;
    this.data = new Uint8Array(this.gridWidth * this.gridHeight);
    this.reset();
  }

  /**
   * Generate procedural caves using Perlin noise
   *
   * @param seed - Random seed for reproducible generation
   * @param scale - Noise scale (smaller = larger features)
   * @param octaves - Number of noise layers
   * @param threshold - Cave threshold (higher = more caves, range: -1 to 1)
   */
  generateCaves(seed?: number, scale: number = 0.05, octaves: number = 4, threshold: number = 0.1): void {
    console.log('[CaveGen] Starting cave generation with parameters:');
    console.log(`  seed: ${seed ?? 'random'}`);
    console.log(`  scale: ${scale}`);
    console.log(`  octaves: ${octaves}`);
    console.log(`  threshold: ${threshold}`);
    console.log(`  grid size: ${this.gridWidth} x ${this.gridHeight}`);

    const noise = new PerlinNoise(seed);

    // Statistics tracking
    let caveCells = 0;
    let rockCells = 0;
    let minNoise = Infinity;
    let maxNoise = -Infinity;
    let minDensity = Infinity;
    let maxDensity = -Infinity;

    // Sample some positions for debugging
    const samples: Array<{x: number, y: number, noise: number, density: number}> = [];
    const samplePositions = [
      { gx: 0, gy: 0 },
      { gx: Math.floor(this.gridWidth / 4), gy: Math.floor(this.gridHeight / 4) },
      { gx: Math.floor(this.gridWidth / 2), gy: Math.floor(this.gridHeight / 2) },
      { gx: Math.floor(3 * this.gridWidth / 4), gy: Math.floor(3 * this.gridHeight / 4) },
      { gx: this.gridWidth - 1, gy: this.gridHeight - 1 }
    ];

    for (let gy = 0; gy < this.gridHeight; gy++) {
      for (let gx = 0; gx < this.gridWidth; gx++) {
        // Convert grid coordinates to world coordinates
        const worldX = gx * this.config.gridPitch;
        const worldY = gy * this.config.gridPitch;

        // Sample noise at this position
        const noiseValue = noise.octaveNoise(
          worldX * scale,
          worldY * scale,
          octaves,
          0.5,  // persistence
          2.0   // lacunarity
        );

        // Track noise range
        minNoise = Math.min(minNoise, noiseValue);
        maxNoise = Math.max(maxNoise, noiseValue);

        // Map noise value to density with continuous gradient
        // noise is in range [-1, 1]
        // threshold controls cave/rock ratio (higher = more caves)
        //
        // This creates a CONTINUOUS density field for smooth marching squares:
        // - noiseValue = threshold → density = 128 (ISO surface)
        // - noiseValue > threshold → density < 128 (cave)
        // - noiseValue < threshold → density > 128 (rock)
        //
        // This allows linear interpolation to find arbitrary crossing points,
        // producing smooth curves with any angle (not just multiples of 45°)

        const density = Math.floor(128 + (threshold - noiseValue) * 127.5);

        // Clamp to valid range [0, 255]
        const clampedDensity = Math.max(0, Math.min(255, density));

        // Track cave vs rock cells based on ISO threshold
        if (clampedDensity >= this.config.isoValue) {
          rockCells++;
        } else {
          caveCells++;
        }

        this.data[gy * this.gridWidth + gx] = clampedDensity;

        // Track density range
        minDensity = Math.min(minDensity, clampedDensity);
        maxDensity = Math.max(maxDensity, clampedDensity);

        // Collect samples for debugging
        if (samplePositions.some(s => s.gx === gx && s.gy === gy)) {
          samples.push({ x: worldX, y: worldY, noise: noiseValue, density: clampedDensity });
        }
      }
    }

    const totalCells = this.gridWidth * this.gridHeight;
    const cavePercent = (caveCells / totalCells * 100).toFixed(1);
    const rockPercent = (rockCells / totalCells * 100).toFixed(1);

    // Count density distribution
    const densityBuckets = new Map<number, number>();
    for (let i = 0; i < this.data.length; i++) {
      const d = this.data[i];
      densityBuckets.set(d, (densityBuckets.get(d) || 0) + 1);
    }
    const uniqueDensities = Array.from(densityBuckets.keys()).sort((a, b) => a - b);

    console.log('[CaveGen] Generation complete!');
    console.log(`  Total cells: ${totalCells}`);
    console.log(`  Cave cells (density=0): ${caveCells} (${cavePercent}%)`);
    console.log(`  Rock cells (density>0): ${rockCells} (${rockPercent}%)`);
    console.log(`  Noise type: GRAYSCALE (continuous values from -1 to 1)`);
    console.log(`  Noise range: [${minNoise.toFixed(3)}, ${maxNoise.toFixed(3)}]`);
    console.log(`  Density type: GRAYSCALE (0=cave, 128-255=rock gradient)`);
    console.log(`  Density range: [${minDensity}, ${maxDensity}]`);
    console.log(`  Unique density values: ${uniqueDensities.length}`);
    console.log(`  ISO value for marching squares: ${this.config.isoValue}`);
    if (uniqueDensities.length <= 20) {
      console.log(`  All density values: [${uniqueDensities.join(', ')}]`);
    } else {
      console.log(`  First 10 densities: [${uniqueDensities.slice(0, 10).join(', ')}]`);
      console.log(`  Last 10 densities: [${uniqueDensities.slice(-10).join(', ')}]`);
    }
    console.log('[CaveGen] Sample positions:');
    samples.forEach(s => {
      const aboveISO = s.density >= this.config.isoValue ? 'ROCK' : 'CAVE';
      console.log(`  (${s.x.toFixed(1)}, ${s.y.toFixed(1)}): noise=${s.noise.toFixed(3)}, density=${s.density} [${aboveISO}]`);
    });

    // Add solid rock border to ensure all caves are enclosed
    // This prevents open loops at boundaries
    const borderWidth = 5; // cells
    console.log(`[CaveGen] Adding ${borderWidth}-cell solid rock border...`);

    let borderCellsSet = 0;

    // Top and bottom borders
    for (let gx = 0; gx < this.gridWidth; gx++) {
      for (let by = 0; by < borderWidth; by++) {
        // Top border
        if (by < this.gridHeight) {
          this.data[by * this.gridWidth + gx] = 255;
          borderCellsSet++;
        }
        // Bottom border
        const bottomY = this.gridHeight - 1 - by;
        if (bottomY >= 0 && bottomY < this.gridHeight) {
          this.data[bottomY * this.gridWidth + gx] = 255;
          borderCellsSet++;
        }
      }
    }

    // Left and right borders
    for (let gy = 0; gy < this.gridHeight; gy++) {
      for (let bx = 0; bx < borderWidth; bx++) {
        // Left border
        if (bx < this.gridWidth) {
          this.data[gy * this.gridWidth + bx] = 255;
          borderCellsSet++;
        }
        // Right border
        const rightX = this.gridWidth - 1 - bx;
        if (rightX >= 0 && rightX < this.gridWidth) {
          this.data[gy * this.gridWidth + rightX] = 255;
          borderCellsSet++;
        }
      }
    }

    console.log(`[CaveGen] Border complete! Set ${borderCellsSet} cells to solid rock (255)`);

    this.markAllDirty();
  }

  /**
   * Generate caves using noise-based bubble algorithm
   */
  generateBubbleCaves(params: CaveGenParams): void {
    console.log('[BubbleGen] Starting bubble cave generation...');
    console.log('  Parameters:', JSON.stringify({
      bubbleCount: params.bubbleCount,
      clusteriness: params.clusteriness,
      sizeRange: [params.sizeMin, params.sizeMax],
      shapeComplexity: params.shapeComplexity,
      shapeIrregularity: params.shapeIrregularity
    }, null, 2));

    // Generate bubbles
    const bubbleData = generateBubbleCaves(params);

    // Replace our data with the generated data
    if (bubbleData.length !== this.data.length) {
      console.warn(`[BubbleGen] Size mismatch! Expected ${this.data.length} (${this.gridWidth}×${this.gridHeight}), got ${bubbleData.length}. Params: ${params.worldAabb.maxX}×${params.worldAabb.maxY}, h=${params.h}`);
      return;
    }

    this.data.set(bubbleData);

    // Add solid rock border (same as Perlin generation)
    const borderWidth = 5;
    console.log(`[BubbleGen] Adding ${borderWidth}-cell solid rock border...`);

    let borderCellsSet = 0;

    // Top and bottom borders
    for (let gx = 0; gx < this.gridWidth; gx++) {
      for (let by = 0; by < borderWidth; by++) {
        // Top border
        if (by < this.gridHeight) {
          this.data[by * this.gridWidth + gx] = 255;
          borderCellsSet++;
        }
        // Bottom border
        const bottomY = this.gridHeight - 1 - by;
        if (bottomY >= 0 && bottomY < this.gridHeight) {
          this.data[bottomY * this.gridWidth + gx] = 255;
          borderCellsSet++;
        }
      }
    }

    // Left and right borders
    for (let gy = 0; gy < this.gridHeight; gy++) {
      for (let bx = 0; bx < borderWidth; bx++) {
        // Left border
        if (bx < this.gridWidth) {
          this.data[gy * this.gridWidth + bx] = 255;
          borderCellsSet++;
        }
        // Right border
        const rightX = this.gridWidth - 1 - bx;
        if (rightX >= 0 && rightX < this.gridWidth) {
          this.data[gy * this.gridWidth + rightX] = 255;
          borderCellsSet++;
        }
      }
    }

    console.log(`[BubbleGen] Border complete! Set ${borderCellsSet} cells to solid rock`);

    // Count statistics
    let caveCells = 0;
    let rockCells = 0;
    for (let i = 0; i < this.data.length; i++) {
      if (this.data[i] < this.config.isoValue) {
        caveCells++;
      } else {
        rockCells++;
      }
    }

    const totalCells = this.data.length;
    const cavePercent = (caveCells / totalCells * 100).toFixed(1);
    const rockPercent = (rockCells / totalCells * 100).toFixed(1);

    console.log(`[BubbleGen] Generation complete!`);
    console.log(`  Total cells: ${totalCells}`);
    console.log(`  Cave cells: ${caveCells} (${cavePercent}%)`);
    console.log(`  Rock cells: ${rockCells} (${rockPercent}%)`);

    this.markAllDirty();
  }

  /**
   * Get density at grid coordinates
   */
  get(gridX: number, gridY: number): number {
    if (gridX < 0 || gridX >= this.gridWidth || gridY < 0 || gridY >= this.gridHeight) {
      return 255; // Treat out-of-bounds as solid
    }
    return this.data[gridY * this.gridWidth + gridX];
  }

  /**
   * Set density at grid coordinates
   */
  set(gridX: number, gridY: number, value: number): void {
    if (gridX < 0 || gridX >= this.gridWidth || gridY < 0 || gridY >= this.gridHeight) {
      return;
    }
    this.data[gridY * this.gridWidth + gridX] = Math.max(0, Math.min(255, value));
  }

  /**
   * Convert world coordinates to grid coordinates
   */
  worldToGrid(worldX: number, worldY: number): { gridX: number; gridY: number } {
    return {
      gridX: Math.floor(worldX / this.config.gridPitch),
      gridY: Math.floor(worldY / this.config.gridPitch)
    };
  }

  /**
   * Convert grid coordinates to world coordinates
   */
  gridToWorld(gridX: number, gridY: number): { worldX: number; worldY: number } {
    return {
      worldX: gridX * this.config.gridPitch,
      worldY: gridY * this.config.gridPitch
    };
  }

  /**
   * Carve (subtract) or add density in a circular brush
   */
  applyBrush(worldX: number, worldY: number, radiusMetres: number, strength: number, add: boolean): void {
    const { gridX: centerGridX, gridY: centerGridY } = this.worldToGrid(worldX, worldY);
    const radiusInGrid = radiusMetres / this.config.gridPitch;

    const minGridX = Math.max(0, Math.floor(centerGridX - radiusInGrid));
    const maxGridX = Math.min(this.gridWidth - 1, Math.ceil(centerGridX + radiusInGrid));
    const minGridY = Math.max(0, Math.floor(centerGridY - radiusInGrid));
    const maxGridY = Math.min(this.gridHeight - 1, Math.ceil(centerGridY + radiusInGrid));

    for (let gy = minGridY; gy <= maxGridY; gy++) {
      for (let gx = minGridX; gx <= maxGridX; gx++) {
        const dx = gx - centerGridX;
        const dy = gy - centerGridY;
        const distSq = dx * dx + dy * dy;

        if (distSq <= radiusInGrid * radiusInGrid) {
          const currentValue = this.get(gx, gy);
          const newValue = add ? currentValue + strength : currentValue - strength;
          this.set(gx, gy, newValue);
        }
      }
    }

    // Mark dirty region
    this.expandDirtyAABB(minGridX, minGridY, maxGridX, maxGridY);
  }

  /**
   * Expand dirty AABB to include new region
   */
  expandDirtyAABB(minX: number, minY: number, maxX: number, maxY: number): void {
    if (this.dirtyAABB === null) {
      this.dirtyAABB = { minX, minY, maxX, maxY };
    } else {
      this.dirtyAABB.minX = Math.min(this.dirtyAABB.minX, minX);
      this.dirtyAABB.minY = Math.min(this.dirtyAABB.minY, minY);
      this.dirtyAABB.maxX = Math.max(this.dirtyAABB.maxX, maxX);
      this.dirtyAABB.maxY = Math.max(this.dirtyAABB.maxY, maxY);
    }
  }

  /**
   * Mark entire field as dirty
   */
  markAllDirty(): void {
    this.dirtyAABB = {
      minX: 0,
      minY: 0,
      maxX: this.gridWidth - 1,
      maxY: this.gridHeight - 1
    };
  }

  /**
   * Clear dirty region
   */
  clearDirty(): void {
    this.dirtyAABB = null;
  }

  /**
   * Get dirty region in world coordinates
   */
  getDirtyWorldAABB(): AABB | null {
    if (!this.dirtyAABB) return null;

    return {
      minX: this.dirtyAABB.minX * this.config.gridPitch,
      minY: this.dirtyAABB.minY * this.config.gridPitch,
      maxX: (this.dirtyAABB.maxX + 1) * this.config.gridPitch,
      maxY: (this.dirtyAABB.maxY + 1) * this.config.gridPitch
    };
  }

  /**
   * Clear a spawn chamber with a guaranteed floor platform
   * Creates a rectangular room with solid floor below for player to spawn on
   * @param worldX - Center X position in world coordinates
   * @param worldY - Center Y position in world coordinates (player spawn height)
   * @param width - Chamber width in metres
   * @param height - Chamber height in metres
   * @param floorThickness - Thickness of floor platform in metres
   */
  clearSpawnArea(worldX: number, worldY: number, width: number = 10, height: number = 6, floorThickness: number = 2): void {
    const { gridX: centerGridX, gridY: centerGridY } = this.worldToGrid(worldX, worldY);
    const widthGrid = width / this.config.gridPitch;
    const heightGrid = height / this.config.gridPitch;
    const floorGrid = floorThickness / this.config.gridPitch;

    const minGridX = Math.max(0, Math.floor(centerGridX - widthGrid / 2));
    const maxGridX = Math.min(this.gridWidth - 1, Math.ceil(centerGridX + widthGrid / 2));

    // Chamber extends upward from player spawn point (empty space above player)
    const chamberMinY = Math.max(0, Math.floor(centerGridY - heightGrid));
    const chamberMaxY = Math.floor(centerGridY); // Include spawn point in chamber

    // Floor is directly below the spawn point
    const floorMinY = Math.ceil(centerGridY) + 1; // Start 1 cell below spawn
    const floorMaxY = Math.min(this.gridHeight - 1, floorMinY + Math.ceil(floorGrid));

    // Clear the chamber (cave/empty space)
    for (let gy = chamberMinY; gy <= chamberMaxY; gy++) {
      for (let gx = minGridX; gx <= maxGridX; gx++) {
        this.set(gx, gy, 0); // Set to cave (0 density)
      }
    }

    // Create solid floor platform below
    for (let gy = floorMinY; gy <= floorMaxY; gy++) {
      for (let gx = minGridX; gx <= maxGridX; gx++) {
        this.set(gx, gy, 255); // Set to solid rock (255 density)
      }
    }

    // Mark dirty region (include both chamber and floor)
    this.expandDirtyAABB(minGridX, chamberMinY, maxGridX, floorMaxY);
    console.log(`[DensityField] Created spawn chamber at (${worldX.toFixed(1)}, ${worldY.toFixed(1)}) - ${width}m × ${height}m cave with ${floorThickness}m floor below`);
  }

  /**
   * Check if a world position is in an empty area (cave)
   * @param worldX - X position in world coordinates
   * @param worldY - Y position in world coordinates
   * @returns true if empty (density < isoValue), false if rock (density >= isoValue)
   */
  isEmptyArea(worldX: number, worldY: number): boolean {
    const { gridX, gridY } = this.worldToGrid(worldX, worldY);

    // Out of bounds is considered rock
    if (gridX < 0 || gridX >= this.gridWidth || gridY < 0 || gridY >= this.gridHeight) {
      return false;
    }

    const density = this.get(gridX, gridY);
    return density < this.config.isoValue;
  }

  /**
   * Get density at world coordinates (with bilinear interpolation for sub-grid accuracy)
   * @param worldX - X position in world coordinates
   * @param worldY - Y position in world coordinates
   * @returns interpolated density value (0-255)
   */
  getDensityAtWorld(worldX: number, worldY: number): number {
    // Convert to grid coordinates (fractional)
    const gridX = worldX / this.config.gridPitch;
    const gridY = worldY / this.config.gridPitch;

    // Get integer grid coordinates
    const gx0 = Math.floor(gridX);
    const gy0 = Math.floor(gridY);
    const gx1 = gx0 + 1;
    const gy1 = gy0 + 1;

    // Get fractional parts
    const fx = gridX - gx0;
    const fy = gridY - gy0;

    // Get corner densities (treat out of bounds as rock = 255)
    const d00 = this.get(gx0, gy0);
    const d10 = gx1 < this.gridWidth ? this.get(gx1, gy0) : 255;
    const d01 = gy1 < this.gridHeight ? this.get(gx0, gy1) : 255;
    const d11 = (gx1 < this.gridWidth && gy1 < this.gridHeight) ? this.get(gx1, gy1) : 255;

    // Bilinear interpolation
    const d0 = d00 * (1 - fx) + d10 * fx;
    const d1 = d01 * (1 - fx) + d11 * fx;
    const density = d0 * (1 - fy) + d1 * fy;

    return density;
  }
}
