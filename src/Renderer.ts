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
 * Canvas2D renderer with device-pixel-ratio awareness
 */
export class Renderer {
  private canvas: HTMLCanvasElement;
  private ctx: CanvasRenderingContext2D;
  private camera: Camera;

  private polylines: Vec2[][] = [];
  private originalPolylines: Vec2[][] = []; // Store original vertices before optimization
  private densityField: DensityField | null = null;
  public showGrid: boolean = false;
  public showDensityField: boolean = false;
  public showVertices: boolean = false; // Show optimized vertices
  public showOriginalVertices: boolean = false; // Show original vertices (before optimization)
  public showPhysicsBodies: boolean = false;

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
    console.log(`[Canvas] ${width}x${height} (${orientation}, DPR=${dpr}, buffer=${width * dpr}x${height * dpr})`);

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
   * Render the scene
   * @param playerPosition - Optional player position to render
   * @param playerRadius - Optional player radius
   * @param balls - Optional array of ball bodies to render
   * @param physicsDebugDraw - Optional callback to draw physics debug
   * @param playerDebugDraw - Optional callback to draw player debug info
   * @param joystickDraw - Optional callback to draw virtual joystick
   */
  render(
    playerPosition?: { x: number; y: number },
    playerRadius?: number,
    balls?: BallRenderData[],
    physicsDebugDraw?: (ctx: CanvasRenderingContext2D, width: number, height: number) => void,
    playerDebugDraw?: (ctx: CanvasRenderingContext2D, width: number, height: number) => void,
    joystickDraw?: (ctx: CanvasRenderingContext2D) => void
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
        this.drawPlayer(width, height, playerPosition, playerRadius);
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

      // Draw player debug info (velocity, grounded state, etc.)
      if (playerDebugDraw) {
        playerDebugDraw(this.ctx, width, height);
      }

      // Draw virtual joystick (always on top, in screen coordinates)
      if (joystickDraw) {
        joystickDraw(this.ctx);
      }
    } catch (error) {
      console.error('Error during render:', error);
    }
  }

  /**
   * Draw the player (as capsule)
   */
  private drawPlayer(canvasWidth: number, canvasHeight: number, position: { x: number; y: number }, radius: number): void {
    const screen = this.camera.worldToScreen(position.x, position.y, canvasWidth, canvasHeight);
    const screenRadius = radius * this.camera.zoom;

    // Capsule parameters (matching physics collider)
    const halfHeight = 0.6; // m
    const screenHalfHeight = halfHeight * this.camera.zoom;

    this.ctx.save();

    // Draw player body as capsule (two circles + rectangle) - light cyan
    this.ctx.fillStyle = '#bfeae6';

    // Top circle
    this.ctx.beginPath();
    this.ctx.arc(screen.x, screen.y - screenHalfHeight, screenRadius, 0, Math.PI * 2);
    this.ctx.fill();

    // Bottom circle
    this.ctx.beginPath();
    this.ctx.arc(screen.x, screen.y + screenHalfHeight, screenRadius, 0, Math.PI * 2);
    this.ctx.fill();

    // Middle rectangle
    this.ctx.fillRect(
      screen.x - screenRadius,
      screen.y - screenHalfHeight,
      screenRadius * 2,
      screenHalfHeight * 2
    );

    // Draw outline (medium purple)
    this.ctx.strokeStyle = '#9c7fa3';
    this.ctx.lineWidth = 2;

    // Left edge
    this.ctx.beginPath();
    this.ctx.moveTo(screen.x - screenRadius, screen.y - screenHalfHeight);
    this.ctx.lineTo(screen.x - screenRadius, screen.y + screenHalfHeight);
    this.ctx.stroke();

    // Right edge
    this.ctx.beginPath();
    this.ctx.moveTo(screen.x + screenRadius, screen.y - screenHalfHeight);
    this.ctx.lineTo(screen.x + screenRadius, screen.y + screenHalfHeight);
    this.ctx.stroke();

    // Top arc
    this.ctx.beginPath();
    this.ctx.arc(screen.x, screen.y - screenHalfHeight, screenRadius, Math.PI, 0);
    this.ctx.stroke();

    // Bottom arc
    this.ctx.beginPath();
    this.ctx.arc(screen.x, screen.y + screenHalfHeight, screenRadius, 0, Math.PI);
    this.ctx.stroke();

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
}
