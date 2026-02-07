import type { Camera } from './Camera';
import type { DensityField } from './DensityField';

export interface BallRenderData {
  position: { x: number; y: number };
  circleRadius: number;
}

export interface RendererOptions {
  texelsPerMeter?: number;
  edgeAaMeters?: number;
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

  private texelsPerMeter: number;
  private edgeAaMeters: number;
  private terrainCanvas: HTMLCanvasElement;
  private terrainCtx: CanvasRenderingContext2D;
  private terrainImage: ImageData | null = null;
  private terrainWidth = 0;
  private terrainHeight = 0;
  private sample = { density: 0, gradX: 0, gradY: 0 };

  private readonly rock = { r: 20, g: 20, b: 24 };
  private readonly cave = { r: 210, g: 205, b: 190 };

  constructor(
    canvas: HTMLCanvasElement,
    camera: Camera,
    densityField: DensityField,
    options: RendererOptions = {}
  ) {
    this.canvas = canvas;
    this.camera = camera;
    this.densityField = densityField;
    this.texelsPerMeter = options.texelsPerMeter ?? 16;
    this.edgeAaMeters = options.edgeAaMeters ?? 0.5 / this.texelsPerMeter;

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

  updateTerrainTextureDirty(worldAabb: { minX: number; minY: number; maxX: number; maxY: number } | null): void {
    if (!worldAabb) {
      this.rebuildTerrainTexture();
      return;
    }

    this.ensureTerrainTextureAllocated();
    if (!this.terrainImage) return;

    const { config } = this.densityField;
    const clamped = {
      minX: Math.max(0, Math.min(config.width, worldAabb.minX)),
      minY: Math.max(0, Math.min(config.height, worldAabb.minY)),
      maxX: Math.max(0, Math.min(config.width, worldAabb.maxX)),
      maxY: Math.max(0, Math.min(config.height, worldAabb.maxY)),
    };

    const padPx = Math.max(2, Math.ceil(this.edgeAaMeters * this.texelsPerMeter) + 2);
    const x0 = Math.max(0, Math.floor(clamped.minX * this.texelsPerMeter) - padPx);
    const y0 = Math.max(0, Math.floor(clamped.minY * this.texelsPerMeter) - padPx);
    const x1 = Math.min(this.terrainWidth, Math.ceil(clamped.maxX * this.texelsPerMeter) + padPx);
    const y1 = Math.min(this.terrainHeight, Math.ceil(clamped.maxY * this.texelsPerMeter) + padPx);

    if (x1 <= x0 || y1 <= y0) return;

    this.rasterizeTerrainRect(this.terrainImage, x0, y0, x1, y1);
    this.terrainCtx.putImageData(this.terrainImage, 0, 0, x0, y0, x1 - x0, y1 - y0);
  }

  rebuildTerrainTexture(): void {
    this.ensureTerrainTextureAllocated();
    if (!this.terrainImage) return;
    this.rasterizeTerrainRect(this.terrainImage, 0, 0, this.terrainWidth, this.terrainHeight);
    this.terrainCtx.putImageData(this.terrainImage, 0, 0, 0, 0, this.terrainWidth, this.terrainHeight);
  }

  private ensureTerrainTextureAllocated(): void {
    const { config } = this.densityField;
    const texWidth = Math.max(1, Math.round(config.width * this.texelsPerMeter));
    const texHeight = Math.max(1, Math.round(config.height * this.texelsPerMeter));

    if (this.terrainCanvas.width !== texWidth || this.terrainCanvas.height !== texHeight) {
      this.terrainCanvas.width = texWidth;
      this.terrainCanvas.height = texHeight;
      this.terrainImage = this.terrainCtx.createImageData(texWidth, texHeight);
      this.terrainWidth = texWidth;
      this.terrainHeight = texHeight;
    }
  }

  private rasterizeTerrainRect(image: ImageData, x0: number, y0: number, x1: number, y1: number): void {
    const { config } = this.densityField;
    const pixels = image.data;
    const iso = config.isoValue;
    const aa = this.edgeAaMeters;
    const invTexels = 1 / this.texelsPerMeter;

    const smoothstep = (edge0: number, edge1: number, x: number): number => {
      const t = Math.max(0, Math.min(1, (x - edge0) / (edge1 - edge0)));
      return t * t * (3 - 2 * t);
    };

    for (let y = y0; y < y1; y++) {
      const worldY = (y + 0.5) * invTexels;
      for (let x = x0; x < x1; x++) {
        const worldX = (x + 0.5) * invTexels;
        this.densityField.getDensityAndGradientAtWorld(worldX, worldY, this.sample);

        const density = this.sample.density;
        const gradLen = Math.hypot(this.sample.gradX, this.sample.gradY);
        let caveAmount = density < iso ? 1 : 0;
        if (gradLen >= 1e-5) {
          const phi = (density - iso) / gradLen;
          caveAmount = 1 - smoothstep(-aa, aa, phi);
        }

        const base = (y * this.terrainWidth + x) * 4;
        pixels[base + 0] = Math.round(this.rock.r + (this.cave.r - this.rock.r) * caveAmount);
        pixels[base + 1] = Math.round(this.rock.g + (this.cave.g - this.rock.g) * caveAmount);
        pixels[base + 2] = Math.round(this.rock.b + (this.cave.b - this.rock.b) * caveAmount);
        pixels[base + 3] = 255;
      }
    }
  }

  render(params: RenderParams): void {
    const dpr = window.devicePixelRatio || 1;
    const width = this.canvas.width / dpr;
    const height = this.canvas.height / dpr;

    this.ctx.save();
    this.ctx.fillStyle = '#141418';
    this.ctx.fillRect(0, 0, width, height);

    this.ctx.imageSmoothingEnabled = true;
    this.ctx.imageSmoothingQuality = 'high';
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
