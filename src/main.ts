import { Camera } from './Camera';
import { DensityField } from './DensityField';
import { MarchingSquares } from './MarchingSquares';
import { Renderer } from './Renderer';
import { DebugConsole } from './DebugConsole';
import { SpiderDebugUI } from './SpiderDebugUI';
import { CaveGeneratorUI, type PerlinCaveParams } from './CaveGeneratorUI';
import { CharacterControllerUI } from './CharacterControllerUI';
import { LoopCache } from './LoopCache';
import { InputHandler } from './InputHandler';
import { Box2DPhysics } from './Box2DPhysics';
import { VirtualJoystick } from './VirtualJoystick';
import { RemeshManager, type RemeshStats } from './RemeshManager';
import { VersionChecker } from './VersionChecker';
import type { WorldConfig, BrushSettings } from './types';
import * as SpiderMath from './controllers/spider/SpiderMath';
import { SpiderController } from './controllers/spider/SpiderController';
import { DEFAULT_SPIDER_CONFIG } from './controllers/spider/SpiderTypes';
import { CapsuleController } from './controllers/CapsuleController';
import type { IPlayerController } from './controllers/IPlayerController';
import { BrushGenerator, type Brush } from './BrushGenerator';
import { PipelineConfig, DEFAULT_CONFIG } from './PipelineConfig';

/**
 * Test spider math functions (Phase 1 verification)
 * This runs once at startup and logs results to console
 */
function testSpiderMath() {
  // console.log('\n=== SPIDER MATH TESTS (Phase 1) ===\n');

  // Test 1: deltaAngle (shortest angular difference)
  // console.log('Test 1: deltaAngle (shortest angular difference)');
  // console.log('  deltaAngle(10, 50) =', SpiderMath.deltaAngle(10, 50), '(expected: 40)');
  // console.log('  deltaAngle(350, 10) =', SpiderMath.deltaAngle(350, 10), '(expected: 20)');
  // console.log('  deltaAngle(10, 350) =', SpiderMath.deltaAngle(10, 350), '(expected: -20)');
  // console.log('  deltaAngle(170, -170) =', SpiderMath.deltaAngle(170, -170), '(expected: 20)');

  // Test 2: normalizeAngle180
  // console.log('\nTest 2: normalizeAngle180 (wrap to [-180, 180])');
  // console.log('  normalizeAngle180(0) =', SpiderMath.normalizeAngle180(0), '(expected: 0)');
  // console.log('  normalizeAngle180(190) =', SpiderMath.normalizeAngle180(190), '(expected: -170)');
  // console.log('  normalizeAngle180(-190) =', SpiderMath.normalizeAngle180(-190), '(expected: 170)');
  // console.log('  normalizeAngle180(360) =', SpiderMath.normalizeAngle180(360), '(expected: 0)');
  // console.log('  normalizeAngle180(720) =', SpiderMath.normalizeAngle180(720), '(expected: 0)');

  // Test 3: computeJointLimitTorque (PD controller)
  // console.log('\nTest 3: computeJointLimitTorque (PD controller for soft limits)');

  // Inside free range [10, 160] - should return 0
  const torque1 = SpiderMath.computeJointLimitTorque(
    0, 45, // parent=0°, child=45° (rel=45°)
    10, 160, // free range [10°, 160°]
    10, 1, // Kp=10, Kd=1
    0, 0 // no angular velocity
  );
  // console.log('  Inside range [10°, 160°]: rel=45° → torque =', torque1, '(expected: 0)');

  // Below free range - should push toward min
  const torque2 = SpiderMath.computeJointLimitTorque(
    0, 5, // parent=0°, child=5° (rel=5°, below min=10°)
    10, 160, // free range
    10, 1, // Kp=10, Kd=1
    0, 0 // no angular velocity
  );
  // console.log('  Below range: rel=5° (min=10°) → torque =', torque2, '(expected: 50 = 10*(10-5))');

  // Above free range - should push toward max
  const torque3 = SpiderMath.computeJointLimitTorque(
    0, 170, // parent=0°, child=170° (rel=170°, above max=160°)
    10, 160, // free range
    10, 1, // Kp=10, Kd=1
    0, 0 // no angular velocity
  );
  // console.log('  Above range: rel=170° (max=160°) → torque =', torque3, '(expected: -100 = 10*(160-170))');

  // Test 4: applyMirrorIfNeeded
  // console.log('\nTest 4: applyMirrorIfNeeded (left/right leg symmetry)');

  const leftRange = { min: 10, max: 160 };
  SpiderMath.applyMirrorIfNeeded(true, leftRange);
  // console.log('  Left leg [10°, 160°] → ', leftRange, '(expected: unchanged)');

  const rightRange = { min: 10, max: 160 };
  SpiderMath.applyMirrorIfNeeded(false, rightRange);
  // console.log('  Right leg [10°, 160°] → ', rightRange, '(expected: [-160°, -10°])');

  // Test 5: angleToDir
  // console.log('\nTest 5: angleToDir (angle to direction vector)');
  const dir0 = SpiderMath.angleToDir(0);
  // console.log('  angleToDir(0°) =', `{x: ${dir0.x.toFixed(3)}, y: ${dir0.y.toFixed(3)}}`, '(expected: {x: 1, y: 0})');

  const dir90 = SpiderMath.angleToDir(90);
  // console.log('  angleToDir(90°) =', `{x: ${dir90.x.toFixed(3)}, y: ${dir90.y.toFixed(3)}}`, '(expected: {x: 0, y: 1})');

  const dir180 = SpiderMath.angleToDir(180);
  // console.log('  angleToDir(180°) =', `{x: ${dir180.x.toFixed(3)}, y: ${dir180.y.toFixed(3)}}`, '(expected: {x: -1, y: 0})');

  // Test 6: rotateDir
  // console.log('\nTest 6: rotateDir (rotate direction vector)');
  const rotated = SpiderMath.rotateDir({ x: 1, y: 0 }, 90);
  // console.log('  rotateDir({1, 0}, 90°) =', `{x: ${rotated.x.toFixed(3)}, y: ${rotated.y.toFixed(3)}}`, '(expected: {x: 0, y: 1})');

  // Test 7: DEFAULT_SPIDER_CONFIG
  // console.log('\nTest 7: DEFAULT_SPIDER_CONFIG (verify Unity defaults loaded)');
  // console.log('  Segment lengths: L1=', DEFAULT_SPIDER_CONFIG.segmentLength1,
  //             'L2=', DEFAULT_SPIDER_CONFIG.segmentLength2,
  //             'L3=', DEFAULT_SPIDER_CONFIG.segmentLength3);
  // console.log('  Torque: gain=', DEFAULT_SPIDER_CONFIG.torqueGain,
  //             'max=', DEFAULT_SPIDER_CONFIG.maxJointTorque);
  // console.log('  Joint limit PD: Kp=', DEFAULT_SPIDER_CONFIG.jointLimitKp,
  //             'Kd=', DEFAULT_SPIDER_CONFIG.jointLimitKd);
  // console.log('  Hip limits: [', DEFAULT_SPIDER_CONFIG.hipLimitFreeMin, '°,',
  //             DEFAULT_SPIDER_CONFIG.hipLimitFreeMax, '°]');
  // console.log('  Knee limits: [', DEFAULT_SPIDER_CONFIG.kneeLimitFreeMin, '°,',
  //             DEFAULT_SPIDER_CONFIG.kneeLimitFreeMax, '°]');

  // console.log('\n=== END SPIDER MATH TESTS ===\n');
}

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
  private spider: SpiderController | null = null; // Spider controller (parked for future reference)
  private player: IPlayerController | null = null; // Current active player controller
  private joystick: VirtualJoystick;
  private remeshManager!: RemeshManager; // Initialized after physics

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

  // Automated joystick test (for debugging spider movement)
  private testStartFrame = 0;
  private testPhase: 'waiting' | 'input' | 'release' | 'done' = 'waiting';

  // Carving brush (cached for efficiency)
  private carveBrush: Brush | null = null;

  // Debug visualization for carved areas
  private debugLoops: Array<{ loop: { x: number; y: number }[]; closed: boolean; endpoints?: [{ x: number; y: number }, { x: number; y: number }]; inside: boolean }> = [];
  private debugAABB: { minX: number; minY: number; maxX: number; maxY: number } | null = null;

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

  /**
   * Wire up spider debug UI callbacks (called after spider is created)
   */
  private setupSpiderDebugUI(): void {
    const spiderUI = (window as any).spiderDebugUI as SpiderDebugUI;

    if (spiderUI && this.spider) {
      // Attach the controller and its config to the debug UI
      spiderUI.attachController(this.spider, this.spider.config);
    }
  }

  private setupCharacterControllerUI(): void {
    // STUB: This method was for the old ForcePlayerController
    // Spider controller uses SpiderDebugUI instead
    // Character controller UI is no longer used with spider
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
        simplificationEpsilonPost: this.config.simplificationEpsilonPost
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

    // Spider debug UI disabled (using simple capsule controller)
    // this.setupSpiderDebugUI();

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
   * COMMENTED OUT: Not using balls anymore with spider controller
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

    // Automated joystick test (for debugging spider movement)
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
    this.renderer.render(playerPos, this.player.getRadius(), [], physicsDebugDraw, undefined, joystickDraw, undefined, playerDirection, this.debugLoops, this.debugAABB);
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
   * Run automated joystick test to debug spider movement
   * Test sequence:
   * 1. Wait 60 frames (~1 second) for spider to settle
   * 2. Apply small upward force for 10 frames
   * 3. Release for 20 frames and observe behavior
   */
  private runAutomatedTest(): void {
    const currentFrame = this.frameCount;

    switch (this.testPhase) {
      case 'waiting':
        // Wait 60 frames for spider to settle
        if (this.testStartFrame === 0) {
          this.testStartFrame = currentFrame;
          // console.log('[TEST] ========================================');
          // console.log('[TEST] AUTOMATED JOYSTICK TEST STARTING');
          // console.log('[TEST] Phase 1: Waiting 60 frames for spider to settle...');
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
  private aabbsIntersect(a: { minX: number; minY: number; maxX: number; maxY: number }, b: { minX: number; minY: number; maxX: number; maxY: number }): boolean {
    return !(a.maxX < b.minX || a.minX > b.maxX || a.maxY < b.minY || a.minY > b.maxY);
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

    // EXPERIMENT: Capture debug loops from dirty region (guarded by toggle)
    if (this.config.debugCaptureEnabled) {
      const dirtyWorldAABB = this.densityField.getDirtyWorldAABB();
      if (!dirtyWorldAABB) return;

      // Erase previous debug visualization
      this.debugLoops = [];
      this.debugAABB = null;

      // Clear dirty region so it doesn't accumulate
      this.densityField.clearDirty();

      // Convert world AABB to grid AABB with expanded padding
      const h = this.densityField.config.gridPitch;
      const expandCells = this.config.carveDebugExpandCells;
      const gridAABB = {
        minX: Math.max(0, Math.floor(dirtyWorldAABB.minX / h) - expandCells),
        minY: Math.max(0, Math.floor(dirtyWorldAABB.minY / h) - expandCells),
        maxX: Math.min(this.densityField.gridWidth - 2, Math.ceil(dirtyWorldAABB.maxX / h) + expandCells),
        maxY: Math.min(this.densityField.gridHeight - 2, Math.ceil(dirtyWorldAABB.maxY / h) + expandCells)
      };

      const worldMinX = gridAABB.minX * h;
      const worldMinY = gridAABB.minY * h;
      const worldMaxX = (gridAABB.maxX + 1) * h;
      const worldMaxY = (gridAABB.maxY + 1) * h;
      const quantStep = h / 4; // snap lattice for matching endpoints

      const quantKey = (v: { x: number; y: number }): string =>
        `${Math.round(v.x / quantStep)},${Math.round(v.y / quantStep)}`;

      // Convert expanded grid AABB back to world coordinates for consistent cutting
      // Add +1 to max values to cover the full extent of the boundary cells
      const expandedWorldAABB = {
        minX: worldMinX,
        minY: worldMinY,
        maxX: worldMaxX,  // Include right edge of rightmost cell
        maxY: worldMaxY   // Include bottom edge of bottom cell
      };

      // Closed-world check so boundary vertices classify consistently
      const isInsideWorld = (v: { x: number; y: number }): boolean => (
        v.x >= worldMinX && v.x <= worldMaxX &&
        v.y >= worldMinY && v.y <= worldMaxY
      );

      // Set boundary for confined marching
      this.marchingSquares.setBoundaryAABB(gridAABB);

      // Generate contours with bidirectional walking (INSIDE dirty region)
      const insideResults = this.marchingSquares.generateContours(dirtyWorldAABB, expandCells);
      // Merge adjacent open loops that touch at quantized endpoints to avoid artificial splits
      const mergeOpenLoops = (
        loops: Array<{ loop: { x: number; y: number }[]; closed: boolean; endpoints?: [{ x: number; y: number }, { x: number; y: number }] }>
      ) => {
        const open: typeof loops = [];
        const closed: typeof loops = [];
        let mergesPerformed = 0;
        for (const l of loops) {
          if (l.closed || !l.endpoints) {
            closed.push(l);
          } else {
            open.push(l);
          }
        }

        let changed = true;
        while (changed) {
          changed = false;
          outer: for (let i = 0; i < open.length; i++) {
            for (let j = 0; j < open.length; j++) {
              if (i === j) continue;
              const a = open[i];
              const b = open[j];
              if (!a.endpoints || !b.endpoints) continue;

              const aEndKey = quantKey(a.endpoints[1]);
              const bStartKey = quantKey(b.endpoints[0]);

              if (aEndKey === bStartKey) {
                // Merge A then B (drop duplicate touching vertex)
                const mergedLoop = [...a.loop, ...b.loop.slice(1)];
                const mergedEndpoints: [{ x: number; y: number }, { x: number; y: number }] = [
                  a.endpoints[0],
                  b.endpoints[1]
                ];
                const merged = { loop: mergedLoop, closed: false, endpoints: mergedEndpoints };
                open.splice(i, 1);
                const jIdx = j > i ? j - 1 : j;
                open.splice(jIdx, 1);
                open.push(merged);
                changed = true;
                mergesPerformed++;
                console.log('[Debug] Merged open loops at boundary', {
                  aEnd: a.endpoints[1],
                  bStart: b.endpoints[0],
                  mergedStart: mergedEndpoints[0],
                  mergedEnd: mergedEndpoints[1],
                  aLength: a.loop.length,
                  bLength: b.loop.length,
                  mergedLength: mergedLoop.length
                });
                break outer;
              }
            }
          }
        }

        if (mergesPerformed > 0) {
          console.log(`[Debug] Merged ${mergesPerformed} open loop pairs`);
        }

        return [...closed, ...open];
      };
      const insideMerged = mergeOpenLoops(insideResults);

      // Clear boundary after use
      this.marchingSquares.setBoundaryAABB(null);

      // Get canonical loops and extract portions OUTSIDE the dirty region
      const canonicalLoops = this.remeshManager.getCanonicalLoops();
      const outsideResults: Array<{ loop: { x: number; y: number }[]; closed: boolean; endpoints?: [{ x: number; y: number }, { x: number; y: number }] }> = [];
      const arcLength = (verts: { x: number; y: number }[]): number => {
        let len = 0;
        for (let i = 1; i < verts.length; i++) {
          const dx = verts[i].x - verts[i - 1].x;
          const dy = verts[i].y - verts[i - 1].y;
          len += Math.hypot(dx, dy);
        }
        return len;
      };

      const arcOutsideMetrics = (verts: { x: number; y: number }[]) => {
        let total = 0;
        let outside = 0;
        for (let i = 1; i < verts.length; i++) {
          const dx = verts[i].x - verts[i - 1].x;
          const dy = verts[i].y - verts[i - 1].y;
          const segLen = Math.hypot(dx, dy);
          total += segLen;
          if (!isInsideWorld(verts[i - 1]) && !isInsideWorld(verts[i])) {
            outside += segLen;
          }
        }
        return { total, outside, outsideFrac: total > 0 ? outside / total : 0 };
      };

      const splitArcOutside = (verts: { x: number; y: number }[]) => {
        const result: { x: number; y: number }[][] = [];
        if (verts.length < 2) return result;

        const inside = (p: { x: number; y: number }) => isInsideWorld(p);

        const edgeIntersections = (p: { x: number; y: number }, q: { x: number; y: number }): number[] => {
          // Liang-Barsky to find enter/exit t values (can yield 0,1 or 2 intersections)
          const ts: number[] = [];
          const dx = q.x - p.x;
          const dy = q.y - p.y;
          let tEnter = 0;
          let tExit = 1;
          const clip = (pC: number, qC: number): boolean => {
            if (pC === 0) return qC >= 0;
            const r = qC / pC;
            if (pC < 0) {
              if (r > tExit) return false;
              if (r > tEnter) tEnter = r;
            } else if (pC > 0) {
              if (r < tEnter) return false;
              if (r < tExit) tExit = r;
            }
            return true;
          };

          if (
            !clip(-dx, p.x - expandedWorldAABB.minX) ||
            !clip(dx, expandedWorldAABB.maxX - p.x) ||
            !clip(-dy, p.y - expandedWorldAABB.minY) ||
            !clip(dy, expandedWorldAABB.maxY - p.y)
          ) {
            return ts;
          }

          if (tEnter > 0 && tEnter < 1) ts.push(tEnter);
          if (tExit > 0 && tExit < 1 && tExit !== tEnter) ts.push(tExit);
          ts.sort((a, b) => a - b);
          return ts;
        };

        const pointAt = (p: { x: number; y: number }, q: { x: number; y: number }, t: number) => ({
          x: Math.round((p.x + (q.x - p.x) * t) / quantStep) * quantStep,
          y: Math.round((p.y + (q.y - p.y) * t) / quantStep) * quantStep
        });

        let current: { x: number; y: number }[] = [];

        for (let i = 0; i < verts.length - 1; i++) {
          const p = verts[i];
          const q = verts[i + 1];
          const ts = edgeIntersections(p, q);
          const pts: { x: number; y: number }[] = [p];
          for (const t of ts) {
            pts.push(pointAt(p, q, t));
          }
          pts.push(q);

          for (let k = 0; k < pts.length - 1; k++) {
            const a = pts[k];
            const b = pts[k + 1];
            const mid = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
            const segmentOutside = !inside(mid);
            if (segmentOutside) {
              if (current.length === 0) current.push({ ...a });
              current.push({ ...b });
            } else {
              if (current.length > 1) {
                result.push(current);
              }
              current = [];
            }
          }
        }

        if (current.length > 1) {
          result.push(current);
        }

        return result;
      };

      const collectArc = (verts: { x: number; y: number }[], startIdx: number, endIdx: number): { x: number; y: number }[] => {
        const n = verts.length;
        const result: { x: number; y: number }[] = [];
        let idx = startIdx;
        result.push({ x: verts[idx].x, y: verts[idx].y });
        while (idx !== endIdx) {
          idx = (idx + 1) % n;
          result.push({ x: verts[idx].x, y: verts[idx].y });
        }
        return result;
      };

      const nearestIndex = (verts: { x: number; y: number }[], target: { x: number; y: number }): number => {
        let best = 0;
        let bestD2 = Infinity;
        for (let i = 0; i < verts.length; i++) {
          const dx = verts[i].x - target.x;
          const dy = verts[i].y - target.y;
          const d2 = dx * dx + dy * dy;
          if (d2 < bestD2) {
            bestD2 = d2;
            best = i;
          }
        }
        return best;
      };

      // Build outside arcs by pairing each inside open loop to the nearest canonical loop segment between its endpoints
      insideMerged.forEach((insideLoop, insideIdx) => {
        if (insideLoop.closed || !insideLoop.endpoints) return;
        const [epA, epB] = insideLoop.endpoints;
        let bestArc: { verts: { x: number; y: number }[]; loopId: number; bestFrac: number; bestOutside: number } | null = null;

        for (const canonLoop of canonicalLoops) {
          if (!this.aabbsIntersect(canonLoop.aabb, expandedWorldAABB)) continue;
          const verts = canonLoop.vertices;
          if (verts.length < 2) continue;

          const iA = nearestIndex(verts, epA);
          const iB = nearestIndex(verts, epB);
          if (iA === iB) continue;

          const forward = collectArc(verts, iA, iB);
          const backward = collectArc(verts, iB, iA);
          const fMetrics = arcOutsideMetrics(forward);
          const bMetrics = arcOutsideMetrics(backward);

          let chosen = forward;
          let chosenMetrics = fMetrics;
          if (bMetrics.outsideFrac > fMetrics.outsideFrac || (bMetrics.outsideFrac === fMetrics.outsideFrac && bMetrics.outside > fMetrics.outside)) {
            chosen = backward;
            chosenMetrics = bMetrics;
          }

          const arcVerts = chosen.map(v => ({ x: v.x, y: v.y }));

          if (
            !bestArc ||
            chosenMetrics.outsideFrac > bestArc.bestFrac ||
            (chosenMetrics.outsideFrac === bestArc.bestFrac && chosenMetrics.outside > bestArc.bestOutside)
          ) {
            bestArc = { verts: arcVerts, loopId: canonLoop.id, bestFrac: chosenMetrics.outsideFrac, bestOutside: chosenMetrics.outside };
          }
        }

        if (bestArc && bestArc.verts.length > 1) {
          const outsidePieces = splitArcOutside(bestArc.verts);

          outsidePieces.forEach((piece, pieceIdx) => {
            if (piece.length < 2) return;
            const endpoints: [{ x: number; y: number }, { x: number; y: number }] = [
              { ...piece[0] },
              { ...piece[piece.length - 1] }
            ];

            outsideResults.push({
              loop: piece,
              closed: false,
              endpoints
            });

            console.log('[Debug] Outside arc chosen', {
              insideLoop: insideIdx,
              canonicalLoopId: bestArc.loopId,
              arcLength: arcLength(piece).toFixed(3),
              arcVerts: piece.length,
              outsideFrac: arcOutsideMetrics(piece).outsideFrac,
              pieceIdx,
              start: endpoints[0],
              end: endpoints[1]
            });
          });
        }
      });

      // Combine inside and outside results
      this.debugLoops = [
        ...insideMerged.map(r => ({ ...r, inside: true })),
        ...outsideResults.map(r => ({ ...r, inside: false }))
      ];
      this.debugAABB = expandedWorldAABB; // Use expanded AABB for visualization

      console.log(`[Debug] Captured loops from carve`, {
        inside: insideResults.length,
        outside: outsideResults.length,
        total: this.debugLoops.length
      });

      // Log detailed endpoint information
      console.log('\n=== INSIDE LOOPS (Marching Squares) ===');
      console.log(`AABB Region (grid): [${gridAABB.minX}, ${gridAABB.minY}] to [${gridAABB.maxX}, ${gridAABB.maxY}]`);
      console.log(`AABB Region (world): [${expandedWorldAABB.minX.toFixed(2)}, ${expandedWorldAABB.minY.toFixed(2)}] to [${expandedWorldAABB.maxX.toFixed(2)}, ${expandedWorldAABB.maxY.toFixed(2)}]`);

      insideMerged.forEach((result, idx) => {
        if (!result.closed && result.endpoints) {
          const [ep1, ep2] = result.endpoints;
          const ep1Cell = { gx: Math.floor(ep1.x / h), gy: Math.floor(ep1.y / h) };
          const ep2Cell = { gx: Math.floor(ep2.x / h), gy: Math.floor(ep2.y / h) };

          console.log(`\nInside Loop ${idx} (${result.loop.length} vertices):`);
          console.log(`  Endpoint 1: (${ep1.x.toFixed(3)}, ${ep1.y.toFixed(3)}) at cell (${ep1Cell.gx}, ${ep1Cell.gy})`);
          console.log(`  Endpoint 2: (${ep2.x.toFixed(3)}, ${ep2.y.toFixed(3)}) at cell (${ep2Cell.gx}, ${ep2Cell.gy})`);
        }
      });

      console.log('\n=== OUTSIDE LOOPS (Canonical Segments) ===');
      console.log(`AABB Region (grid): [${gridAABB.minX}, ${gridAABB.minY}] to [${gridAABB.maxX}, ${gridAABB.maxY}]`);
      console.log(`AABB Region (world): [${expandedWorldAABB.minX.toFixed(2)}, ${expandedWorldAABB.minY.toFixed(2)}] to [${expandedWorldAABB.maxX.toFixed(2)}, ${expandedWorldAABB.maxY.toFixed(2)}]`);

      // Log each outside segment that was chosen
      let segmentIdx = 0;
      for (const seg of outsideResults) {
        if (seg.loop.length > 1) {
          const ep1 = seg.loop[0];
          const ep2 = seg.loop[seg.loop.length - 1];
          const ep1Cell = { gx: Math.floor(ep1.x / h), gy: Math.floor(ep1.y / h) };
          const ep2Cell = { gx: Math.floor(ep2.x / h), gy: Math.floor(ep2.y / h) };

          console.log(`\nOutside Segment ${segmentIdx} (${seg.loop.length} vertices):`);
          console.log(`  Endpoint 1: (${ep1.x.toFixed(3)}, ${ep1.y.toFixed(3)}) at cell (${ep1Cell.gx}, ${ep1Cell.gy})`);
          console.log(`  Endpoint 2: (${ep2.x.toFixed(3)}, ${ep2.y.toFixed(3)}) at cell (${ep2Cell.gx}, ${ep2Cell.gy})`);
          segmentIdx++;
        }
      }

      console.log('\n');
    }

    // DISABLED: Bypass all rebuilding for experiment
    // const stats = this.remeshManager.localUpdate(2);
    // if (stats) {
    //   this.originalVertexCount = stats.originalVertexCount;
    //   this.finalVertexCount = stats.finalVertexCount;
    //   this.simplificationReduction = stats.simplificationReduction;
    //   this.postSimplificationReduction = stats.postSimplificationReduction;
    // }
  }
}

(window as any).APP_LOADED = true;

// Initialize debug console (hidden by default)
let debugConsole: DebugConsole;
let spiderDebugUI: SpiderDebugUI;
try {
  debugConsole = new DebugConsole();
  (window as any).debugConsole = debugConsole; // Make accessible for stats updates

  spiderDebugUI = new SpiderDebugUI();
  (window as any).spiderDebugUI = spiderDebugUI; // Make accessible
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

debugConsole.onToggleLoopPatching = (enabled: boolean) => {
  if (appRenderer) {
    appRenderer.showLoopPatching = enabled;
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

// Initialize character controller UI (hidden by default)
let characterControllerUI: CharacterControllerUI;
try {
  characterControllerUI = new CharacterControllerUI();
  (window as any).characterControllerUI = characterControllerUI; // Make accessible for setup after player creation
} catch (error) {
  // console.error('Failed to create character controller UI:', error);
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

// Test spider math before starting application
testSpiderMath();

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
