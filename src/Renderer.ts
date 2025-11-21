import type { Camera } from './Camera';
import type { Vec2 } from './types';
import type { DensityField } from './DensityField';

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
  private originalPolylines: Vec2[][] = []; // Store original vertices before optimization
  private densityField: DensityField | null = null;
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
    dirtyAABB: { minX: number; minY: number; maxX: number; maxY: number };
  }> = [];

  public showGrid: boolean = false;
  public showDensityField: boolean = false;
  public showVertices: boolean = false; // Show optimized vertices
  public showOriginalVertices: boolean = false; // Show original vertices (before optimization)
  public showPhysicsBodies: boolean = false; // Disabled for performance testing
  public showLoopNumbers: boolean = false; // Disabled for performance testing
  public showSamplePoints: boolean = false; // Disabled for performance testing
  public showDirtyAABB: boolean = false; // Disabled for performance testing
  public showRebuiltChains: boolean = false; // Disabled for performance testing
  public showLoopPatching: boolean = false; // Show loop patching debug visualization

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
   * Update polylines to render
   */
  updatePolylines(polylines: Vec2[][]): void {
    this.polylines = polylines;
  }

  /**
   * Update original (unoptimized) polylines for debug visualization
   */
  updateOriginalPolylines(polylines: Vec2[][]): void {
    this.originalPolylines = polylines;
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

    // Draw each rebuilt chain with bright cyan color
    this.ctx.strokeStyle = '#00ffff'; // Bright cyan
    this.ctx.lineWidth = 4; // Thicker than normal
    this.ctx.globalAlpha = 0.8;

    for (const chain of this.rebuiltChains) {
      if (chain.length < 2) continue;

      this.ctx.beginPath();
      const first = this.camera.worldToScreen(chain[0].x, chain[0].y, canvasWidth, canvasHeight);
      this.ctx.moveTo(first.x, first.y);

      for (let i = 1; i < chain.length; i++) {
        const screen = this.camera.worldToScreen(chain[i].x, chain[i].y, canvasWidth, canvasHeight);
        this.ctx.lineTo(screen.x, screen.y);
      }

      this.ctx.stroke();

      // Draw vertices as small circles
      for (const vertex of chain) {
        const screen = this.camera.worldToScreen(vertex.x, vertex.y, canvasWidth, canvasHeight);
        this.ctx.fillStyle = '#00ffff';
        this.ctx.beginPath();
        this.ctx.arc(screen.x, screen.y, 3, 0, Math.PI * 2);
        this.ctx.fill();
      }
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
    if (this.loopPatchDebugInfo.length === 0) return;

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

      // 2. Draw original loop (gray, thin, semi-transparent)
      if (patchInfo.originalLoop.length > 2) {
        this.ctx.strokeStyle = 'rgba(128, 128, 128, 0.4)'; // Gray
        this.ctx.lineWidth = 2;
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

      // 6. Draw legend in top-left of dirty AABB
      const legendX = topLeft.x + 10;
      const legendY = topLeft.y + 10;
      this.ctx.font = 'bold 12px monospace';
      this.ctx.fillStyle = '#ffffff';
      this.ctx.strokeStyle = '#000000';
      this.ctx.lineWidth = 3;

      const legendItems = [
        { color: 'rgba(128, 128, 128, 0.8)', text: 'Original Loop' },
        { color: '#ff0000', text: 'Old Arc (replaced)' },
        { color: '#00ff00', text: 'New Arc (from MS)' },
        { color: '#00ffff', text: 'Patched Loop' },
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
