import { Camera } from './Camera';
import { DensityField } from './DensityField';
import { MarchingSquares } from './MarchingSquares';
import { Renderer } from './Renderer';
import { DebugConsole } from './DebugConsole';
import { CaveGeneratorUI, type PerlinCaveParams } from './CaveGeneratorUI';
import { LoopCache } from './LoopCache';
import { InputHandler } from './InputHandler';
import { Box2DPhysics } from './Box2DPhysics';
import { VirtualJoystick } from './VirtualJoystick';
import { RemeshManager, type RemeshStats } from './RemeshManager';
import { VersionChecker } from './VersionChecker';
import type { WorldConfig, BrushSettings, Vec2 } from './types';
import { CapsuleController } from './controllers/CapsuleController';
import type { IPlayerController } from './controllers/IPlayerController';
import { BrushGenerator, type Brush } from './BrushGenerator';
import { PipelineConfig, DEFAULT_CONFIG } from './PipelineConfig';
import type { CarvingDebugContext, CarvingDebugHooks } from './carving/CarvingDebugHooks';
import { WaterGrid } from './water/WaterGrid';
import { MacVelocityGrid } from './water/MacVelocityGrid';

/**
 * Main application
 */
class CarvableCaves {
  // Pipeline configuration
  private config: PipelineConfig;

  private canvas: HTMLCanvasElement;
  private camera: Camera;
  private densityField: DensityField;
  private marchingSquares: MarchingSquares;
  private renderer: Renderer;
  private loopCache: LoopCache;
  private inputHandler: InputHandler;
  private physics: Box2DPhysics;
  private player: IPlayerController | null = null; // Current active player controller
  private joystick: VirtualJoystick;
  private remeshManager!: RemeshManager; // Initialized after physics
  private waterGrid: WaterGrid | null = null;
  private waterVelocity: MacVelocityGrid | null = null;

  private needsRemesh = true;
  private animationFrameId = 0;

  // Performance tracking
  private frameCount = 0;
  private lastFpsTime = performance.now();
  private fps = 0;
  private lastPhysicsTime = 0;

  // Resize handling
  private pendingResize = false;

  // Spawn position tracking
  private preferredSpawnX = 0;
  private preferredSpawnY = 0;

  // Reduction statistics for UI display
  private simplificationReduction = 0; // percentage
  private postSimplificationReduction = 0; // percentage
  private originalVertexCount = 0; // vertices from Marching Squares
  private finalVertexCount = 0; // vertices after full pipeline

  // Automated joystick test (for debugging movement)
  private testStartFrame = 0;
  private testPhase: 'waiting' | 'input' | 'release' | 'done' = 'waiting';

  // Carving brush (cached for efficiency)
  private carveBrush: Brush | null = null;

  // Optional step-by-step carving debug controller (installed only in debug builds)
  private carvingDebugHooks: CarvingDebugHooks | null = null;

  constructor() {
    try {
      // Initialize pipeline configuration
      this.config = DEFAULT_CONFIG;

      // Get world configuration from pipeline config
      const worldConfig = this.config.getWorldConfig();

      // Setup canvas
      this.canvas = document.getElementById('canvas') as HTMLCanvasElement;
      if (!this.canvas) {
        throw new Error('Canvas not found');
      }

      // Initialize camera (centered on world, zoomed in for better view)
      const cameraPos = this.config.getCameraInitialPosition();
      this.camera = new Camera(
        cameraPos.x,
        cameraPos.y,
        this.config.cameraInitialZoom,
        this.config.worldWidth,
        this.config.worldHeight,
        this.config // Pass config for camera parameters
      );

      // Initialize density field
      this.densityField = new DensityField(worldConfig);

      // Generate initial cave system with configured parameters
      this.densityField.generateCaves(
        undefined,
        this.config.perlinScale,
        this.config.perlinOctaves,
        this.config.perlinThreshold
      );

      // Player spawn position (validated to be in empty area)
      const spawnPos = this.config.getPlayerSpawnPosition();
      this.preferredSpawnX = spawnPos.x;
      this.preferredSpawnY = spawnPos.y;

      // Initialize marching squares with config
      this.marchingSquares = new MarchingSquares(
        this.densityField,
        worldConfig.isoValue,
        this.config
      );

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
      this.inputHandler.setCameraControlsEnabled(!this.config.characterControlMode);

      // Initialize physics (will be initialized async in start())
      this.physics = new Box2DPhysics();

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
      // console.error('Failed to initialize CarvableCaves:', error);
      throw error;
    }
  }

  private setupUI(): void {
    // UI elements removed - all debug functionality now in debug console
  }

  private async start(gridPitch: number): Promise<void> {
    // Initialize Box2D physics
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
        simplificationEpsilon: this.config.simplificationEpsilon,
        chaikinEnabled: this.config.chaikinEnabled,
        chaikinIterations: this.config.chaikinIterations,
        simplificationEpsilonPost: this.config.simplificationEpsilonPost,
        closed: true // Full loops are closed (warm segments will override this)
      }
    });

    // Generate initial mesh and physics bodies
    this.remesh();
    this.needsRemesh = false; // Prevent double-remesh on first frame

    // Find valid spawn position using density field (retry up to configured max)
    let actualSpawnX = this.preferredSpawnX;
    let actualSpawnY = this.preferredSpawnY;
    let spawnPos = null;

    for (let attempt = 0; attempt < this.config.spawnMaxRetries; attempt++) {
      spawnPos = this.findValidSpawnPosition(
        this.preferredSpawnX,
        this.preferredSpawnY,
        this.config.playerSpawnRadius
      );

      if (spawnPos) {
        actualSpawnX = spawnPos.x;
        actualSpawnY = spawnPos.y;
        break; // Found valid spawn!
      } else {
        // Regenerate world with new random seed
        this.densityField.generateCaves(
          undefined,
          this.config.perlinScale,
          this.config.perlinOctaves,
          -0.2 // More caves for spawn search
        );
        this.remesh();
      }
    }

    // Create capsule controller
    const world = this.physics.getEngine().getWorld();
    this.player = new CapsuleController(world, actualSpawnX, actualSpawnY);

    this.rebuildWaterGrid();

    // Register player's update with physics engine
    this.physics.getEngine().registerFixedUpdate((dt) => {
      if (this.player) {
        // Get input from joystick
        const joystickDir = this.joystick.getInput();
        this.player.setJoystick(joystickDir); // Pass joystick input

        // Update player (dt is in milliseconds)
        this.player.update(dt);
      }
    });

    // Register water simulation step with physics engine (runs at fixed 60Hz)
    this.physics.getEngine().registerFixedUpdate((dt) => {
      this.waterGrid?.tickSource(dt);
      this.waterVelocity?.step(dt, this.waterGrid);
      if (this.waterGrid && this.waterVelocity) {
        this.waterGrid.advectWithVelocity(dt, this.waterVelocity, 2);
      } else {
        this.waterGrid?.step(dt, 1);
      }
    });

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
            return { x: worldX, y: worldY };
          }
        }
      }
    }

    // No valid position found in entire world
    // console.error('[Spawn] No valid spawn position found in entire world');
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
    // CRITICAL: Add extra margin to account for marching squares interpolation
    // and smoothing pushing physics colliders into "empty" density field areas
    const checkRadius = radius + this.config.spawnSafetyMargin;

    // Check center
    if (!this.densityField.isEmptyArea(x, y)) {
      return false;
    }

    // Check points around the perimeter (with margin)
    for (let i = 0; i < this.config.spawnPerimeterChecks; i++) {
      const angle = (i / this.config.spawnPerimeterChecks) * Math.PI * 2;
      const checkX = x + Math.cos(angle) * checkRadius;
      const checkY = y + Math.sin(angle) * checkRadius;

      if (!this.densityField.isEmptyArea(checkX, checkY)) {
        return false;
      }
    }

    // Additional check: ensure we're not in a tiny pocket
    // Check cardinal directions at configured distance to ensure decent open space
    if (!this.densityField.isEmptyArea(x + this.config.spawnOpenSpaceCheck, y)) return false;
    if (!this.densityField.isEmptyArea(x - this.config.spawnOpenSpaceCheck, y)) return false;
    if (!this.densityField.isEmptyArea(x, y + this.config.spawnOpenSpaceCheck)) return false;
    if (!this.densityField.isEmptyArea(x, y - this.config.spawnOpenSpaceCheck)) return false;

    return true;
  }

  /**
   * Spawn a test ball at random position in the world (with spawn validation)
   * COMMENTED OUT: Not using balls anymore
   */
  // private spawnTestBall(): void {
  //   const margin = 2; // Stay 2m away from edges
  //   const worldWidth = this.densityField.config.width;
  //   const worldHeight = this.densityField.config.height;
  //   const radius = 0.5;

  //   // Try to find a random valid spawn position
  //   const preferredX = margin + Math.random() * (worldWidth - 2 * margin);
  //   const preferredY = margin + Math.random() * (worldHeight - 2 * margin);

  //   const spawnPos = this.findValidSpawnPosition(preferredX, preferredY, radius);

  //   if (spawnPos) {
  //     const ball = this.physics.createBall(spawnPos.x, spawnPos.y, radius);
  //     this.ballBodies.push(ball);
  //   }
  // }

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

    // Automated joystick test (for debugging movement)
    if (this.config.testEnabled) {
      this.runAutomatedTest();
    }

    // Update physics simulation with fixed timestep (60Hz)
    // Player updates are registered as fixed callbacks inside the physics engine
    this.physics.update(deltaMs);

    // Get player position for camera
    const playerPos = this.player.getPosition();

    // Get player velocity for advanced camera (look-ahead and dynamic zoom)
    const playerBody = this.player.getBody();
    const velocity = playerBody.GetLinearVelocity();

    // Camera follows player with advanced features in character control mode
    if (this.config.characterControlMode) {
      // Use advanced camera with velocity-based zoom and look-ahead
      // deltaMs is in milliseconds, convert to seconds
      this.camera.followPlayer(playerPos.x, playerPos.y, velocity.x, velocity.y, deltaMs / 1000);
    }

    // Remesh if needed
    if (this.needsRemesh) {
      this.remesh();
      this.needsRemesh = false;
    }

    // Create physics debug draw callback
    const physicsDebugDraw = (ctx: CanvasRenderingContext2D, width: number, height: number) => {
      this.physics.debugDraw(ctx, this.camera, width, height);
    };

    // Create joystick draw callback
    const joystickDraw = (ctx: CanvasRenderingContext2D) => {
      this.joystick.render(ctx);
    };

    // Get player direction
    const playerDirection = this.player.getDirection ? this.player.getDirection() : undefined;

    // Render (simple circle player with direction indicator)
    this.renderer.render(
      playerPos,
      this.player.getRadius(),
      [],
      physicsDebugDraw,
      undefined,
      joystickDraw,
      playerDirection
    );
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

  /**
   * Run automated joystick test to debug movement
   * Test sequence:
   * 1. Wait 60 frames (~1 second) to settle
   * 2. Apply small upward force for 10 frames
   * 3. Release for 20 frames and observe behavior
   */
  private runAutomatedTest(): void {
    const currentFrame = this.frameCount;

    switch (this.testPhase) {
      case 'waiting':
        // Wait 60 frames to settle
        if (this.testStartFrame === 0) {
          this.testStartFrame = currentFrame;
          // console.log('[TEST] ========================================');
          // console.log('[TEST] AUTOMATED JOYSTICK TEST STARTING');
          // console.log('[TEST] Phase 1: Waiting 60 frames to settle...');
          // console.log('[TEST] ========================================');
        }
        if (currentFrame - this.testStartFrame >= 60) {
          this.testPhase = 'input';
          // console.log('[TEST] ========================================');
          // console.log('[TEST] Phase 2: Applying small upward force (y=-0.2) for 10 frames...');
          // console.log('[TEST] ========================================');
        }
        break;

      case 'input':
        // Apply small upward force for 10 frames
        // Note: VirtualJoystick y is -1 for up
        this.joystick.injectTestInput(0, -0.2);

        if (currentFrame - this.testStartFrame >= 70) {
          this.testPhase = 'release';
          // console.log('[TEST] ========================================');
          // console.log('[TEST] Phase 3: RELEASED - Observing for 20 frames...');
          // console.log('[TEST] Watch for: input→0, forces→0, velocities decreasing');
          // console.log('[TEST] ========================================');
        }
        break;

      case 'release':
        // Release joystick (zero input)
        this.joystick.injectTestInput(0, 0);

        if (currentFrame - this.testStartFrame >= 90) {
          this.testPhase = 'done';
          // console.log('[TEST] ========================================');
          // console.log('[TEST] TEST COMPLETE - Check logs above');
          // console.log('[TEST] Expected behavior:');
          // console.log('[TEST]   - Input should be 0.000 after release');
          // console.log('[TEST]   - Forces should be 0.00 when input is 0');
          // console.log('[TEST]   - Body velocity should decrease (not increase!)');
          // console.log('[TEST]   - Angular velocities should decrease');
          // console.log('[TEST] ========================================');
          // Test complete, testEnabled is read from config
        }
        break;

      case 'done':
        // Test complete, do nothing
        break;
    }
  }

  stop(): void {
    if (this.animationFrameId) {
      cancelAnimationFrame(this.animationFrameId);
    }
  }

  /**
   * Update simplification epsilon and remesh
   * Note: This updates the remesh manager directly, not the config
   */
  setSimplificationEpsilon(epsilon: number): void {
    this.remeshManager.updateOptimizationOptions({ simplificationEpsilon: epsilon });
    this.needsRemesh = true;
    this.remeshManager.requestFullHeal();
  }

  setChaikinEnabled(enabled: boolean): void {
    this.remeshManager.updateOptimizationOptions({ chaikinEnabled: enabled });
    this.needsRemesh = true;
    this.remeshManager.requestFullHeal();
  }

  setChaikinIterations(iterations: number): void {
    this.remeshManager.updateOptimizationOptions({ chaikinIterations: iterations });
    this.needsRemesh = true;
    this.remeshManager.requestFullHeal();
  }

  setSimplificationEpsilonPost(epsilon: number): void {
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
    // Check if world size has changed
    if (params.worldWidth !== this.densityField.config.width ||
        params.worldHeight !== this.densityField.config.height) {
      this.densityField.resize(params.worldWidth, params.worldHeight);

      // Update camera bounds
      this.camera.worldWidth = params.worldWidth;
      this.camera.worldHeight = params.worldHeight;
    }

    // Generate new caves with Perlin noise
    this.densityField.generateCaves(params.seed, params.scale, params.octaves, params.threshold);

    // Trigger remesh to update physics bodies before spawning
    this.needsRemesh = true;
    this.remeshManager.requestFullHeal();
    this.remesh();

    this.rebuildWaterGrid();

    // Reset player to center of world (with validation)
    const preferredX = params.worldWidth / 2;
    const preferredY = params.worldHeight / 2;

    const spawnPos = this.findValidSpawnPosition(
      preferredX,
      preferredY,
      this.config.playerSpawnRadius
    );

    let actualSpawnX = preferredX;
    let actualSpawnY = preferredY;

    if (spawnPos) {
      actualSpawnX = spawnPos.x;
      actualSpawnY = spawnPos.y;
    }

    if (this.player) {
      this.player.respawn(actualSpawnX, actualSpawnY);
    }

    // Center camera on spawn
    this.camera.x = actualSpawnX;
    this.camera.y = actualSpawnY;
  }

  private rebuildWaterGrid(): void {
    const cellSizeM = this.densityField.config.gridPitch;

    this.waterGrid = new WaterGrid({
      worldWidthM: this.densityField.config.width,
      worldHeightM: this.densityField.config.height,
      cellSizeM,
    });
    this.waterGrid.rebuildSolidFromDensityField(this.densityField);
    this.waterGrid.resetWater();
    this.waterGrid.spawnDebugDrop();

    this.renderer.setWaterGrid(this.waterGrid);

    this.waterVelocity = new MacVelocityGrid({
      widthCells: this.waterGrid.widthCells,
      heightCells: this.waterGrid.heightCells,
      cellSizeM: this.waterGrid.cellSizeM,
      solidCells: this.waterGrid.solid,
    });
    this.waterVelocity.reset();
    this.renderer.setWaterVelocityGrid(this.waterVelocity);
  }

  /**
   * Toggle control mode between character control and camera pan/zoom
   * @param enabled - true for character control, false for camera control
   */
  setControlMode(enabled: boolean): void {
    // Note: This overrides the config value at runtime
    // The config provides the initial value, but UI can change it
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
      const spawnPos = this.findValidSpawnPosition(
        this.camera.x,
        this.camera.y,
        this.config.playerSpawnRadius
      );

      let actualSpawnX = this.camera.x;
      let actualSpawnY = this.camera.y;

      if (spawnPos) {
        actualSpawnX = spawnPos.x;
        actualSpawnY = spawnPos.y;
      }

      this.player.respawn(actualSpawnX, actualSpawnY);
    }
  }

  /**
   * Regenerate brush with current parameters
   */
  getCarvingDebugContext(): CarvingDebugContext {
    return {
      config: this.config,
      densityField: this.densityField,
      remeshManager: this.remeshManager,
      renderer: this.renderer,
    };
  }

  setCarvingDebugHooks(hooks: CarvingDebugHooks | null): void {
    this.carvingDebugHooks?.dispose();
    this.carvingDebugHooks = hooks;
  }

  private regenerateBrush(): void {
    const gridPitch = this.densityField.config.gridPitch;

    // Use Gaussian brush for natural, smooth falloff from config
    this.carveBrush = BrushGenerator.createGaussianBrush(
      this.config.carveRadius,
      gridPitch,
      this.config.carveBrushSigma,
      this.config.carveStrength
    );
  }

  /**
   * Set carve radius and regenerate brush
   * Note: This overrides the config value at runtime
   */
  setCarveRadius(radius: number): void {
    // For now, just invalidate cache
    // In the future, could override config value here
    this.carveBrush = null; // Invalidate cache
  }

  /**
   * Set carve strength and regenerate brush
   * Note: This overrides the config value at runtime
   */
  setCarveStrength(strength: number): void {
    // For now, just invalidate cache
    // In the future, could override config value here
    this.carveBrush = null; // Invalidate cache
  }

  /**
   * Set carve offset (distance ahead of player)
   * Note: This overrides the config value at runtime
   */
  setCarveOffset(offset: number): void {
    // For now, no-op (not stored anywhere except config)
    // In the future, could override config value here
  }

  /**
   * Carve ahead of player in the direction they're facing
   */
  carveAroundPlayer(): void {
    if (!this.player) {
      return;
    }

    const pos = this.player.getPosition();

    // Get player direction (if available)
    const direction = this.player.getDirection ? this.player.getDirection() : 0;

    // Calculate carve position ahead of player using configured offset
    const carveX = pos.x + Math.cos(direction) * this.config.carveOffset;
    const carveY = pos.y + Math.sin(direction) * this.config.carveOffset;

    // Generate brush if not cached or if parameters changed
    if (!this.carveBrush) {
      this.regenerateBrush();
    }

    // Safety check (should never happen after regenerateBrush)
    if (!this.carveBrush) {
      return;
    }

    // Stamp the pre-generated brush onto the density field
    // Strength is pre-baked into the brush texture
    this.densityField.stampBrush(
      carveX,
      carveY,
      this.carveBrush,
      false // false = carve (subtract density)
    );

    // Step-by-step debugging (opt-in, installed only in debug builds)
    if (this.carvingDebugHooks) {
      this.carvingDebugHooks.onCarveStamped();
      return;
    }

    // Production path: apply local update immediately.
    this.remeshManager.localUpdate(this.config.carveDebugExpandCells);
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

debugConsole.onToggleCanonicalVertices = (enabled: boolean) => {
  if (appRenderer) {
    appRenderer.showCanonicalVertices = enabled;
  }
};

debugConsole.onToggleCanonicalAABBs = (enabled: boolean) => {
  if (appRenderer) {
    appRenderer.showCanonicalAABBs = enabled;
  }
};

debugConsole.onToggleSegments = (enabled: boolean) => {
  if (appRenderer) {
    appRenderer.showSegmentDebug = enabled;
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

debugConsole.onToggleWaterGrid = (enabled: boolean) => {
  if (appRenderer) {
    appRenderer.showWaterGrid = enabled;
  }
};

debugConsole.onToggleWaterFlowDebug = (enabled: boolean) => {
  if (appRenderer) {
    appRenderer.showWaterFlowDebug = enabled;
  }
};

debugConsole.onToggleWaterVelocityHsv = (enabled: boolean) => {
  if (appRenderer) {
    appRenderer.showWaterVelocityHsv = enabled;
  }
};

debugConsole.onToggleDirtyAABB = (enabled: boolean) => {
  if (appRenderer) {
    appRenderer.showDirtyAABB = enabled;
  }
};

debugConsole.onToggleRebuiltChains = (enabled: boolean) => {
  if (appRenderer) {
    appRenderer.showRebuiltChains = enabled;
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

debugConsole.onCarveRadiusChange = (radius: number) => {
  if (app) {
    app.setCarveRadius(radius);
  }
};

debugConsole.onCarveStrengthChange = (strength: number) => {
  if (app) {
    app.setCarveStrength(strength);
  }
};

// Initialize cave generator UI (hidden by default)
let caveGeneratorUI: CaveGeneratorUI;
try {
  caveGeneratorUI = new CaveGeneratorUI();
} catch (error) {
  console.error('Failed to create cave generator UI:', error);
  throw error;
}

// Wire up cave generator callback
caveGeneratorUI.onGenerate = (params) => {
  if (app) {
    app.regenerateCaves(params);
  }
};

// Create carve button (on right side, opposite of joystick)
const carveButton = document.createElement('button');
carveButton.id = 'carve-button';
carveButton.textContent = '⛏️';
carveButton.title = 'Carve around player';
carveButton.style.cssText = `
  position: fixed;
  bottom: calc(env(safe-area-inset-bottom, 10px) + 10px);
  right: calc(env(safe-area-inset-right, 10px) + 10px);
  background: rgba(255, 152, 0, 0.95);
  backdrop-filter: blur(10px);
  border-radius: 50%;
  width: 72px;
  height: 72px;
  border: 3px solid rgba(255, 255, 255, 0.5);
  cursor: pointer;
  font-size: 32px;
  display: flex;
  align-items: center;
  justify-content: center;
  z-index: 10000;
  pointer-events: auto;
  box-shadow: 0 4px 12px rgba(0, 0, 0, 0.4);
  -webkit-tap-highlight-color: rgba(255, 152, 0, 0.3);
  touch-action: manipulation;
  user-select: none;
  -webkit-user-select: none;
  transition: transform 0.1s ease, background 0.1s ease;
`;
carveButton.addEventListener('click', () => {
  if (app) {
    app.carveAroundPlayer();
  }
});
carveButton.addEventListener('touchstart', (e) => {
  e.preventDefault();
  carveButton.style.transform = 'scale(0.95)';
  carveButton.style.background = 'rgba(255, 152, 0, 1)';
});
carveButton.addEventListener('touchend', (e) => {
  e.preventDefault();
  carveButton.style.transform = 'scale(1)';
  carveButton.style.background = 'rgba(255, 152, 0, 0.95)';
  if (app) {
    app.carveAroundPlayer();
  }
});
document.body.appendChild(carveButton);

// Start the application
let app: CarvableCaves;

try {
  app = new CarvableCaves();
  // Expose renderer and physics to debug console callbacks
  appRenderer = (app as any).renderer;
  appPhysics = (app as any).physics;

  // Enable physics debug by default (since showPhysicsBodies defaults to true)
  if (appPhysics && appRenderer?.showPhysicsBodies) {
    appPhysics.setDebugEnabled(true);
  }

  // Note: Character controller UI callbacks are wired up in start() after player is created

  // Optional (debug-build only): expose step-by-step carving debugger installer
  if (__CARVE_DEBUG__) {
    (window as any).enableCarvingStepDebug = async () => {
      const { installCarvingDebug } = await import('./debug/carving/installCarvingDebug');
      return installCarvingDebug(app as any);
    };

    if (new URLSearchParams(window.location.search).has('carveDebug')) {
      (window as any).enableCarvingStepDebug();
    }
  }
} catch (error) {
  // console.error('Fatal error during initialization:', error);
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
