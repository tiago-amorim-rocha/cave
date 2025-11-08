import type { DensityField } from './DensityField';
import type { AABB, Vec2 } from './types';

/**
 * Marching Squares with linear edge interpolation
 * Outputs closed polylines representing contours at the iso-value
 */

interface Edge {
  x: number; // world coords
  y: number;
}

/**
 * Marching Squares lookup table
 * Each entry is an array of edge pairs: [startEdge, endEdge]
 * Edges: 0=bottom, 1=right, 2=top, 3=left
 */
const MARCHING_SQUARES_CASES: number[][][] = [
  [],              // 0: 0000
  [[3, 0]],        // 1: 0001
  [[0, 1]],        // 2: 0010
  [[3, 1]],        // 3: 0011
  [[1, 2]],        // 4: 0100
  [[3, 0], [1, 2]], // 5: 0101 - ambiguous (using asymptotic decider)
  [[0, 2]],        // 6: 0110
  [[3, 2]],        // 7: 0111
  [[2, 3]],        // 8: 1000
  [[0, 2]],        // 9: 1001
  [[0, 1], [2, 3]], // 10: 1010 - ambiguous (using asymptotic decider)
  [[1, 2]],        // 11: 1011
  [[1, 3]],        // 12: 1100
  [[0, 1]],        // 13: 1101
  [[0, 3]],        // 14: 1110
  []               // 15: 1111
];

export class MarchingSquares {
  field: DensityField;
  isoValue: number;

  constructor(field: DensityField, isoValue: number) {
    this.field = field;
    this.isoValue = isoValue;
  }

  /**
   * Generate contour polylines for the dirty region
   */
  generateContours(dirtyAABB?: AABB | null): Vec2[][] {
    if (!dirtyAABB) {
      dirtyAABB = this.field.getDirtyWorldAABB();
    }
    if (!dirtyAABB) return [];

    // Convert world AABB to grid AABB
    const minGridX = Math.max(0, Math.floor(dirtyAABB.minX / this.field.config.gridPitch));
    const minGridY = Math.max(0, Math.floor(dirtyAABB.minY / this.field.config.gridPitch));
    const maxGridX = Math.min(this.field.gridWidth - 2, Math.ceil(dirtyAABB.maxX / this.field.config.gridPitch));
    const maxGridY = Math.min(this.field.gridHeight - 2, Math.ceil(dirtyAABB.maxY / this.field.config.gridPitch));

    // Build edge map
    const edges = new Map<string, Edge>();

    for (let gy = minGridY; gy <= maxGridY; gy++) {
      for (let gx = minGridX; gx <= maxGridX; gx++) {
        this.processCell(gx, gy, edges);
      }
    }

    // Stitch edges into polylines
    return this.stitchPolylines(edges);
  }

  /**
   * Process a single marching squares cell
   */
  private processCell(gx: number, gy: number, edges: Map<string, Edge>): void {
    const h = this.field.config.gridPitch;

    // Get corner values
    const v00 = this.field.get(gx, gy);         // bottom-left
    const v10 = this.field.get(gx + 1, gy);     // bottom-right
    const v11 = this.field.get(gx + 1, gy + 1); // top-right
    const v01 = this.field.get(gx, gy + 1);     // top-left

    // Calculate case index
    let caseIndex = 0;
    if (v00 >= this.isoValue) caseIndex |= 1;
    if (v10 >= this.isoValue) caseIndex |= 2;
    if (v11 >= this.isoValue) caseIndex |= 4;
    if (v01 >= this.isoValue) caseIndex |= 8;

    // Handle ambiguous cases 5 and 10 with asymptotic decider
    if (caseIndex === 5 || caseIndex === 10) {
      const center = (v00 + v10 + v11 + v01) / 4;
      if (center >= this.isoValue) {
        caseIndex = caseIndex === 5 ? 10 : 5;
      }
    }

    const edgePairs = MARCHING_SQUARES_CASES[caseIndex];
    if (edgePairs.length === 0) return;

    // Get cell world coordinates
    const worldX = gx * h;
    const worldY = gy * h;

    // Calculate edge intersection points with linear interpolation
    const edgePoints: Edge[] = [];

    // Edge 0: bottom (v00 to v10)
    const t0 = this.interpolate(v00, v10);
    edgePoints[0] = { x: worldX + t0 * h, y: worldY };

    // Edge 1: right (v10 to v11)
    const t1 = this.interpolate(v10, v11);
    edgePoints[1] = { x: worldX + h, y: worldY + t1 * h };

    // Edge 2: top (v01 to v11)
    const t2 = this.interpolate(v01, v11);
    edgePoints[2] = { x: worldX + t2 * h, y: worldY + h };

    // Edge 3: left (v00 to v01)
    const t3 = this.interpolate(v00, v01);
    edgePoints[3] = { x: worldX, y: worldY + t3 * h };

    // Add edge segments
    for (const [startEdge, endEdge] of edgePairs) {
      const start = edgePoints[startEdge];
      const end = edgePoints[endEdge];
      const key = this.edgeKey(start, end);
      edges.set(key, end);
    }
  }

  /**
   * Linear interpolation for edge intersection
   */
  private interpolate(v0: number, v1: number): number {
    if (Math.abs(v1 - v0) < 0.001) return 0.5;
    return (this.isoValue - v0) / (v1 - v0);
  }

  /**
   * Create a unique key for an edge
   */
  private edgeKey(start: Edge, end: Edge): string {
    const x1 = start.x.toFixed(6);
    const y1 = start.y.toFixed(6);
    const x2 = end.x.toFixed(6);
    const y2 = end.y.toFixed(6);
    return `${x1},${y1}->${x2},${y2}`;
  }

  /**
   * Stitch edges into closed polylines
   */
  private stitchPolylines(edges: Map<string, Edge>): Vec2[][] {
    const polylines: Vec2[][] = [];
    const visited = new Set<string>();

    for (const [startKey, firstEnd] of edges) {
      if (visited.has(startKey)) continue;

      const polyline: Vec2[] = [];
      let currentKey = startKey;
      let currentEnd = firstEnd;

      // Parse start point
      const [startCoords] = currentKey.split('->');
      const [sx, sy] = startCoords.split(',').map(Number);
      polyline.push({ x: sx, y: sy });

      // Follow the chain
      while (currentEnd) {
        visited.add(currentKey);
        polyline.push({ x: currentEnd.x, y: currentEnd.y });

        // Find next edge
        let foundNext = false;
        for (const [key, end] of edges) {
          if (visited.has(key)) continue;

          const [keyStart] = key.split('->');
          const [kx, ky] = keyStart.split(',').map(Number);

          // Check if this edge starts where we ended
          if (Math.abs(kx - currentEnd.x) < 0.0001 && Math.abs(ky - currentEnd.y) < 0.0001) {
            currentKey = key;
            currentEnd = end;
            foundNext = true;
            break;
          }
        }

        if (!foundNext) break;
      }

      if (polyline.length > 2) {
        polylines.push(polyline);
      }
    }

    return polylines;
  }
}
