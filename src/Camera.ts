import type { CameraState, Vec2 } from './types';

export interface CameraOptions {
  minZoom?: number;
  maxZoom?: number;
}

/**
 * Minimal camera for 2D world navigation.
 * World units are metres, zoom is pixels-per-metre.
 */
export class Camera {
  x: number;
  y: number;
  zoom: number;
  minZoom: number;
  maxZoom: number;
  worldWidth: number;
  worldHeight: number;

  constructor(
    x: number,
    y: number,
    zoom: number,
    worldWidth: number,
    worldHeight: number,
    options: CameraOptions = {}
  ) {
    this.x = x;
    this.y = y;
    this.zoom = zoom;
    this.worldWidth = worldWidth;
    this.worldHeight = worldHeight;
    this.minZoom = options.minZoom ?? 10;
    this.maxZoom = options.maxZoom ?? 400;
  }

  screenToWorld(screenX: number, screenY: number, canvasWidth: number, canvasHeight: number): Vec2 {
    return {
      x: this.x + (screenX - canvasWidth / 2) / this.zoom,
      y: this.y + (screenY - canvasHeight / 2) / this.zoom,
    };
  }

  worldToScreen(worldX: number, worldY: number, canvasWidth: number, canvasHeight: number): Vec2 {
    return {
      x: (worldX - this.x) * this.zoom + canvasWidth / 2,
      y: (worldY - this.y) * this.zoom + canvasHeight / 2,
    };
  }

  pan(dx: number, dy: number): void {
    this.x -= dx / this.zoom;
    this.y -= dy / this.zoom;
    this.clampToBounds();
  }

  zoomAt(screenX: number, screenY: number, zoomDelta: number, canvasWidth: number, canvasHeight: number): void {
    const worldPosBefore = this.screenToWorld(screenX, screenY, canvasWidth, canvasHeight);
    this.zoom = Math.max(this.minZoom, Math.min(this.maxZoom, this.zoom * zoomDelta));
    const worldPosAfter = this.screenToWorld(screenX, screenY, canvasWidth, canvasHeight);
    this.x += worldPosBefore.x - worldPosAfter.x;
    this.y += worldPosBefore.y - worldPosAfter.y;
    this.clampToBounds();
  }

  smoothFollow(targetX: number, targetY: number, smoothing: number = 0.1): void {
    this.x += (targetX - this.x) * smoothing;
    this.y += (targetY - this.y) * smoothing;
    this.clampToBounds();
  }

  getState(): CameraState {
    return { x: this.x, y: this.y, zoom: this.zoom };
  }

  setState(state: CameraState): void {
    this.x = state.x;
    this.y = state.y;
    this.zoom = state.zoom;
  }

  private clampToBounds(): void {
    this.x = Math.max(0, Math.min(this.worldWidth, this.x));
    this.y = Math.max(0, Math.min(this.worldHeight, this.y));
  }
}
