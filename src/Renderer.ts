import type { Camera } from './Camera';
import type { DensityField } from './DensityField';

export interface BallRenderData {
  position: { x: number; y: number };
  circleRadius: number;
}

export interface RenderParams {
  playerPosition?: { x: number; y: number };
  playerRadius?: number;
  playerDirection?: number;
  joystickDraw?: (ctx: CanvasRenderingContext2D) => void;
}

/**
 * Minimal renderer: draws a thresholded density field and a simple player.
 */
export class Renderer {
  private canvas: HTMLCanvasElement;
  private ctx: CanvasRenderingContext2D;
  private camera: Camera;
  private densityField: DensityField;

  private terrainCanvas: HTMLCanvasElement;
  private terrainCtx: CanvasRenderingContext2D;
  private terrainImage: ImageData | null = null;

  constructor(canvas: HTMLCanvasElement, camera: Camera, densityField: DensityField) {
    this.canvas = canvas;
    this.camera = camera;
    this.densityField = densityField;

    const ctx = canvas.getContext('2d');
    if (!ctx) throw new Error('Could not get 2D context');
    this.ctx = ctx;

    this.terrainCanvas = document.createElement('canvas');
    const terrainCtx = this.terrainCanvas.getContext('2d');
    if (!terrainCtx) throw new Error('Could not get terrain 2D context');
    this.terrainCtx = terrainCtx;

    this.resize();
    this.rebuildTerrainTexture();
  }

  resize(): void {
    const dpr = window.devicePixelRatio || 1;
    const width = window.innerWidth;
    const height = window.innerHeight;
    this.canvas.width = width * dpr;
    this.canvas.height = height * dpr;
    this.ctx.setTransform(1, 0, 0, 1, 0, 0);
    this.ctx.scale(dpr, dpr);
    this.canvas.style.width = `${width}px`;
    this.canvas.style.height = `${height}px`;
  }

  rebuildTerrainTexture(): void {
    const { gridWidth, gridHeight, config, data } = this.densityField;
    if (this.terrainCanvas.width !== gridWidth || this.terrainCanvas.height !== gridHeight) {
      this.terrainCanvas.width = gridWidth;
      this.terrainCanvas.height = gridHeight;
      this.terrainImage = this.terrainCtx.createImageData(gridWidth, gridHeight);
    }

    if (!this.terrainImage) return;

    const pixels = this.terrainImage.data;
    const iso = config.isoValue;

    for (let i = 0; i < data.length; i++) {
      const isCave = data[i] < iso;
      const base = i * 4;
      if (isCave) {
        pixels[base + 0] = 210;
        pixels[base + 1] = 205;
        pixels[base + 2] = 190;
        pixels[base + 3] = 255;
      } else {
        pixels[base + 0] = 20;
        pixels[base + 1] = 20;
        pixels[base + 2] = 24;
        pixels[base + 3] = 255;
      }
    }

    this.terrainCtx.putImageData(this.terrainImage, 0, 0);
  }

  render(params: RenderParams): void {
    const dpr = window.devicePixelRatio || 1;
    const width = this.canvas.width / dpr;
    const height = this.canvas.height / dpr;

    this.ctx.save();
    this.ctx.fillStyle = '#141418';
    this.ctx.fillRect(0, 0, width, height);

    this.ctx.imageSmoothingEnabled = false;
    const topLeft = this.camera.worldToScreen(0, 0, width, height);
    const bottomRight = this.camera.worldToScreen(
      this.densityField.config.width,
      this.densityField.config.height,
      width,
      height
    );
    this.ctx.drawImage(
      this.terrainCanvas,
      topLeft.x,
      topLeft.y,
      bottomRight.x - topLeft.x,
      bottomRight.y - topLeft.y
    );

    if (params.playerPosition && params.playerRadius) {
      const screen = this.camera.worldToScreen(params.playerPosition.x, params.playerPosition.y, width, height);
      const radius = params.playerRadius * this.camera.zoom;
      this.ctx.fillStyle = '#f2f2f2';
      this.ctx.beginPath();
      this.ctx.arc(screen.x, screen.y, radius, 0, Math.PI * 2);
      this.ctx.fill();

      if (typeof params.playerDirection === 'number') {
        const tipX = screen.x + Math.cos(params.playerDirection) * radius * 1.2;
        const tipY = screen.y + Math.sin(params.playerDirection) * radius * 1.2;
        this.ctx.strokeStyle = '#0a0a0a';
        this.ctx.lineWidth = 2;
        this.ctx.beginPath();
        this.ctx.moveTo(screen.x, screen.y);
        this.ctx.lineTo(tipX, tipY);
        this.ctx.stroke();
      }
    }

    if (params.joystickDraw) {
      params.joystickDraw(this.ctx);
    }

    this.ctx.restore();
  }
}
