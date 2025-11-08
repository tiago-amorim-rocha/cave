import type { AABB, WorldConfig } from './types';

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
}
