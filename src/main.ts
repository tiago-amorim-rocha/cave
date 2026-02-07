import { Camera } from './Camera';
import { DensityField } from './DensityField';
import { BrushGenerator, type Brush } from './BrushGenerator';
import { InputHandler } from './InputHandler';
import { Box2DPhysics } from './Box2DPhysics';
import { CapsuleController } from './controllers/CapsuleController';
import type { IPlayerController } from './controllers/IPlayerController';
import { VirtualJoystick } from './VirtualJoystick';
import { Renderer } from './Renderer';
import { ImplicitTerrainCollider } from './physics/ImplicitTerrainCollider';
import { DEFAULT_WATER_PARAMS } from './water/WaterParticles';
import { WaterWebGPU } from './water/WaterWebGPU';
import type { BrushSettings, WorldConfig } from './types';

const CONFIG = {
  worldWidth: 32,
  worldHeight: 32,
  gridPitch: 0.5,
  isoValue: 128,
  perlinScale: 0.05,
  perlinOctaves: 4,
  perlinThreshold: 0,
  camera: {
    initialZoom: 75,
    minZoom: 10,
    maxZoom: 400,
    followSmoothing: 0.1,
  },
  carve: {
    radius: 2.0,
    strength: 0.25,
    offset: 2.5,
    brushSigma: 0.5,
  },
  spawn: {
    radius: 3.0,
  },
  terrainCollision: {
    iterations: 5,
    pushStep: 0.05,
    normalDamping: 0.4,
    tangentDamping: 0.15,
  },
  water: {
    enabled: true,
    spawnOffsetY: 6,
  },
  terrain: {
    texelsPerMeter: 24,
  },
};

class CaveGame {
  private canvas: HTMLCanvasElement;
  private camera: Camera;
  private densityField: DensityField;
  private renderer: Renderer;
  private inputHandler: InputHandler;
  private physics: Box2DPhysics;
  private player: IPlayerController | null = null;
  private joystick: VirtualJoystick;
  private terrainCollider: ImplicitTerrainCollider;

  private water: WaterWebGPU | null = null;
  private waterGpuCanvas: HTMLCanvasElement | null = null;

  private carveBrush: Brush | null = null;
  private spawnBrush: Brush | null = null;

  private characterControlMode = true;
  private lastPhysicsTime = 0;
  private animationFrameId = 0;

  private frameCount = 0;
  private lastFpsTime = performance.now();
  private fps = 0;

  private pendingResize = false;

  constructor() {
    this.canvas = document.getElementById('canvas') as HTMLCanvasElement;
    if (!this.canvas) {
      throw new Error('Canvas not found');
    }

    const worldConfig: WorldConfig = {
      width: CONFIG.worldWidth,
      height: CONFIG.worldHeight,
      gridPitch: CONFIG.gridPitch,
      isoValue: CONFIG.isoValue,
    };

    this.camera = new Camera(
      CONFIG.worldWidth / 2,
      CONFIG.worldHeight / 2,
      CONFIG.camera.initialZoom,
      CONFIG.worldWidth,
      CONFIG.worldHeight,
      { minZoom: CONFIG.camera.minZoom, maxZoom: CONFIG.camera.maxZoom }
    );

    this.densityField = new DensityField(worldConfig);
    this.densityField.generateCaves(
      undefined,
      CONFIG.perlinScale,
      CONFIG.perlinOctaves,
      CONFIG.perlinThreshold
    );

    this.renderer = new Renderer(this.canvas, this.camera, this.densityField, {
      texelsPerMeter: CONFIG.terrain.texelsPerMeter,
    });

    this.waterGpuCanvas = document.createElement('canvas');
    this.waterGpuCanvas.id = 'water-canvas';
    this.waterGpuCanvas.style.cssText = `
      position: fixed;
      inset: 0;
      width: 100%;
      height: 100%;
      pointer-events: none;
      z-index: 2;
    `;
    document.body.appendChild(this.waterGpuCanvas);

    const brushSettings: BrushSettings = { radius: 0, strength: 0 };
    this.inputHandler = new InputHandler(this.canvas, this.camera, this.densityField, brushSettings);
    this.inputHandler.setCameraControlsEnabled(!this.characterControlMode);

    this.physics = new Box2DPhysics();
    this.joystick = new VirtualJoystick();

    this.terrainCollider = new ImplicitTerrainCollider(this.densityField, CONFIG.terrainCollision);

    this.prepareBrushes();
    this.carveSpawnArea();
    this.renderer.rebuildTerrainTexture();

    this.setupUI();
    this.setupResizeHandling();

    void this.start().catch((err) => this.showFatalError(err));
  }

  private prepareBrushes(): void {
    this.carveBrush = BrushGenerator.createGaussianBrush(
      CONFIG.carve.radius,
      CONFIG.gridPitch,
      CONFIG.carve.brushSigma,
      CONFIG.carve.strength
    );
    this.spawnBrush = BrushGenerator.createGaussianBrush(
      CONFIG.spawn.radius,
      CONFIG.gridPitch,
      0.6,
      1.0
    );
  }

  private carveSpawnArea(): void {
    if (!this.spawnBrush) return;
    const spawnX = CONFIG.worldWidth / 2;
    const spawnY = CONFIG.worldHeight / 2;
    this.densityField.stampBrush(spawnX, spawnY, this.spawnBrush, false);
    this.densityField.clearDirty();
  }

  private setupResizeHandling(): void {
    const handleResize = () => {
      if (this.pendingResize) return;
      this.pendingResize = true;
      requestAnimationFrame(() => {
        this.pendingResize = false;
        this.renderer.resize();
        this.syncWaterOverlaySize();
        this.joystick.handleResize();
      });
    };

    window.addEventListener('resize', handleResize);
    window.addEventListener('orientationchange', handleResize);
    if (window.visualViewport) {
      window.visualViewport.addEventListener('resize', handleResize);
    }
  }

  private setupUI(): void {
    const carveButton = document.createElement('button');
    carveButton.id = 'carve-button';
    carveButton.textContent = '⛏️';
    carveButton.title = 'Carve around player';
    carveButton.style.cssText = `
      position: fixed;
      bottom: calc(env(safe-area-inset-bottom, 10px) + 20px);
      right: calc(env(safe-area-inset-right, 10px) + 20px);
      width: 56px;
      height: 56px;
      border-radius: 50%;
      font-size: 24px;
      background: rgba(255, 152, 0, 0.95);
      border: none;
      color: #fff;
      z-index: 1000;
    `;
    carveButton.addEventListener('click', () => this.carveAroundPlayer());
    carveButton.addEventListener('touchstart', (e) => {
      e.preventDefault();
      carveButton.style.transform = 'scale(0.95)';
    }, { passive: false });
    carveButton.addEventListener('touchend', (e) => {
      e.preventDefault();
      carveButton.style.transform = 'scale(1)';
      this.carveAroundPlayer();
    }, { passive: false });
    document.body.appendChild(carveButton);

    window.addEventListener('keydown', (e) => {
      if (e.key.toLowerCase() === 'c') {
        this.setControlMode(!this.characterControlMode);
      }
      if (e.key.toLowerCase() === 'e') {
        this.carveAroundPlayer();
      }
    });
  }

  private setControlMode(enabled: boolean): void {
    this.characterControlMode = enabled;
    this.inputHandler.setCameraControlsEnabled(!enabled);
    this.joystick.setVisible(enabled);
  }

  private async start(): Promise<void> {
    await this.physics.init();

    const world = this.physics.getEngine().getWorld();
    const spawnX = CONFIG.worldWidth / 2;
    const spawnY = CONFIG.worldHeight / 2;
    this.player = new CapsuleController(world, spawnX, spawnY);

    this.physics.getEngine().registerFixedUpdate((dt) => {
      this.player?.update(dt);
      if (this.water) {
        this.water.fixedUpdate(dt);
      }
    });

    this.physics.getEngine().registerPostStep(() => {
      if (!this.player) return;
      this.terrainCollider.resolveCircleBody(this.player.getBody(), this.player.getRadius());
    });

    if (this.waterGpuCanvas && CONFIG.water.enabled) {
      const params = { ...DEFAULT_WATER_PARAMS, enabled: true };
      const water = new WaterWebGPU(this.waterGpuCanvas, this.densityField, params);
      try {
        await water.init();
        water.setSpawnCenter(spawnX, spawnY - CONFIG.water.spawnOffsetY);
        water.respawn();
        this.water = water;
      } catch (err) {
        console.warn('[CaveGame] WebGPU water disabled:', err);
        this.water = null;
      }
    }

    this.syncWaterOverlaySize();
    this.loop();
  }

  private loop = (): void => {
    this.animationFrameId = requestAnimationFrame(this.loop);
    if (!this.player) return;

    const now = performance.now();
    if (this.lastPhysicsTime === 0) {
      this.lastPhysicsTime = now;
      return;
    }

    const deltaMs = now - this.lastPhysicsTime;
    this.lastPhysicsTime = now;

    this.updateFPS();

    this.player.setJoystick(this.joystick.getInput());

    const preStepPlayerPos = this.player.getPosition();
    this.water?.setSpawnCenter(preStepPlayerPos.x, preStepPlayerPos.y - CONFIG.water.spawnOffsetY);

    this.physics.update(deltaMs);

    const playerPos = this.player.getPosition();
    if (this.characterControlMode) {
      this.camera.smoothFollow(playerPos.x, playerPos.y, CONFIG.camera.followSmoothing);
    }

    this.renderer.render({
      playerPosition: playerPos,
      playerRadius: this.player.getRadius(),
      playerDirection: this.player.getDirection ? this.player.getDirection() : undefined,
      joystickDraw: (ctx) => this.joystick.render(ctx),
    });

    const dpr = window.devicePixelRatio || 1;
    this.water?.render(this.camera, dpr);
  };

  private carveAroundPlayer(): void {
    if (!this.player || !this.carveBrush) return;

    const pos = this.player.getPosition();
    const dir = this.player.getDirection ? this.player.getDirection() : 0;
    const carveX = pos.x + Math.cos(dir) * CONFIG.carve.offset;
    const carveY = pos.y + Math.sin(dir) * CONFIG.carve.offset;

    this.densityField.stampBrush(carveX, carveY, this.carveBrush, false);
    const dirty = this.densityField.getDirtyWorldAABB();
    this.renderer.updateTerrainTextureDirty(dirty);
    this.densityField.clearDirty();
    this.water?.uploadDensityField();
  }

  private syncWaterOverlaySize(): void {
    if (!this.waterGpuCanvas) return;
    const w = this.canvas.width;
    const h = this.canvas.height;
    if (w <= 0 || h <= 0) return;
    if (this.water) {
      this.water.setSize(w, h);
    } else {
      this.waterGpuCanvas.width = w;
      this.waterGpuCanvas.height = h;
    }
  }

  private updateFPS(): void {
    this.frameCount++;
    const now = performance.now();
    if (now - this.lastFpsTime < 1000) return;

    this.fps = Math.round((this.frameCount * 1000) / (now - this.lastFpsTime));
    this.frameCount = 0;
    this.lastFpsTime = now;

    const fpsElement = document.getElementById('fps-value');
    if (fpsElement) {
      fpsElement.textContent = this.fps.toString();
    }

    const waterCountElement = document.getElementById('water-count');
    if (waterCountElement) {
      const count = this.water ? this.water.getCount() : 0;
      waterCountElement.textContent = count.toString();
    }
  }

  private showFatalError(err: unknown): void {
    console.error('[CaveGame] Fatal error:', err);
    if (this.animationFrameId) {
      cancelAnimationFrame(this.animationFrameId);
    }
    const overlay = document.createElement('div');
    overlay.style.cssText = `
      position: fixed;
      inset: 0;
      background: rgba(0, 0, 0, 0.9);
      color: #fff;
      padding: 24px;
      font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, "Liberation Mono", "Courier New", monospace;
      white-space: pre-wrap;
      z-index: 9999;
    `;
    overlay.textContent = String(err);
    document.body.appendChild(overlay);
  }
}

new CaveGame();
(window as any).APP_LOADED = true;
