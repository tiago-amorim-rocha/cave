import type { Camera } from './Camera';
import type { Vec2 } from './types';
import type { DensityField } from './DensityField';
import type { WaterGrid } from './water/WaterGrid';
import type { VelocityField } from './water/VelocityField';
import type { CanonicalLoop, OptVertex, PhysicsSegment } from './terrain/CanonicalGeometry';
import { CarvingDebugMode } from './CarvingDebugMode';

/**
 * Option-2 style local update preview data (canonical dirty ranges → opt invalidation).
 *
 * This is a debug-only structure used to visualize the canonical-first pipeline without
 * requiring the full update to be applied yet.
 */
export interface CarveOption2DebugData {
  region: { minX: number; minY: number; maxX: number; maxY: number };
  affectedCanonicalLoopIds: number[];
  dirtyRanges: Array<{ loopId: number; startIndex: number; endIndex: number }>;
  optInvalidations: Array<{ loopId: number; spans: Array<{ startOpt: number; endOpt: number }> }>;
}

export interface LocalUpdateDebugData {
  paddedAABB: { minX: number; minY: number; maxX: number; maxY: number };

  affectedCanonicalLoops?: Array<{ id: number; vertices: Vec2[] }>;
  msCleanedLoops?: Vec2[][];
  matches?: Array<{
    oldLoopId: number;
    newLoopId: number | null;
    oldCentroid: Vec2;
    newCentroid?: Vec2;
  }>;

  surgeryPreview?: {
    replacementLoops: Array<{ id: number; vertices: Vec2[] }>;
  };

  surgeryCommit?: {
    replacementLoopIds: number[];
  };

  optAabbInvalidation?: {
    optLoops: Vec2[][];
    invalidations: Array<{ loopIndex: number; spans: Array<{ startOpt: number; endOpt: number }> }>;
  };

  optRebuild?: {
    rebuiltOptLoops: Vec2[][];
  };

  optSplice?: {
    splicedOptLoops: Vec2[][];
    keptCount: number;
    rebuiltCount: number;
  };

  physicsPlan?: {
    affectedBodyCount: number;
    loopsToAdd: number;
  };

  physicsApply?: {
    removedBodyCount: number;
    loopsAdded: number;
  };
}

/**
 * Ball rendering data
 */
export interface BallRenderData {
  position: { x: number; y: number };
  circleRadius: number;
}

/**
 * Canvas2D renderer with device-pixel-ratio awareness
 */
export class Renderer {
  private canvas: HTMLCanvasElement;
  private ctx: CanvasRenderingContext2D;
  private camera: Camera;

  private polylines: Vec2[][] = [];
  private polylineAABBs: Array<{ minX: number; minY: number; maxX: number; maxY: number }> = []; // AABB for each polyline
  private originalPolylines: Vec2[][] = []; // Store original vertices before optimization
  private originalPolylineAABBs: Array<{ minX: number; minY: number; maxX: number; maxY: number }> = []; // AABB for each original polyline
  private densityField: DensityField | null = null;
  private waterGrid: WaterGrid | null = null;
  private waterVelocity: VelocityField | null = null;
  private waterParticles: ReadonlyArray<{ x: number; y: number }> | null = null;
  private optimizedOptLoops: OptVertex[][] = []; // Ancestry-carrying optimized vertices (debug)
  private canonicalLoops: CanonicalLoop[] = []; // Cleaned marching squares output (debug-only)
  private segmentDebugData: Array<{ loopId: number; vertices: OptVertex[]; segments: PhysicsSegment[] }> = [];
  private loopDebugInfo: Array<{
    index: number;
    centroid: { x: number; y: number };
    isRock: boolean;
    samples?: Array<{ x: number; y: number; density: number; side: "inside" | "outside"; segmentIndex: number }>;
  }> = [];

  // Local update debug info
  private dirtyAABB: { minX: number; minY: number; maxX: number; maxY: number } | null = null;
  private rebuiltChains: Vec2[][] = []; // Chains added during last local update

  // Option-2 staged local-update debug data (Step 5a–5h)
  private localUpdateDebug: LocalUpdateDebugData | null = null;

  public showGrid: boolean = false;
  public showDensityField: boolean = false;
  public showWaterGrid: boolean = true;
  public showWaterFlowDebug: boolean = true;
  public showWaterVelocityHsv: boolean = false;
  public showWaterParticles: boolean = false;
  public showVertices: boolean = false; // Show optimized vertices
  public showOriginalVertices: boolean = false; // Show original vertices (before optimization)
  public showCanonicalVertices: boolean = false; // Show canonical vertices (debug-only)
  public showCanonicalLabels: boolean = false; // Show canonical loop ids / start markers (debug-only)
  public showCanonicalAABBs: boolean = false; // Show canonical loop AABBs (debug-only)
  public showSegmentDebug: boolean = false; // Show physics segment boundaries/ranges
  public showPhysicsBodies: boolean = false; // Disabled for performance testing
  public showLoopNumbers: boolean = false; // Disabled for performance testing
  public showSamplePoints: boolean = false; // Disabled for performance testing
  public showDirtyAABB: boolean = false; // Local update debugging
  public showRebuiltChains: boolean = false; // Local update debugging

  /**
   * Carving debug visualization mode (state machine for step progression)
   * Replaces individual boolean flags (showReusePlan, showOptMerging) with single state
   */
  private _carvingDebugMode: CarvingDebugMode = CarvingDebugMode.NONE;

  private debugHoverWorld: { x: number; y: number } | null = null; // For hover labels
  private carveOption2Debug: CarveOption2DebugData | null = null;

  constructor(canvas: HTMLCanvasElement, camera: Camera) {
    this.canvas = canvas;
    this.camera = camera;

    const ctx = canvas.getContext('2d');
    if (!ctx) {
      throw new Error('Could not get 2D context');
    }
    this.ctx = ctx;

    this.setupCanvas();
  }

  /**
   * Setup canvas with device-pixel-ratio awareness
   */
  private setupCanvas(): void {
    const dpr = window.devicePixelRatio || 1;

    // Use window dimensions directly instead of getBoundingClientRect to avoid stale values
    const width = window.innerWidth;
    const height = window.innerHeight;

    const orientation = width > height ? 'landscape' : 'portrait';
    // console.log(`[Canvas] ${width}x${height} (${orientation}, DPR=${dpr}, buffer=${width * dpr}x${height * dpr})`);

    // Set canvas internal resolution
    this.canvas.width = width * dpr;
    this.canvas.height = height * dpr;

    // Reset transform before scaling (important for resize)
    this.ctx.setTransform(1, 0, 0, 1, 0, 0);

    // Scale context to account for device pixel ratio
    this.ctx.scale(dpr, dpr);

    // Ensure canvas CSS matches window size
    this.canvas.style.width = `${width}px`;
    this.canvas.style.height = `${height}px`;
  }

  /**
   * Update canvas size on window resize
   */
  resize(): void {
    this.setupCanvas();
  }

  /**
   * Get the current carving debug visualization mode
   */
  getCarvingDebugMode(): CarvingDebugMode {
    return this._carvingDebugMode;
  }

  /**
   * Set the carving debug visualization mode
   * This replaces the old boolean flags (showReusePlan, showOptMerging)
   */
  setCarvingDebugMode(mode: CarvingDebugMode): void {
    if (import.meta.env.DEV || __CARVE_DEBUG__) {
      console.log('[Renderer] Carving debug mode changed', {
        from: this._carvingDebugMode,
        to: mode
      });
    }
    this._carvingDebugMode = mode;
  }

  /**
   * Update polylines to render (replaces all polylines)
   */
  updatePolylines(polylines: Vec2[][]): void {
    this.polylines = polylines;
    this.polylineAABBs = polylines.map(p => this.computePolylineAABB(p));
    if (import.meta.env.DEV || __CARVE_DEBUG__) {
      console.log(`[Renderer] updatePolylines: ${polylines.length} polylines`);
      if (polylines.length === 0) {
        console.warn('[Renderer] updatePolylines received empty array');
      } else {
        console.log(`[Renderer] first polyline length=${polylines[0].length}`);
      }
    }
  }

  /**
   * Update original (unoptimized) polylines for debug visualization (replaces all)
   */
  updateOriginalPolylines(polylines: Vec2[][]): void {
    this.originalPolylines = polylines;
    this.originalPolylineAABBs = polylines.map(p => this.computePolylineAABB(p));
  }

  /**
   * Set canonical loops for debug visualization
   */
  setCanonicalLoops(canonicalLoops: CanonicalLoop[]): void {
    this.canonicalLoops = canonicalLoops;
  }

  /**
   * Set optimized vertices with ancestry (Chaikin output) for debug visualization
   */
  setOptimizedOptLoops(loops: OptVertex[][]): void {
    this.optimizedOptLoops = loops;
  }

  /**
   * Set segment debug data (physics segments with ancestry ranges)
   */
  setSegmentDebugData(data: Array<{ loopId: number; vertices: OptVertex[]; segments: PhysicsSegment[] }>): void {
    this.segmentDebugData = data;
  }

  /**
   * Set option-2 style local update preview debug data.
   */
  setCarveOption2Debug(debugData: CarveOption2DebugData | null): void {
    this.carveOption2Debug = debugData;
  }

  setLocalUpdateDebug(debugData: LocalUpdateDebugData | null): void {
    this.localUpdateDebug = debugData;
  }

  /**
   * Set a world-space hover position to show ancestry labels near cursor.
   */
  setDebugHoverWorldPosition(pos: { x: number; y: number } | null): void {
    this.debugHoverWorld = pos;
  }

  /**
   * Compute AABB for a polyline
   */
  private computePolylineAABB(polyline: Vec2[]): { minX: number; minY: number; maxX: number; maxY: number } {
    if (polyline.length === 0) {
      return { minX: 0, minY: 0, maxX: 0, maxY: 0 };
    }

    let minX = polyline[0].x;
    let minY = polyline[0].y;
    let maxX = polyline[0].x;
    let maxY = polyline[0].y;

    for (const v of polyline) {
      minX = Math.min(minX, v.x);
      minY = Math.min(minY, v.y);
      maxX = Math.max(maxX, v.x);
      maxY = Math.max(maxY, v.y);
    }

    return { minX, minY, maxX, maxY };
  }

  /**
   * Check if two AABBs intersect
   */
  private aabbsIntersect(a: { minX: number; minY: number; maxX: number; maxY: number }, b: { minX: number; minY: number; maxX: number; maxY: number }): boolean {
    return !(
      a.maxX < b.minX ||
      a.minX > b.maxX ||
      a.maxY < b.minY ||
      a.minY > b.maxY
    );
  }

  /**
   * Check if any vertex lies inside or any edge crosses a region
   */
  private polylineTouchesRegion(polyline: Vec2[], region: { minX: number; minY: number; maxX: number; maxY: number }): boolean {
    const pointInside = (p: Vec2) =>
      p.x >= region.minX && p.x <= region.maxX && p.y >= region.minY && p.y <= region.maxY;

    const segmentsIntersect = (a: Vec2, b: Vec2, c: Vec2, d: Vec2): boolean => {
      const cross = (p: Vec2, q: Vec2, r: Vec2) => (q.x - p.x) * (r.y - p.y) - (q.y - p.y) * (r.x - p.x);
      const onSegment = (p: Vec2, q: Vec2, r: Vec2) =>
        Math.min(p.x, r.x) - 1e-6 <= q.x && q.x <= Math.max(p.x, r.x) + 1e-6 &&
        Math.min(p.y, r.y) - 1e-6 <= q.y && q.y <= Math.max(p.y, r.y) + 1e-6;

      const o1 = cross(a, b, c);
      const o2 = cross(a, b, d);
      const o3 = cross(c, d, a);
      const o4 = cross(c, d, b);

      if (o1 === 0 && onSegment(a, c, b)) return true;
      if (o2 === 0 && onSegment(a, d, b)) return true;
      if (o3 === 0 && onSegment(c, a, d)) return true;
      if (o4 === 0 && onSegment(c, b, d)) return true;

      return (o1 > 0) !== (o2 > 0) && (o3 > 0) !== (o4 > 0);
    };

    const segmentIntersectsAABB = (p1: Vec2, p2: Vec2): boolean => {
      if (pointInside(p1) || pointInside(p2)) return true;
      // Quick reject by segment AABB
      const minX = Math.min(p1.x, p2.x);
      const maxX = Math.max(p1.x, p2.x);
      const minY = Math.min(p1.y, p2.y);
      const maxY = Math.max(p1.y, p2.y);
      if (maxX < region.minX || minX > region.maxX || maxY < region.minY || minY > region.maxY) {
        return false;
      }

      const topLeft = { x: region.minX, y: region.minY };
      const topRight = { x: region.maxX, y: region.minY };
      const bottomLeft = { x: region.minX, y: region.maxY };
      const bottomRight = { x: region.maxX, y: region.maxY };

      return (
        segmentsIntersect(p1, p2, topLeft, topRight) ||
        segmentsIntersect(p1, p2, topRight, bottomRight) ||
        segmentsIntersect(p1, p2, bottomRight, bottomLeft) ||
        segmentsIntersect(p1, p2, bottomLeft, topLeft)
      );
    };

    for (const v of polyline) {
      if (pointInside(v)) return true;
    }

    for (let i = 0; i < polyline.length - 1; i++) {
      if (segmentIntersectsAABB(polyline[i], polyline[i + 1])) return true;
    }

    return false;
  }

  /**
   * Remove polylines that intersect with the given region
   * Returns the number of polylines removed
   */
  removePolylinesInRegion(region: { minX: number; minY: number; maxX: number; maxY: number }): number {
    const indicesToKeep: number[] = [];

    for (let i = 0; i < this.polylines.length; i++) {
      // Quick reject using AABB, then fall back to geometry check
      if (!this.aabbsIntersect(this.polylineAABBs[i], region)) {
        indicesToKeep.push(i);
        continue;
      }
      if (!this.polylineTouchesRegion(this.polylines[i], region)) {
        indicesToKeep.push(i);
      }
    }

    const removedCount = this.polylines.length - indicesToKeep.length;

    // Keep only non-intersecting polylines
    this.polylines = indicesToKeep.map(i => this.polylines[i]);
    this.polylineAABBs = indicesToKeep.map(i => this.polylineAABBs[i]);
    this.originalPolylines = indicesToKeep.map(i => this.originalPolylines[i]);
    this.originalPolylineAABBs = indicesToKeep.map(i => this.originalPolylineAABBs[i]);

    console.log(`[Renderer] removePolylinesInRegion: removed ${removedCount}, kept ${indicesToKeep.length}`);
    return removedCount;
  }

  /**
   * Add new polylines (and their original versions)
   */
  addPolylines(optimized: Vec2[][], original: Vec2[][]): void {
    if (optimized.length !== original.length) {
      console.warn(`[Renderer] addPolylines: optimized (${optimized.length}) and original (${original.length}) counts mismatch`);
    }

    for (let i = 0; i < optimized.length; i++) {
      this.polylines.push(optimized[i]);
      this.polylineAABBs.push(this.computePolylineAABB(optimized[i]));

      if (i < original.length) {
        this.originalPolylines.push(original[i]);
        this.originalPolylineAABBs.push(this.computePolylineAABB(original[i]));
      }
    }

    console.log(`[Renderer] addPolylines: added ${optimized.length} polylines (total now: ${this.polylines.length})`);
  }

  /**
   * Set density field for debug visualization
   */
  setDensityField(field: DensityField): void {
    this.densityField = field;
  }

  setWaterGrid(grid: WaterGrid | null): void {
    this.waterGrid = grid;
  }

  setWaterVelocityGrid(grid: VelocityField | null): void {
    this.waterVelocity = grid;
  }

  setWaterParticles(particles: ReadonlyArray<{ x: number; y: number }> | null): void {
    this.waterParticles = particles;
  }

  /**
   * Set loop debug info for rendering loop numbers and sample points
   */
  setLoopDebugInfo(info: Array<{
    index: number;
    centroid: { x: number; y: number };
    isRock: boolean;
    samples?: Array<{ x: number; y: number; density: number; side: "inside" | "outside"; segmentIndex: number }>;
  }>): void {
    this.loopDebugInfo = info;
  }

  /**
   * Set dirty AABB for local update visualization
   */
  setDirtyAABB(aabb: { minX: number; minY: number; maxX: number; maxY: number } | null): void {
    this.dirtyAABB = aabb;
  }

  /**
   * Set rebuilt chains for local update visualization
   */
  setRebuiltChains(chains: Vec2[][]): void {
    this.rebuiltChains = chains;
  }

  /**
   * Clear local update debug info (call after full heal)
   */
  clearLocalUpdateDebug(): void {
    this.dirtyAABB = null;
    this.rebuiltChains = [];
    this.localUpdateDebug = null;
  }

  /**
   * Render the scene
   * @param playerPosition - Optional player position to render
   * @param playerRadius - Optional player radius
   * @param balls - Optional array of ball bodies to render
   * @param physicsDebugDraw - Optional callback to draw physics debug
   * @param playerDebugDraw - Optional callback to draw player debug info
   * @param joystickDraw - Optional callback to draw virtual joystick
   * @param playerDirection - Optional player direction in radians (for rendering direction indicator)
   */
  render(
    playerPosition?: { x: number; y: number },
    playerRadius?: number,
    balls?: BallRenderData[],
    physicsDebugDraw?: (ctx: CanvasRenderingContext2D, width: number, height: number) => void,
    playerDebugDraw?: (ctx: CanvasRenderingContext2D, width: number, height: number) => void,
    joystickDraw?: (ctx: CanvasRenderingContext2D) => void,
    playerDirection?: number
  ): void {
    try {
      const dpr = window.devicePixelRatio || 1;
      const width = this.canvas.width / dpr;
      const height = this.canvas.height / dpr;

      // Clear canvas - rock background (dark purple)
      this.ctx.fillStyle = '#665779';
      this.ctx.fillRect(0, 0, width, height);

      // Draw density field (optional, for debugging)
      if (this.showDensityField && this.densityField) {
        this.drawDensityField(width, height);
      }

      // Draw grid (optional, for debugging)
      if (this.showGrid) {
        this.drawGrid(width, height);
      }

      // Draw polylines
      this.drawPolylines(width, height);

      // Draw water grid overlay (debug)
      if (this.showWaterGrid && this.waterGrid) {
        this.drawWaterGrid(width, height);
      }

      if (this.showWaterParticles && this.waterParticles) {
        this.drawWaterParticles(width, height);
      }

      // ========================================
      // Carving Debug Overlays (State-Based)
      // ========================================

      // Draw physics bodies (debugging) - use custom debug draw
      if (this.showPhysicsBodies && physicsDebugDraw) {
        physicsDebugDraw(this.ctx, width, height);
      }

      // Draw player
      if (playerPosition && playerRadius) {
        this.drawPlayer(width, height, playerPosition, playerRadius, playerDirection);
      }

      // Draw test balls
      if (balls && balls.length > 0) {
        this.drawBalls(width, height, balls);
      }

      // Draw vertices (debugging)
      if (this.showVertices) {
        this.drawVertices(width, height);
      }

      // Draw original vertices (debugging)
      if (this.showOriginalVertices) {
        this.drawOriginalVertices(width, height);
      }

      // Draw canonical vertices (cleaned marching squares)
      if (this.showCanonicalVertices) {
        this.drawCanonicalVertices(width, height);
      }

      // Draw canonical loop AABBs
      if (this.showCanonicalAABBs) {
        this.drawCanonicalAABBs(width, height);
      }

      // Draw loop numbers at centroids (debugging)
      if (this.showLoopNumbers) {
        this.drawLoopNumbers(width, height);
      }

      // Draw sample points (debugging)
      if (this.showSamplePoints) {
        this.drawSamplePoints(width, height);
      }

      // Draw dirty AABB (local update debugging)
      if (this.showDirtyAABB && this.dirtyAABB) {
        this.drawDirtyAABB(width, height);
      }

      // Draw rebuilt chains (local update debugging)
      if (this.showRebuiltChains && this.rebuiltChains.length > 0) {
        this.drawRebuiltChains(width, height);
      }

      // Draw physics segment debug
      if (this.showSegmentDebug && this.segmentDebugData.length > 0) {
        this.drawSegmentDebug(width, height);
      }

      // Draw player debug info (velocity, grounded state, etc.)
      if (playerDebugDraw) {
        playerDebugDraw(this.ctx, width, height);
      }

      switch (this._carvingDebugMode) {
        case CarvingDebugMode.DIRTY_AABB:
          this.drawOption2Legend(width, height, 'Step 1: Dirty AABB', [
            'Yellow dashed box = dirty region',
            'Stamp brush creates this region'
          ]);
          break;

        case CarvingDebugMode.CANONICAL_AFFECTED:
          this.drawCanonicalAffectedOverlay(width, height);
          break;

        case CarvingDebugMode.CANONICAL_DIRTY_RANGES:
          this.drawCanonicalDirtyRangesOverlay(width, height);
          break;

        case CarvingDebugMode.OPT_INVALIDATION:
          this.drawOptInvalidationOverlay(width, height);
          break;

        case CarvingDebugMode.LOCAL_MS_MATCH:
          this.drawLocalMsMatchOverlay(width, height);
          break;

        case CarvingDebugMode.LOCAL_CANON_SURGERY_PREVIEW:
          this.drawLocalCanonSurgeryPreviewOverlay(width, height);
          break;

        case CarvingDebugMode.LOCAL_CANON_SURGERY_COMMIT:
          this.drawLocalCanonSurgeryCommitOverlay(width, height);
          break;

        case CarvingDebugMode.LOCAL_OPT_AABB_INVALIDATION:
          this.drawLocalOptAabbInvalidationOverlay(width, height);
          break;

        case CarvingDebugMode.LOCAL_OPT_REBUILD:
          this.drawLocalOptRebuildOverlay(width, height);
          break;

        case CarvingDebugMode.LOCAL_OPT_SPLICE_VALIDATE:
          this.drawLocalOptSpliceOverlay(width, height);
          break;

        case CarvingDebugMode.LOCAL_PHYSICS_PLAN:
          this.drawLocalPhysicsPlanOverlay(width, height);
          break;

        case CarvingDebugMode.LOCAL_PHYSICS_APPLY:
          this.drawLocalPhysicsApplyOverlay(width, height);
          break;

        case CarvingDebugMode.SEGMENT_DEBUG:
          this.drawOption2Legend(width, height, 'Step 6: Segment Debug', [
            'Enable segment debug overlay',
            'Inspect updated physics segments'
          ]);
          break;

        case CarvingDebugMode.NONE:
        default:
          // No debug visualization - only show final physics-ready terrain
          break;
      }

      // Draw virtual joystick (always on top, in screen coordinates)
      if (joystickDraw) {
        joystickDraw(this.ctx);
      }
    } catch (error) {
      // console.error('Error during render:', error);
    }
  }

  /**
   * Draw the player (as circle with direction indicator)
   */
  private drawPlayer(
    canvasWidth: number,
    canvasHeight: number,
    position: { x: number; y: number },
    radius: number,
    direction?: number
  ): void {
    const screen = this.camera.worldToScreen(position.x, position.y, canvasWidth, canvasHeight);
    const radiusScreen = radius * this.camera.zoom;

    this.ctx.save();

    // Draw circle body (bright green for visibility)
    this.ctx.fillStyle = '#00ff00';
    this.ctx.beginPath();
    this.ctx.arc(screen.x, screen.y, radiusScreen, 0, Math.PI * 2);
    this.ctx.fill();

    // Outline (white)
    this.ctx.strokeStyle = '#ffffff';
    this.ctx.lineWidth = 2;
    this.ctx.stroke();

    // Draw direction indicator triangle (if direction is provided)
    if (direction !== undefined) {
      this.ctx.save();
      this.ctx.translate(screen.x, screen.y);
      this.ctx.rotate(direction);

      // Draw triangle pointing in movement direction
      this.ctx.fillStyle = '#ff00ff';
      this.ctx.beginPath();
      // Triangle at edge of circle
      const triangleSize = Math.min(radiusScreen * 0.3, 15); // Scale with zoom, max 15px
      this.ctx.moveTo(radiusScreen - 2, 0); // Tip of triangle at edge
      this.ctx.lineTo(radiusScreen - triangleSize - 2, -triangleSize / 2); // Left base
      this.ctx.lineTo(radiusScreen - triangleSize - 2, triangleSize / 2); // Right base
      this.ctx.closePath();
      this.ctx.fill();

      // Outline for triangle
      this.ctx.strokeStyle = '#ffffff';
      this.ctx.lineWidth = 1;
      this.ctx.stroke();

      this.ctx.restore();
    }

    // Draw center dot
    this.ctx.fillStyle = '#ffffff';
    this.ctx.beginPath();
    this.ctx.arc(screen.x, screen.y, 3, 0, Math.PI * 2);
    this.ctx.fill();

    this.ctx.restore();
  }

  /**
   * Draw test balls
   */
  private drawBalls(canvasWidth: number, canvasHeight: number, balls: BallRenderData[]): void {
    this.ctx.save();

    for (const ball of balls) {
      const screen = this.camera.worldToScreen(ball.position.x, ball.position.y, canvasWidth, canvasHeight);
      const screenRadius = ball.circleRadius * this.camera.zoom;

      // Draw ball body (light blue-gray from palette)
      this.ctx.fillStyle = '#a2babc';
      this.ctx.beginPath();
      this.ctx.arc(screen.x, screen.y, screenRadius, 0, Math.PI * 2);
      this.ctx.fill();

      // Draw ball outline (medium purple)
      this.ctx.strokeStyle = '#9c7fa3';
      this.ctx.lineWidth = 1;
      this.ctx.stroke();
    }

    this.ctx.restore();
  }

  /**
   * Draw contour polylines
   */
  private drawPolylines(canvasWidth: number, canvasHeight: number): void {
    if (this.polylines.length === 0) {
      console.warn('[Renderer] No polylines to draw (polylines array empty)');
      return;
    }

    this.ctx.save();

    // Fill empty cave space (inside contours) with light cream (lightest)
    // Use 'evenodd' fill rule to handle nested contours
    this.ctx.fillStyle = '#fff8e3';
    this.ctx.beginPath();

    for (const polyline of this.polylines) {
      if (polyline.length < 2) continue;

      const firstScreen = this.camera.worldToScreen(polyline[0].x, polyline[0].y, canvasWidth, canvasHeight);
      this.ctx.moveTo(firstScreen.x, firstScreen.y);

      for (let i = 1; i < polyline.length; i++) {
        const screen = this.camera.worldToScreen(polyline[i].x, polyline[i].y, canvasWidth, canvasHeight);
        this.ctx.lineTo(screen.x, screen.y);
      }

      this.ctx.closePath();
    }

    this.ctx.fill('evenodd');

    // Draw subtle grid lines in cave space (after fill, before stroke)
    this.drawCaveGrid(canvasWidth, canvasHeight);

    // Stroke outlines (medium purple for definition)
    this.ctx.strokeStyle = '#9c7fa3';
    this.ctx.lineWidth = 2;
    this.ctx.lineCap = 'round';
    this.ctx.lineJoin = 'round';

    for (const polyline of this.polylines) {
      if (polyline.length < 2) continue;

      this.ctx.beginPath();
      const firstScreen = this.camera.worldToScreen(polyline[0].x, polyline[0].y, canvasWidth, canvasHeight);
      this.ctx.moveTo(firstScreen.x, firstScreen.y);

      for (let i = 1; i < polyline.length; i++) {
        const screen = this.camera.worldToScreen(polyline[i].x, polyline[i].y, canvasWidth, canvasHeight);
        this.ctx.lineTo(screen.x, screen.y);
      }

      this.ctx.closePath();
      this.ctx.stroke();
    }

    this.ctx.restore();
  }

  private drawDensityField(canvasWidth: number, canvasHeight: number): void {
    if (!this.densityField) return;

    this.ctx.save();

    const field = this.densityField;
    const gridWidth = field.gridWidth;
    const gridHeight = field.gridHeight;

    // Create ImageData for the density field
    const imageData = this.ctx.createImageData(gridWidth, gridHeight);

    // Fill ImageData with grayscale values from density field
    for (let gy = 0; gy < gridHeight; gy++) {
      for (let gx = 0; gx < gridWidth; gx++) {
        const idx = gy * gridWidth + gx;
        const density = field.data[idx]; // 0-255

        // Convert to RGBA (grayscale)
        const pixelIdx = idx * 4;
        imageData.data[pixelIdx + 0] = density; // R
        imageData.data[pixelIdx + 1] = density; // G
        imageData.data[pixelIdx + 2] = density; // B
        imageData.data[pixelIdx + 3] = 128; // A (50% transparent)
      }
    }

    // Create temporary canvas to hold the ImageData
    const tempCanvas = document.createElement('canvas');
    tempCanvas.width = gridWidth;
    tempCanvas.height = gridHeight;
    const tempCtx = tempCanvas.getContext('2d');
    if (!tempCtx) return;

    tempCtx.putImageData(imageData, 0, 0);

    // Calculate world bounds of density field
    const worldWidth = field.config.width;
    const worldHeight = field.config.height;

    // Convert world bounds to screen coordinates
    const topLeft = this.camera.worldToScreen(0, 0, canvasWidth, canvasHeight);
    const bottomRight = this.camera.worldToScreen(worldWidth, worldHeight, canvasWidth, canvasHeight);

    const screenWidth = bottomRight.x - topLeft.x;
    const screenHeight = bottomRight.y - topLeft.y;

    // Draw the density field image scaled to world coordinates
    this.ctx.drawImage(
      tempCanvas,
      topLeft.x,
      topLeft.y,
      screenWidth,
      screenHeight
    );

    this.ctx.restore();
  }

  private drawWaterGrid(canvasWidth: number, canvasHeight: number): void {
    if (!this.waterGrid) return;

    const grid = this.waterGrid;
    const water = grid.water;
    const flowDown = grid.debugFlowDown;
    const flowSide = grid.debugFlowSide;
    const velGrid = this.waterVelocity;
    const cell = grid.cellSizeM;

    const a = this.camera.screenToWorld(0, 0, canvasWidth, canvasHeight);
    const b = this.camera.screenToWorld(canvasWidth, canvasHeight, canvasWidth, canvasHeight);
    const minX = Math.min(a.x, b.x);
    const minY = Math.min(a.y, b.y);
    const maxX = Math.max(a.x, b.x);
    const maxY = Math.max(a.y, b.y);

    let cx0 = Math.floor(minX / cell) - 1;
    let cy0 = Math.floor(minY / cell) - 1;
    let cx1 = Math.floor(maxX / cell) + 1;
    let cy1 = Math.floor(maxY / cell) + 1;

    cx0 = Math.max(0, Math.min(grid.widthCells - 1, cx0));
    cy0 = Math.max(0, Math.min(grid.heightCells - 1, cy0));
    cx1 = Math.max(0, Math.min(grid.widthCells - 1, cx1));
    cy1 = Math.max(0, Math.min(grid.heightCells - 1, cy1));

    this.ctx.save();

    for (let cy = cy0; cy <= cy1; cy++) {
      const wy = cy * cell;
      for (let cx = cx0; cx <= cx1; cx++) {
        const idx = cy * grid.widthCells + cx;
        const w = water[idx];
        if (w <= 0) continue;

        const wx = cx * cell;
        const p0 = this.camera.worldToScreen(wx, wy, canvasWidth, canvasHeight);
        const p1 = this.camera.worldToScreen(wx + cell, wy + cell, canvasWidth, canvasHeight);
        const x0 = Math.min(p0.x, p1.x);
        const y0 = Math.min(p0.y, p1.y);
        const x1 = Math.max(p0.x, p1.x);
        const y1 = Math.max(p0.y, p1.y);

        const alpha = Math.min(0.95, 0.06 + 0.85 * w);
        if (this.showWaterVelocityHsv && velGrid) {
          const vel = velGrid.getCellVelocity(cx, cy);
          const speed = Math.sqrt(vel.u * vel.u + vel.v * vel.v);
          const speedN = Math.max(0, Math.min(1, speed / 8));
          const rgb = this.velocityToRgb(vel.u, vel.v, speedN);
          this.ctx.fillStyle = `rgba(${rgb.r}, ${rgb.g}, ${rgb.b}, ${alpha})`;
        } else if (this.showWaterFlowDebug) {
          const downN = Math.max(0, Math.min(1, flowDown[idx] * 6));
          const sideN = Math.max(0, Math.min(1, flowSide[idx] * 6));
          const r = Math.round(30 + 180 * sideN);
          const g = Math.round(90 + 140 * downN);
          const b = 229;
          this.ctx.fillStyle = `rgba(${r}, ${g}, ${b}, ${alpha})`;
        } else {
          this.ctx.fillStyle = `rgba(30, 136, 229, ${alpha})`;
        }
        this.ctx.fillRect(x0, y0, x1 - x0, y1 - y0);
      }
    }

    this.ctx.restore();
  }

  private drawWaterParticles(canvasWidth: number, canvasHeight: number): void {
    if (!this.waterParticles) return;

    const topLeft = this.camera.screenToWorld(0, 0, canvasWidth, canvasHeight);
    const bottomRight = this.camera.screenToWorld(canvasWidth, canvasHeight, canvasWidth, canvasHeight);

    const minX = Math.min(topLeft.x, bottomRight.x);
    const minY = Math.min(topLeft.y, bottomRight.y);
    const maxX = Math.max(topLeft.x, bottomRight.x);
    const maxY = Math.max(topLeft.y, bottomRight.y);

    const particles = this.waterParticles;
    const maxDraw = 6000;
    const stride = particles.length > maxDraw ? Math.ceil(particles.length / maxDraw) : 1;

    this.ctx.save();
    this.ctx.fillStyle = 'rgba(3, 169, 244, 0.65)';

    const r = Math.max(0.75, Math.min(2.0, this.camera.zoom * 0.01));

    for (let i = 0; i < particles.length; i += stride) {
      const p = particles[i];
      if (p.x < minX || p.x > maxX || p.y < minY || p.y > maxY) continue;

      const s = this.camera.worldToScreen(p.x, p.y, canvasWidth, canvasHeight);
      this.ctx.beginPath();
      this.ctx.arc(s.x, s.y, r, 0, Math.PI * 2);
      this.ctx.fill();
    }

    this.ctx.restore();
  }

  private velocityToRgb(u: number, v: number, speedN: number): { r: number; g: number; b: number } {
    if (speedN <= 0.001) return { r: 0, g: 0, b: 0 };

    let angle = Math.atan2(v, u);
    if (angle < 0) angle += Math.PI * 2;

    const seg = Math.min(3, Math.floor(angle / (Math.PI / 2)));
    const t = (angle - seg * (Math.PI / 2)) / (Math.PI / 2);

    const anchors = [
      { r: 1, g: 0, b: 0 }, // right = red
      { r: 0, g: 0, b: 1 }, // down = blue
      { r: 0, g: 1, b: 1 }, // left = cyan
      { r: 1, g: 1, b: 0 }, // up = yellow
    ];

    const a = anchors[seg];
    const b = anchors[(seg + 1) % 4];

    const r = (a.r * (1 - t) + b.r * t) * speedN;
    const g = (a.g * (1 - t) + b.g * t) * speedN;
    const bl = (a.b * (1 - t) + b.b * t) * speedN;

    return {
      r: Math.round(r * 255),
      g: Math.round(g * 255),
      b: Math.round(bl * 255),
    };
  }

  /**
   * Draw debug grid
   */
  private drawGrid(canvasWidth: number, canvasHeight: number): void {
    this.ctx.save();
    this.ctx.strokeStyle = '#333';
    this.ctx.lineWidth = 1;

    // Draw grid lines every 1 metre in world space
    const gridSpacing = 1; // metres

    // Calculate visible world bounds
    const topLeft = this.camera.screenToWorld(0, 0, canvasWidth, canvasHeight);
    const bottomRight = this.camera.screenToWorld(canvasWidth, canvasHeight, canvasWidth, canvasHeight);

    const startX = Math.floor(topLeft.x / gridSpacing) * gridSpacing;
    const endX = Math.ceil(bottomRight.x / gridSpacing) * gridSpacing;
    const startY = Math.floor(topLeft.y / gridSpacing) * gridSpacing;
    const endY = Math.ceil(bottomRight.y / gridSpacing) * gridSpacing;

    // Vertical lines
    for (let x = startX; x <= endX; x += gridSpacing) {
      const top = this.camera.worldToScreen(x, topLeft.y, canvasWidth, canvasHeight);
      const bottom = this.camera.worldToScreen(x, bottomRight.y, canvasWidth, canvasHeight);
      this.ctx.beginPath();
      this.ctx.moveTo(top.x, top.y);
      this.ctx.lineTo(bottom.x, bottom.y);
      this.ctx.stroke();
    }

    // Horizontal lines
    for (let y = startY; y <= endY; y += gridSpacing) {
      const left = this.camera.worldToScreen(topLeft.x, y, canvasWidth, canvasHeight);
      const right = this.camera.worldToScreen(bottomRight.x, y, canvasWidth, canvasHeight);
      this.ctx.beginPath();
      this.ctx.moveTo(left.x, left.y);
      this.ctx.lineTo(right.x, right.y);
      this.ctx.stroke();
    }

    this.ctx.restore();
  }

  /**
   * Draw subtle grid lines in cave space (empty area)
   * Grid is almost the same color as the cave background for subtle visual aid
   */
  private drawCaveGrid(canvasWidth: number, canvasHeight: number): void {
    if (this.polylines.length === 0) return;

    this.ctx.save();

    // Create clipping region from polylines (only draw grid inside cave)
    this.ctx.beginPath();
    for (const polyline of this.polylines) {
      if (polyline.length < 2) continue;

      const firstScreen = this.camera.worldToScreen(polyline[0].x, polyline[0].y, canvasWidth, canvasHeight);
      this.ctx.moveTo(firstScreen.x, firstScreen.y);

      for (let i = 1; i < polyline.length; i++) {
        const screen = this.camera.worldToScreen(polyline[i].x, polyline[i].y, canvasWidth, canvasHeight);
        this.ctx.lineTo(screen.x, screen.y);
      }

      this.ctx.closePath();
    }
    this.ctx.clip('evenodd');

    // Make cave grid lines stand out a bit more than the cave background '#fff8e3'
    this.ctx.strokeStyle = '#d4b46b';
    this.ctx.lineWidth = 1;
    this.ctx.globalAlpha = 0.85;

    // Draw grid lines every 1 metre in world space
    const gridSpacing = 1; // metres

    // Calculate visible world bounds
    const topLeft = this.camera.screenToWorld(0, 0, canvasWidth, canvasHeight);
    const bottomRight = this.camera.screenToWorld(canvasWidth, canvasHeight, canvasWidth, canvasHeight);

    const startX = Math.floor(topLeft.x / gridSpacing) * gridSpacing;
    const endX = Math.ceil(bottomRight.x / gridSpacing) * gridSpacing;
    const startY = Math.floor(topLeft.y / gridSpacing) * gridSpacing;
    const endY = Math.ceil(bottomRight.y / gridSpacing) * gridSpacing;

    // Vertical lines
    for (let x = startX; x <= endX; x += gridSpacing) {
      const top = this.camera.worldToScreen(x, topLeft.y, canvasWidth, canvasHeight);
      const bottom = this.camera.worldToScreen(x, bottomRight.y, canvasWidth, canvasHeight);
      this.ctx.beginPath();
      this.ctx.moveTo(top.x, top.y);
      this.ctx.lineTo(bottom.x, bottom.y);
      this.ctx.stroke();
    }

    // Horizontal lines
    for (let y = startY; y <= endY; y += gridSpacing) {
      const left = this.camera.worldToScreen(topLeft.x, y, canvasWidth, canvasHeight);
      const right = this.camera.worldToScreen(bottomRight.x, y, canvasWidth, canvasHeight);
      this.ctx.beginPath();
      this.ctx.moveTo(left.x, left.y);
      this.ctx.lineTo(right.x, right.y);
      this.ctx.stroke();
    }

    this.ctx.restore();
  }

  /**
   * Compute midpoint (in screen space) along a polyline by arc length
   */
  private getPolylineMidpoint(points: Vec2[], canvasWidth: number, canvasHeight: number): { x: number; y: number } | null {
    if (points.length === 0) return null;
    if (points.length === 1) {
      const p = this.camera.worldToScreen(points[0].x, points[0].y, canvasWidth, canvasHeight);
      return { x: p.x, y: p.y };
    }

    // Total length
    let total = 0;
    for (let i = 1; i < points.length; i++) {
      const dx = points[i].x - points[i - 1].x;
      const dy = points[i].y - points[i - 1].y;
      total += Math.hypot(dx, dy);
    }

    const target = total / 2;
    let accum = 0;

    for (let i = 1; i < points.length; i++) {
      const dx = points[i].x - points[i - 1].x;
      const dy = points[i].y - points[i - 1].y;
      const segLen = Math.hypot(dx, dy);
      if (accum + segLen >= target) {
        const t = (target - accum) / segLen;
        const wx = points[i - 1].x + t * dx;
        const wy = points[i - 1].y + t * dy;
        const screen = this.camera.worldToScreen(wx, wy, canvasWidth, canvasHeight);
        return { x: screen.x, y: screen.y };
      }
      accum += segLen;
    }

    // Fallback to last point
    const last = points[points.length - 1];
    const screen = this.camera.worldToScreen(last.x, last.y, canvasWidth, canvasHeight);
    return { x: screen.x, y: screen.y };
  }

  /**
   * Draw optimized vertices with labels
   */
  private drawVertices(canvasWidth: number, canvasHeight: number): void {
    this.ctx.save();
    const useAncestry = this.optimizedOptLoops.length > 0;
    if (useAncestry) {
      const hover = this.debugHoverWorld
        ? this.camera.worldToScreen(this.debugHoverWorld.x, this.debugHoverWorld.y, canvasWidth, canvasHeight)
        : null;
      const labelRadiusPx = 12;
      this.ctx.font = '10px monospace';
      this.ctx.textBaseline = 'middle';
      this.ctx.textAlign = 'left';
      for (const loop of this.optimizedOptLoops) {
        if (loop.length === 0) continue;

        // Use a slow-changing gradient based on overall canonical span for this loop
        const maxCanon = loop.reduce((m, v) => Math.max(m, v.canonEndId), 1);
        for (let i = 0; i < loop.length; i++) {
          const v = loop[i];
          const screen = this.camera.worldToScreen(v.x, v.y, canvasWidth, canvasHeight);
          const mid = (v.canonStartId + v.canonEndId) * 0.5;
          const t = maxCanon > 0 ? mid / maxCanon : 0;
          const hue = (t * 300 + 20) % 360; // smooth sweep across loop
          this.ctx.fillStyle = `hsl(${hue}, 80%, 60%)`;
          this.ctx.beginPath();
          this.ctx.arc(screen.x, screen.y, 3, 0, Math.PI * 2);
          this.ctx.fill();

          // Show ancestry text only near hover to avoid clutter
          if (hover) {
            const dx = screen.x - hover.x;
            const dy = screen.y - hover.y;
            if (dx * dx + dy * dy <= labelRadiusPx * labelRadiusPx) {
              this.ctx.fillStyle = 'rgba(255, 255, 255, 0.8)';
              this.ctx.fillText(`${v.canonStartId}-${v.canonEndId}`, screen.x + 6, screen.y);
            }
          }
        }
      }
    } else {
      for (const polyline of this.polylines) {
        if (polyline.length === 0) continue;

        // Draw start point (green)
        const start = this.camera.worldToScreen(polyline[0].x, polyline[0].y, canvasWidth, canvasHeight);
        this.ctx.fillStyle = '#00ff00';
        this.ctx.beginPath();
        this.ctx.arc(start.x, start.y, 5, 0, Math.PI * 2);
        this.ctx.fill();
        this.ctx.fillText('START', start.x + 8, start.y);

        // Draw end point (red)
        const end = this.camera.worldToScreen(
          polyline[polyline.length - 1].x,
          polyline[polyline.length - 1].y,
          canvasWidth,
          canvasHeight
        );
        this.ctx.fillStyle = '#ff0000';
        this.ctx.beginPath();
        this.ctx.arc(end.x, end.y, 5, 0, Math.PI * 2);
        this.ctx.fill();
        this.ctx.fillText('END', end.x + 8, end.y);

        // Draw all vertices (yellow)
        this.ctx.fillStyle = '#ffff00';
        for (let i = 0; i < polyline.length; i++) {
          const screen = this.camera.worldToScreen(polyline[i].x, polyline[i].y, canvasWidth, canvasHeight);
          this.ctx.beginPath();
          this.ctx.arc(screen.x, screen.y, 2, 0, Math.PI * 2);
          this.ctx.fill();
        }
      }
    }

    this.ctx.restore();
  }

  /**
   * Draw original (unoptimized) vertices as tiny points
   */
  private drawOriginalVertices(canvasWidth: number, canvasHeight: number): void {
    this.ctx.save();

    // Draw all original vertices as tiny cyan points (1px radius)
    this.ctx.fillStyle = '#00ffff';
    for (const polyline of this.originalPolylines) {
      if (polyline.length === 0) continue;

      for (let i = 0; i < polyline.length; i++) {
        const screen = this.camera.worldToScreen(polyline[i].x, polyline[i].y, canvasWidth, canvasHeight);
        this.ctx.beginPath();
        this.ctx.arc(screen.x, screen.y, 1, 0, Math.PI * 2);
        this.ctx.fill();
      }
    }

    this.ctx.restore();
  }

  /**
   * Draw canonical vertices (cleaned marching squares output)
   */
  private drawCanonicalVertices(canvasWidth: number, canvasHeight: number): void {
    if (this.canonicalLoops.length === 0) return;

    this.ctx.save();
    this.ctx.fillStyle = '#444444';
    this.ctx.font = '11px monospace';
    this.ctx.textBaseline = 'middle';
    this.ctx.textAlign = 'left';

    for (const loop of this.canonicalLoops) {
      const loopLen = loop.vertices.length;
      if (loopLen === 0) continue;

      // Draw a small direction stub from v0 to v1 to show loop start
      if (this.showCanonicalLabels && loopLen > 1) {
        const v0 = loop.vertices[0];
        const v1 = loop.vertices[1];
        const s0 = this.camera.worldToScreen(v0.x, v0.y, canvasWidth, canvasHeight);
        const s1 = this.camera.worldToScreen(v1.x, v1.y, canvasWidth, canvasHeight);
        this.ctx.strokeStyle = '#666666';
        this.ctx.lineWidth = 2;
        this.ctx.beginPath();
        this.ctx.moveTo(s0.x, s0.y);
        this.ctx.lineTo(s1.x, s1.y);
        this.ctx.stroke();
      }

      for (const vertex of loop.vertices) {
        const screen = this.camera.worldToScreen(vertex.x, vertex.y, canvasWidth, canvasHeight);
        this.ctx.beginPath();
        this.ctx.arc(screen.x, screen.y, 2, 0, Math.PI * 2);
        this.ctx.fill();
      }

      // Label loop id at the start vertex
      if (this.showCanonicalLabels) {
        const start = loop.vertices[0];
        const s = this.camera.worldToScreen(start.x, start.y, canvasWidth, canvasHeight);
        this.ctx.fillStyle = '#ffffff';
        this.ctx.strokeStyle = '#000000';
        this.ctx.lineWidth = 3;
        const label = `id:${loop.id} len:${loopLen}`;
        // Outline for readability
        this.ctx.strokeText(label, s.x + 6, s.y);
        this.ctx.fillText(label, s.x + 6, s.y);
        this.ctx.fillStyle = '#444444';
      }
    }

    this.ctx.restore();
  }

  /**
   * Draw canonical loop AABBs
   */
  private drawCanonicalAABBs(canvasWidth: number, canvasHeight: number): void {
    if (this.canonicalLoops.length === 0) return;

    this.ctx.save();
    this.ctx.strokeStyle = '#ff3333';
    this.ctx.lineWidth = 2;
    this.ctx.setLineDash([6, 3]);

    for (const loop of this.canonicalLoops) {
      const topLeft = this.camera.worldToScreen(loop.aabb.minX, loop.aabb.minY, canvasWidth, canvasHeight);
      const bottomRight = this.camera.worldToScreen(loop.aabb.maxX, loop.aabb.maxY, canvasWidth, canvasHeight);
      const rectWidth = bottomRight.x - topLeft.x;
      const rectHeight = bottomRight.y - topLeft.y;
      this.ctx.strokeRect(topLeft.x, topLeft.y, rectWidth, rectHeight);
    }

    this.ctx.setLineDash([]);
    this.ctx.restore();
  }

  /**
   * Draw physics segments and their canonical ranges (debug)
   */
  private drawSegmentDebug(canvasWidth: number, canvasHeight: number): void {
    this.ctx.save();
    this.ctx.font = '10px monospace';
    this.ctx.textBaseline = 'middle';
    this.ctx.textAlign = 'center';

    for (const entry of this.segmentDebugData) {
      const verts = entry.vertices;
      for (const seg of entry.segments) {
        const start = verts[seg.optStart];
        const end = verts[seg.optEnd];
        if (!start || !end) continue;

        // Polyline along segment vertices (no diagonals)
        this.ctx.strokeStyle = '#ffeb3b';
        this.ctx.lineWidth = 2;
        this.ctx.beginPath();
        for (let i = seg.optStart; i <= seg.optEnd; i++) {
          const v = verts[i];
          const s = this.camera.worldToScreen(v.x, v.y, canvasWidth, canvasHeight);
          if (i === seg.optStart) {
            this.ctx.moveTo(s.x, s.y);
          } else {
            this.ctx.lineTo(s.x, s.y);
          }
        }
        this.ctx.stroke();

        // Endpoints
        const startScreen = this.camera.worldToScreen(start.x, start.y, canvasWidth, canvasHeight);
        const endScreen = this.camera.worldToScreen(end.x, end.y, canvasWidth, canvasHeight);
        this.ctx.fillStyle = '#ffeb3b';
        this.ctx.beginPath();
        this.ctx.arc(startScreen.x, startScreen.y, 3, 0, Math.PI * 2);
        this.ctx.fill();
        this.ctx.beginPath();
        this.ctx.arc(endScreen.x, endScreen.y, 3, 0, Math.PI * 2);
        this.ctx.fill();

        // Label canonical range at midpoint vertex
        const midIdx = Math.floor((seg.optStart + seg.optEnd) / 2);
        const mid = verts[midIdx] ?? start;
        const midScreen = this.camera.worldToScreen(mid.x, mid.y, canvasWidth, canvasHeight);
        this.ctx.fillStyle = 'rgba(0,0,0,0.7)';
        this.ctx.fillRect(midScreen.x - 26, midScreen.y - 8, 52, 16);
        this.ctx.fillStyle = '#ffeb3b';
        this.ctx.fillText(`${seg.canonicalStart}-${seg.canonicalEnd}`, midScreen.x, midScreen.y);
      }
    }

    this.ctx.restore();
  }

  /**
   * Draw loop numbers at centroids for debugging
   */
  private drawLoopNumbers(canvasWidth: number, canvasHeight: number): void {
    if (this.loopDebugInfo.length === 0) return;

    this.ctx.save();
    this.ctx.font = 'bold 16px monospace';
    this.ctx.textAlign = 'center';
    this.ctx.textBaseline = 'middle';

    for (const info of this.loopDebugInfo) {
      const screen = this.camera.worldToScreen(info.centroid.x, info.centroid.y, canvasWidth, canvasHeight);

      // Draw background circle
      this.ctx.fillStyle = info.isRock ? 'rgba(0, 128, 255, 0.7)' : 'rgba(255, 128, 0, 0.7)';
      this.ctx.beginPath();
      this.ctx.arc(screen.x, screen.y, 14, 0, Math.PI * 2);
      this.ctx.fill();

      // Draw border
      this.ctx.strokeStyle = info.isRock ? '#ffffff' : '#000000';
      this.ctx.lineWidth = 2;
      this.ctx.beginPath();
      this.ctx.arc(screen.x, screen.y, 14, 0, Math.PI * 2);
      this.ctx.stroke();

      // Draw number
      this.ctx.fillStyle = '#ffffff';
      this.ctx.fillText(info.index.toString(), screen.x, screen.y);
    }

    this.ctx.restore();
  }

  /**
   * Draw sample points for density classification debugging
   * Green dots = inside samples, Red dots = outside samples
   */
  private drawSamplePoints(canvasWidth: number, canvasHeight: number): void {
    if (this.loopDebugInfo.length === 0) return;

    this.ctx.save();

    for (const info of this.loopDebugInfo) {
      if (!info.samples) continue;

      for (const sample of info.samples) {
        const screen = this.camera.worldToScreen(sample.x, sample.y, canvasWidth, canvasHeight);

        // Set color based on side: green for inside, red for outside
        this.ctx.fillStyle = sample.side === "inside" ? '#00ff00' : '#ff0000';

        // Draw dot
        this.ctx.beginPath();
        this.ctx.arc(screen.x, screen.y, 3, 0, Math.PI * 2);
        this.ctx.fill();

        // Optional: draw small border for visibility
        this.ctx.strokeStyle = '#ffffff';
        this.ctx.lineWidth = 1;
        this.ctx.beginPath();
        this.ctx.arc(screen.x, screen.y, 3, 0, Math.PI * 2);
        this.ctx.stroke();
      }
    }

    this.ctx.restore();
  }

  /**
   * Draw dirty AABB box (local update region)
   */
  private drawDirtyAABB(canvasWidth: number, canvasHeight: number): void {
    if (!this.dirtyAABB) return;

    this.ctx.save();

    const topLeft = this.camera.worldToScreen(this.dirtyAABB.minX, this.dirtyAABB.minY, canvasWidth, canvasHeight);
    const bottomRight = this.camera.worldToScreen(this.dirtyAABB.maxX, this.dirtyAABB.maxY, canvasWidth, canvasHeight);

    const rectWidth = bottomRight.x - topLeft.x;
    const rectHeight = bottomRight.y - topLeft.y;

    // Draw filled semi-transparent background
    this.ctx.fillStyle = 'rgba(255, 255, 0, 0.1)'; // Yellow with 10% opacity
    this.ctx.fillRect(topLeft.x, topLeft.y, rectWidth, rectHeight);

    // Draw bright yellow border
    this.ctx.strokeStyle = '#ffff00'; // Bright yellow
    this.ctx.lineWidth = 3;
    this.ctx.setLineDash([10, 5]); // Dashed line
    this.ctx.strokeRect(topLeft.x, topLeft.y, rectWidth, rectHeight);

    // Reset dash
    this.ctx.setLineDash([]);

    // Draw label
    this.ctx.fillStyle = '#ffff00';
    this.ctx.font = 'bold 14px monospace';
    this.ctx.fillText('DIRTY AABB', topLeft.x + 5, topLeft.y + 20);

    this.ctx.restore();
  }

  /**
   * Draw rebuilt chains (newly added collision segments)
   */
  private drawRebuiltChains(canvasWidth: number, canvasHeight: number): void {
    if (this.rebuiltChains.length === 0) return;

    this.ctx.save();

    for (const chain of this.rebuiltChains) {
      if (chain.length < 2) continue;

      // Stroke for the stitched arc
      this.ctx.strokeStyle = '#ff00ff'; // Magenta for stitched arc
      this.ctx.lineWidth = 4;
      this.ctx.globalAlpha = 0.9;

      this.ctx.beginPath();
      const first = this.camera.worldToScreen(chain[0].x, chain[0].y, canvasWidth, canvasHeight);
      this.ctx.moveTo(first.x, first.y);

      for (let i = 1; i < chain.length; i++) {
        const screen = this.camera.worldToScreen(chain[i].x, chain[i].y, canvasWidth, canvasHeight);
        this.ctx.lineTo(screen.x, screen.y);
      }

      this.ctx.stroke();

      // Draw all intermediate vertices as small cyan dots
      for (let i = 1; i < chain.length - 1; i++) {
        const v = chain[i];
        const screen = this.camera.worldToScreen(v.x, v.y, canvasWidth, canvasHeight);
        this.ctx.fillStyle = '#00ffff';
        this.ctx.beginPath();
        this.ctx.arc(screen.x, screen.y, 2, 0, Math.PI * 2);
        this.ctx.fill();
      }

      // Highlight endpoints as reattachment vertices
      const start = this.camera.worldToScreen(chain[0].x, chain[0].y, canvasWidth, canvasHeight);
      const end = this.camera.worldToScreen(chain[chain.length - 1].x, chain[chain.length - 1].y, canvasWidth, canvasHeight);

      // Start vertex (red)
      this.ctx.fillStyle = '#ff0000';
      this.ctx.beginPath();
      this.ctx.arc(start.x, start.y, 4, 0, Math.PI * 2);
      this.ctx.fill();

      // End vertex (blue)
      this.ctx.fillStyle = '#0000ff';
      this.ctx.beginPath();
      this.ctx.arc(end.x, end.y, 4, 0, Math.PI * 2);
      this.ctx.fill();
    }

    this.ctx.restore();
  }

  // ============================================================================
  // Option 2 Debug Overlays (Canonical-First Local Update)
  // ============================================================================

  private drawOption2Legend(
    canvasWidth: number,
    canvasHeight: number,
    title: string,
    lines: string[]
  ): void {
    this.ctx.save();
    const width = 360;
    const x = Math.max(20, Math.floor((canvasWidth - width) / 2));
    const y = 20;
    const lineHeight = 18;
    const height = 18 + (lines.length + 1) * lineHeight + 16;

    this.ctx.fillStyle = 'rgba(0, 0, 0, 0.75)';
    this.ctx.fillRect(x - 10, y - 10, width, height);
    this.ctx.strokeStyle = '#00ff00';
    this.ctx.lineWidth = 2;
    this.ctx.strokeRect(x - 10, y - 10, width, height);

    this.ctx.font = 'bold 14px monospace';
    this.ctx.fillStyle = '#00ff00';
    this.ctx.textAlign = 'left';
    this.ctx.textBaseline = 'top';
    this.ctx.fillText(title, x, y);

    this.ctx.font = '12px monospace';
    this.ctx.fillStyle = '#ffffff';
    let cy = y + lineHeight + 6;
    for (const line of lines) {
      this.ctx.fillText(`- ${line}`, x, cy);
      cy += lineHeight;
    }

    this.ctx.restore();
  }

  private drawCanonicalAffectedOverlay(canvasWidth: number, canvasHeight: number): void {
    if (!this.carveOption2Debug || this.canonicalLoops.length === 0) return;

    const affected = new Set(this.carveOption2Debug.affectedCanonicalLoopIds);

    this.ctx.save();
    this.ctx.lineWidth = 3;
    this.ctx.globalAlpha = 1.0;

    for (const loop of this.canonicalLoops) {
      const verts = loop.vertices;
      if (!verts || verts.length < 2) continue;

      const isAffected = affected.has(loop.id);
      this.ctx.strokeStyle = isAffected ? '#ff00ff' : 'rgba(255,255,255,0.25)';
      this.ctx.lineWidth = isAffected ? 4 : 2;
      this.ctx.globalAlpha = isAffected ? 0.95 : 0.35;

      const first = this.camera.worldToScreen(verts[0].x, verts[0].y, canvasWidth, canvasHeight);
      this.ctx.beginPath();
      this.ctx.moveTo(first.x, first.y);
      for (let i = 1; i < verts.length; i++) {
        const s = this.camera.worldToScreen(verts[i].x, verts[i].y, canvasWidth, canvasHeight);
        this.ctx.lineTo(s.x, s.y);
      }
      this.ctx.stroke();

      if (isAffected) {
        this.ctx.font = 'bold 12px monospace';
        this.ctx.textAlign = 'left';
        this.ctx.textBaseline = 'top';
        this.ctx.lineWidth = 3;
        this.ctx.strokeStyle = '#000000';
        this.ctx.strokeText(`canon#${loop.id}`, first.x + 8, first.y + 8);
        this.ctx.fillStyle = '#ff00ff';
        this.ctx.fillText(`canon#${loop.id}`, first.x + 8, first.y + 8);
      }
    }

    this.ctx.restore();
    this.drawOption2Legend(canvasWidth, canvasHeight, 'Step 2: Canonical Affected', [
      'Magenta = affected canonical loops',
      'Use this set for local updates'
    ]);
  }

  private drawCanonicalDirtyRangesOverlay(canvasWidth: number, canvasHeight: number): void {
    if (!this.carveOption2Debug || this.canonicalLoops.length === 0) return;
    const ranges = this.carveOption2Debug.dirtyRanges;
    if (ranges.length === 0) {
      this.drawOption2Legend(canvasWidth, canvasHeight, 'Step 3: Canonical Dirty Ranges', [
        'No dirty ranges computed'
      ]);
      return;
    }

    const rangeMap = new Map<number, Array<{ startIndex: number; endIndex: number }>>();
    for (const r of ranges) {
      const arr = rangeMap.get(r.loopId) ?? [];
      arr.push({ startIndex: r.startIndex, endIndex: r.endIndex });
      rangeMap.set(r.loopId, arr);
    }

    this.ctx.save();

    for (const loop of this.canonicalLoops) {
      const verts = loop.vertices;
      if (!verts || verts.length < 2) continue;

      const loopRanges = rangeMap.get(loop.id);
      if (!loopRanges || loopRanges.length === 0) continue;

      // Draw full loop faintly
      this.ctx.strokeStyle = 'rgba(255,255,255,0.25)';
      this.ctx.lineWidth = 2;
      this.ctx.globalAlpha = 0.5;
      const first = this.camera.worldToScreen(verts[0].x, verts[0].y, canvasWidth, canvasHeight);
      this.ctx.beginPath();
      this.ctx.moveTo(first.x, first.y);
      for (let i = 1; i < verts.length; i++) {
        const s = this.camera.worldToScreen(verts[i].x, verts[i].y, canvasWidth, canvasHeight);
        this.ctx.lineTo(s.x, s.y);
      }
      this.ctx.stroke();

      // Draw dirty spans
      const drawSpan = (start: number, end: number) => {
        if (end - start < 1) return;
        const s0 = this.camera.worldToScreen(verts[start].x, verts[start].y, canvasWidth, canvasHeight);
        this.ctx.beginPath();
        this.ctx.moveTo(s0.x, s0.y);
        for (let i = start + 1; i <= end; i++) {
          const si = this.camera.worldToScreen(verts[i].x, verts[i].y, canvasWidth, canvasHeight);
          this.ctx.lineTo(si.x, si.y);
        }
        this.ctx.stroke();
      };

      this.ctx.strokeStyle = '#ff00ff';
      this.ctx.lineWidth = 5;
      this.ctx.globalAlpha = 0.9;
      for (const { startIndex, endIndex } of loopRanges) {
        if (startIndex <= endIndex) {
          drawSpan(startIndex, endIndex);
        } else {
          drawSpan(startIndex, verts.length - 1);
          drawSpan(0, endIndex);
        }

        // Mark boundaries
        const startPt = this.camera.worldToScreen(verts[startIndex].x, verts[startIndex].y, canvasWidth, canvasHeight);
        const endPt = this.camera.worldToScreen(verts[endIndex].x, verts[endIndex].y, canvasWidth, canvasHeight);
        this.ctx.fillStyle = '#00ff00';
        this.ctx.beginPath();
        this.ctx.arc(startPt.x, startPt.y, 5, 0, Math.PI * 2);
        this.ctx.fill();
        this.ctx.fillStyle = '#ffff00';
        this.ctx.beginPath();
        this.ctx.arc(endPt.x, endPt.y, 5, 0, Math.PI * 2);
        this.ctx.fill();
      }
    }

    this.ctx.restore();
    this.drawOption2Legend(canvasWidth, canvasHeight, 'Step 3: Canonical Dirty Ranges', [
      'Magenta = dirty canonical span',
      'Green = start, Yellow = end'
    ]);
  }

  private drawOptInvalidationOverlay(canvasWidth: number, canvasHeight: number): void {
    if (!this.carveOption2Debug || this.canonicalLoops.length === 0) return;
    const invalidations = this.carveOption2Debug.optInvalidations;
    if (invalidations.length === 0) {
      this.drawOption2Legend(canvasWidth, canvasHeight, 'Step 4: Opt Invalidation', [
        'No opt invalidations computed (missing optVertices?)'
      ]);
      return;
    }

    const invMap = new Map<number, Array<{ startOpt: number; endOpt: number }>>();
    for (const inv of invalidations) invMap.set(inv.loopId, inv.spans);

    const inAnySpan = (i: number, spans: Array<{ startOpt: number; endOpt: number }>, n: number): boolean => {
      if (n <= 0) return false;
      for (const s of spans) {
        const start = s.startOpt;
        const end = s.endOpt;
        if (start < 0 || end < 0) continue;
        if (start <= end) {
          if (start <= i && i <= end) return true;
        } else {
          // wrap span
          if (i >= start || i <= end) return true;
        }
      }
      return false;
    };

    this.ctx.save();
    this.ctx.globalAlpha = 1.0;

    for (const loop of this.canonicalLoops) {
      const inv = invMap.get(loop.id);
      const opt = loop.optVertices;
      if (!inv || inv.length === 0 || !opt || opt.length < 2) continue;
      const n = opt.length;

      // Draw edges colored by invalidation membership.
      // We require BOTH endpoints to be inside the span so the red polyline terminates
      // exactly at the start/end markers (which are vertex indices).
      for (let i = 0; i < n - 1; i++) {
        const a = opt[i];
        const b = opt[i + 1];
        const invalid = inAnySpan(i, inv, n) && inAnySpan(i + 1, inv, n);
        this.ctx.strokeStyle = invalid ? '#ff3333' : '#00ffff';
        this.ctx.lineWidth = invalid ? 4 : 2.5;
        this.ctx.globalAlpha = invalid ? 0.95 : 0.75;
        this.ctx.beginPath();
        const sa = this.camera.worldToScreen(a.x, a.y, canvasWidth, canvasHeight);
        const sb = this.camera.worldToScreen(b.x, b.y, canvasWidth, canvasHeight);
        this.ctx.moveTo(sa.x, sa.y);
        this.ctx.lineTo(sb.x, sb.y);
        this.ctx.stroke();
      }

      // Mark removal boundaries
      for (const span of inv) {
        const { startOpt, endOpt } = span;
        if (startOpt >= 0 && startOpt < n) {
          const v = opt[startOpt];
          const s = this.camera.worldToScreen(v.x, v.y, canvasWidth, canvasHeight);
          this.ctx.fillStyle = '#00ff00';
          this.ctx.beginPath();
          this.ctx.arc(s.x, s.y, 5, 0, Math.PI * 2);
          this.ctx.fill();
        }
        if (endOpt >= 0 && endOpt < n) {
          const v = opt[endOpt];
          const s = this.camera.worldToScreen(v.x, v.y, canvasWidth, canvasHeight);
          this.ctx.fillStyle = '#ffff00';
          this.ctx.beginPath();
          this.ctx.arc(s.x, s.y, 5, 0, Math.PI * 2);
          this.ctx.fill();
        }
      }
    }

    this.ctx.restore();
    this.drawOption2Legend(canvasWidth, canvasHeight, 'Step 4: Opt Invalidation', [
      'Cyan = reused opt vertices',
      'Red = invalidated span',
      'Green/Yellow = removal start/end'
    ]);
  }

  private drawLocalMsMatchOverlay(canvasWidth: number, canvasHeight: number): void {
    const data = this.localUpdateDebug;
    if (!data) {
      this.drawOption2Legend(canvasWidth, canvasHeight, 'Step 5a: MS Loops + Matching', [
        'No local-update session (stamp carve first)'
      ]);
      return;
    }

    this.ctx.save();

    // Draw cleaned MS loops (green)
    if (data.msCleanedLoops && data.msCleanedLoops.length > 0) {
      this.ctx.strokeStyle = '#00ff00';
      this.ctx.lineWidth = 3;
      this.ctx.globalAlpha = 0.9;
      for (const loop of data.msCleanedLoops) {
        if (loop.length < 2) continue;
        const first = this.camera.worldToScreen(loop[0].x, loop[0].y, canvasWidth, canvasHeight);
        this.ctx.beginPath();
        this.ctx.moveTo(first.x, first.y);
        for (let i = 1; i < loop.length; i++) {
          const s = this.camera.worldToScreen(loop[i].x, loop[i].y, canvasWidth, canvasHeight);
          this.ctx.lineTo(s.x, s.y);
        }
        this.ctx.stroke();
      }
    }

    // Draw affected old canonical loops (magenta)
    if (data.affectedCanonicalLoops && data.affectedCanonicalLoops.length > 0) {
      this.ctx.strokeStyle = '#ff00ff';
      this.ctx.lineWidth = 4;
      this.ctx.globalAlpha = 0.8;
      for (const loop of data.affectedCanonicalLoops) {
        if (loop.vertices.length < 2) continue;
        const first = this.camera.worldToScreen(loop.vertices[0].x, loop.vertices[0].y, canvasWidth, canvasHeight);
        this.ctx.beginPath();
        this.ctx.moveTo(first.x, first.y);
        for (let i = 1; i < loop.vertices.length; i++) {
          const s = this.camera.worldToScreen(loop.vertices[i].x, loop.vertices[i].y, canvasWidth, canvasHeight);
          this.ctx.lineTo(s.x, s.y);
        }
        this.ctx.stroke();
      }
    }

    // Draw match lines (white)
    if (data.matches && data.matches.length > 0) {
      this.ctx.strokeStyle = 'rgba(255,255,255,0.85)';
      this.ctx.lineWidth = 2;
      this.ctx.globalAlpha = 1.0;
      for (const m of data.matches) {
        if (!m.newCentroid) continue;
        const a = this.camera.worldToScreen(m.oldCentroid.x, m.oldCentroid.y, canvasWidth, canvasHeight);
        const b = this.camera.worldToScreen(m.newCentroid.x, m.newCentroid.y, canvasWidth, canvasHeight);
        this.ctx.beginPath();
        this.ctx.moveTo(a.x, a.y);
        this.ctx.lineTo(b.x, b.y);
        this.ctx.stroke();
      }
    }

    this.ctx.restore();

    this.drawOption2Legend(canvasWidth, canvasHeight, 'Step 5a: MS Loops + Matching', [
      'Green = cleaned MS loops (padded region)',
      'Magenta = affected canonical loops',
      'White lines = match old→new (centroids)'
    ]);
  }

  private drawLocalCanonSurgeryPreviewOverlay(canvasWidth: number, canvasHeight: number): void {
    const data = this.localUpdateDebug;
    if (!data || !data.surgeryPreview) {
      this.drawOption2Legend(canvasWidth, canvasHeight, 'Step 5b: Canon Surgery Preview', [
        'No surgery preview (advance from Step 5a)'
      ]);
      return;
    }

    this.ctx.save();

    // Old affected loops (faint red)
    if (data.affectedCanonicalLoops && data.affectedCanonicalLoops.length > 0) {
      this.ctx.strokeStyle = 'rgba(255,50,50,0.7)';
      this.ctx.lineWidth = 3;
      this.ctx.globalAlpha = 0.65;
      for (const loop of data.affectedCanonicalLoops) {
        if (loop.vertices.length < 2) continue;
        const first = this.camera.worldToScreen(loop.vertices[0].x, loop.vertices[0].y, canvasWidth, canvasHeight);
        this.ctx.beginPath();
        this.ctx.moveTo(first.x, first.y);
        for (let i = 1; i < loop.vertices.length; i++) {
          const s = this.camera.worldToScreen(loop.vertices[i].x, loop.vertices[i].y, canvasWidth, canvasHeight);
          this.ctx.lineTo(s.x, s.y);
        }
        this.ctx.stroke();
      }
    }

    // Replacement preview loops (green)
    this.ctx.strokeStyle = '#00ff00';
    this.ctx.lineWidth = 4;
    this.ctx.globalAlpha = 0.95;
    for (const loop of data.surgeryPreview.replacementLoops) {
      if (loop.vertices.length < 2) continue;
      const first = this.camera.worldToScreen(loop.vertices[0].x, loop.vertices[0].y, canvasWidth, canvasHeight);
      this.ctx.beginPath();
      this.ctx.moveTo(first.x, first.y);
      for (let i = 1; i < loop.vertices.length; i++) {
        const s = this.camera.worldToScreen(loop.vertices[i].x, loop.vertices[i].y, canvasWidth, canvasHeight);
        this.ctx.lineTo(s.x, s.y);
      }
      this.ctx.stroke();
    }

    this.ctx.restore();
    this.drawOption2Legend(canvasWidth, canvasHeight, 'Step 5b: Canon Surgery Preview', [
      'Green = canonical after surgery (preview)',
      'Red = current canonical (pre-commit)'
    ]);
  }

  private drawLocalCanonSurgeryCommitOverlay(canvasWidth: number, canvasHeight: number): void {
    const data = this.localUpdateDebug;
    if (!data || !data.surgeryCommit) {
      this.drawOption2Legend(canvasWidth, canvasHeight, 'Step 5c: Commit Canon Surgery', [
        'No commit info (advance from Step 5b)'
      ]);
      return;
    }

    const highlightIds = new Set(data.surgeryCommit.replacementLoopIds);

    this.ctx.save();
    this.ctx.strokeStyle = '#00ff00';
    this.ctx.lineWidth = 4;
    this.ctx.globalAlpha = 0.95;

    for (const loop of this.canonicalLoops) {
      if (!highlightIds.has(loop.id) || loop.vertices.length < 2) continue;
      const first = this.camera.worldToScreen(loop.vertices[0].x, loop.vertices[0].y, canvasWidth, canvasHeight);
      this.ctx.beginPath();
      this.ctx.moveTo(first.x, first.y);
      for (let i = 1; i < loop.vertices.length; i++) {
        const s = this.camera.worldToScreen(loop.vertices[i].x, loop.vertices[i].y, canvasWidth, canvasHeight);
        this.ctx.lineTo(s.x, s.y);
      }
      this.ctx.stroke();
    }

    this.ctx.restore();
    this.drawOption2Legend(canvasWidth, canvasHeight, 'Step 5c: Commit Canon Surgery', [
      'Canonical layer mutated',
      'Green highlight = replacement loops'
    ]);
  }

  private drawLocalOptAabbInvalidationOverlay(canvasWidth: number, canvasHeight: number): void {
    const data = this.localUpdateDebug;
    const inv = data?.optAabbInvalidation;
    if (!data || !inv) {
      this.drawOption2Legend(canvasWidth, canvasHeight, 'Step 5d: Opt Invalidation (AABB)', [
        'No opt invalidation info (advance from Step 5c)'
      ]);
      return;
    }

    const invMap = new Map<number, Array<{ startOpt: number; endOpt: number }>>();
    for (const entry of inv.invalidations) {
      invMap.set(entry.loopIndex, entry.spans);
    }

    const inAnySpan = (i: number, spans: Array<{ startOpt: number; endOpt: number }>, n: number): boolean => {
      if (n <= 0) return false;
      for (const s of spans) {
        const start = s.startOpt;
        const end = s.endOpt;
        if (start < 0 || end < 0) continue;
        if (start <= end) {
          if (start <= i && i <= end) return true;
        } else {
          // wrap span
          if (i >= start || i <= end) return true;
        }
      }
      return false;
    };

    this.ctx.save();
    this.ctx.globalAlpha = 1.0;

    for (let li = 0; li < inv.optLoops.length; li++) {
      const loop = inv.optLoops[li];
      if (loop.length < 2) continue;
      const spans = invMap.get(li) ?? [];
      const n = loop.length;

      for (let i = 0; i < n; i++) {
        const a = loop[i];
        const b = loop[(i + 1) % n];
        const next = (i + 1) % n;
        const invalid = spans.length > 0 && inAnySpan(i, spans, n) && inAnySpan(next, spans, n);
        this.ctx.strokeStyle = invalid ? '#ff3333' : '#00ffff';
        this.ctx.lineWidth = invalid ? 4 : 2.5;
        this.ctx.globalAlpha = invalid ? 0.95 : 0.75;
        const sa = this.camera.worldToScreen(a.x, a.y, canvasWidth, canvasHeight);
        const sb = this.camera.worldToScreen(b.x, b.y, canvasWidth, canvasHeight);
        this.ctx.beginPath();
        this.ctx.moveTo(sa.x, sa.y);
        this.ctx.lineTo(sb.x, sb.y);
        this.ctx.stroke();
      }

      // Mark span boundaries
      for (const span of spans) {
        const { startOpt, endOpt } = span;
        if (startOpt >= 0 && startOpt < n) {
          const v = loop[startOpt];
          const s = this.camera.worldToScreen(v.x, v.y, canvasWidth, canvasHeight);
          this.ctx.fillStyle = '#00ff00';
          this.ctx.beginPath();
          this.ctx.arc(s.x, s.y, 5, 0, Math.PI * 2);
          this.ctx.fill();
        }
        if (endOpt >= 0 && endOpt < n) {
          const v = loop[endOpt];
          const s = this.camera.worldToScreen(v.x, v.y, canvasWidth, canvasHeight);
          this.ctx.fillStyle = '#ffff00';
          this.ctx.beginPath();
          this.ctx.arc(s.x, s.y, 5, 0, Math.PI * 2);
          this.ctx.fill();
        }
      }
    }
    this.ctx.restore();

    this.drawOption2Legend(canvasWidth, canvasHeight, 'Step 5d: Opt Invalidation (AABB)', [
      'Cyan = reused opt edges',
      'Red = opt span touching padded region',
      'Green/Yellow = span start/end'
    ]);
  }

  private drawLocalOptRebuildOverlay(canvasWidth: number, canvasHeight: number): void {
    const data = this.localUpdateDebug;
    const rebuilt = data?.optRebuild?.rebuiltOptLoops;
    if (!data || !rebuilt) {
      this.drawOption2Legend(canvasWidth, canvasHeight, 'Step 5e: Opt Rebuild', [
        'No rebuilt opt loops (advance from Step 5d)'
      ]);
      return;
    }

    this.ctx.save();
    this.ctx.strokeStyle = '#00ff00';
    this.ctx.lineWidth = 3.5;
    this.ctx.globalAlpha = 0.95;
    for (const loop of rebuilt) {
      if (loop.length < 2) continue;
      const first = this.camera.worldToScreen(loop[0].x, loop[0].y, canvasWidth, canvasHeight);
      this.ctx.beginPath();
      this.ctx.moveTo(first.x, first.y);
      for (let i = 1; i < loop.length; i++) {
        const s = this.camera.worldToScreen(loop[i].x, loop[i].y, canvasWidth, canvasHeight);
        this.ctx.lineTo(s.x, s.y);
      }
      this.ctx.stroke();
    }
    this.ctx.restore();

    this.drawOption2Legend(canvasWidth, canvasHeight, 'Step 5e: Opt Rebuild', [
      'Green = rebuilt opt loops (for replacements)'
    ]);
  }

  private drawLocalOptSpliceOverlay(canvasWidth: number, canvasHeight: number): void {
    const data = this.localUpdateDebug;
    const spliced = data?.optSplice;
    if (!data || !spliced) {
      this.drawOption2Legend(canvasWidth, canvasHeight, 'Step 5f: Opt Splice + Validate', [
        'No splice info (advance from Step 5e)'
      ]);
      return;
    }

    this.ctx.save();
    this.ctx.strokeStyle = 'rgba(255,255,255,0.35)';
    this.ctx.lineWidth = 2;
    this.ctx.globalAlpha = 0.55;
    for (const loop of spliced.splicedOptLoops) {
      if (loop.length < 2) continue;
      const first = this.camera.worldToScreen(loop[0].x, loop[0].y, canvasWidth, canvasHeight);
      this.ctx.beginPath();
      this.ctx.moveTo(first.x, first.y);
      for (let i = 1; i < loop.length; i++) {
        const s = this.camera.worldToScreen(loop[i].x, loop[i].y, canvasWidth, canvasHeight);
        this.ctx.lineTo(s.x, s.y);
      }
      this.ctx.stroke();
    }
    this.ctx.restore();

    this.drawOption2Legend(canvasWidth, canvasHeight, 'Step 5f: Opt Splice + Validate', [
      `Opt sets: base=${spliced.keptCount}, rebuiltInputs=${spliced.rebuiltCount}`
    ]);
  }

  private drawLocalPhysicsPlanOverlay(canvasWidth: number, canvasHeight: number): void {
    const data = this.localUpdateDebug;
    const plan = data?.physicsPlan;
    if (!data || !plan) {
      this.drawOption2Legend(canvasWidth, canvasHeight, 'Step 5g: Physics Plan', [
        'No physics plan (advance from Step 5f)'
      ]);
      return;
    }

    this.drawOption2Legend(canvasWidth, canvasHeight, 'Step 5g: Physics Plan', [
      `Bodies in region: ${plan.affectedBodyCount}`,
      `Loops to add: ${plan.loopsToAdd}`,
      'Next step removes bodies in AABB and adds replacements'
    ]);
  }

  private drawLocalPhysicsApplyOverlay(canvasWidth: number, canvasHeight: number): void {
    const data = this.localUpdateDebug;
    const applied = data?.physicsApply;
    if (!data || !applied) {
      this.drawOption2Legend(canvasWidth, canvasHeight, 'Step 5h: Apply Physics', [
        'No apply result (advance from Step 5g)'
      ]);
      return;
    }

    this.drawOption2Legend(canvasWidth, canvasHeight, 'Step 5h: Apply Physics', [
      `Removed bodies: ${applied.removedBodyCount}`,
      `Added loops: ${applied.loopsAdded}`,
      'Dirty region cleared; segment debug available next'
    ]);
  }
}
