import { Camera } from './Camera';
import { DensityField } from './DensityField';
import { MarchingSquares } from './MarchingSquares';
import { Renderer } from './Renderer';
import { DebugConsole } from './DebugConsole';
import { LoopCache } from './LoopCache';
import { Physics } from './Physics';
import { Player } from './Player';
import { simplifyPolylines } from './PolylineSimplifier';
import type { WorldConfig } from './types';
import type { Point } from './PolylineSimplifier';
import Matter from 'matter-js';

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
  private physics: Physics;
  private player: Player;

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
  private ballBodies: Matter.Body[] = []; // Track all balls for rendering

  constructor() {
    try {
      console.log('Initializing CarvableCaves...');

      // World configuration
      const worldConfig: WorldConfig = {
        width: 50, // metres (halved)
        height: 30, // metres (halved)
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

      // Initialize camera (centered on world, zoomed out 2x)
      this.camera = new Camera(
        worldConfig.width / 2,
        worldConfig.height / 2,
        25 // initial PPM (pixels per metre) - 2x zoomed out from 50
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

      // Clear spawn area at center-bottom with guaranteed floor
      const spawnX = worldConfig.width / 2;
      const spawnY = worldConfig.height * 0.7; // Lower third of world
      this.densityField.clearSpawnArea(spawnX, spawnY, 10, 6, 2); // 10m wide, 6m tall, 2m floor
      console.log(`Spawn chamber created at (${spawnX}, ${spawnY})`);

      // Initialize marching squares
      this.marchingSquares = new MarchingSquares(this.densityField, worldConfig.isoValue);
      console.log('Marching squares initialized');

      // Initialize loop cache
      this.loopCache = new LoopCache();
      console.log('Loop cache initialized');

      // Initialize renderer
      this.renderer = new Renderer(this.canvas, this.camera);
      console.log('Renderer initialized');

      // Initialize physics
      this.physics = new Physics();
      console.log('Physics initialized');

      // Setup UI
      this.setupUI();
      console.log('UI setup complete');

      // Window resize
      window.addEventListener('resize', () => {
        this.renderer.resize();
      });

      // Generate initial mesh and physics bodies BEFORE creating player
      console.log('Generating initial mesh and physics bodies...');
      this.remesh();
      console.log('Initial mesh generated');

      // NOW create player after collision bodies exist
      this.player = new Player(this.physics, spawnX, spawnY);
      console.log(`Player initialized at spawn location (${spawnX}, ${spawnY})`);

      // Start render loop
      this.start();
      console.log('CarvableCaves initialized successfully!');
    } catch (error) {
      console.error('Failed to initialize CarvableCaves:', error);
      throw error;
    }
  }

  private setupUI(): void {
    // Reset button (regenerates caves and respawns player)
    const resetButton = document.getElementById('reset-button') as HTMLButtonElement;
    if (resetButton) {
      console.log('Reset button found, attaching event listeners');

      const handleReset = (e: Event) => {
        console.log('Reset button activated - regenerating caves');
        e.preventDefault();
        e.stopPropagation();

        // Clear all test balls
        for (const ball of this.ballBodies) {
          Matter.World.remove(this.physics.world, ball);
        }
        this.ballBodies = [];

        // Generate new caves with random seed
        this.densityField.generateCaves(undefined, 0.05, 4, 0.1);
        // Clear spawn chamber with floor
        const spawnX = 50 / 2;
        const spawnY = 30 * 0.7;
        this.densityField.clearSpawnArea(spawnX, spawnY, 10, 6, 2);
        // Respawn player at cleared area
        this.player.respawn(spawnX, spawnY);
        this.needsRemesh = true;
        this.needsFullHeal = true;
      };

      resetButton.addEventListener('click', handleReset);
      resetButton.addEventListener('touchend', handleReset, { passive: false });
    } else {
      console.error('Reset button NOT found!');
    }

    // Debug checkboxes
    const debugGridCheckbox = document.getElementById('debug-grid') as HTMLInputElement;
    if (debugGridCheckbox) {
      debugGridCheckbox.addEventListener('change', () => {
        this.renderer.showGrid = debugGridCheckbox.checked;
      });
    }

    const debugVerticesCheckbox = document.getElementById('debug-vertices') as HTMLInputElement;
    if (debugVerticesCheckbox) {
      debugVerticesCheckbox.addEventListener('change', () => {
        this.renderer.showVertices = debugVerticesCheckbox.checked;
      });
    }

    const debugConsoleLogCheckbox = document.getElementById('debug-console-log') as HTMLInputElement;
    if (debugConsoleLogCheckbox) {
      debugConsoleLogCheckbox.addEventListener('change', () => {
        this.marchingSquares.setDebug(debugConsoleLogCheckbox.checked);
        if (debugConsoleLogCheckbox.checked) {
          console.log('[DEBUG MODE ENABLED] Remeshing to show debug output...');
          this.needsRemesh = true;
        }
      });
    }

    const debugPhysicsBodiesCheckbox = document.getElementById('debug-physics') as HTMLInputElement;
    if (debugPhysicsBodiesCheckbox) {
      debugPhysicsBodiesCheckbox.addEventListener('change', () => {
        this.renderer.showPhysicsBodies = debugPhysicsBodiesCheckbox.checked;
        console.log(`[DEBUG] Physics bodies visualization: ${debugPhysicsBodiesCheckbox.checked ? 'ON' : 'OFF'}`);
      });
    }
  }

  private start(): void {
    console.log('Starting render loop...');
    // Mesh was already generated during init
    this.loop();
  }

  /**
   * Spawn a test ball at player position
   */
  private spawnTestBall(): void {
    // Spawn at player position with slight offset upward
    const playerPos = this.player.getPosition();
    const x = playerPos.x;
    const y = playerPos.y - 1; // 1m above player
    const radius = 0.5;

    const ball = Matter.Bodies.circle(x, y, radius, {
      isStatic: false,
      friction: 0.3,
      restitution: 0.3,
      density: 0.001,
      label: 'test-ball',
    });

    Matter.World.add(this.physics.world, ball);
    this.ballBodies.push(ball);

    console.log(`[Test] Spawned ball at player position (${x.toFixed(1)}, ${y.toFixed(1)})`);
  }

  private loop = (): void => {
    this.animationFrameId = requestAnimationFrame(this.loop);

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

    // Update physics simulation
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

    // Render with player, all balls, and physics bodies
    const playerPos = this.player.getPosition();
    const allBodies = this.physics.getAllBodies();
    this.renderer.render(playerPos, this.player.getRadius(), this.ballBodies, allBodies);
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
    this.renderer.updatePolylines(allPolylines);

    // Simplify and update physics bodies (using minimal simplification to preserve collision detail)
    const simplifiedPolylines = simplifyPolylines(
      allPolylines.map(polyline => polyline.map(v => ({ x: v.x, y: v.y } as Point))),
      0.1, // epsilon in metres (1x grid pitch - minimal simplification for accurate collisions)
      true // closed loops
    );

    console.log(`[FullHeal] Simplified ${allPolylines.length} polylines (avg reduction: ${this.calculateReduction(allPolylines, simplifiedPolylines).toFixed(1)}%)`);
    console.log(`[FullHeal] Total vertices: ${simplifiedPolylines.reduce((sum, p) => sum + p.length, 0)}`);

    this.physics.setCaveContours(simplifiedPolylines);

    this.densityField.clearDirty();

    const elapsed = performance.now() - startTime;
    console.log(`[FullHeal] Complete. ${allLoops.length} loops in ${elapsed.toFixed(1)}ms`);
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
