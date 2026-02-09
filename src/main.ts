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
import { DEFAULT_WATER_PARAMS, type WaterParticlesParams } from './water/WaterParams';
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

type WaterParamKey = keyof WaterParticlesParams;
type WaterNumberParamKey = Exclude<WaterParamKey, 'enabled' | 'pbfEnabled'>;

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
  private waterParams: WaterParticlesParams = { ...DEFAULT_WATER_PARAMS, enabled: CONFIG.water.enabled };
  private waterUi: {
    panel: HTMLDivElement;
    toggle: HTMLButtonElement;
    status: HTMLSpanElement;
    controls: Partial<Record<WaterParamKey, { input: HTMLInputElement; value?: HTMLSpanElement; format?: (v: number) => string }>>;
  } | null = null;

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
    this.setupWaterTuningUI();
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

  private setupWaterTuningUI(): void {
    const toggle = document.createElement('button');
    toggle.id = 'water-tune-toggle';
    toggle.textContent = 'Water';
    toggle.title = 'Toggle water tuning';
    toggle.style.cssText = `
      position: fixed;
      top: calc(env(safe-area-inset-top, 10px) + 10px);
      left: calc(env(safe-area-inset-left, 10px) + 10px);
      padding: 8px 10px;
      border-radius: 8px;
      background: rgba(40, 40, 40, 0.92);
      border: 1px solid rgba(255, 255, 255, 0.15);
      color: #fff;
      font-size: 12px;
      z-index: 1001;
    `;

    const panel = document.createElement('div');
    panel.id = 'water-tune-panel';
    panel.style.cssText = `
      position: fixed;
      top: calc(env(safe-area-inset-top, 10px) + 52px);
      left: calc(env(safe-area-inset-left, 10px) + 10px);
      width: 280px;
      max-height: 70vh;
      overflow: auto;
      padding: 10px;
      background: rgba(20, 20, 20, 0.92);
      border: 1px solid rgba(255, 255, 255, 0.15);
      border-radius: 10px;
      color: #fff;
      font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, "Liberation Mono", "Courier New", monospace;
      font-size: 12px;
      z-index: 1001;
      display: none;
      pointer-events: auto;
    `;

    const header = document.createElement('div');
    header.style.cssText = 'display: flex; justify-content: space-between; align-items: baseline; gap: 8px; margin-bottom: 6px;';
    const title = document.createElement('span');
    title.textContent = 'Water tuning';
    title.style.cssText = 'font-weight: 600;';
    const status = document.createElement('span');
    status.style.cssText = 'font-size: 11px; opacity: 0.7;';
    header.append(title, status);
    panel.appendChild(header);

    const controls: Partial<Record<WaterParamKey, { input: HTMLInputElement; value?: HTMLSpanElement; format?: (v: number) => string }>> = {};
    const paramTooltips: Record<WaterParamKey, string> = {
      enabled:
        'Turns water simulation on/off. Off pauses updates and particles freeze in place. Interacts with all other parameters.',
      particleRadius:
        'Visual and collision radius per particle. Higher radius makes fluid look thicker and raises effective volume. Interacts strongly with pbfRadius and maxParticles.',
      gravityY:
        'Downward acceleration. Higher values make flow faster and impacts stronger. Interacts strongly with linearDamping, substeps, and collision damping.',
      linearDamping:
        'Global velocity drag every substep. Higher values calm motion faster; too high makes syrup-like flow. Interacts with gravityY, viscosityStrength, and collision damping.',
      viscosityStrength:
        'Neighbor velocity smoothing. Higher values reduce jitter and splashes, but slow leveling and detail. Interacts strongly with pbfIterations and linearDamping.',
      pbfEnabled:
        'Enables pressure/incompressibility solve (PBF). This is the main mechanism that keeps fluid from collapsing and helps leveling.',
      pbfIterations:
        'How many pressure solve rounds run each substep. Higher values improve incompressibility and leveling, with higher GPU cost. Interacts with pbfStiffness and substeps.',
      pbfRadius:
        'Neighbor search radius for pressure solve. Higher values make broader/smoother pressure transfer; too high over-smooths. Interacts strongly with particleRadius, pbfRestDensity, and pbfSCorrDq.',
      pbfRestDensity:
        'Target local density for incompressibility. Higher values allow tighter packing; lower values make fluid expand. Interacts strongly with pbfRadius and pbfStiffness.',
      pbfStiffness:
        'Strength of each pressure correction step. Higher values enforce density faster but can destabilize if too high. Interacts with pbfIterations and pbfEpsilon stabilizer (internal).',
      pbfSCorrK:
        'Anti-clumping strength (s_corr). Higher values push close particles apart more, reducing tensile clumps. Interacts strongly with pbfSCorrN and pbfSCorrDq.',
      pbfSCorrN:
        'Anti-clumping falloff exponent. Higher values focus correction only at very short distances; lower values spread it wider. Interacts with pbfSCorrK and pbfSCorrDq.',
      pbfSCorrDq:
        'Reference distance for s_corr. Larger values trigger anti-clumping at longer range. Interacts strongly with pbfRadius and pbfSCorrK.',
      spawnRate:
        'Particles spawned per second while spawn window is active. Higher values fill pools faster. Interacts with spawnDuration and maxParticles.',
      spawnDuration:
        'How long spawning continues after respawn. Higher values create more total fluid. Interacts with spawnRate and maxParticles.',
      maxParticles:
        'Hard cap of simulated particles. Higher values allow larger volumes but increase GPU cost. Interacts with particleRadius and spawn settings.',
      spawnXSpread:
        'Horizontal spread of spawn area around source. Higher values make wider initial distribution. Interacts with spawnRate and spawnYJitter.',
      spawnYJitter:
        'Vertical randomness of spawn positions. Higher values increase initial turbulence. Interacts with spawnXSpread and gravityY.',
      substeps:
        'Simulation slices per fixed step. Higher values improve stability for collisions/pressure but cost more GPU time. Interacts strongly with pbfIterations and collisionIterations.',
      collisionIterations:
        'How many wall-projection passes run when inside rock. Higher values resolve penetration better but can over-correct if too high. Interacts with collisionPushStep and substeps.',
      collisionPushStep:
        'Max position push per collision iteration. Higher values escape geometry faster but can inject motion. Interacts strongly with collisionIterations and substeps.',
      collisionNormalDamping:
        'Damping along wall normal after collision. Higher values remove bounce more aggressively. Interacts with collisionPushStep and gravityY.',
      collisionTangentDamping:
        'Damping along wall tangent after collision. Higher values reduce wall sliding. Interacts with linearDamping and collisionNormalDamping.',
    };

    const applyTooltip = (target: HTMLElement, key: WaterParamKey): void => {
      const tip = paramTooltips[key];
      target.title = tip;
      target.style.cursor = 'help';
    };

    const updateParam = <K extends WaterParamKey>(key: K, value: WaterParticlesParams[K]) => {
      this.applyWaterParams({ [key]: value } as Partial<WaterParticlesParams>);
    };

    const addSection = (label: string) => {
      const el = document.createElement('div');
      el.textContent = label;
      el.style.cssText = 'margin-top: 8px; margin-bottom: 4px; font-size: 11px; letter-spacing: 0.08em; text-transform: uppercase; opacity: 0.6;';
      panel.appendChild(el);
    };

    const addCheckbox = (key: WaterParamKey, label: string) => {
      const row = document.createElement('label');
      row.style.cssText = 'display: flex; align-items: center; justify-content: space-between; gap: 8px; margin: 6px 0;';
      const text = document.createElement('span');
      text.textContent = label;
      applyTooltip(text, key);
      const input = document.createElement('input');
      input.type = 'checkbox';
      input.checked = Boolean(this.waterParams[key]);
      applyTooltip(input, key);
      input.addEventListener('change', () => updateParam(key, input.checked as WaterParticlesParams[typeof key]));
      row.append(text, input);
      panel.appendChild(row);
      controls[key] = { input };
    };

    const addSlider = (
      key: WaterNumberParamKey,
      label: string,
      min: number,
      max: number,
      step: number,
      format: (v: number) => string
    ) => {
      const row = document.createElement('div');
      row.style.cssText = 'display: grid; gap: 4px; margin: 6px 0;';
      const top = document.createElement('div');
      top.style.cssText = 'display: flex; justify-content: space-between; gap: 8px;';
      const labelEl = document.createElement('span');
      labelEl.textContent = label;
      applyTooltip(labelEl, key);
      const valueEl = document.createElement('span');
      const value = this.waterParams[key] as number;
      valueEl.textContent = format(value);
      top.append(labelEl, valueEl);
      const input = document.createElement('input');
      input.type = 'range';
      input.min = String(min);
      input.max = String(max);
      input.step = String(step);
      input.value = String(value);
      input.style.width = '100%';
      applyTooltip(input, key);
      input.addEventListener('input', () => {
        const next = parseFloat(input.value);
        valueEl.textContent = format(next);
        updateParam(key, next as WaterParticlesParams[typeof key]);
      });
      row.append(top, input);
      panel.appendChild(row);
      controls[key] = { input, value: valueEl, format };
    };

    addSection('General');
    addCheckbox('enabled', 'Enabled');
    addSlider('particleRadius', 'Radius', 0.02, 0.5, 0.01, (v) => v.toFixed(2));
    addSlider('gravityY', 'Gravity', -30, 30, 0.5, (v) => v.toFixed(1));
    addSlider('linearDamping', 'Linear damping', 0, 1, 0.01, (v) => v.toFixed(2));

    addSection('Viscosity');
    addSlider('viscosityStrength', 'Strength', 0, 1, 0.01, (v) => v.toFixed(2));

    addSection('Pressure (PBF)');
    addCheckbox('pbfEnabled', 'Enabled');
    addSlider('pbfIterations', 'Iterations', 0, 8, 1, (v) => v.toFixed(0));
    addSlider('pbfRadius', 'Radius', 0.1, 1.0, 0.01, (v) => v.toFixed(2));
    addSlider('pbfRestDensity', 'Rest density', 1, 50, 0.5, (v) => v.toFixed(1));
    addSlider('pbfStiffness', 'Stiffness', 0, 1, 0.01, (v) => v.toFixed(2));
    addSlider('pbfSCorrK', 's_corr K', 0, 0.01, 0.0001, (v) => v.toFixed(4));
    addSlider('pbfSCorrN', 's_corr N', 1, 8, 1, (v) => v.toFixed(0));
    addSlider('pbfSCorrDq', 's_corr dq', 0.01, 0.5, 0.01, (v) => v.toFixed(2));

    addSection('Collisions');
    addSlider('substeps', 'Substeps', 1, 6, 1, (v) => v.toFixed(0));
    addSlider('collisionIterations', 'Iterations', 0, 12, 1, (v) => v.toFixed(0));
    addSlider('collisionPushStep', 'Push step', 0.005, 0.2, 0.005, (v) => v.toFixed(3));
    addSlider('collisionNormalDamping', 'Normal damp', 0, 1, 0.01, (v) => v.toFixed(2));
    addSlider('collisionTangentDamping', 'Tangent damp', 0, 1, 0.01, (v) => v.toFixed(2));

    addSection('Spawn');
    addSlider('spawnRate', 'Rate', 0, 200, 1, (v) => v.toFixed(0));
    addSlider('spawnDuration', 'Duration', 0, 10, 0.1, (v) => v.toFixed(1));
    addSlider('maxParticles', 'Max', 0, 10000, 100, (v) => v.toFixed(0));
    addSlider('spawnXSpread', 'Spread X', 0, 6, 0.1, (v) => v.toFixed(1));
    addSlider('spawnYJitter', 'Jitter Y', 0, 6, 0.1, (v) => v.toFixed(1));

    const actions = document.createElement('div');
    actions.style.cssText = 'display: flex; flex-wrap: wrap; gap: 6px; margin-top: 8px;';

    const loadInput = document.createElement('input');
    loadInput.type = 'file';
    loadInput.accept = 'application/json,.json';
    loadInput.style.display = 'none';
    loadInput.addEventListener('change', async () => {
      const file = loadInput.files?.[0];
      if (!file) {
        this.updateWaterUiStatus('no file selected');
        return;
      }
      const ok = await this.loadWaterParamsFromFile(file);
      loadInput.value = '';
      this.updateWaterUiStatus(ok ? 'loaded file' : 'invalid file');
    });

    const savePreset = document.createElement('button');
    savePreset.textContent = 'Save file';
    savePreset.title = 'Download params as JSON';
    savePreset.addEventListener('click', () => {
      this.saveWaterParamsToFile();
      this.updateWaterUiStatus('saved file');
    });
    actions.appendChild(savePreset);

    const loadPreset = document.createElement('button');
    loadPreset.textContent = 'Load file';
    loadPreset.title = 'Load params from JSON file';
    loadPreset.addEventListener('click', () => loadInput.click());
    actions.appendChild(loadPreset);

    const respawn = document.createElement('button');
    respawn.textContent = 'Respawn';
    respawn.addEventListener('click', () => this.water?.respawn());
    actions.appendChild(respawn);

    const clear = document.createElement('button');
    clear.textContent = 'Clear';
    clear.addEventListener('click', () => this.water?.clear());
    actions.appendChild(clear);

    const reset = document.createElement('button');
    reset.textContent = 'Reset';
    reset.addEventListener('click', () => {
      const enabled = this.waterParams.enabled;
      this.applyWaterParams({ ...DEFAULT_WATER_PARAMS, enabled });
    });
    actions.appendChild(reset);

    panel.appendChild(actions);

    const stopEvent = (e: Event) => e.stopPropagation();
    panel.addEventListener('pointerdown', stopEvent);
    panel.addEventListener('wheel', stopEvent, { passive: true });
    panel.addEventListener('touchstart', stopEvent, { passive: true });

    let visible = false;
    const setVisible = (next: boolean) => {
      visible = next;
      panel.style.display = visible ? 'block' : 'none';
    };
    toggle.addEventListener('click', () => setVisible(!visible));

    document.body.appendChild(toggle);
    document.body.appendChild(panel);
    document.body.appendChild(loadInput);

    this.waterUi = { panel, toggle, status, controls };
    this.syncWaterUi();
    this.updateWaterUiStatus();
  }

  private applyWaterParams(partial: Partial<WaterParticlesParams>): void {
    this.waterParams = { ...this.waterParams, ...partial };
    if (this.water) {
      this.water.updateParams(partial);
      this.waterParams = this.water.getParams();
    }
    this.syncWaterUi();
    this.updateWaterUiStatus();
  }

  private parseWaterParams(obj: Record<string, unknown>): WaterParticlesParams {
    const next: WaterParticlesParams = { ...this.waterParams };
    for (const key of Object.keys(DEFAULT_WATER_PARAMS) as WaterParamKey[]) {
      const v = obj[key as string];
      if (typeof next[key] === 'number') {
        if (typeof v === 'number' && Number.isFinite(v)) (next as any)[key] = v;
      } else if (typeof next[key] === 'boolean') {
        if (typeof v === 'boolean') (next as any)[key] = v;
      }
    }
    return next;
  }

  private async loadWaterParamsFromFile(file: File): Promise<boolean> {
    try {
      const raw = await file.text();
      const parsed: unknown = JSON.parse(raw);
      if (!parsed || typeof parsed !== 'object') return false;
      const root = parsed as Record<string, unknown>;
      const maybeParams = (root.params && typeof root.params === 'object')
        ? (root.params as Record<string, unknown>)
        : root;
      const next = this.parseWaterParams(maybeParams);

      // Apply without auto-saving back immediately.
      this.waterParams = next;
      if (this.water) {
        this.water.updateParams(next);
        this.waterParams = this.water.getParams();
      }
      this.syncWaterUi();
      this.updateWaterUiStatus();
      return true;
    } catch {
      return false;
    }
  }

  private saveWaterParamsToFile(): void {
    const payload = {
      version: 1,
      savedAt: new Date().toISOString(),
      params: this.waterParams,
    };
    const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    const ts = new Date().toISOString().replace(/[:.]/g, '-');
    a.href = url;
    a.download = `water-config-${ts}.json`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
  }

  private syncWaterUi(): void {
    if (!this.waterUi) return;
    const { controls } = this.waterUi;
    for (const key of Object.keys(controls) as WaterParamKey[]) {
      const control = controls[key];
      if (!control) continue;
      const value = this.waterParams[key];
      if (control.input.type === 'checkbox') {
        control.input.checked = Boolean(value);
      } else {
        control.input.value = String(value);
        if (control.value && typeof value === 'number') {
          const format = control.format ?? ((v: number) => String(v));
          control.value.textContent = format(value);
        }
      }
    }
  }

  private updateWaterUiStatus(note?: string): void {
    if (!this.waterUi) return;
    if (!this.water) {
      this.waterUi.status.textContent = 'status: unavailable';
      this.waterUi.status.style.color = '#f28b82';
      return;
    }
    const base = this.waterParams.enabled ? 'status: running' : 'status: paused';
    this.waterUi.status.textContent = note ? `${base} (${note})` : base;
    this.waterUi.status.style.color = this.waterParams.enabled ? '#9fe870' : '#f6d365';
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
      const params = { ...this.waterParams, enabled: this.waterParams.enabled };
      const water = new WaterWebGPU(this.waterGpuCanvas, this.densityField, params);
      await water.init();
      water.setSpawnCenter(spawnX, spawnY - CONFIG.water.spawnOffsetY);
      water.respawn();
      this.water = water;
      this.waterParams = water.getParams();
      this.syncWaterUi();
    }

    this.updateWaterUiStatus();
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
