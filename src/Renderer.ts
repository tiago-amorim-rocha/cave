import type { Camera } from './Camera';
import type { Vec2 } from './types';

/**
 * Canvas2D renderer with device-pixel-ratio awareness
 */
export class Renderer {
  private canvas: HTMLCanvasElement;
  private ctx: CanvasRenderingContext2D;
  private camera: Camera;

  private polylines: Vec2[][] = [];
  private originalPolylines: Vec2[][] = []; // Store original vertices before optimization
  public showGrid: boolean = false;
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
   * Render the scene
   * @param playerPosition - Optional player position to render
   * @param playerRadius - Optional player radius
   * @param balls - Optional array of ball bodies to render
   * @param physicsDebugDraw - Optional callback to draw physics debug
   */
  render(
    playerPosition?: { x: number; y: number },
    playerRadius?: number,
    balls?: any[],
    physicsDebugDraw?: (ctx: CanvasRenderingContext2D, width: number, height: number) => void
  ): void {
    try {
      const dpr = window.devicePixelRatio || 1;
      const width = this.canvas.width / dpr;
      const height = this.canvas.height / dpr;

      // Clear canvas
      this.ctx.fillStyle = '#1a1a1a';
      this.ctx.fillRect(0, 0, width, height);

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
    } catch (error) {
      console.error('Error during render:', error);
    }
  }

  /**
   * Draw the player
   */
  private drawPlayer(canvasWidth: number, canvasHeight: number, position: { x: number; y: number }, radius: number): void {
    const screen = this.camera.worldToScreen(position.x, position.y, canvasWidth, canvasHeight);
    const screenRadius = radius * this.camera.zoom;

    this.ctx.save();

    // Draw player body (circle)
    this.ctx.fillStyle = '#4a9eff';
    this.ctx.beginPath();
    this.ctx.arc(screen.x, screen.y, screenRadius, 0, Math.PI * 2);
    this.ctx.fill();

    // Draw player outline
    this.ctx.strokeStyle = '#2e5f99';
    this.ctx.lineWidth = 2;
    this.ctx.stroke();

    this.ctx.restore();
  }

  /**
   * Draw test balls
   */
  private drawBalls(canvasWidth: number, canvasHeight: number, balls: any[]): void {
    this.ctx.save();

    for (const ball of balls) {
      const screen = this.camera.worldToScreen(ball.position.x, ball.position.y, canvasWidth, canvasHeight);
      const screenRadius = ball.circleRadius * this.camera.zoom;

      // Draw ball body (orange/yellow)
      this.ctx.fillStyle = '#ff9800';
      this.ctx.beginPath();
      this.ctx.arc(screen.x, screen.y, screenRadius, 0, Math.PI * 2);
      this.ctx.fill();

      // Draw ball outline
      this.ctx.strokeStyle = '#e65100';
      this.ctx.lineWidth = 1;
      this.ctx.stroke();
    }

    this.ctx.restore();
  }

  /**
   * Draw physics bodies as wireframes (debug mode)
   */
  private drawPhysicsBodies(canvasWidth: number, canvasHeight: number, bodies: any[]): void {
    this.ctx.save();

    this.ctx.strokeStyle = '#00ff00'; // Bright green for physics bodies
    this.ctx.lineWidth = 2;
    this.ctx.setLineDash([5, 5]); // Dashed line

    for (const body of bodies) {
      // Skip non-static bodies (player, balls)
      if (!body.isStatic) continue;

      // Draw each part of the body
      if (body.parts && body.parts.length > 1) {
        // Compound body - draw each part
        for (let i = 1; i < body.parts.length; i++) {
          this.drawBodyPart(canvasWidth, canvasHeight, body.parts[i]);
        }
      } else {
        // Simple body
        this.drawBodyPart(canvasWidth, canvasHeight, body);
      }
    }

    this.ctx.setLineDash([]); // Reset dash
    this.ctx.restore();
  }

  /**
   * Draw a single body part
   */
  private drawBodyPart(canvasWidth: number, canvasHeight: number, part: any): void {
    if (!part.vertices || part.vertices.length < 2) return;

    this.ctx.beginPath();

    const firstVertex = part.vertices[0];
    const firstScreen = this.camera.worldToScreen(firstVertex.x, firstVertex.y, canvasWidth, canvasHeight);
    this.ctx.moveTo(firstScreen.x, firstScreen.y);

    for (let i = 1; i < part.vertices.length; i++) {
      const vertex = part.vertices[i];
      const screen = this.camera.worldToScreen(vertex.x, vertex.y, canvasWidth, canvasHeight);
      this.ctx.lineTo(screen.x, screen.y);
    }

    this.ctx.closePath();
    this.ctx.stroke();
  }

  /**
   * Draw contour polylines
   */
  private drawPolylines(canvasWidth: number, canvasHeight: number): void {
    if (this.polylines.length === 0) {
      return;
    }

    this.ctx.save();

    // Fill rock (inside contours)
    // Use 'evenodd' fill rule to handle nested contours (rock islands within caves)
    this.ctx.fillStyle = '#8b7355';
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

    // Stroke outlines
    this.ctx.strokeStyle = '#4a3f35';
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
