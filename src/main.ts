import { Camera } from './Camera';
import { DensityField } from './DensityField';
import { MarchingSquares } from './MarchingSquares';
import { Renderer } from './Renderer';
import { InputHandler } from './InputHandler';
import { DebugConsole } from './DebugConsole';
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

  private needsRemesh = true;
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
        width: 200, // metres
        height: 120, // metres
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

      // Initialize marching squares
      this.marchingSquares = new MarchingSquares(this.densityField, worldConfig.isoValue);
      console.log('Marching squares initialized');

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
        this.needsRemesh = true;
      };

      this.inputHandler.onCarveEnd = () => {
        this.needsRemesh = true; // Final remesh
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

    // Reset button
    const resetButton = document.getElementById('reset-button') as HTMLButtonElement;
    if (resetButton) {
      console.log('Reset button found, attaching event listeners');

      const handleReset = (e: Event) => {
        console.log('Reset button activated');
        e.preventDefault();
        e.stopPropagation();
        this.densityField.reset();
        this.needsRemesh = true;
      };

      resetButton.addEventListener('click', handleReset);
      resetButton.addEventListener('touchend', handleReset, { passive: false });
    } else {
      console.error('Reset button NOT found!');
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
      console.log('Remeshing...');
      const polylines = this.marchingSquares.generateContours();
      console.log(`Generated ${polylines.length} polylines`);
      this.renderer.updatePolylines(polylines);
      this.densityField.clearDirty();
    } catch (error) {
      console.error('Error during remesh:', error);
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

// Initialize debug console and show it by default
let debugConsole: DebugConsole;
try {
  debugConsole = new DebugConsole();
  debugConsole.show(); // Open by default for debugging
  console.log('Debug console created and shown');
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
console.log('Debug console is open by default');
console.log('🐛 Click the bug button to toggle it');
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

// Register service worker for PWA with update detection
if ('serviceWorker' in navigator) {
  // Use vite-plugin-pwa's virtual module for service worker registration
  import('virtual:pwa-register').then(({ registerSW }) => {
    const updateButton = document.getElementById('update-button');

    const updateSW = registerSW({
      onNeedRefresh() {
        // Show the update button when a new version is available
        if (updateButton) {
          updateButton.classList.add('visible');
        }
      },
      onOfflineReady() {
        console.log('App ready to work offline');
      }
    });

    // Handle update button click
    if (updateButton) {
      updateButton.addEventListener('click', () => {
        updateSW(true); // Update and reload
      });
    }
  }).catch(() => {
    // Service worker registration failed (expected in dev mode)
  });
}

export { app };
