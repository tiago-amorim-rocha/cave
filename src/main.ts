import { Camera } from './Camera';
import { DensityField } from './DensityField';
import { MarchingSquares } from './MarchingSquares';
import { Renderer } from './Renderer';
import { DebugConsole } from './DebugConsole';
import { LoopCache } from './LoopCache';
import { InputHandler } from './InputHandler';
import { RapierPhysics } from './RapierPhysics';
import { RapierPlayer } from './RapierPlayer';
import { simplifyPolylines } from './PolylineSimplifier';
import { chaikinSmooth } from './ChaikinSmoothing';
import { cleanLoop } from './physics/shapeUtils';
import type { WorldConfig, BrushSettings } from './types';
import type { Point } from './PolylineSimplifier';
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

  private needsRemesh = true;
  private needsFullHeal = false; // Track if we need a full-world remesh
  private lastFullHealTime = 0;
  private animationFrameId = 0;
  private lastBallSpawnTime = 0; // Track ball spawning

  // Performance tracking
  private frameCount = 0;
  private lastFpsTime = 0;
  private fps = 0;
  private lastPhysicsTime = 0;
  private physicsAccumulator = 0; // Accumulate time for 10fps physics
  private ballBodies: RAPIER.RigidBody[] = []; // Track all balls for rendering

  // Resize handling
  private pendingResize = false;

  // Simplification control
  private simplificationEpsilon = 0; // 0 = no simplification

  constructor() {
    try {
      console.log('Initializing CarvableCaves...');

      // World configuration
      const worldConfig: WorldConfig = {
        width: 50, // metres
        height: 30, // metres
        gridPitch: 0.1, // metres (h)
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
      console.log('Input handler initialized (camera controls only)');

      // Initialize physics (will be initialized async in start())
      this.physics = new RapierPhysics();
      console.log('Physics created (pending async init)');

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

      // Start render loop (async initialization happens there)
      this.start(spawnX, spawnY);
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

  private async start(spawnX: number, spawnY: number): Promise<void> {
    console.log('Starting async initialization...');

    // Initialize Rapier physics
    await this.physics.init();
    console.log('Physics initialized');

    // Generate initial mesh and physics bodies
    console.log('Generating initial mesh and physics bodies...');
    this.remesh();
    console.log('Initial mesh generated');

    // Create player after physics world is ready
    this.player = new RapierPlayer(this.physics, spawnX, spawnY);
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

    // Update player input
    this.player.update();

    // Update physics simulation (Rapier handles fixed timestep internally)
    this.physics.update(deltaMs);

    // Spawn test balls every 5 seconds
    if (now - this.lastBallSpawnTime > 5000) {
      this.spawnTestBall();
      this.lastBallSpawnTime = now;
    }

    // Camera stays static (don't follow player)
    // this.camera.x = playerPos.x;
    // this.camera.y = playerPos.y;

    // Remesh if needed
    if (this.needsRemesh) {
      this.remesh();
      this.needsRemesh = false;
    }

    // Render with player, all balls, and physics debug
    const playerPos = this.player.getPosition();

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

    this.renderer.render(playerPos, this.player.getRadius(), ballsForRender, physicsDebugDraw);
  };

  private remesh(): void {
    try {
      const now = performance.now();

      // Check if we need a full heal (periodic or requested)
      const timeSinceLastHeal = now - this.lastFullHealTime;
      const needsPeriodicHeal = timeSinceLastHeal > 5000; // Every 5 seconds

      if (this.needsFullHeal || needsPeriodicHeal || this.loopCache.count() === 0) {
        // Full world remesh
        this.fullHeal();
        this.needsFullHeal = false;
        this.lastFullHealTime = now;
      } else {
        // Incremental update
        this.incrementalUpdate();
      }
    } catch (error) {
      console.error('Error during remesh:', error);
    }
  }

  /**
   * Full world remesh - rebuild all loops
   */
  private fullHeal(): void {
    console.log('[FullHeal] Rebuilding all loops...');
    const startTime = performance.now();

    // Clear cache
    this.loopCache.clear();

    // Generate all contours for entire field
    const fullField = {
      minX: 0,
      minY: 0,
      maxX: this.densityField.config.width,
      maxY: this.densityField.config.height
    };

    const results = this.marchingSquares.generateContours(fullField, 0);

    // Add all loops to cache
    for (const result of results) {
      if (result && result.loop && result.loop.length > 2) {
        this.loopCache.addLoop(result.loop, result.closed);
      }
    }

    // Update renderer with all loops
    const allLoops = this.loopCache.getAllLoops();
    const allPolylines = allLoops.map(l => l.vertices);

    // Filter to only rock loops (not cave holes) using density field sampling
    const rockLoops = allPolylines.filter(loop => {
      if (loop.length < 3) return false;
      return this.isRockLoop(loop);
    });

    console.log(`[FullHeal] Classified ${allPolylines.length} loops: ${rockLoops.length} rock, ${allPolylines.length - rockLoops.length} cave`);

    // Store TRUE ORIGINAL vertices before ANY optimization (for debug visualization)
    const trueOriginalLoops = rockLoops.map(loop => loop.map(v => ({ x: v.x, y: v.y })));
    const trueOriginalCount = trueOriginalLoops.reduce((sum, loop) => sum + loop.length, 0);

    // Apply shape hygiene: dedupe, cull tiny edges, collapse collinear, ensure CCW
    const gridPitch = this.densityField.config.gridPitch;

    const cleanedLoops = rockLoops.map(loop => {
      const asPoints = loop.map(v => ({ x: v.x, y: v.y } as Point));
      return cleanLoop(asPoints, gridPitch); // dedupe + cullTinyEdges + ensureCCW
    }).filter(loop => loop.length >= 3);

    const cleanedVertexCount = cleanedLoops.reduce((sum, loop) => sum + loop.length, 0);
    const cleanReduction = ((trueOriginalCount - cleanedVertexCount) / trueOriginalCount * 100);

    console.log(`[FullHeal] Vertex optimization pipeline:`);
    console.log(`  1. Marching Squares output: ${rockLoops.length} contours, ${trueOriginalCount} vertices`);
    console.log(`  2. After cleanLoop (dedupe+hygiene): ${cleanedLoops.length} contours, ${cleanedVertexCount} vertices`);
    console.log(`     → cleanLoop reduction: ${cleanReduction.toFixed(1)}% (${trueOriginalCount - cleanedVertexCount} vertices removed)`);

    // Apply Visvalingam-Whyatt simplification if epsilon > 0
    let finalLoops = cleanedLoops;
    if (this.simplificationEpsilon > 0) {
      const areaThreshold = this.simplificationEpsilon * this.simplificationEpsilon; // ε²
      const asPoints = cleanedLoops.map(loop => loop.map(p => ({ x: p.x, y: p.y } as Point)));
      const simplified = simplifyPolylines(asPoints, areaThreshold, true);
      finalLoops = simplified.map(loop => loop.map(p => ({ x: p.x, y: p.y })));

      const simplifiedCount = finalLoops.reduce((sum, loop) => sum + loop.length, 0);
      const simplifyReduction = ((cleanedVertexCount - simplifiedCount) / cleanedVertexCount * 100);
      const totalReduction = ((trueOriginalCount - simplifiedCount) / trueOriginalCount * 100);

      console.log(`  3. After Visvalingam-Whyatt simplification (ε=${this.simplificationEpsilon.toFixed(3)}m, area=${areaThreshold.toFixed(6)}m²): ${finalLoops.length} contours, ${simplifiedCount} vertices`);
      console.log(`     → simplification reduction: ${simplifyReduction.toFixed(1)}% (${cleanedVertexCount - simplifiedCount} vertices removed)`);
      console.log(`     → TOTAL reduction: ${totalReduction.toFixed(1)}% (${trueOriginalCount - simplifiedCount} vertices removed)`);
    }

    // Store original for debug visualization
    this.renderer.updateOriginalPolylines(trueOriginalLoops);

    console.log(`  Average vertices per contour: ${(finalLoops.reduce((sum, loop) => sum + loop.length, 0) / finalLoops.length).toFixed(1)}`);

    // Use final loops for both physics and rendering
    this.physics.setCaveContours(finalLoops);

    // Update renderer with final loops
    const finalForRender = finalLoops.map(loop => loop.map(p => ({ x: p.x, y: p.y })));
    this.renderer.updatePolylines(finalForRender);

    this.densityField.clearDirty();

    const elapsed = performance.now() - startTime;
    console.log(`[FullHeal] Complete. ${allLoops.length} loops in ${elapsed.toFixed(1)}ms`);
  }

  /**
   * Determine if a loop represents solid rock or a cave hole
   * Uses signed area and density sampling to classify
   */
  private isRockLoop(loop: { x: number; y: number }[]): boolean {
    if (loop.length < 3) return false;

    // Calculate signed area to determine winding direction
    let area = 0;
    for (let i = 0; i < loop.length; i++) {
      const p = loop[i];
      const q = loop[(i + 1) % loop.length];
      area += (p.x * q.y - q.x * p.y);
    }

    // Sample a point slightly inside the loop
    const p0 = loop[0];
    const p1 = loop[1];

    // Calculate left normal to first edge
    let nx = p1.y - p0.y;
    let ny = -(p1.x - p0.x);
    const len = Math.hypot(nx, ny) || 1;
    nx /= len;
    ny /= len;

    // Flip normal based on winding direction so it points inward
    if (area >= 0) {
      nx = -nx;
      ny = -ny;
    }

    // Sample point 5cm inside the loop
    const sampleX = p0.x + nx * 0.05;
    const sampleY = p0.y + ny * 0.05;

    // Check density at sample point
    const { gridX, gridY } = this.densityField.worldToGrid(sampleX, sampleY);
    const density = this.densityField.get(gridX, gridY);

    // Rock if density >= isoValue (128)
    return density >= 128;
  }

  /**
   * Calculate average vertex reduction percentage
   */
  private calculateReduction(original: any[][], simplified: Point[][]): number {
    let totalOriginal = 0;
    let totalSimplified = 0;
    for (let i = 0; i < original.length; i++) {
      totalOriginal += original[i].length;
      totalSimplified += simplified[i]?.length || 0;
    }
    return totalOriginal > 0 ? ((totalOriginal - totalSimplified) / totalOriginal) * 100 : 0;
  }

  /**
   * Incremental update - only update affected loops
   * For physics-enabled mode, we do a full heal to ensure physics bodies are correct
   */
  private incrementalUpdate(): void {
    // For now, just do a full heal since we have physics
    // In the future, we could optimize this to only update affected physics bodies
    this.fullHeal();
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

      // Update memory display
      const memoryElement = document.getElementById('memory-value');
      if (memoryElement && (performance as any).memory) {
        const memoryMB = ((performance as any).memory.usedJSHeapSize / 1024 / 1024).toFixed(1);
        memoryElement.textContent = memoryMB;
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
    this.needsRemesh = true; // Trigger remesh check
    this.needsFullHeal = true; // Trigger full remesh
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
  console.log('Debug console created (hidden by default)');
} catch (error) {
  console.error('Failed to create debug console:', error);
  alert('Failed to create debug console: ' + error);
  throw error;
}

// Wire up debug button
const debugButton = document.getElementById('debug-button');
if (debugButton) {
  console.log('Debug button found, attaching event listeners');

  const handleDebugToggle = (e: Event) => {
    console.log('Debug button activated');
    e.preventDefault();
    e.stopPropagation();
    debugConsole.toggle();
  };

  // Add both click and touchend for better iOS compatibility
  debugButton.addEventListener('click', handleDebugToggle);
  debugButton.addEventListener('touchend', handleDebugToggle, { passive: false });
} else {
  console.error('Debug button NOT found!');
}

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

debugConsole.onSimplificationChange = (epsilon: number) => {
  if (app) {
    app.setSimplificationEpsilon(epsilon);
    console.log(`Simplification epsilon changed to ${epsilon.toFixed(3)}m`);
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
  debugConsole.show();
  throw error;
}

// ===================================================
// Version checking for cache busting
// ===================================================
let currentVersion: { timestamp: number; buildId: string } | null = null;

async function checkForUpdates(): Promise<boolean> {
  try {
    const response = await fetch('/cave/version.json', {
      cache: 'no-cache',
      headers: {
        'Cache-Control': 'no-cache, no-store, must-revalidate',
        'Pragma': 'no-cache'
      }
    });

    if (!response.ok) {
      console.warn('Failed to fetch version.json');
      return false;
    }

    const newVersion = await response.json();

    // First time - store current version
    if (!currentVersion) {
      currentVersion = newVersion;
      console.log('Current version:', newVersion);
      return false;
    }

    // Check if version changed
    if (newVersion.buildId !== currentVersion.buildId ||
        newVersion.timestamp !== currentVersion.timestamp) {
      console.log('New version detected!', {
        current: currentVersion,
        new: newVersion
      });
      return true;
    }

    return false;
  } catch (error) {
    console.error('Error checking version:', error);
    return false;
  }
}

// Check for updates every 5 seconds
function startVersionPolling() {
  // Initial check
  checkForUpdates().then(hasUpdate => {
    if (hasUpdate) {
      showUpdateButton();
    }
  });

  // Poll every 5 seconds
  setInterval(async () => {
    const hasUpdate = await checkForUpdates();
    if (hasUpdate) {
      showUpdateButton();
    }
  }, 5000);
}

function showUpdateButton() {
  const updateButton = document.getElementById('update-button');
  if (updateButton && !updateButton.classList.contains('visible')) {
    updateButton.classList.add('visible');
    console.log('Update button shown - new version available!');
  }
}

function reloadApp() {
  // Clear all caches and reload
  if ('caches' in window && window.caches) {
    window.caches.keys().then(names => {
      names.forEach(name => window.caches.delete(name));
    }).then(() => {
      window.location.reload();
    });
  } else {
    // No cache API, just reload
    (window as Window).location.reload();
  }
}

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
        showUpdateButton();
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
          reloadApp();
        });
      });
    }
  }).catch((error) => {
    // Service worker registration failed (expected in dev mode)
    console.log('Service worker registration skipped:', error?.message || 'dev mode');
  });
}

// Start version polling (independent of service worker)
startVersionPolling();

export { app };
