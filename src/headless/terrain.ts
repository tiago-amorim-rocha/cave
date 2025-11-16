/**
 * Simple terrain generation for headless testing
 *
 * Creates static terrain shapes without marching squares or density fields.
 */

import type { Point } from '../types';

export interface TerrainShape {
  type: 'flat' | 'slope' | 'wall' | 'pit';
  points: Point[];
}

/**
 * Create a flat ground platform
 * @param y - Y position of the ground surface
 * @param width - Width of the platform
 * @param thickness - Thickness of the platform (downward)
 * @returns Closed loop representing the platform
 */
export function createFlatGround(y: number, width: number, thickness: number = 1.0): Point[] {
  const halfWidth = width / 2;

  return [
    { x: -halfWidth, y: y },           // Top-left
    { x: halfWidth, y: y },            // Top-right
    { x: halfWidth, y: y + thickness }, // Bottom-right
    { x: -halfWidth, y: y + thickness },// Bottom-left
    { x: -halfWidth, y: y }            // Close the loop
  ];
}

/**
 * Create a sloped ramp
 * @param startX - Starting X position
 * @param startY - Starting Y position
 * @param endX - Ending X position
 * @param endY - Ending Y position
 * @param thickness - Thickness of the ramp (perpendicular to slope)
 * @returns Closed loop representing the ramp
 */
export function createSlope(
  startX: number,
  startY: number,
  endX: number,
  endY: number,
  thickness: number = 1.0
): Point[] {
  // Calculate perpendicular offset for thickness
  const dx = endX - startX;
  const dy = endY - startY;
  const len = Math.sqrt(dx * dx + dy * dy);
  const nx = -dy / len; // Normal X (perpendicular)
  const ny = dx / len;  // Normal Y (perpendicular)

  const offsetX = nx * thickness;
  const offsetY = ny * thickness;

  return [
    { x: startX, y: startY },                        // Top start
    { x: endX, y: endY },                            // Top end
    { x: endX + offsetX, y: endY + offsetY },        // Bottom end
    { x: startX + offsetX, y: startY + offsetY },    // Bottom start
    { x: startX, y: startY }                         // Close the loop
  ];
}

/**
 * Create a vertical wall obstacle
 * @param x - X position of the wall
 * @param bottomY - Y position of the wall bottom
 * @param height - Height of the wall
 * @param thickness - Thickness of the wall
 * @returns Closed loop representing the wall
 */
export function createWall(x: number, bottomY: number, height: number, thickness: number = 0.5): Point[] {
  const halfThickness = thickness / 2;

  return [
    { x: x - halfThickness, y: bottomY - height }, // Top-left
    { x: x + halfThickness, y: bottomY - height }, // Top-right
    { x: x + halfThickness, y: bottomY },          // Bottom-right
    { x: x - halfThickness, y: bottomY },          // Bottom-left
    { x: x - halfThickness, y: bottomY - height }  // Close the loop
  ];
}

/**
 * Create a simple test arena with flat ground
 * Suitable for basic spider movement testing
 */
export function createSimpleArena(): Point[][] {
  const ground = createFlatGround(15, 60, 5); // 60m wide, 5m thick, at y=15

  return [ground];
}

/**
 * Create a test arena with varied terrain
 * Flat ground + slope + wall obstacle
 */
export function createVariedArena(): Point[][] {
  const ground = createFlatGround(15, 30, 5);     // Flat section
  const slope = createSlope(15, 15, 25, 12, 1);   // Upward slope
  const wall = createWall(35, 15, 3, 0.5);        // Wall obstacle

  return [ground, slope, wall];
}
