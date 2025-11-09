/**
 * Visvalingam-Whyatt algorithm for polyline simplification
 * Reduces vertex count while preserving shape by removing vertices with smallest triangle areas
 * Better curve preservation compared to Douglas-Peucker
 */

import type { Point } from './types';
import type { DensityField } from './DensityField';

export type { Point };

/**
 * Calculate signed area of triangle formed by three points
 * Returns absolute area value (always positive)
 */
function triangleArea(p1: Point, p2: Point, p3: Point): number {
  // Shoelace formula: area = 0.5 * |x1(y2-y3) + x2(y3-y1) + x3(y1-y2)|
  const area = Math.abs(
    p1.x * (p2.y - p3.y) +
    p2.x * (p3.y - p1.y) +
    p3.x * (p1.y - p2.y)
  ) / 2;
  return area;
}

/**
 * Node in the linked list for efficient vertex removal
 */
interface VWNode {
  point: Point;
  effectiveArea: number;
  prev: VWNode | null;
  next: VWNode | null;
  removed: boolean;
}

/**
 * Calculate effective area for a vertex (triangle with neighbors)
 */
function calculateEffectiveArea(node: VWNode): number {
  if (!node.prev || !node.next) {
    return Infinity; // Can't remove endpoints
  }
  return triangleArea(node.prev.point, node.point, node.next.point);
}

/**
 * Simplify a polyline using Visvalingam-Whyatt algorithm
 * @param points - Array of points forming the polyline
 * @param areaThreshold - Minimum triangle area threshold (in m²)
 * @param closed - Whether the polyline is closed (first point = last point)
 * @returns Simplified polyline
 */
export function simplifyPolyline(points: Point[], areaThreshold: number, closed: boolean = false): Point[] {
  if (points.length <= 2) {
    return points.slice();
  }

  // Build linked list of nodes
  const nodes: VWNode[] = points.map(point => ({
    point: { x: point.x, y: point.y },
    effectiveArea: 0,
    prev: null,
    next: null,
    removed: false
  }));

  // Link nodes
  for (let i = 0; i < nodes.length; i++) {
    if (i > 0) nodes[i].prev = nodes[i - 1];
    if (i < nodes.length - 1) nodes[i].next = nodes[i + 1];
  }

  // For closed polylines, link first and last
  if (closed && nodes.length > 2) {
    nodes[0].prev = nodes[nodes.length - 1];
    nodes[nodes.length - 1].next = nodes[0];
  }

  // Calculate initial effective areas
  for (const node of nodes) {
    node.effectiveArea = calculateEffectiveArea(node);
  }

  // Remove vertices with smallest areas until threshold met
  while (true) {
    // Find node with smallest effective area
    let minNode: VWNode | null = null;
    let minArea = Infinity;

    for (const node of nodes) {
      if (!node.removed && node.effectiveArea < minArea) {
        minArea = node.effectiveArea;
        minNode = node;
      }
    }

    // Stop if no removable vertex found or minimum area exceeds threshold
    if (!minNode || minArea >= areaThreshold) {
      break;
    }

    // Remove the vertex
    minNode.removed = true;

    // Update linked list
    if (minNode.prev) minNode.prev.next = minNode.next;
    if (minNode.next) minNode.next.prev = minNode.prev;

    // Recalculate effective areas for affected neighbors
    if (minNode.prev) {
      minNode.prev.effectiveArea = calculateEffectiveArea(minNode.prev);
    }
    if (minNode.next) {
      minNode.next.effectiveArea = calculateEffectiveArea(minNode.next);
    }
  }

  // Build result from non-removed nodes
  const result: Point[] = [];
  for (const node of nodes) {
    if (!node.removed) {
      result.push(node.point);
    }
  }

  // For closed polylines, ensure first and last are the same
  if (closed && result.length > 0) {
    const first = result[0];
    const last = result[result.length - 1];
    if (Math.abs(first.x - last.x) > 1e-10 || Math.abs(first.y - last.y) > 1e-10) {
      result.push({ x: first.x, y: first.y });
    }
  }

  return result;
}

/**
 * Simplify multiple polylines
 * @param polylines - Array of polylines to simplify
 * @param areaThreshold - Minimum triangle area threshold (in m²)
 * @param closed - Whether polylines are closed
 * @returns Simplified polylines
 */
export function simplifyPolylines(polylines: Point[][], areaThreshold: number, closed: boolean = false): Point[][] {
  return polylines.map(polyline => simplifyPolyline(polyline, areaThreshold, closed));
}

/**
 * Chaikin smoothing algorithm - corner cutting for smooth curves
 * Each iteration replaces each edge with two points at 1/4 and 3/4 positions
 * @param points - Array of points forming the polyline
 * @param iterations - Number of smoothing iterations (1-3 recommended)
 * @param closed - Whether the polyline is closed
 * @returns Smoothed polyline
 */
export function chaikinSmooth(points: Point[], iterations: number = 1, closed: boolean = false): Point[] {
  if (points.length < 3 || iterations === 0) {
    return points.slice();
  }

  let smoothed = points.slice();

  for (let iter = 0; iter < iterations; iter++) {
    const newPoints: Point[] = [];

    // For closed curves, process all edges including the wrap-around edge
    const numEdges = closed ? smoothed.length : smoothed.length - 1;

    for (let i = 0; i < numEdges; i++) {
      const p0 = smoothed[i];
      const p1 = smoothed[(i + 1) % smoothed.length];

      // Create two points at 1/4 and 3/4 along the edge
      const q = {
        x: 0.75 * p0.x + 0.25 * p1.x,
        y: 0.75 * p0.y + 0.25 * p1.y
      };

      const r = {
        x: 0.25 * p0.x + 0.75 * p1.x,
        y: 0.25 * p0.y + 0.75 * p1.y
      };

      newPoints.push(q);
      newPoints.push(r);
    }

    // For open curves, keep the original endpoints
    if (!closed && newPoints.length > 0) {
      // Replace first point with original start
      newPoints[0] = { x: points[0].x, y: points[0].y };
      // Replace last point with original end
      newPoints[newPoints.length - 1] = { x: points[points.length - 1].x, y: points[points.length - 1].y };
    }

    smoothed = newPoints;
  }

  // For closed polylines, ensure first and last are the same
  if (closed && smoothed.length > 0) {
    const first = smoothed[0];
    const last = smoothed[smoothed.length - 1];
    if (Math.abs(first.x - last.x) > 1e-10 || Math.abs(first.y - last.y) > 1e-10) {
      smoothed.push({ x: first.x, y: first.y });
    }
  }

  return smoothed;
}

/**
 * Apply Chaikin smoothing to multiple polylines
 * @param polylines - Array of polylines to smooth
 * @param iterations - Number of smoothing iterations
 * @param closed - Whether polylines are closed
 * @returns Smoothed polylines
 */
export function chaikinSmoothPolylines(polylines: Point[][], iterations: number = 1, closed: boolean = false): Point[][] {
  return polylines.map(polyline => chaikinSmooth(polyline, iterations, closed));
}
