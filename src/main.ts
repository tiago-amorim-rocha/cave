import { Camera } from './Camera';
import { DensityField } from './DensityField';
import { MarchingSquares } from './MarchingSquares';
import { Renderer } from './Renderer';
import { InputHandler } from './InputHandler';
import { DebugConsole } from './DebugConsole';
import { LoopCache } from './LoopCache';
import type { WorldConfig, BrushSettings } from './types';

/**
 * Main application
 */
class CarvableCaves {
  private canvas: HTMLCanvasElement;
  private camera: Camera;
  private densityField: DensityField;
  private marchingSquares: MarchingSquares;
  private renderer: Renderer;
  private inputHandler: InputHandler;
  private brushSettings: BrushSettings;
  private loopCache: LoopCache;

  private needsRemesh = true;
  private isLiveCarving = false; // Track if we're currently carving
  private needsFullHeal = false; // Track if we need a full-world remesh
  private lastFullHealTime = 0;
  private animationFrameId = 0;

  // Performance tracking
  private frameCount = 0;
  private lastFpsTime = 0;
  private fps = 0;

  constructor() {
    try {
      console.log('Initializing CarvableCaves...');

      // World configuration
      const worldConfig: WorldConfig = {
        width: 100, // metres (halved from 200)
        height: 60, // metres (halved from 120)
        gridPitch: 0.1, // metres (h)
        isoValue: 128
      };
      console.log('World config:', worldConfig);

      // Brush settings
      this.brushSettings = {
        radius: 2, // metres
        strength: 30 // 0-255
      };
      console.log('Brush settings:', this.brushSettings);

      // Setup canvas
      this.canvas = document.getElementById('canvas') as HTMLCanvasElement;
      if (!this.canvas) {
        throw new Error('Canvas not found');
      }
      console.log('Canvas found:', this.canvas);

      // Initialize camera (centered on world)
      this.camera = new Camera(
        worldConfig.width / 2,
        worldConfig.height / 2,
        50 // initial PPM (pixels per metre)
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

      // Initialize marching squares
      this.marchingSquares = new MarchingSquares(this.densityField, worldConfig.isoValue);
      console.log('Marching squares initialized');

      // Initialize loop cache
      this.loopCache = new LoopCache();
      console.log('Loop cache initialized');

      // Initialize renderer
      this.renderer = new Renderer(this.canvas, this.camera);
      console.log('Renderer initialized');

      // Initialize input handler
      this.inputHandler = new InputHandler(
        this.canvas,
        this.camera,
        this.densityField,
        this.brushSettings
      );
      console.log('Input handler initialized');

      this.inputHandler.onCarve = () => {
        this.isLiveCarving = true;
        this.needsRemesh = true;
      };

      this.inputHandler.onCarveEnd = () => {
        this.isLiveCarving = false;
        this.needsRemesh = true;
        this.needsFullHeal = true; // Full heal on pointer up
      };

      // Setup UI
      this.setupUI();
      console.log('UI setup complete');

      // Window resize
      window.addEventListener('resize', () => {
        this.renderer.resize();
      });

      // Start render loop
      this.start();
      console.log('CarvableCaves initialized successfully!');
    } catch (error) {
      console.error('Failed to initialize CarvableCaves:', error);
      throw error;
    }
  }

  private setupUI(): void {
    // Brush radius slider
    const radiusSlider = document.getElementById('brush-radius') as HTMLInputElement;
    const radiusValue = document.getElementById('brush-radius-value') as HTMLSpanElement;

    if (radiusSlider && radiusValue) {
      radiusSlider.value = this.brushSettings.radius.toString();
      radiusValue.textContent = this.brushSettings.radius.toFixed(1);

      radiusSlider.addEventListener('input', () => {
        this.brushSettings.radius = parseFloat(radiusSlider.value);
        radiusValue.textContent = this.brushSettings.radius.toFixed(1);
        this.inputHandler.setBrushSettings(this.brushSettings);
      });
    }

    // Brush strength slider
    const strengthSlider = document.getElementById('brush-strength') as HTMLInputElement;
    const strengthValue = document.getElementById('brush-strength-value') as HTMLSpanElement;

    if (strengthSlider && strengthValue) {
      strengthSlider.value = this.brushSettings.strength.toString();
      strengthValue.textContent = this.brushSettings.strength.toString();

      strengthSlider.addEventListener('input', () => {
        this.brushSettings.strength = parseInt(strengthSlider.value);
        strengthValue.textContent = this.brushSettings.strength.toString();
        this.inputHandler.setBrushSettings(this.brushSettings);
      });
    }

    // Reset button (now regenerates caves)
    const resetButton = document.getElementById('reset-button') as HTMLButtonElement;
    if (resetButton) {
      console.log('Reset button found, attaching event listeners');

      const handleReset = (e: Event) => {
        console.log('Reset button activated - regenerating caves');
        e.preventDefault();
        e.stopPropagation();
        // Generate new caves with random seed
        this.densityField.generateCaves(undefined, 0.05, 4, 0.1);
        this.needsRemesh = true;
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
  }

  private start(): void {
    console.log('Starting render loop...');
    // Initial mesh generation
    this.remesh();
    this.loop();
  }

  private loop = (): void => {
    this.animationFrameId = requestAnimationFrame(this.loop);

    // Update FPS
    this.updateFPS();

    // Remesh if needed
    if (this.needsRemesh) {
      this.remesh();
      this.needsRemesh = false;
    }

    // Render
    this.renderer.render();
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
    this.renderer.updatePolylines(allLoops.map(l => l.vertices));

    this.densityField.clearDirty();

    const elapsed = performance.now() - startTime;
    console.log(`[FullHeal] Complete. ${allLoops.length} loops in ${elapsed.toFixed(1)}ms`);
  }

  /**
   * Incremental update - only update affected loops
   */
  private incrementalUpdate(): void {
    const dirtyAABB = this.densityField.getDirtyWorldAABB();
    if (!dirtyAABB) {
      // No dirty region
      return;
    }

    const startTime = performance.now();

    // Expand dirty region for safety
    const h = this.densityField.config.gridPitch;
    const pad = Math.ceil(this.brushSettings.radius / h) + 2;
    const expandedAABB = {
      minX: Math.max(0, dirtyAABB.minX - pad * h),
      minY: Math.max(0, dirtyAABB.minY - pad * h),
      maxX: Math.min(this.densityField.config.width, dirtyAABB.maxX + pad * h),
      maxY: Math.min(this.densityField.config.height, dirtyAABB.maxY + pad * h)
    };

    // Query loops that intersect dirty region
    const affectedLoops = this.loopCache.queryAABB(expandedAABB);

    console.log(`[Incremental] Dirty region: (${expandedAABB.minX.toFixed(1)},${expandedAABB.minY.toFixed(1)}) to (${expandedAABB.maxX.toFixed(1)},${expandedAABB.maxY.toFixed(1)})`);
    console.log(`[Incremental] Affected loops: ${affectedLoops.length}`);

    // Remove affected loops
    for (const loop of affectedLoops) {
      this.loopCache.removeLoop(loop.id);
    }

    // Generate new loops in dirty region
    const results = this.marchingSquares.generateContours(expandedAABB, pad);

    // Add new loops to cache
    let newLoopCount = 0;
    for (const result of results) {
      if (result && result.loop && result.loop.length > 2) {
        this.loopCache.addLoop(result.loop, result.closed);
        newLoopCount++;
      }
    }

    // Update renderer with all loops
    const allLoops = this.loopCache.getAllLoops();
    this.renderer.updatePolylines(allLoops.map(l => l.vertices));

    // Clear dirty region
    if (!this.isLiveCarving) {
      this.densityField.clearDirty();
    }

    const elapsed = performance.now() - startTime;
    console.log(`[Incremental] Updated ${affectedLoops.length}→${newLoopCount} loops in ${elapsed.toFixed(1)}ms (total: ${allLoops.length})`);
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
