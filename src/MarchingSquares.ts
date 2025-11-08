import type { DensityField } from './DensityField';
import type { AABB, Vec2 } from './types';

/**
 * Marching Squares with topology-driven edge walking
 * Guarantees closed contours by walking cell-to-cell instead of stitching segments
 */

/**
 * Marching Squares case table
 * Each entry maps edge pairs that are connected: [edge1, edge2]
 * Edges: 0=bottom, 1=right, 2=top, 3=left
 *
 * For ambiguous cases 5 and 10, we use asymptotic decider at runtime
 */
const MARCHING_SQUARES_CASES: number[][][] = [
  [],              // 0: 0000
  [[3, 0]],        // 1: 0001
  [[0, 1]],        // 2: 0010
  [[3, 1]],        // 3: 0011
  [[1, 2]],        // 4: 0100
  [[3, 0], [1, 2]], // 5: 0101 - ambiguous (saddle)
  [[0, 2]],        // 6: 0110
  [[3, 2]],        // 7: 0111
  [[2, 3]],        // 8: 1000
  [[0, 2]],        // 9: 1001
  [[0, 1], [2, 3]], // 10: 1010 - ambiguous (saddle)
  [[1, 2]],        // 11: 1011
  [[1, 3]],        // 12: 1100
  [[0, 1]],        // 13: 1101
  [[0, 3]],        // 14: 1110
  []               // 15: 1111
];

interface CellInfo {
  caseIndex: number;
  edgePairs: number[][];
  v00: number;
  v10: number;
  v11: number;
  v01: number;
}

export class MarchingSquares {
  field: DensityField;
  isoValue: number;
  debug: boolean = false;

  // Topology tracking
  private cellInfo: Map<string, CellInfo> = new Map();
  private visited: Set<string> = new Set();

  constructor(field: DensityField, isoValue: number) {
    this.field = field;
    this.isoValue = isoValue;
  }

  setDebug(enabled: boolean): void {
    this.debug = enabled;
  }

  /**
   * Generate contour polylines using topology-driven edge walking
   */
  generateContours(dirtyAABB?: AABB | null, expandCells: number = 1): { loop: Vec2[]; closed: boolean }[] {
    if (!dirtyAABB) {
      dirtyAABB = this.field.getDirtyWorldAABB();
    }

    // If no dirty region, scan entire field
    if (!dirtyAABB) {
      dirtyAABB = {
        minX: 0,
        minY: 0,
        maxX: this.field.config.width,
        maxY: this.field.config.height
      };
    }

    // Convert world AABB to grid AABB, expand by expandCells for boundary handling
    const h = this.field.config.gridPitch;
    let minGridX = Math.max(0, Math.floor(dirtyAABB.minX / h) - expandCells);
    let minGridY = Math.max(0, Math.floor(dirtyAABB.minY / h) - expandCells);
    let maxGridX = Math.min(this.field.gridWidth - 2, Math.ceil(dirtyAABB.maxX / h) + expandCells);
    let maxGridY = Math.min(this.field.gridHeight - 2, Math.ceil(dirtyAABB.maxY / h) + expandCells);

    if (this.debug) {
      console.log(`[MarchingSquares] Scanning grid (${minGridX},${minGridY}) to (${maxGridX},${maxGridY})`);
    }

    // Step 1: Build cell info for all cells in region
    this.cellInfo.clear();
    this.visited.clear();

    let totalCrossings = 0;
    for (let gy = minGridY; gy <= maxGridY; gy++) {
      for (let gx = minGridX; gx <= maxGridX; gx++) {
        const info = this.buildCellInfo(gx, gy);
        if (info.edgePairs.length > 0) {
          this.cellInfo.set(this.cellKey(gx, gy), info);
          totalCrossings += info.edgePairs.length;
        }
      }
    }

    if (this.debug) {
      console.log(`[MarchingSquares] Found ${this.cellInfo.size} cells with crossings (${totalCrossings} edge pairs)`);
    }

    // Step 2: Walk topology to trace closed loops
    const results: { loop: Vec2[]; closed: boolean }[] = [];
    let tracedEdges = 0;
    let closedCount = 0;
    let openCount = 0;

    for (const [cellKey, info] of this.cellInfo) {
      const [gx, gy] = cellKey.split(',').map(Number);

      // Try each edge pair in this cell
      for (let pairIdx = 0; pairIdx < info.edgePairs.length; pairIdx++) {
        const edgeKey = this.edgeKey(gx, gy, pairIdx);
        if (this.visited.has(edgeKey)) continue;

        // Start a new contour walk from this edge
        const result = this.traceLoop(gx, gy, pairIdx);
        if (result && result.loop.length > 2) {
          results.push(result);
          tracedEdges += result.loop.length;
          if (result.closed) {
            closedCount++;
          } else {
            openCount++;
          }
        }
      }
    }

    console.log(`[MarchingSquares] Traced ${results.length} contours (${tracedEdges} vertices total):`);
    console.log(`  Closed loops: ${closedCount}`);
    console.log(`  Open loops: ${openCount}`);
    if (openCount > 0) {
      console.warn(`  ⚠️  WARNING: ${openCount} OPEN CONTOURS DETECTED!`);
      console.warn(`  This usually means loops hit boundaries or density gradients are too sharp`);

      // Log details about open loops
      results.forEach((result, idx) => {
        if (!result.closed) {
          const first = result.loop[0];
          const last = result.loop[result.loop.length - 1];
          const dist = Math.sqrt(
            Math.pow(last.x - first.x, 2) + Math.pow(last.y - first.y, 2)
          );
          console.warn(`  Loop ${idx}: ${result.loop.length} vertices, gap=${dist.toFixed(3)}m`);
          console.warn(`    First: (${first.x.toFixed(2)}, ${first.y.toFixed(2)})`);
          console.warn(`    Last: (${last.x.toFixed(2)}, ${last.y.toFixed(2)})`);
        }
      });
    }

    return results;
  }

  /**
   * Get or compute cell info on-demand (with caching and bounds checking)
   */
  private getCellInfo(gx: number, gy: number): CellInfo | null {
    // Check bounds
    if (gx < 0 || gy < 0 || gx >= this.field.gridWidth - 1 || gy >= this.field.gridHeight - 1) {
      return null;
    }

    const key = this.cellKey(gx, gy);
    let info = this.cellInfo.get(key);

    if (!info) {
      // Compute on-demand
      info = this.buildCellInfo(gx, gy);
      if (info.edgePairs.length > 0) {
        this.cellInfo.set(key, info);
      } else {
        return null; // No crossings in this cell
      }
    }

    return info;
  }

  /**
   * Build cell info with case determination
   */
  private buildCellInfo(gx: number, gy: number): CellInfo {
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
    let edgePairs: number[][];
    if (caseIndex === 5) {
      const center = (v00 + v10 + v11 + v01) / 4;
      const isConnected = center >= this.isoValue;
      if (this.debug) {
        console.log(`Case 5 at (${gx},${gy}): center=${center.toFixed(1)} iso=${this.isoValue} → ${isConnected ? 'CONNECTED' : 'SADDLE'}`);
      }
      edgePairs = isConnected ? [[3, 1]] : [[3, 0], [1, 2]];
    } else if (caseIndex === 10) {
      const center = (v00 + v10 + v11 + v01) / 4;
      const isConnected = center >= this.isoValue;
      if (this.debug) {
        console.log(`Case 10 at (${gx},${gy}): center=${center.toFixed(1)} iso=${this.isoValue} → ${isConnected ? 'CONNECTED' : 'SADDLE'}`);
      }
      edgePairs = isConnected ? [[0, 2]] : [[0, 1], [2, 3]];
    } else {
      edgePairs = MARCHING_SQUARES_CASES[caseIndex];
    }

    return { caseIndex, edgePairs, v00, v10, v11, v01 };
  }

  /**
   * Trace a closed loop starting from a specific edge pair in a cell
   */
  private traceLoop(startGx: number, startGy: number, startPairIdx: number): { loop: Vec2[]; closed: boolean } | null {
    const loop: Vec2[] = [];
    let gx = startGx;
    let gy = startGy;
    let pairIdx = startPairIdx;
    let enterEdge: number | null = null; // Which edge we entered from

    const startKey = this.edgeKey(startGx, startGy, startPairIdx);
    let closed = false;
    let steps = 0;
    const maxSteps = 100000; // Safety limit

    while (steps < maxSteps) {
      const key = this.edgeKey(gx, gy, pairIdx);

      // Check if we've returned to start (after at least one step)
      if (steps > 0 && key === startKey) {
        closed = true;
        break;
      }

      if (this.visited.has(key)) {
        // Already visited this edge
        break;
      }

      this.visited.add(key);

      const info = this.getCellInfo(gx, gy);
      if (!info) {
        if (this.debug) {
          console.warn(`No cell info for (${gx},${gy})`);
        }
        break;
      }

      const [e1, e2] = info.edgePairs[pairIdx];
      const h = this.field.config.gridPitch;
      const worldX = gx * h;
      const worldY = gy * h;

      // Determine which edge we enter and exit from
      let entryEdge: number;
      let exitEdge: number;

      if (enterEdge === null) {
        // First cell - arbitrarily choose e1 as entry
        entryEdge = e1;
        exitEdge = e2;
      } else {
        // Subsequent cells - entry edge is known, find exit edge
        if (e1 === enterEdge) {
          entryEdge = e1;
          exitEdge = e2;
        } else if (e2 === enterEdge) {
          entryEdge = e2;
          exitEdge = e1;
        } else {
          if (this.debug) {
            console.warn(`Enter edge ${enterEdge} doesn't match pair [${e1},${e2}] in cell (${gx},${gy})`);
          }
          break;
        }
      }

      // Add vertex for the exit edge (this becomes the next cell's entry vertex)
      const vertex = this.interpolateEdge(gx, gy, exitEdge, info, h, worldX, worldY);
      loop.push(vertex);

      // Move to neighbor cell through exit edge
      const next = this.getNeighborThroughEdge(gx, gy, exitEdge);
      if (!next) {
        // Hit boundary
        if (this.debug) {
          console.warn(`Hit boundary at (${gx},${gy}) edge ${exitEdge}`);
        }
        break;
      }

      gx = next.gx;
      gy = next.gy;
      enterEdge = this.oppositeEdge(exitEdge);

      // Find which edge pair in the neighbor cell contains enterEdge
      const nextInfo = this.getCellInfo(gx, gy);
      if (!nextInfo) {
        if (this.debug) {
          console.warn(`No cell info for neighbor (${gx},${gy})`);
        }
        break;
      }

      pairIdx = -1;
      for (let i = 0; i < nextInfo.edgePairs.length; i++) {
        const [ne1, ne2] = nextInfo.edgePairs[i];
        if (ne1 === enterEdge || ne2 === enterEdge) {
          pairIdx = i;
          break;
        }
      }

      if (pairIdx === -1) {
        if (this.debug) {
          console.warn(`No matching edge pair in neighbor (${gx},${gy}) for edge ${enterEdge}`);
        }
        break;
      }

      steps++;
    }

    if (steps >= maxSteps) {
      console.error(`[MarchingSquares] Loop trace exceeded max steps (${maxSteps})`);
      return null;
    }

    // Log why loop terminated if not closed
    if (!closed && this.debug) {
      console.warn(`[MarchingSquares] Open loop from (${startGx},${startGy}): ${steps} steps, ${loop.length} vertices`);
    }

    // If closed, append first vertex to end so first==last
    if (closed && loop.length > 0) {
      loop.push({ ...loop[0] });
    }

    return loop.length > 2 ? { loop, closed } : null;
  }

  /**
   * Interpolate vertex position on a cell edge (with quantization for consistency)
   */
  private interpolateEdge(
    gx: number,
    gy: number,
    edge: number,
    info: CellInfo,
    h: number,
    worldX: number,
    worldY: number
  ): Vec2 {
    const { v00, v10, v11, v01 } = info;

    let t: number;
    let x: number;
    let y: number;

    switch (edge) {
      case 0: // bottom (v00 to v10)
        t = this.interpolate(v00, v10);
        x = worldX + t * h;
        y = worldY;
        break;
      case 1: // right (v10 to v11)
        t = this.interpolate(v10, v11);
        x = worldX + h;
        y = worldY + t * h;
        break;
      case 2: // top (v01 to v11)
        t = this.interpolate(v01, v11);
        x = worldX + t * h;
        y = worldY + h;
        break;
      case 3: // left (v00 to v01)
        t = this.interpolate(v00, v01);
        x = worldX;
        y = worldY + t * h;
        break;
      default:
        throw new Error(`Invalid edge: ${edge}`);
    }

    // Quantize to avoid floating-point precision issues
    const precision = 1000000;
    x = Math.round(x * precision) / precision;
    y = Math.round(y * precision) / precision;

    return { x, y };
  }

  /**
   * Linear interpolation for edge intersection
   */
  private interpolate(v0: number, v1: number): number {
    if (Math.abs(v1 - v0) < 0.001) return 0.5;
    const t = (this.isoValue - v0) / (v1 - v0);
    // Clamp to [0, 1]
    return Math.max(0, Math.min(1, t));
  }

  /**
   * Get neighbor cell through a given edge
   */
  private getNeighborThroughEdge(gx: number, gy: number, edge: number): { gx: number; gy: number } | null {
    switch (edge) {
      case 0: return { gx, gy: gy - 1 }; // bottom → move down
      case 1: return { gx: gx + 1, gy }; // right → move right
      case 2: return { gx, gy: gy + 1 }; // top → move up
      case 3: return { gx: gx - 1, gy }; // left → move left
      default: return null;
    }
  }

  /**
   * Get opposite edge (for entering neighbor cell)
   */
  private oppositeEdge(edge: number): number {
    return (edge + 2) % 4;
  }

  /**
   * Create unique key for a cell
   */
  private cellKey(gx: number, gy: number): string {
    return `${gx},${gy}`;
  }

  /**
   * Create unique key for an edge pair in a cell
   */
  private edgeKey(gx: number, gy: number, pairIdx: number): string {
    return `${gx},${gy},${pairIdx}`;
  }
}
