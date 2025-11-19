import type { CameraState, Vec2 } from './types';

/**
 * Camera system for world-space navigation
 * All positions are in metres, zoom is pixels-per-metre
 */
export class Camera {
  x: number; // world position (metres)
  y: number;
  zoom: number; // pixels per metre (PPM)

  minZoom = 10; // minimum PPM
  maxZoom = 400; // maximum PPM (2x more than before)

  worldWidth: number; // world bounds (metres)
  worldHeight: number;

  // Dynamic camera parameters
  private baseZoom = 50; // PPM when stationary (2x zoomed out from previous 100)
  private minDynamicZoom = 35; // PPM when moving fast (2x zoomed out from previous 70)
  private zoomOutFactor = 6; // How much velocity affects zoom
  private zoomSmoothSpeed = 0.06; // Zoom transition speed

  // Look-ahead parameters
  private lookAheadX = 0.3; // Horizontal look-ahead factor
  private lookAheadY = 0.15; // Vertical look-ahead factor

  // Smoothing parameters (frame-rate independent)
  private smoothX = 0.06; // Horizontal follow smoothing
  private smoothY = 0.08; // Vertical follow smoothing (more responsive)

  // Target zoom (for smooth transitions)
  private targetZoom: number;

  constructor(x: number, y: number, zoom: number, worldWidth: number = 50, worldHeight: number = 30) {
    this.x = x;
    this.y = y;
    this.zoom = zoom;
    this.targetZoom = zoom;
    this.worldWidth = worldWidth;
    this.worldHeight = worldHeight;
  }

  /**
   * Convert screen pixel coordinates to world coordinates (metres)
   */
  screenToWorld(screenX: number, screenY: number, canvasWidth: number, canvasHeight: number): Vec2 {
    // Screen center in world coords
    const worldX = this.x + (screenX - canvasWidth / 2) / this.zoom;
    const worldY = this.y + (screenY - canvasHeight / 2) / this.zoom;
    return { x: worldX, y: worldY };
  }

  /**
   * Convert world coordinates (metres) to screen pixel coordinates
   */
  worldToScreen(worldX: number, worldY: number, canvasWidth: number, canvasHeight: number): Vec2 {
    const screenX = (worldX - this.x) * this.zoom + canvasWidth / 2;
    const screenY = (worldY - this.y) * this.zoom + canvasHeight / 2;
    return { x: screenX, y: screenY };
  }

  /**
   * Clamp camera position to stay within world bounds
   */
  private clampToBounds(): void {
    this.x = Math.max(0, Math.min(this.worldWidth, this.x));
    this.y = Math.max(0, Math.min(this.worldHeight, this.y));
  }

  /**
   * Pan camera by screen pixels
   */
  pan(dx: number, dy: number): void {
    this.x -= dx / this.zoom;
    this.y -= dy / this.zoom;
    this.clampToBounds();
  }

  /**
   * Zoom camera around a screen point
   */
  zoomAt(screenX: number, screenY: number, zoomDelta: number, canvasWidth: number, canvasHeight: number): void {
    // Get world position before zoom
    const worldPosBefore = this.screenToWorld(screenX, screenY, canvasWidth, canvasHeight);

    // Apply zoom
    this.zoom = Math.max(this.minZoom, Math.min(this.maxZoom, this.zoom * zoomDelta));

    // Get world position after zoom
    const worldPosAfter = this.screenToWorld(screenX, screenY, canvasWidth, canvasHeight);

    // Adjust camera to keep the same world point under the cursor
    this.x += worldPosBefore.x - worldPosAfter.x;
    this.y += worldPosBefore.y - worldPosAfter.y;
    this.clampToBounds();
  }

  getState(): CameraState {
    return {
      x: this.x,
      y: this.y,
      zoom: this.zoom
    };
  }

  setState(state: CameraState): void {
    this.x = state.x;
    this.y = state.y;
    this.zoom = state.zoom;
  }

  /**
   * Smoothly move camera towards a target position using linear interpolation
   * @param targetX - Target world x position (metres)
   * @param targetY - Target world y position (metres)
   * @param smoothing - Lerp factor (0-1), lower = smoother but slower. Typical: 0.1
   */
  smoothFollow(targetX: number, targetY: number, smoothing: number = 0.1): void {
    // Linear interpolation: current + (target - current) * smoothing
    this.x += (targetX - this.x) * smoothing;
    this.y += (targetY - this.y) * smoothing;
    this.clampToBounds();
  }

  /**
   * Simple camera following - just copy player position exactly
   * @param playerX - Player X position (metres)
   * @param playerY - Player Y position (metres)
   * @param velocityX - Player X velocity (metres/second) [unused]
   * @param velocityY - Player Y velocity (metres/second) [unused]
   * @param deltaTime - Time since last frame (seconds) [unused]
   */
  followPlayer(
    playerX: number,
    playerY: number,
    velocityX: number,
    velocityY: number,
    deltaTime: number
  ): void {
    // Directly copy player position - no smoothing, no look-ahead
    this.x = playerX;
    this.y = playerY;

    // Fixed zoom
    this.zoom = this.baseZoom;

    // Clamp to world bounds
    this.clampToBounds();
  }
}
