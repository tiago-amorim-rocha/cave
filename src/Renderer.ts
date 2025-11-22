import type { Camera } from './Camera';
import type { Vec2 } from './types';
import type { DensityField } from './DensityField';
import type { CanonicalLoop, OptVertex, PhysicsSegment } from './terrain/CanonicalGeometry';

/**
 * Ball rendering data
 */
export interface BallRenderData {
  position: { x: number; y: number };
  circleRadius: number;
}

/**
 * Spider segment rendering data
 */
export interface SpiderSegmentData {
  x: number;
  y: number;
  rotation: number; // radians
  length: number;
  width: number;
}

/**
 * Spider rendering data
 */
export interface SpiderRenderData {
  body: {
    x: number;
    y: number;
    rotation: number; // radians
    width: number;
    height: number;
  };
  leftLeg: {
    hip: SpiderSegmentData;
    knee: SpiderSegmentData;
    ankle: SpiderSegmentData;
    foot: { x: number; y: number };
  };
  rightLeg: {
    hip: SpiderSegmentData;
    knee: SpiderSegmentData;
    ankle: SpiderSegmentData;
    foot: { x: number; y: number };
  };
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

  // Loop patching debug info
  private loopPatchDebugInfo: Array<{
    originalLoop: Vec2[];
    oldArc: Vec2[];
    newArc: Vec2[];
    patchedLoop: Vec2[];
    beforePart: Vec2[];
    afterPart: Vec2[];
    dirtyAABB: { minX: number; minY: number; maxX: number; maxY: number };
  }> = [];
  private lastPatchLogTime: number = 0;

  public showGrid: boolean = false;
  public showDensityField: boolean = false;
  public showVertices: boolean = false; // Show optimized vertices
  public showOriginalVertices: boolean = false; // Show original vertices (before optimization)
  public showCanonicalVertices: boolean = false; // Show canonical vertices (cleaned marching squares)
  public showCanonicalAABBs: boolean = false; // Show canonical loop AABBs
  public showSegmentDebug: boolean = false; // Show physics segment boundaries/ranges
  public showPhysicsBodies: boolean = false; // Disabled for performance testing
  public showLoopNumbers: boolean = false; // Disabled for performance testing
  public showSamplePoints: boolean = false; // Disabled for performance testing
  public showDirtyAABB: boolean = true; // Enabled by default for local update debugging
  public showRebuiltChains: boolean = true; // Enabled by default for local update debugging
  public showLoopPatching: boolean = false; // Legacy loop patching debug visualization (disabled by default)
  private debugHoverWorld: { x: number; y: number } | null = null; // For hover labels

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
   * Update polylines to render (replaces all polylines)
   */
  updatePolylines(polylines: Vec2[][]): void {
    this.polylines = polylines;
    this.polylineAABBs = polylines.map(p => this.computePolylineAABB(p));
    console.log(`[Renderer] updatePolylines: ${polylines.length} polylines`);
    if (polylines.length === 0) {
      console.warn('[Renderer] updatePolylines received empty array');
    } else {
      console.log(`[Renderer] first polyline length=${polylines[0].length}`);
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
    this.loopPatchDebugInfo = [];
  }

  /**
   * Set loop patch debug info for visualization
   */
  setLoopPatchDebugInfo(info: Array<{
    originalLoop: Vec2[];
    oldArc: Vec2[];
    newArc: Vec2[];
    patchedLoop: Vec2[];
    beforePart: Vec2[];
    afterPart: Vec2[];
    dirtyAABB: { minX: number; minY: number; maxX: number; maxY: number };
  }>): void {
    this.loopPatchDebugInfo = info;
  }

  /**
   * Render the scene
   * @param playerPosition - Optional player position to render
   * @param playerRadius - Optional player radius
   * @param balls - Optional array of ball bodies to render
   * @param physicsDebugDraw - Optional callback to draw physics debug
   * @param playerDebugDraw - Optional callback to draw player debug info
   * @param joystickDraw - Optional callback to draw virtual joystick
   * @param spider - Optional spider rendering data
   * @param playerDirection - Optional player direction in radians (for rendering direction indicator)
   */
  render(
    playerPosition?: { x: number; y: number },
    playerRadius?: number,
    balls?: BallRenderData[],
    physicsDebugDraw?: (ctx: CanvasRenderingContext2D, width: number, height: number) => void,
    playerDebugDraw?: (ctx: CanvasRenderingContext2D, width: number, height: number) => void,
    joystickDraw?: (ctx: CanvasRenderingContext2D) => void,
    spider?: SpiderRenderData,
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

      // Draw physics bodies (debugging) - use custom debug draw
      if (this.showPhysicsBodies && physicsDebugDraw) {
        physicsDebugDraw(this.ctx, width, height);
      }

      // Draw player
      if (playerPosition && playerRadius) {
        this.drawPlayer(width, height, playerPosition, playerRadius, playerDirection);
      }

      // Draw spider
      if (spider) {
        this.drawSpider(width, height, spider);
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

      // Draw loop patching debug visualization
      if (this.showLoopPatching && this.loopPatchDebugInfo.length > 0) {
        this.drawLoopPatching(width, height);
      }

      // Draw physics segment debug
      if (this.showSegmentDebug && this.segmentDebugData.length > 0) {
        this.drawSegmentDebug(width, height);
      }

      // Draw player debug info (velocity, grounded state, etc.)
      if (playerDebugDraw) {
        playerDebugDraw(this.ctx, width, height);
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
   * Draw spider controller with Canvas2D
   */
  private drawSpider(canvasWidth: number, canvasHeight: number, spider: SpiderRenderData): void {
    this.ctx.save();

    // Draw main body (1m × 1m square)
    const bodyScreen = this.camera.worldToScreen(spider.body.x, spider.body.y, canvasWidth, canvasHeight);
    const bodyWidthScreen = spider.body.width * this.camera.zoom;
    const bodyHeightScreen = spider.body.height * this.camera.zoom;

    this.ctx.translate(bodyScreen.x, bodyScreen.y);
    this.ctx.rotate(spider.body.rotation);

    // Body fill (dark red-purple from palette)
    this.ctx.fillStyle = '#665779';
    this.ctx.fillRect(-bodyWidthScreen / 2, -bodyHeightScreen / 2, bodyWidthScreen, bodyHeightScreen);

    // Body outline (medium purple)
    this.ctx.strokeStyle = '#9c7fa3';
    this.ctx.lineWidth = 2;
    this.ctx.strokeRect(-bodyWidthScreen / 2, -bodyHeightScreen / 2, bodyWidthScreen, bodyHeightScreen);

    this.ctx.restore();

    // Draw left leg
    this.drawLeg(canvasWidth, canvasHeight, spider.leftLeg.hip, spider.leftLeg.knee, spider.leftLeg.ankle, spider.leftLeg.foot);

    // Draw right leg
    this.drawLeg(canvasWidth, canvasHeight, spider.rightLeg.hip, spider.rightLeg.knee, spider.rightLeg.ankle, spider.rightLeg.foot);
  }

  /**
   * Draw a single leg (hip → knee → ankle → foot)
   */
  private drawLeg(
    canvasWidth: number,
    canvasHeight: number,
    hip: SpiderSegmentData,
    knee: SpiderSegmentData,
    ankle: SpiderSegmentData,
    foot: { x: number; y: number }
  ): void {
    // Draw hip segment
    this.drawSegment(canvasWidth, canvasHeight, hip);

    // Draw knee segment
    this.drawSegment(canvasWidth, canvasHeight, knee);

    // Draw ankle segment
    this.drawSegment(canvasWidth, canvasHeight, ankle);

    // Draw joint at distal end of ankle (ankle-to-foot connection)
    this.ctx.save();
    const ankleScreen = this.camera.worldToScreen(ankle.x, ankle.y, canvasWidth, canvasHeight);
    const lengthScreen = ankle.length * this.camera.zoom;
    const widthScreen = ankle.width * this.camera.zoom;

    this.ctx.translate(ankleScreen.x, ankleScreen.y);
    this.ctx.rotate(ankle.rotation);

    this.ctx.fillStyle = '#665779';
    this.ctx.beginPath();
    this.ctx.arc(lengthScreen / 2, 0, widthScreen / 2 * 1.2, 0, Math.PI * 2);
    this.ctx.fill();
    this.ctx.restore();

    // Draw foot (small circle)
    const footScreen = this.camera.worldToScreen(foot.x, foot.y, canvasWidth, canvasHeight);
    const footRadius = 0.1 * this.camera.zoom; // 0.2m diameter foot

    this.ctx.save();
    this.ctx.fillStyle = '#a2babc'; // Light blue-gray from palette
    this.ctx.beginPath();
    this.ctx.arc(footScreen.x, footScreen.y, footRadius, 0, Math.PI * 2);
    this.ctx.fill();

    this.ctx.strokeStyle = '#9c7fa3';
    this.ctx.lineWidth = 1;
    this.ctx.stroke();
    this.ctx.restore();
  }

  /**
   * Draw a single leg segment (rectangle rotated around pivot point)
   * Segments are centered at their pivot (Box2D body center)
   */
  private drawSegment(canvasWidth: number, canvasHeight: number, segment: SpiderSegmentData): void {
    this.ctx.save();

    const screen = this.camera.worldToScreen(segment.x, segment.y, canvasWidth, canvasHeight);
    const lengthScreen = segment.length * this.camera.zoom;
    const widthScreen = segment.width * this.camera.zoom;

    this.ctx.translate(screen.x, screen.y);
    this.ctx.rotate(segment.rotation);

    // Segment fill (light cream from palette, slightly darker)
    // Draw centered at pivot (Box2D body center is at segment center)
    this.ctx.fillStyle = '#e6d5b8';
    this.ctx.fillRect(-lengthScreen / 2, -widthScreen / 2, lengthScreen, widthScreen);

    // Segment outline (medium purple)
    this.ctx.strokeStyle = '#9c7fa3';
    this.ctx.lineWidth = 1.5;
    this.ctx.strokeRect(-lengthScreen / 2, -widthScreen / 2, lengthScreen, widthScreen);

    // Draw joint marker at proximal end (start of segment)
    this.ctx.fillStyle = '#665779';
    this.ctx.beginPath();
    this.ctx.arc(-lengthScreen / 2, 0, widthScreen / 2 * 1.2, 0, Math.PI * 2);
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
        const maxCanon = loop.reduce((m, v) => Math.max(m, v.canonEnd), 1);
        for (let i = 0; i < loop.length; i++) {
          const v = loop[i];
          const screen = this.camera.worldToScreen(v.x, v.y, canvasWidth, canvasHeight);
          const mid = (v.canonStart + v.canonEnd) * 0.5;
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
              this.ctx.fillText(`${v.canonStart}-${v.canonEnd}`, screen.x + 6, screen.y);
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
    this.ctx.fillStyle = '#ff3333';

    for (const loop of this.canonicalLoops) {
      for (const vertex of loop.vertices) {
        const screen = this.camera.worldToScreen(vertex.x, vertex.y, canvasWidth, canvasHeight);
        this.ctx.beginPath();
        this.ctx.arc(screen.x, screen.y, 2, 0, Math.PI * 2);
        this.ctx.fill();
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

  /**
   * Draw loop patching debug visualization
   * Shows:
   * - Original loop (gray)
   * - Old arc being replaced (red)
   * - New arc from marching squares (green)
   * - Patched loop (cyan)
   * - Dirty AABB (yellow box)
   */
  private drawLoopPatching(canvasWidth: number, canvasHeight: number): void {
    if (this.loopPatchDebugInfo.length === 0) {
      return;
    }

    // Only log once per second to avoid spam
    const now = Date.now();
    if (!this.lastPatchLogTime || now - this.lastPatchLogTime > 1000) {
      console.log(`[Renderer] Drawing ${this.loopPatchDebugInfo.length} loop patch debug infos`);
      this.lastPatchLogTime = now;
    }

    this.ctx.save();

    for (const patchInfo of this.loopPatchDebugInfo) {
      // 1. Draw dirty AABB (yellow dashed box)
      const topLeft = this.camera.worldToScreen(patchInfo.dirtyAABB.minX, patchInfo.dirtyAABB.minY, canvasWidth, canvasHeight);
      const bottomRight = this.camera.worldToScreen(patchInfo.dirtyAABB.maxX, patchInfo.dirtyAABB.maxY, canvasWidth, canvasHeight);
      const rectWidth = bottomRight.x - topLeft.x;
      const rectHeight = bottomRight.y - topLeft.y;

      this.ctx.strokeStyle = '#ffff00'; // Yellow
      this.ctx.lineWidth = 2;
      this.ctx.setLineDash([8, 4]);
      this.ctx.strokeRect(topLeft.x, topLeft.y, rectWidth, rectHeight);
      this.ctx.setLineDash([]);

      // 2. Draw original loop (gray, thin, semi-transparent) - FULL original for reference
      if (patchInfo.originalLoop.length > 2) {
        this.ctx.strokeStyle = 'rgba(128, 128, 128, 0.3)'; // Gray, very subtle
        this.ctx.lineWidth = 1;
        this.ctx.beginPath();
        const first = this.camera.worldToScreen(patchInfo.originalLoop[0].x, patchInfo.originalLoop[0].y, canvasWidth, canvasHeight);
        this.ctx.moveTo(first.x, first.y);
        for (let i = 1; i < patchInfo.originalLoop.length; i++) {
          const screen = this.camera.worldToScreen(patchInfo.originalLoop[i].x, patchInfo.originalLoop[i].y, canvasWidth, canvasHeight);
          this.ctx.lineTo(screen.x, screen.y);
        }
        this.ctx.closePath();
        this.ctx.stroke();
      }

      // 2b. Draw KEPT parts of the loop (before and after) in BLUE - these are unchanged
      // This clearly shows which vertices are being preserved
      if (patchInfo.beforePart.length > 1) {
        this.ctx.strokeStyle = '#4488ff'; // Bright blue
        this.ctx.lineWidth = 4;
        this.ctx.globalAlpha = 0.9;
        this.ctx.beginPath();
        const first = this.camera.worldToScreen(patchInfo.beforePart[0].x, patchInfo.beforePart[0].y, canvasWidth, canvasHeight);
        this.ctx.moveTo(first.x, first.y);
        for (let i = 1; i < patchInfo.beforePart.length; i++) {
          const screen = this.camera.worldToScreen(patchInfo.beforePart[i].x, patchInfo.beforePart[i].y, canvasWidth, canvasHeight);
          this.ctx.lineTo(screen.x, screen.y);
        }
        this.ctx.stroke();
        this.ctx.globalAlpha = 1.0;

        // Draw vertices as blue dots
        for (const vertex of patchInfo.beforePart) {
          const screen = this.camera.worldToScreen(vertex.x, vertex.y, canvasWidth, canvasHeight);
          this.ctx.fillStyle = '#4488ff';
          this.ctx.beginPath();
          this.ctx.arc(screen.x, screen.y, 3, 0, Math.PI * 2);
          this.ctx.fill();
        }
      }

      if (patchInfo.afterPart.length > 1) {
        this.ctx.strokeStyle = '#4488ff'; // Bright blue
        this.ctx.lineWidth = 4;
        this.ctx.globalAlpha = 0.9;
        this.ctx.beginPath();
        const first = this.camera.worldToScreen(patchInfo.afterPart[0].x, patchInfo.afterPart[0].y, canvasWidth, canvasHeight);
        this.ctx.moveTo(first.x, first.y);
        for (let i = 1; i < patchInfo.afterPart.length; i++) {
          const screen = this.camera.worldToScreen(patchInfo.afterPart[i].x, patchInfo.afterPart[i].y, canvasWidth, canvasHeight);
          this.ctx.lineTo(screen.x, screen.y);
        }
        this.ctx.stroke();
        this.ctx.globalAlpha = 1.0;

        // Draw vertices as blue dots
        for (const vertex of patchInfo.afterPart) {
          const screen = this.camera.worldToScreen(vertex.x, vertex.y, canvasWidth, canvasHeight);
          this.ctx.fillStyle = '#4488ff';
          this.ctx.beginPath();
          this.ctx.arc(screen.x, screen.y, 3, 0, Math.PI * 2);
          this.ctx.fill();
        }
      }

      // 3. Draw old arc being replaced (red, thick)
      if (patchInfo.oldArc.length > 1) {
        this.ctx.strokeStyle = '#ff0000'; // Red
        this.ctx.lineWidth = 5;
        this.ctx.globalAlpha = 0.8;
        this.ctx.beginPath();
        const first = this.camera.worldToScreen(patchInfo.oldArc[0].x, patchInfo.oldArc[0].y, canvasWidth, canvasHeight);
        this.ctx.moveTo(first.x, first.y);
        for (let i = 1; i < patchInfo.oldArc.length; i++) {
          const screen = this.camera.worldToScreen(patchInfo.oldArc[i].x, patchInfo.oldArc[i].y, canvasWidth, canvasHeight);
          this.ctx.lineTo(screen.x, screen.y);
        }
        this.ctx.stroke();
        this.ctx.globalAlpha = 1.0;

        // Draw vertices as red dots
        for (const vertex of patchInfo.oldArc) {
          const screen = this.camera.worldToScreen(vertex.x, vertex.y, canvasWidth, canvasHeight);
          this.ctx.fillStyle = '#ff0000';
          this.ctx.beginPath();
          this.ctx.arc(screen.x, screen.y, 4, 0, Math.PI * 2);
          this.ctx.fill();
        }
      }

      // 4. Draw new arc from marching squares (green, thick)
      if (patchInfo.newArc.length > 1) {
        this.ctx.strokeStyle = '#00ff00'; // Green
        this.ctx.lineWidth = 5;
        this.ctx.globalAlpha = 0.8;
        this.ctx.beginPath();
        const first = this.camera.worldToScreen(patchInfo.newArc[0].x, patchInfo.newArc[0].y, canvasWidth, canvasHeight);
        this.ctx.moveTo(first.x, first.y);
        for (let i = 1; i < patchInfo.newArc.length; i++) {
          const screen = this.camera.worldToScreen(patchInfo.newArc[i].x, patchInfo.newArc[i].y, canvasWidth, canvasHeight);
          this.ctx.lineTo(screen.x, screen.y);
        }
        this.ctx.stroke();
        this.ctx.globalAlpha = 1.0;

        // Draw vertices as green dots
        for (const vertex of patchInfo.newArc) {
          const screen = this.camera.worldToScreen(vertex.x, vertex.y, canvasWidth, canvasHeight);
          this.ctx.fillStyle = '#00ff00';
          this.ctx.beginPath();
          this.ctx.arc(screen.x, screen.y, 4, 0, Math.PI * 2);
          this.ctx.fill();
        }
      }

      // 5. Draw patched loop (cyan, medium thickness)
      if (patchInfo.patchedLoop.length > 2) {
        this.ctx.strokeStyle = '#00ffff'; // Cyan
        this.ctx.lineWidth = 3;
        this.ctx.globalAlpha = 0.6;
        this.ctx.beginPath();
        const first = this.camera.worldToScreen(patchInfo.patchedLoop[0].x, patchInfo.patchedLoop[0].y, canvasWidth, canvasHeight);
        this.ctx.moveTo(first.x, first.y);
        for (let i = 1; i < patchInfo.patchedLoop.length; i++) {
          const screen = this.camera.worldToScreen(patchInfo.patchedLoop[i].x, patchInfo.patchedLoop[i].y, canvasWidth, canvasHeight);
          this.ctx.lineTo(screen.x, screen.y);
        }
        this.ctx.closePath();
        this.ctx.stroke();
        this.ctx.globalAlpha = 1.0;
      }

      // 6. Highlight connection points (where new arc joins unchanged loop)
      // These are critical for understanding the stitching process
      if (patchInfo.newArc.length > 0) {
        // Connection point 1: Start of new arc (connects to "before" part)
        const startPoint = patchInfo.newArc[0];
        const startScreen = this.camera.worldToScreen(startPoint.x, startPoint.y, canvasWidth, canvasHeight);

        // Draw outer ring (white)
        this.ctx.strokeStyle = '#ffffff';
        this.ctx.lineWidth = 3;
        this.ctx.beginPath();
        this.ctx.arc(startScreen.x, startScreen.y, 10, 0, Math.PI * 2);
        this.ctx.stroke();

        // Draw inner circle (magenta)
        this.ctx.fillStyle = '#ff00ff';
        this.ctx.beginPath();
        this.ctx.arc(startScreen.x, startScreen.y, 7, 0, Math.PI * 2);
        this.ctx.fill();

        // Connection point 2: End of new arc (connects to "after" part)
        const endPoint = patchInfo.newArc[patchInfo.newArc.length - 1];
        const endScreen = this.camera.worldToScreen(endPoint.x, endPoint.y, canvasWidth, canvasHeight);

        // Draw outer ring (white)
        this.ctx.strokeStyle = '#ffffff';
        this.ctx.lineWidth = 3;
        this.ctx.beginPath();
        this.ctx.arc(endScreen.x, endScreen.y, 10, 0, Math.PI * 2);
        this.ctx.stroke();

        // Draw inner circle (orange)
        this.ctx.fillStyle = '#ff8800';
        this.ctx.beginPath();
        this.ctx.arc(endScreen.x, endScreen.y, 7, 0, Math.PI * 2);
        this.ctx.fill();
      }

      // 7. Draw legend in top-left of dirty AABB
      const legendX = topLeft.x + 10;
      const legendY = topLeft.y + 10;
      this.ctx.font = 'bold 12px monospace';
      this.ctx.fillStyle = '#ffffff';
      this.ctx.strokeStyle = '#000000';
      this.ctx.lineWidth = 3;

      const legendItems = [
        { color: '#4488ff', text: 'KEPT (unchanged)' },
        { color: '#ff0000', text: 'OLD Arc (replaced)' },
        { color: '#00ff00', text: 'NEW Arc (from MS)' },
        { color: '#ff00ff', text: 'Start Stitch' },
        { color: '#ff8800', text: 'End Stitch' },
      ];

      let yOffset = 0;
      for (const item of legendItems) {
        // Background
        this.ctx.fillStyle = 'rgba(0, 0, 0, 0.7)';
        this.ctx.fillRect(legendX - 5, legendY + yOffset - 12, 180, 18);

        // Color swatch
        this.ctx.fillStyle = item.color;
        this.ctx.fillRect(legendX, legendY + yOffset - 8, 20, 10);

        // Text
        this.ctx.strokeText(item.text, legendX + 25, legendY + yOffset);
        this.ctx.fillStyle = '#ffffff';
        this.ctx.fillText(item.text, legendX + 25, legendY + yOffset);

        yOffset += 20;
      }
    }

    this.ctx.restore();
  }

  /**
   * Draw density field as grayscale image
   */
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

    // Very subtle grid color - slightly darker than cave background '#fff8e3'
    this.ctx.strokeStyle = '#ede5d0';
    this.ctx.lineWidth = 0.5;
    this.ctx.globalAlpha = 0.6; // Additional subtlety

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
}
