import { Camera } from './Camera';
import { DensityField } from './DensityField';
import { MarchingSquares } from './MarchingSquares';
import { Renderer } from './Renderer';
import { DebugConsole } from './DebugConsole';
import { LoopCache } from './LoopCache';
import { InputHandler } from './InputHandler';
import { RapierPhysics } from './RapierPhysics';
import { RapierPlayer } from './RapierPlayer';
import { VirtualJoystick } from './VirtualJoystick';
import { RemeshManager, type RemeshStats } from './RemeshManager';
import { VersionChecker } from './VersionChecker';
import type { WorldConfig, BrushSettings } from './types';
import RAPIER from '@dimforge/rapier2d-compat';

/**
 * Main application
 */
class CarvableCaves {
  private canvas: HTMLCanvasElement;
  private camera: Camera;
  private densityField: DensityField;
  private marchingSquares: MarchingSquares;
  private renderer: Renderer;
  private loopCache: LoopCache;
  private inputHandler: InputHandler;
  private physics: RapierPhysics;
  private player!: RapierPlayer; // Initialized asynchronously in start()
  private joystick: VirtualJoystick;
  private remeshManager!: RemeshManager; // Initialized after physics

  private needsRemesh = true;
  private animationFrameId = 0;
  private lastBallSpawnTime = 0; // Track ball spawning

  // Performance tracking
  private frameCount = 0;
  private lastFpsTime = performance.now();
  private fps = 0;
  private lastPhysicsTime = 0;
  private ballBodies: RAPIER.RigidBody[] = []; // Track all balls for rendering

  // Resize handling
  private pendingResize = false;

  // Simplification control (disabled by default - Chaikin smoothing works better)
  private simplificationEpsilon = 0; // 0 = no pre-Chaikin simplification

  // Chaikin smoothing control (enabled by default for organic cave shapes)
  private chaikinEnabled = true;
  private chaikinIterations = 2;

  // Post-smoothing simplification control (removes redundant vertices from Chaikin)
  private simplificationEpsilonPost = 0.05; // metres - optimal balance of smoothness and vertex count

  // Reduction statistics for UI display
  private simplificationReduction = 0; // percentage
  private postSimplificationReduction = 0; // percentage
  private originalVertexCount = 0; // vertices from Marching Squares
  private finalVertexCount = 0; // vertices after full pipeline

  // Control mode (true = character control, false = camera pan/zoom)
  private characterControlMode = true;

  constructor() {
    try {
      console.log('Initializing CarvableCaves...');

      // World configuration
      const worldConfig: WorldConfig = {
        width: 50, // metres
        height: 30, // metres
        gridPitch: 0.25, // metres (h)
        isoValue: 128
      };
      console.log('World config:', worldConfig);

      // Setup canvas
      this.canvas = document.getElementById('canvas') as HTMLCanvasElement;
      if (!this.canvas) {
        throw new Error('Canvas not found');
      }
      console.log('Canvas found:', this.canvas);

      // Initialize camera (centered on world, standard zoom)
      this.camera = new Camera(
        worldConfig.width / 2,
        worldConfig.height / 2,
        50 // initial PPM (pixels per metre) - standard zoom
      );
      console.log('Camera initialized:', this.camera.getState());

      // Initialize density field
      this.densityField = new DensityField(worldConfig);
      console.log('Density field initialized:', {
        gridWidth: this.densityField.gridWidth,
        gridHeight: this.densityField.gridHeight,
        dataLength: this.densityField.data.length
      });

      // Generate initial cave system
      console.log('Generating procedural caves...');
      this.densityField.generateCaves(undefined, 0.05, 4, 0.1);
      console.log('Caves generated!');

      // Player spawn position (no clearing of area)
      const spawnX = worldConfig.width / 2;
      const spawnY = worldConfig.height / 2;

      // Initialize marching squares
      this.marchingSquares = new MarchingSquares(this.densityField, worldConfig.isoValue);
      console.log('Marching squares initialized');

      // Initialize loop cache
      this.loopCache = new LoopCache();
      console.log('Loop cache initialized');

      // Initialize renderer
      this.renderer = new Renderer(this.canvas, this.camera);
      this.renderer.setDensityField(this.densityField); // For debug visualization
      console.log('Renderer initialized');

      // Initialize input handler (camera controls only, no brushing)
      const brushSettings: BrushSettings = {
        radius: 0, // Disabled
        strength: 0
      };
      this.inputHandler = new InputHandler(this.canvas, this.camera, this.densityField, brushSettings);
      // Disable carving callbacks
      this.inputHandler.onCarve = undefined;
      this.inputHandler.onCarveEnd = undefined;
      // Start in character control mode (camera controls disabled)
      this.inputHandler.setCameraControlsEnabled(!this.characterControlMode);
      console.log('Input handler initialized (camera controls disabled, character control mode)');

      // Initialize physics (will be initialized async in start())
      this.physics = new RapierPhysics();
      console.log('Physics created (pending async init)');

      // Initialize virtual joystick for mobile controls
      this.joystick = new VirtualJoystick();
      console.log('Virtual joystick initialized');

      // Setup UI
      this.setupUI();
      console.log('UI setup complete');

      // Window resize and orientation change handling using requestAnimationFrame pattern
      const handleResize = () => {
        // Debounce: only schedule one resize per animation frame
        if (this.pendingResize) return;
        this.pendingResize = true;

        requestAnimationFrame(() => {
          this.pendingResize = false;
          console.log('[Resize] Executing resize');
          this.renderer.resize();
        });
      };

      // Listen to resize on both window and visualViewport (if available)
      window.addEventListener('resize', handleResize);

      // Visual Viewport API - handles mobile keyboard, zoom, and orientation
      if (window.visualViewport) {
        window.visualViewport.addEventListener('resize', handleResize);
        console.log('Visual Viewport API detected - using for resize events');
      }

      // Fallback for older browsers: orientationchange event
      window.addEventListener('orientationchange', handleResize);

      // Update joystick position on window resize
      window.addEventListener('resize', () => {
        this.joystick.handleResize();
      });

      // Start render loop (async initialization happens there)
      this.start(spawnX, spawnY, worldConfig.gridPitch);
      console.log('CarvableCaves initialization started...');
    } catch (error) {
      console.error('Failed to initialize CarvableCaves:', error);
      throw error;
    }
  }

  private setupUI(): void {
    // UI elements removed - all debug functionality now in debug console
    console.log('UI setup complete (debug console only)');
  }

  private async start(spawnX: number, spawnY: number, gridPitch: number): Promise<void> {
    console.log('Starting async initialization...');

    // Initialize Rapier physics
    await this.physics.init();
    console.log('Physics initialized');

    // Initialize remesh manager (after physics is ready)
    this.remeshManager = new RemeshManager({
      densityField: this.densityField,
      marchingSquares: this.marchingSquares,
      loopCache: this.loopCache,
      physics: this.physics,
      renderer: this.renderer,
      optimizationOptions: {
        gridPitch,
        simplificationEpsilon: this.simplificationEpsilon,
        chaikinEnabled: this.chaikinEnabled,
        chaikinIterations: this.chaikinIterations,
        simplificationEpsilonPost: this.simplificationEpsilonPost
      }
    });
    console.log('Remesh manager initialized');

    // Generate initial mesh and physics bodies
    console.log('Generating initial mesh and physics bodies...');
    this.remesh();
    console.log('Initial mesh generated');

    // Create player after physics world is ready
    this.player = new RapierPlayer(this.physics, spawnX, spawnY);
    this.player.setJoystick(this.joystick); // Connect joystick to player
    console.log(`Player initialized at spawn location (${spawnX}, ${spawnY})`);

    // Start render loop
    console.log('Starting render loop...');
    this.loop();
    console.log('CarvableCaves fully initialized!');
  }

  /**
   * Spawn a test ball at random position in the world
   */
  private spawnTestBall(): void {
    // Spawn at random position (avoiding border areas)
    const margin = 2; // Stay 2m away from edges
    const x = margin + Math.random() * (50 - 2 * margin);
    const y = margin + Math.random() * (30 - 2 * margin);
    const radius = 0.5;

    const ball = this.physics.createBall(x, y, radius);
    this.ballBodies.push(ball);

    console.log(`[Test] Spawned ball at random position (${x.toFixed(1)}, ${y.toFixed(1)})`);
  }

  private loop = (): void => {
    this.animationFrameId = requestAnimationFrame(this.loop);

    // Wait for player to be initialized
    if (!this.player) {
      return;
    }

    // Calculate delta time for physics
    const now = performance.now();

    // Initialize lastPhysicsTime on first frame
    if (this.lastPhysicsTime === 0) {
      this.lastPhysicsTime = now;
      return; // Skip first frame to avoid huge delta
    }

    const deltaMs = now - this.lastPhysicsTime;
    this.lastPhysicsTime = now;

    // Update FPS
    this.updateFPS();

    // Update player input (with delta time for physics calculations)
    this.player.update(deltaMs);

    // Update physics simulation (Rapier handles fixed timestep internally)
    this.physics.update(deltaMs);

    // Spawn test balls every 5 seconds
    if (now - this.lastBallSpawnTime > 5000) {
      this.spawnTestBall();
      this.lastBallSpawnTime = now;
    }

    // Camera follows player in character control mode
    const playerPos = this.player.getPosition();
    if (this.characterControlMode) {
      this.camera.x = playerPos.x;
      this.camera.y = playerPos.y;
    }

    // Remesh if needed
    if (this.needsRemesh) {
      this.remesh();
      this.needsRemesh = false;
    }

    // Render with player, all balls, and physics debug

    // Convert Rapier balls to format expected by Renderer
    const ballsForRender = this.ballBodies.map(ball => {
      const translation = ball.translation();
      const collider = ball.collider(0);
      const radius = collider ? (collider.shape as RAPIER.Ball).radius : 0.5;
      return {
        position: { x: translation.x, y: translation.y },
        circleRadius: radius
      };
    });

    // Create physics debug draw callback
    const physicsDebugDraw = (ctx: CanvasRenderingContext2D, width: number, height: number) => {
      this.physics.debugDraw(ctx, this.camera, width, height);
    };

    // Create player debug draw callback
    const playerDebugDraw = (ctx: CanvasRenderingContext2D, width: number, height: number) => {
      this.player.debugDraw(ctx, this.camera, width, height);
    };

    // Create joystick draw callback
    const joystickDraw = (ctx: CanvasRenderingContext2D) => {
      this.joystick.render(ctx);
    };

    this.renderer.render(playerPos, this.player.getRadius(), ballsForRender, physicsDebugDraw, playerDebugDraw, joystickDraw);
  };

  private remesh(): void {
    const stats = this.remeshManager.remesh();

    if (stats) {
      // Update local stats for UI
      this.originalVertexCount = stats.originalVertexCount;
      this.finalVertexCount = stats.finalVertexCount;
      this.simplificationReduction = stats.simplificationReduction;
      this.postSimplificationReduction = stats.postSimplificationReduction;

      // Update debug console stats
      if ((window as any).debugConsole) {
        (window as any).debugConsole.updateStats(
          this.originalVertexCount,
          this.finalVertexCount,
          this.simplificationReduction,
          this.postSimplificationReduction
        );
      }
    }
  }

  private updateFPS(): void {
    this.frameCount++;
    const now = performance.now();

    if (now - this.lastFpsTime >= 1000) {
      this.fps = Math.round((this.frameCount * 1000) / (now - this.lastFpsTime));
      this.frameCount = 0;
      this.lastFpsTime = now;

      // Update FPS display
      const fpsElement = document.getElementById('fps-value');
      if (fpsElement) {
        fpsElement.textContent = this.fps.toString();
        console.log(`FPS updated: ${this.fps}`);
      } else {
        console.warn('fps-value element not found');
      }

      // Update memory display
      const memoryElement = document.getElementById('memory-value');
      if (memoryElement && (performance as any).memory) {
        const memoryMB = ((performance as any).memory.usedJSHeapSize / 1024 / 1024).toFixed(1);
        memoryElement.textContent = memoryMB;
        console.log(`Memory updated: ${memoryMB} MB`);
      } else if (!memoryElement) {
        console.warn('memory-value element not found');
      } else {
        console.warn('performance.memory API not available');
      }
    }
  }

  stop(): void {
    if (this.animationFrameId) {
      cancelAnimationFrame(this.animationFrameId);
    }
  }

  /**
   * Update simplification epsilon and remesh
   */
  setSimplificationEpsilon(epsilon: number): void {
    this.simplificationEpsilon = epsilon;
    this.remeshManager.updateOptimizationOptions({ simplificationEpsilon: epsilon });
    this.needsRemesh = true;
    this.remeshManager.requestFullHeal();
  }

  setChaikinEnabled(enabled: boolean): void {
    this.chaikinEnabled = enabled;
    this.remeshManager.updateOptimizationOptions({ chaikinEnabled: enabled });
    this.needsRemesh = true;
    this.remeshManager.requestFullHeal();
  }

  setChaikinIterations(iterations: number): void {
    this.chaikinIterations = iterations;
    this.remeshManager.updateOptimizationOptions({ chaikinIterations: iterations });
    this.needsRemesh = true;
    this.remeshManager.requestFullHeal();
  }

  setSimplificationEpsilonPost(epsilon: number): void {
    this.simplificationEpsilonPost = epsilon;
    this.remeshManager.updateOptimizationOptions({ simplificationEpsilonPost: epsilon });
    this.needsRemesh = true;
    this.remeshManager.requestFullHeal();
  }

  getSimplificationReduction(): number {
    return this.simplificationReduction;
  }

  getPostSimplificationReduction(): number {
    return this.postSimplificationReduction;
  }

  /**
   * Toggle control mode between character control and camera pan/zoom
   * @param enabled - true for character control, false for camera control
   */
  setControlMode(enabled: boolean): void {
    this.characterControlMode = enabled;

    // Enable/disable camera controls (inverse of character control mode)
    this.inputHandler.setCameraControlsEnabled(!enabled);

    // Show/hide virtual joystick
    this.joystick.setVisible(enabled);

    console.log(`[ControlMode] Switched to ${enabled ? 'CHARACTER' : 'CAMERA'} control mode`);
  }
}

// Log that module is loading
console.log('main.ts module loading...');
(window as any).APP_LOADED = true;

// Log to simple log if available
if ((window as any).log) {
  (window as any).log('✓ main.ts module loaded!');
}

// Initialize debug console (hidden by default)
let debugConsole: DebugConsole;
try {
  debugConsole = new DebugConsole();
  (window as any).debugConsole = debugConsole; // Make accessible for stats updates
  console.log('Debug console created (hidden by default)');
} catch (error) {
  console.error('Failed to create debug console:', error);
  alert('Failed to create debug console: ' + error);
  throw error;
}

// Debug buttons are now created and managed by DebugConsole.ts

// Wire up debug console toggle callbacks to renderer (will be set after app is created)
let appRenderer: Renderer | null = null;

debugConsole.onTogglePhysicsMesh = (enabled: boolean) => {
  if (appRenderer) {
    appRenderer.showPhysicsBodies = enabled;
    console.log(`Physics mesh visualization: ${enabled ? 'ON' : 'OFF'}`);
  }
};

debugConsole.onToggleOptimizedVertices = (enabled: boolean) => {
  if (appRenderer) {
    appRenderer.showVertices = enabled;
    console.log(`Optimized vertices visualization: ${enabled ? 'ON' : 'OFF'}`);
  }
};

debugConsole.onToggleOriginalVertices = (enabled: boolean) => {
  if (appRenderer) {
    appRenderer.showOriginalVertices = enabled;
    console.log(`Original vertices visualization: ${enabled ? 'ON' : 'OFF'}`);
  }
};

debugConsole.onToggleGrid = (enabled: boolean) => {
  if (appRenderer) {
    appRenderer.showGrid = enabled;
    console.log(`Grid visualization: ${enabled ? 'ON' : 'OFF'}`);
  }
};

debugConsole.onToggleDensityField = (enabled: boolean) => {
  if (appRenderer) {
    appRenderer.showDensityField = enabled;
    console.log(`Density field visualization: ${enabled ? 'ON' : 'OFF'}`);
  }
};

debugConsole.onSimplificationChange = (epsilon: number) => {
  if (app) {
    app.setSimplificationEpsilon(epsilon);
    console.log(`Simplification epsilon changed to ${epsilon.toFixed(3)}m`);
  }
};

debugConsole.onSimplificationPostChange = (epsilon: number) => {
  if (app) {
    app.setSimplificationEpsilonPost(epsilon);
    console.log(`Post-smoothing simplification epsilon changed to ${epsilon.toFixed(3)}m`);
  }
};

debugConsole.onToggleChaikin = (enabled: boolean) => {
  if (app) {
    app.setChaikinEnabled(enabled);
    console.log(`Chaikin smoothing: ${enabled ? 'ON' : 'OFF'}`);
  }
};

debugConsole.onChaikinIterationsChange = (iterations: number) => {
  if (app) {
    app.setChaikinIterations(iterations);
    console.log(`Chaikin iterations changed to ${iterations}`);
  }
};

debugConsole.onToggleControlMode = (enabled: boolean) => {
  if (app) {
    app.setControlMode(enabled);
    console.log(`Control mode: ${enabled ? 'CHARACTER' : 'CAMERA'}`);
  }
};

console.log('===========================================');
console.log('Carvable Caves PWA');
console.log('===========================================');
console.log('');
console.log('🐛 Click the bug button to open debug console');
console.log('');
console.log('If stuck on old version:');
console.log('1. Force quit Safari and reopen');
console.log('2. Delete PWA from home screen and reinstall');
console.log('3. Settings > Safari > Clear History and Website Data');
console.log('');

// Start the application
console.log('Starting application...');
let app: CarvableCaves;
try {
  app = new CarvableCaves();
  // Expose renderer to debug console callbacks
  appRenderer = (app as any).renderer;
} catch (error) {
  console.error('Fatal error during initialization:', error);
  debugConsole.showTextLog();
  throw error;
}

// ===================================================
// Version checking for cache busting
// ===================================================

const versionChecker = new VersionChecker();
versionChecker.setUpdateCallback(VersionChecker.showUpdateButton);
versionChecker.startPolling();

// ===================================================
// Service Worker Registration
// ===================================================

// Register service worker for PWA with update detection
if ('serviceWorker' in navigator) {
  // Use vite-plugin-pwa's virtual module for service worker registration
  import('virtual:pwa-register').then(({ registerSW }) => {
    const updateButton = document.getElementById('update-button');

    const updateSW = registerSW({
      immediate: true,
      onNeedRefresh() {
        // Show the update button when a new version is available
        console.log('Service worker detected update');
        VersionChecker.showUpdateButton();
      },
      onOfflineReady() {
        console.log('App ready to work offline');
      },
      onRegisteredSW(swUrl, registration) {
        console.log('Service Worker registered:', swUrl);

        // Check for updates every 60 seconds
        if (registration) {
          setInterval(() => {
            console.log('Checking for service worker updates...');
            registration.update();
          }, 60000);
        }
      }
    });

    // Handle update button click
    if (updateButton) {
      updateButton.addEventListener('click', () => {
        console.log('Update button clicked - reloading app');
        updateSW(true).then(() => {
          VersionChecker.reloadApp();
        });
      });
    }
  }).catch((error) => {
    // Service worker registration failed (expected in dev mode)
    console.log('Service worker registration skipped:', error?.message || 'dev mode');
  });
}

export { app };
