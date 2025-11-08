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
    const rect = this.canvas.getBoundingClientRect();

    this.canvas.width = rect.width * dpr;
    this.canvas.height = rect.height * dpr;

    this.ctx.scale(dpr, dpr);

    // Set canvas CSS size
    this.canvas.style.width = `${rect.width}px`;
    this.canvas.style.height = `${rect.height}px`;
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
    console.log(`Renderer: Updating with ${polylines.length} polylines`);
    this.polylines = polylines;
    if (polylines.length > 0) {
      console.log(`First polyline has ${polylines[0].length} points`);
    }
  }

  /**
   * Render the scene
   */
  render(): void {
    try {
      const dpr = window.devicePixelRatio || 1;
      const width = this.canvas.width / dpr;
      const height = this.canvas.height / dpr;

      // Clear canvas
      this.ctx.fillStyle = '#1a1a1a';
      this.ctx.fillRect(0, 0, width, height);

      // Draw grid (optional, for debugging)
      // this.drawGrid(width, height);

      // Draw polylines
      this.drawPolylines(width, height);

      // Draw brush preview (optional, could add later)
    } catch (error) {
      console.error('Error during render:', error);
    }
  }

  /**
   * Draw contour polylines
   */
  private drawPolylines(canvasWidth: number, canvasHeight: number): void {
    if (this.polylines.length === 0) {
      console.log('Renderer: No polylines to draw');
      return;
    }
    console.log(`Renderer: Drawing ${this.polylines.length} polylines`);

    this.ctx.save();

    // Fill rock (inside contours)
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

    this.ctx.fill();

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
   * Draw debug grid
   */
  private _drawGrid(canvasWidth: number, canvasHeight: number): void {
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
