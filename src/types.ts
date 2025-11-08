/**
 * All spatial coordinates and dimensions are in world units (metres)
 */

export interface Vec2 {
  x: number;
  y: number;
}

export interface AABB {
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
}

export interface CameraState {
  x: number; // world units (metres)
  y: number; // world units (metres)
  zoom: number; // pixels per metre (PPM)
}

export interface BrushSettings {
  radius: number; // world units (metres)
  strength: number; // 0-255
}

export interface WorldConfig {
  width: number; // metres
  height: number; // metres
  gridPitch: number; // metres (h)
  isoValue: number; // density threshold (0-255)
}
