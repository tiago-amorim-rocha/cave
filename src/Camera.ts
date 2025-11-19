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
  private baseZoom = 80; // PPM when stationary (zoomed in for close view)
  private minDynamicZoom = 50; // PPM when moving fast (zoomed out for wider view)
  private speedThreshold = 3.0; // Speed at which max zoom-out occurs (m/s)
  private zoomSmoothSpeed = 0.08; // Zoom transition speed (higher = faster)

  // Look-ahead parameters (directional overshoot)
  private lookAheadDistance = 1.2; // Maximum look-ahead distance in metres
  private lookAheadSpeed = 3.5; // Speed threshold for max look-ahead (m/s)

  // Smoothing parameters (frame-rate independent)
  private smoothSpeed = 0.12; // Camera follow smoothing (higher = snappier)

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
   * Advanced camera following with dynamic zoom and directional overshoot
   * @param playerX - Player X position (metres)
   * @param playerY - Player Y position (metres)
   * @param velocityX - Player X velocity (metres/second)
   * @param velocityY - Player Y velocity (metres/second)
   * @param deltaTime - Time since last frame (seconds)
   */
  followPlayer(
    playerX: number,
    playerY: number,
    velocityX: number,
    velocityY: number,
    deltaTime: number
  ): void {
    // Calculate player speed (magnitude of velocity)
    const speed = Math.sqrt(velocityX * velocityX + velocityY * velocityY);

    // === Dynamic Zoom Based on Speed ===
    // Interpolate between baseZoom (stationary) and minDynamicZoom (moving fast)
    const zoomFactor = Math.min(speed / this.speedThreshold, 1.0); // 0-1 based on speed
    this.targetZoom = this.baseZoom - (this.baseZoom - this.minDynamicZoom) * zoomFactor;

    // Smoothly interpolate current zoom towards target zoom
    this.zoom += (this.targetZoom - this.zoom) * this.zoomSmoothSpeed;

    // === Directional Overshoot (Look-ahead) ===
    // Calculate look-ahead offset based on velocity direction
    let lookAheadX = 0;
    let lookAheadY = 0;

    if (speed > 0.1) { // Only apply look-ahead if actually moving
      // Normalize velocity to get direction
      const dirX = velocityX / speed;
      const dirY = velocityY / speed;

      // Calculate look-ahead factor (0-1 based on speed)
      const lookAheadFactor = Math.min(speed / this.lookAheadSpeed, 1.0);

      // Apply look-ahead offset in movement direction
      lookAheadX = dirX * this.lookAheadDistance * lookAheadFactor;
      lookAheadY = dirY * this.lookAheadDistance * lookAheadFactor;
    }

    // Target camera position = player position + look-ahead offset
    const targetX = playerX + lookAheadX;
    const targetY = playerY + lookAheadY;

    // === Smooth Camera Follow ===
    // Use exponential smoothing for smooth, frame-rate independent movement
    this.x += (targetX - this.x) * this.smoothSpeed;
    this.y += (targetY - this.y) * this.smoothSpeed;

    // Clamp to world bounds
    this.clampToBounds();
  }
}
