import { Camera } from './Camera';
import { DensityField } from './DensityField';
import { MarchingSquares } from './MarchingSquares';
import { Renderer } from './Renderer';
import { DebugConsole } from './DebugConsole';
import { CaveGeneratorUI, type PerlinCaveParams } from './CaveGeneratorUI';
import { CharacterControllerUI } from './CharacterControllerUI';
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

  // Spawn position tracking
  private preferredSpawnX = 0;
  private preferredSpawnY = 0;
  private playerRadius = 0.6;

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
      // World configuration
      const worldConfig: WorldConfig = {
        width: 128, // metres
        height: 128, // metres
        gridPitch: 0.25, // metres (h)
        isoValue: 128
      };

      // Setup canvas
      this.canvas = document.getElementById('canvas') as HTMLCanvasElement;
      if (!this.canvas) {
        throw new Error('Canvas not found');
      }

      // Initialize camera (centered on world, zoomed out for better view)
      this.camera = new Camera(
        worldConfig.width / 2,
        worldConfig.height / 2,
        30, // initial PPM (pixels per metre) - zoomed out for wider view
        worldConfig.width,
        worldConfig.height
      );

      // Initialize density field
      this.densityField = new DensityField(worldConfig);

      // Generate initial cave system
      this.densityField.generateCaves(undefined, 0.05, 4, 0.1);

      // Player spawn position (validated to be in empty area)
      const preferredSpawnX = worldConfig.width / 2;
      const preferredSpawnY = worldConfig.height / 2;
      const playerRadius = 0.6; // Player capsule radius (must match RapierPlayer)

      // Store for later use in start()
      this.preferredSpawnX = preferredSpawnX;
      this.preferredSpawnY = preferredSpawnY;
      this.playerRadius = playerRadius;

      // Initialize marching squares
      this.marchingSquares = new MarchingSquares(this.densityField, worldConfig.isoValue);

      // Initialize loop cache
      this.loopCache = new LoopCache();

      // Initialize renderer
      this.renderer = new Renderer(this.canvas, this.camera);
      this.renderer.setDensityField(this.densityField); // For debug visualization

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

      // Initialize physics (will be initialized async in start())
      this.physics = new RapierPhysics();

      // Initialize virtual joystick for mobile controls
      this.joystick = new VirtualJoystick();

      // Setup UI
      this.setupUI();

      // Window resize and orientation change handling using requestAnimationFrame pattern
      const handleResize = () => {
        // Debounce: only schedule one resize per animation frame
        if (this.pendingResize) return;
        this.pendingResize = true;

        requestAnimationFrame(() => {
          this.pendingResize = false;
          this.renderer.resize();
        });
      };

      // Listen to resize on both window and visualViewport (if available)
      window.addEventListener('resize', handleResize);

      // Visual Viewport API - handles mobile keyboard, zoom, and orientation
      if (window.visualViewport) {
        window.visualViewport.addEventListener('resize', handleResize);
      }

      // Fallback for older browsers: orientationchange event
      window.addEventListener('orientationchange', handleResize);

      // Update joystick position on window resize
      window.addEventListener('resize', () => {
        this.joystick.handleResize();
      });

      // Start render loop (async initialization happens there)
      this.start(worldConfig.gridPitch);
    } catch (error) {
      console.error('Failed to initialize CarvableCaves:', error);
      throw error;
    }
  }

  private setupUI(): void {
    // UI elements removed - all debug functionality now in debug console
  }

  private async start(gridPitch: number): Promise<void> {
    // Initialize Rapier physics
    await this.physics.init();

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

    // Generate initial mesh and physics bodies
    this.remesh();

    // Find valid spawn position for player
    console.log(`[Player] Finding valid spawn position near (${this.preferredSpawnX.toFixed(1)}, ${this.preferredSpawnY.toFixed(1)})...`);
    const spawnPos = this.findValidSpawnPosition(
      this.preferredSpawnX,
      this.preferredSpawnY,
      this.playerRadius
    );

    let actualSpawnX = this.preferredSpawnX;
    let actualSpawnY = this.preferredSpawnY;

    if (spawnPos) {
      actualSpawnX = spawnPos.x;
      actualSpawnY = spawnPos.y;
      console.log(`[Player] Spawning at validated position (${actualSpawnX.toFixed(1)}, ${actualSpawnY.toFixed(1)})`);
    } else {
      console.warn(`[Player] No valid position found, spawning at preferred position (may be inside rock)`);
    }

    // Create player after physics world is ready
    this.player = new RapierPlayer(this.physics, actualSpawnX, actualSpawnY);
    this.player.setJoystick(this.joystick); // Connect joystick to player

    // Start render loop
    this.loop();
  }

  /**
   * Find a valid spawn position in an empty area by searching the density field directly
   * @param preferredX - Preferred X position
   * @param preferredY - Preferred Y position
   * @param entityRadius - Radius of entity to spawn (for collision checking)
   * @returns Valid spawn position or null if none found
   */
  private findValidSpawnPosition(
    preferredX: number,
    preferredY: number,
    entityRadius: number
  ): { x: number; y: number } | null {
    // Try preferred position first
    if (this.isValidSpawnPosition(preferredX, preferredY, entityRadius)) {
      return { x: preferredX, y: preferredY };
    }

    // Search the density field in a spiral pattern outward from preferred position
    const gridPitch = this.densityField.config.gridPitch;
    const { gridX: centerGridX, gridY: centerGridY } = this.densityField.worldToGrid(preferredX, preferredY);

    const maxRadius = Math.max(this.densityField.gridWidth, this.densityField.gridHeight);

    // Spiral search: check positions at increasing distances from center
    for (let radius = 1; radius < maxRadius; radius++) {
      // Check positions in a square ring at this radius
      for (let dx = -radius; dx <= radius; dx++) {
        for (let dy = -radius; dy <= radius; dy++) {
          // Only check perimeter of square (not interior)
          if (Math.abs(dx) !== radius && Math.abs(dy) !== radius) {
            continue;
          }

          const gridX = centerGridX + dx;
          const gridY = centerGridY + dy;

          // Convert back to world coordinates
          const { worldX, worldY } = this.densityField.gridToWorld(gridX, gridY);

          // Check if this position is valid
          if (this.isValidSpawnPosition(worldX, worldY, entityRadius)) {
            const distance = Math.sqrt(
              (worldX - preferredX) ** 2 +
              (worldY - preferredY) ** 2
            );
            console.log(`[Spawn] Found valid position ${distance.toFixed(1)}m away at (${worldX.toFixed(1)}, ${worldY.toFixed(1)})`);
            return { x: worldX, y: worldY };
          }
        }
      }
    }

    // No valid position found in entire world
    console.error('[Spawn] No valid spawn position found in entire world');
    return null;
  }

  /**
   * Check if a position is valid for spawning (not inside rock)
   * @param x - X position in world coordinates
   * @param y - Y position in world coordinates
   * @param radius - Radius of entity (check center and edges)
   * @returns true if position is valid (in empty area)
   */
  private isValidSpawnPosition(x: number, y: number, radius: number): boolean {
    // Check center
    if (!this.densityField.isEmptyArea(x, y)) {
      return false;
    }

    // Check points around the perimeter (8 points)
    const numChecks = 8;
    for (let i = 0; i < numChecks; i++) {
      const angle = (i / numChecks) * Math.PI * 2;
      const checkX = x + Math.cos(angle) * radius;
      const checkY = y + Math.sin(angle) * radius;

      if (!this.densityField.isEmptyArea(checkX, checkY)) {
        return false;
      }
    }

    return true;
  }

  /**
   * Spawn a test ball at random position in the world (with spawn validation)
   */
  private spawnTestBall(): void {
    const margin = 2; // Stay 2m away from edges
    const worldWidth = this.densityField.config.width;
    const worldHeight = this.densityField.config.height;
    const radius = 0.5;

    // Try to find a random valid spawn position
    const preferredX = margin + Math.random() * (worldWidth - 2 * margin);
    const preferredY = margin + Math.random() * (worldHeight - 2 * margin);

    const spawnPos = this.findValidSpawnPosition(preferredX, preferredY, radius);

    if (spawnPos) {
      const ball = this.physics.createBall(spawnPos.x, spawnPos.y, radius);
      this.ballBodies.push(ball);
      console.log(`[Ball] Spawned at validated position (${spawnPos.x.toFixed(1)}, ${spawnPos.y.toFixed(1)})`);
    } else {
      console.warn('[Ball] Failed to spawn ball: no valid position found (world may be too full of rock)');
      // Don't spawn the ball if no valid position is found
    }
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

    // Camera smoothly follows player in character control mode
    const playerPos = this.player.getPosition();
    if (this.characterControlMode) {
      // Use smooth following with lerp factor of 0.08 for gentle camera movement
      this.camera.smoothFollow(playerPos.x, playerPos.y, 0.08);
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
   * Regenerate caves using Perlin noise
   */
  regenerateCaves(params: PerlinCaveParams): void {
    console.log('[Main] Regenerating caves with Perlin noise...');

    // Check if world size has changed
    if (params.worldWidth !== this.densityField.config.width ||
        params.worldHeight !== this.densityField.config.height) {
      console.log(`[Main] Resizing world from ${this.densityField.config.width}×${this.densityField.config.height} to ${params.worldWidth}×${params.worldHeight}`);
      this.densityField.resize(params.worldWidth, params.worldHeight);

      // Update camera bounds
      this.camera.worldWidth = params.worldWidth;
      this.camera.worldHeight = params.worldHeight;
    }

    // Generate new caves with Perlin noise
    this.densityField.generateCaves(params.seed, params.scale, params.octaves, params.threshold);

    // Clear existing balls
    for (const ball of this.ballBodies) {
      this.physics.removeBody(ball);
    }
    this.ballBodies = [];

    // Trigger remesh to update physics bodies before spawning
    this.needsRemesh = true;
    this.remeshManager.requestFullHeal();
    this.remesh();

    // Reset player to center of world (with validation)
    const preferredX = params.worldWidth / 2;
    const preferredY = params.worldHeight / 2;

    const spawnPos = this.findValidSpawnPosition(preferredX, preferredY, this.playerRadius);

    let actualSpawnX = preferredX;
    let actualSpawnY = preferredY;

    if (spawnPos) {
      actualSpawnX = spawnPos.x;
      actualSpawnY = spawnPos.y;
      console.log(`[Regenerate] Player respawned at validated position (${actualSpawnX.toFixed(1)}, ${actualSpawnY.toFixed(1)})`);
    } else {
      console.warn('[Regenerate] No valid spawn position found, using preferred position (may be inside rock)');
    }

    if (this.player) {
      this.player.respawn(actualSpawnX, actualSpawnY);
    }

    // Center camera on spawn
    this.camera.x = actualSpawnX;
    this.camera.y = actualSpawnY;
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
  }

  /**
   * Respawn player at camera center (for iOS touch button)
   */
  respawnPlayer(): void {
    if (this.player) {
      const spawnPos = this.findValidSpawnPosition(this.camera.x, this.camera.y, this.playerRadius);

      let actualSpawnX = this.camera.x;
      let actualSpawnY = this.camera.y;

      if (spawnPos) {
        actualSpawnX = spawnPos.x;
        actualSpawnY = spawnPos.y;
        console.log(`[Respawn] Player respawned at validated position (${actualSpawnX.toFixed(1)}, ${actualSpawnY.toFixed(1)})`);
      } else {
        console.warn(`[Respawn] No valid spawn position found near camera, using camera center (may be inside rock)`);
      }

      this.player.respawn(actualSpawnX, actualSpawnY);
    }
  }
}

(window as any).APP_LOADED = true;

// Initialize debug console (hidden by default)
let debugConsole: DebugConsole;
try {
  debugConsole = new DebugConsole();
  (window as any).debugConsole = debugConsole; // Make accessible for stats updates
} catch (error) {
  console.error('Failed to create debug console:', error);
  alert('Failed to create debug console: ' + error);
  throw error;
}

// Debug buttons are now created and managed by DebugConsole.ts

// Wire up debug console toggle callbacks to renderer (will be set after app is created)
let appRenderer: Renderer | null = null;
let appPhysics: any = null;

debugConsole.onTogglePhysicsMesh = (enabled: boolean) => {
  if (appRenderer) {
    appRenderer.showPhysicsBodies = enabled;
  }
  // IMPORTANT: Also enable debug in physics engine (needed for debugDraw to work)
  if (appPhysics) {
    appPhysics.setDebugEnabled(enabled);
  }
};

debugConsole.onToggleOptimizedVertices = (enabled: boolean) => {
  if (appRenderer) {
    appRenderer.showVertices = enabled;
  }
};

debugConsole.onToggleOriginalVertices = (enabled: boolean) => {
  if (appRenderer) {
    appRenderer.showOriginalVertices = enabled;
  }
};

debugConsole.onToggleGrid = (enabled: boolean) => {
  if (appRenderer) {
    appRenderer.showGrid = enabled;
  }
};

debugConsole.onToggleDensityField = (enabled: boolean) => {
  if (appRenderer) {
    appRenderer.showDensityField = enabled;
  }
};

debugConsole.onSimplificationChange = (epsilon: number) => {
  if (app) {
    app.setSimplificationEpsilon(epsilon);
  }
};

debugConsole.onSimplificationPostChange = (epsilon: number) => {
  if (app) {
    app.setSimplificationEpsilonPost(epsilon);
  }
};

debugConsole.onToggleChaikin = (enabled: boolean) => {
  if (app) {
    app.setChaikinEnabled(enabled);
  }
};

debugConsole.onChaikinIterationsChange = (iterations: number) => {
  if (app) {
    app.setChaikinIterations(iterations);
  }
};

debugConsole.onToggleControlMode = (enabled: boolean) => {
  if (app) {
    app.setControlMode(enabled);
  }
};

debugConsole.onRespawn = () => {
  if (app) {
    app.respawnPlayer();
  }
};

debugConsole.onToggleCaveGen = () => {
  if (caveGeneratorUI) {
    caveGeneratorUI.toggle();
  }
};

// Initialize cave generator UI (hidden by default)
let caveGeneratorUI: CaveGeneratorUI;
try {
  caveGeneratorUI = new CaveGeneratorUI();
} catch (error) {
  console.error('Failed to create cave generator UI:', error);
  alert('Failed to create cave generator UI: ' + error);
  throw error;
}

// Wire up cave generator callback
caveGeneratorUI.onGenerate = (params) => {
  if (app) {
    app.regenerateCaves(params);
  }
};

// Initialize character controller UI (hidden by default)
let characterControllerUI: CharacterControllerUI;
try {
  characterControllerUI = new CharacterControllerUI();
} catch (error) {
  console.error('Failed to create character controller UI:', error);
  throw error;
}

// Create character controller UI toggle button
const controllerButton = document.createElement('button');
controllerButton.id = 'controller-button';
controllerButton.textContent = '⚙️';
controllerButton.title = 'Character Controller Settings';
controllerButton.style.cssText = `
  position: fixed;
  bottom: calc(env(safe-area-inset-bottom, 10px) + 200px);
  left: calc(env(safe-area-inset-left, 10px) + 10px);
  background: rgba(66, 66, 66, 0.95);
  border-radius: 50%;
  width: 54px;
  height: 54px;
  border: 2px solid rgba(255, 255, 0, 0.5);
  cursor: pointer;
  font-size: 24px;
  display: flex;
  align-items: center;
  justify-content: center;
  z-index: 10001;
  box-shadow: 0 2px 8px rgba(0, 0, 0, 0.3);
`;
controllerButton.addEventListener('click', () => {
  characterControllerUI.toggle();
});
document.body.appendChild(controllerButton);

// Start the application
let app: CarvableCaves;
let appPlayer: any = null;

try {
  app = new CarvableCaves();
  // Expose renderer, physics, and player to debug console callbacks
  appRenderer = (app as any).renderer;
  appPhysics = (app as any).physics;
  appPlayer = (app as any).player;

  // Enable physics debug by default (since showPhysicsBodies defaults to true)
  if (appPhysics && appRenderer?.showPhysicsBodies) {
    appPhysics.setDebugEnabled(true);
  }

  // Wire up character controller UI callbacks
  if (appPlayer) {
    characterControllerUI.onForceChange = (force) => {
      appPlayer.setMovementForce(force);
    };
    characterControllerUI.onDragChange = (drag) => {
      appPlayer.setDrag(drag);
    };

    // Initialize UI with current values
    characterControllerUI.updateValues(
      appPlayer.getMovementForce(),
      appPlayer.getDrag()
    );
  }
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
        VersionChecker.showUpdateButton();
      },
      onOfflineReady() {
        // App ready to work offline
      },
      onRegisteredSW(swUrl, registration) {
        // Check for updates every 60 seconds
        if (registration) {
          setInterval(() => {
            registration.update();
          }, 60000);
        }
      }
    });

    // Handle update button click
    if (updateButton) {
      updateButton.addEventListener('click', () => {
        updateSW(true).then(() => {
          VersionChecker.reloadApp();
        });
      });
    }
  }).catch(() => {
    // Service worker registration failed (expected in dev mode)
  });
}

export { app };
