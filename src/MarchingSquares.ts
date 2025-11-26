import type { DensityField } from './DensityField';
import type { AABB, Vec2 } from './types';
import { DEFAULT_CONFIG, type PipelineConfig } from './PipelineConfig';

/**
 * Marching Squares with topology-driven edge walking
 * Guarantees closed contours by walking cell-to-cell instead of stitching segments
 *
 * Configurable via PipelineConfig for quantization and loop tracing limits.
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

export interface DebugLoopResult {
  loop: Vec2[];
  closed: boolean;
  endpoints?: [Vec2, Vec2]; // For open loops: start and end vertices that hit boundary
}

export class MarchingSquares {
  field: DensityField;
  isoValue: number;
  debug: boolean = false;
  private quantizationStep: number;
  private maxSteps: number; // Maximum steps when tracing loops

  // Topology tracking
  private cellInfo: Map<string, CellInfo> = new Map();
  private visited: Set<string> = new Set();

  // Optional boundary for confined marching (for debug visualization)
  private boundaryAABB: AABB | null = null;

  constructor(
    field: DensityField,
    isoValue: number,
    config: PipelineConfig = DEFAULT_CONFIG
  ) {
    this.field = field;
    this.isoValue = isoValue;

    // Snap all marching-squares vertices onto a small lattice for stable matching.
    // Quantization step is now configurable via PipelineConfig
    this.quantizationStep = config.getMarchingSquaresQuantizationStep();

    // Maximum loop tracing steps (prevents infinite loops)
    this.maxSteps = config.marchingSquaresMaxSteps;
  }

  /**
   * Set a boundary AABB to confine marching squares
   * When set, loops that hit this boundary will perform bidirectional walking
   */
  setBoundaryAABB(aabb: AABB | null): void {
    this.boundaryAABB = aabb;
  }

  setDebug(enabled: boolean): void {
    this.debug = enabled;
  }

  /**
   * Generate contour polylines using topology-driven edge walking
   */
  generateContours(dirtyAABB?: AABB | null, expandCells: number = 1): DebugLoopResult[] {
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

    // Step 2: Walk topology to trace closed loops
    const results: DebugLoopResult[] = [];
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
    // Check field bounds
    if (gx < 0 || gy < 0 || gx >= this.field.gridWidth - 1 || gy >= this.field.gridHeight - 1) {
      return null;
    }

    // Check boundary AABB if set (for confined marching)
    if (this.boundaryAABB) {
      if (gx < this.boundaryAABB.minX || gx > this.boundaryAABB.maxX ||
          gy < this.boundaryAABB.minY || gy > this.boundaryAABB.maxY) {
        return null;
      }
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
      edgePairs = isConnected ? [[3, 1]] : [[3, 0], [1, 2]];
    } else if (caseIndex === 10) {
      const center = (v00 + v10 + v11 + v01) / 4;
      const isConnected = center >= this.isoValue;
      edgePairs = isConnected ? [[0, 2]] : [[0, 1], [2, 3]];
    } else {
      edgePairs = MARCHING_SQUARES_CASES[caseIndex];
    }

    return { caseIndex, edgePairs, v00, v10, v11, v01 };
  }

  /**
   * Trace a closed loop starting from a specific edge pair in a cell
   * Supports bidirectional walking when boundary is set
   */
  private traceLoop(startGx: number, startGy: number, startPairIdx: number): DebugLoopResult | null {
    // Walk in one direction first
    const forwardResult = this.walkDirection(startGx, startGy, startPairIdx, true);

    if (!forwardResult) {
      return null;
    }

    // If we closed the loop, we're done
    if (forwardResult.closed) {
      return {
        loop: forwardResult.loop,
        closed: true
      };
    }

    // If we hit a boundary and boundaryAABB is set, walk backwards too
    if (forwardResult.hitBoundary && this.boundaryAABB) {
      const backwardResult = this.walkDirection(startGx, startGy, startPairIdx, false);

      if (backwardResult && backwardResult.hitBoundary) {
        // Combine: reverse backward + forward
        const backwardReversed = [...backwardResult.loop].reverse();
        const combinedLoop = [...backwardReversed, ...forwardResult.loop];

        return {
          loop: combinedLoop,
          closed: false,
          endpoints: [backwardReversed[0], forwardResult.loop[forwardResult.loop.length - 1]]
        };
      }
    }

    // Open loop (single direction)
    return {
      loop: forwardResult.loop,
      closed: false,
      endpoints: forwardResult.endpoint ? [forwardResult.loop[0], forwardResult.endpoint] : undefined
    };
  }

  /**
   * Walk in one direction from a starting cell
   * @param forward - true = choose e1 as entry, false = choose e2 as entry
   */
  private walkDirection(
    startGx: number,
    startGy: number,
    startPairIdx: number,
    forward: boolean
  ): { loop: Vec2[]; closed: boolean; hitBoundary: boolean; endpoint?: Vec2 } | null {
    const loop: Vec2[] = [];
    let gx = startGx;
    let gy = startGy;
    let pairIdx = startPairIdx;
    let enterEdge: number | null = null;

    const startKey = this.edgeKey(startGx, startGy, startPairIdx);
    let closed = false;
    let hitBoundary = false;
    let steps = 0;
    let lastVertex: Vec2 | undefined;

    while (steps < this.maxSteps) {
      const key = this.edgeKey(gx, gy, pairIdx);

      // Check if we've returned to start (after at least one step)
      if (steps > 0 && key === startKey) {
        closed = true;
        break;
      }

      // For backward walk, don't mark first cell as visited on step 0
      if (steps > 0 || forward) {
        if (this.visited.has(key)) {
          break;
        }
        this.visited.add(key);
      }

      const info = this.getCellInfo(gx, gy);
      if (!info) {
        hitBoundary = true;
        break;
      }

      const [e1, e2] = info.edgePairs[pairIdx];
      const h = this.field.config.gridPitch;
      const worldX = gx * h;
      const worldY = gy * h;

      let entryEdge: number;
      let exitEdge: number;

      if (enterEdge === null) {
        // First cell - choose direction based on forward flag
        entryEdge = forward ? e1 : e2;
        exitEdge = forward ? e2 : e1;
      } else {
        if (e1 === enterEdge) {
          entryEdge = e1;
          exitEdge = e2;
        } else if (e2 === enterEdge) {
          entryEdge = e2;
          exitEdge = e1;
        } else {
          break;
        }
      }

      const vertex = this.interpolateEdge(gx, gy, exitEdge, info, h, worldX, worldY);
      loop.push(vertex);
      lastVertex = vertex;

      const next = this.getNeighborThroughEdge(gx, gy, exitEdge);
      if (!next) {
        hitBoundary = true;
        break;
      }

      gx = next.gx;
      gy = next.gy;
      enterEdge = this.oppositeEdge(exitEdge);

      const nextInfo = this.getCellInfo(gx, gy);
      if (!nextInfo) {
        hitBoundary = true;
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
        break;
      }

      steps++;
    }

    if (steps >= this.maxSteps) {
      console.error(`[MarchingSquares] Walk exceeded max steps (${this.maxSteps})`);
      return null;
    }

    if (closed && loop.length > 0) {
      loop.push({ ...loop[0] });
    }

    return loop.length > 0 ? { loop, closed, hitBoundary, endpoint: lastVertex } : null;
  }

  /**
   * Interpolate vertex position on a cell edge with ISO-snapping refinement
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
    let edgeStart: Vec2;
    let edgeEnd: Vec2;
    let v0: number;
    let v1: number;

    switch (edge) {
      case 0: // bottom (v00 to v10)
        t = this.interpolate(v00, v10);
        x = worldX + t * h;
        y = worldY;
        edgeStart = { x: worldX, y: worldY };
        edgeEnd = { x: worldX + h, y: worldY };
        v0 = v00;
        v1 = v10;
        break;
      case 1: // right (v10 to v11)
        t = this.interpolate(v10, v11);
        x = worldX + h;
        y = worldY + t * h;
        edgeStart = { x: worldX + h, y: worldY };
        edgeEnd = { x: worldX + h, y: worldY + h };
        v0 = v10;
        v1 = v11;
        break;
      case 2: // top (v01 to v11)
        t = this.interpolate(v01, v11);
        x = worldX + t * h;
        y = worldY + h;
        edgeStart = { x: worldX, y: worldY + h };
        edgeEnd = { x: worldX + h, y: worldY + h };
        v0 = v01;
        v1 = v11;
        break;
      case 3: // left (v00 to v01)
        t = this.interpolate(v00, v01);
        x = worldX;
        y = worldY + t * h;
        edgeStart = { x: worldX, y: worldY };
        edgeEnd = { x: worldX, y: worldY + h };
        v0 = v00;
        v1 = v01;
        break;
      default:
        throw new Error(`Invalid edge: ${edge}`);
    }

    // Linear interpolation along edge
    x = edgeStart.x + t * (edgeEnd.x - edgeStart.x);
    y = edgeStart.y + t * (edgeEnd.y - edgeStart.y);

    // Quantize to a shared lattice to avoid float mismatches downstream
    const q = this.quantizationStep;
    x = Math.round(x / q) * q;
    y = Math.round(y / q) * q;

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
