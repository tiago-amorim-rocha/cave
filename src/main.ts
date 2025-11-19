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

  // Automated joystick test (for debugging spider movement)
  private testEnabled = true; // Set to false to disable automated test
  private testStartFrame = 0;
  private testPhase: 'waiting' | 'input' | 'release' | 'done' = 'waiting';

  constructor() {
    try {
      // World configuration
      const worldConfig: WorldConfig = {
        width: 64, // metres - smaller for spider controller testing
        height: 64, // metres - smaller for spider controller testing
        gridPitch: 0.25, // metres (h)
        isoValue: 128
      };

      // Setup canvas
      this.canvas = document.getElementById('canvas') as HTMLCanvasElement;
      if (!this.canvas) {
        throw new Error('Canvas not found');
      }

      // Initialize camera (centered on world, zoomed out view for character following)
      this.camera = new Camera(
        worldConfig.width / 2,
        worldConfig.height / 2,
        100, // initial PPM (pixels per metre) - 50% zoomed out for wider view
        worldConfig.width,
        worldConfig.height
      );

      // Initialize density field
      this.densityField = new DensityField(worldConfig);

      // Generate initial cave system with balanced cave/empty areas (threshold = 0)
      this.densityField.generateCaves(undefined, 0.05, 4, 0);

      // Player spawn position (validated to be in empty area)
      const preferredSpawnX = worldConfig.width / 2;
      const preferredSpawnY = worldConfig.height / 2;
      // Capsule: width=0.5m, height=1.0m, radius=0.25m
      // Use 0.8m for spawn validation (larger buffer to account for marching squares drift)
      const playerRadius = 0.8;

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
        simplificationEpsilon: this.simplificationEpsilon,
        chaikinEnabled: this.chaikinEnabled,
        chaikinIterations: this.chaikinIterations,
        simplificationEpsilonPost: this.simplificationEpsilonPost
      }
    });

    // Generate initial mesh and physics bodies
    this.remesh();
    this.needsRemesh = false; // Prevent double-remesh on first frame

    // Run warm-up physics steps to initialize Box2D collision structures
    // This prevents wall tunneling when player moves immediately after spawn
    console.log('[Physics] Running warm-up steps to initialize collision detection...');
    const warmUpSteps = 10; // Run 10 physics steps (~167ms at 60Hz)
    for (let i = 0; i < warmUpSteps; i++) {
      this.physics.getEngine().step(16.67); // 60Hz timestep
    }
    console.log('[Physics] Warm-up complete');

    // Find valid spawn position for spider
    // console.log(`[Spider] Finding valid spawn position near (${this.preferredSpawnX.toFixed(1)}, ${this.preferredSpawnY.toFixed(1)})...`);
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
      // console.log(`[Spider] Spawning at validated position (${actualSpawnX.toFixed(1)}, ${actualSpawnY.toFixed(1)})`);
    } else {
      // console.warn(`[Spider] No valid position found, spawning at preferred position (may be inside rock)`);
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
    // Capsule dimensions for proper validation
    const capsuleHeight = 1.0; // Capsule is 1.0m tall
    const halfHeight = capsuleHeight / 2;

    // Check center
    if (!this.densityField.isEmptyArea(x, y)) {
      return false;
    }

    // Check top and bottom of capsule
    if (!this.densityField.isEmptyArea(x, y - halfHeight)) {
      return false;
    }
    if (!this.densityField.isEmptyArea(x, y + halfHeight)) {
      return false;
    }

    // Check points around the perimeter at center height
    const numChecks = 12; // Increased from 8 for better coverage
    for (let i = 0; i < numChecks; i++) {
      const angle = (i / numChecks) * Math.PI * 2;
      const checkX = x + Math.cos(angle) * radius;
      const checkY = y + Math.sin(angle) * radius;

      if (!this.densityField.isEmptyArea(checkX, checkY)) {
        return false;
      }
    }

    // Check points around the perimeter at top and bottom
    const numVerticalChecks = 8;
    for (let i = 0; i < numVerticalChecks; i++) {
      const angle = (i / numVerticalChecks) * Math.PI * 2;
      const checkX = x + Math.cos(angle) * radius;

      // Check top ring
      if (!this.densityField.isEmptyArea(checkX, y - halfHeight)) {
        return false;
      }

      // Check bottom ring
      if (!this.densityField.isEmptyArea(checkX, y + halfHeight)) {
        return false;
      }
    }

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
    if (this.testEnabled) {
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
    if (this.characterControlMode) {
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

    // Render (simple capsule player)
    this.renderer.render(playerPos, this.player.getRadius(), [], physicsDebugDraw, undefined, joystickDraw, undefined);
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
          this.testEnabled = false; // Stop test
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
    // console.log('[Main] Regenerating caves with Perlin noise...');

    // Check if world size has changed
    if (params.worldWidth !== this.densityField.config.width ||
        params.worldHeight !== this.densityField.config.height) {
      // console.log(`[Main] Resizing world from ${this.densityField.config.width}×${this.densityField.config.height} to ${params.worldWidth}×${params.worldHeight}`);
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

    // Reset spider to center of world (with validation)
    const preferredX = params.worldWidth / 2;
    const preferredY = params.worldHeight / 2;

    const spawnPos = this.findValidSpawnPosition(preferredX, preferredY, this.playerRadius);

    let actualSpawnX = preferredX;
    let actualSpawnY = preferredY;

    if (spawnPos) {
      actualSpawnX = spawnPos.x;
      actualSpawnY = spawnPos.y;
      // console.log(`[Regenerate] Spider respawned at validated position (${actualSpawnX.toFixed(1)}, ${actualSpawnY.toFixed(1)})`);
    } else {
      // console.warn('[Regenerate] No valid spawn position found, using preferred position (may be inside rock)');
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
        // console.log(`[Respawn] Player respawned at validated position (${actualSpawnX.toFixed(1)}, ${actualSpawnY.toFixed(1)})`);
      } else {
        // console.warn(`[Respawn] No valid spawn position found near camera, using camera center (may be inside rock)`);
      }

      this.player.respawn(actualSpawnX, actualSpawnY);
    }
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

debugConsole.onToggleSpiderDebug = () => {
  if (spiderDebugUI) {
    spiderDebugUI.toggle();
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
