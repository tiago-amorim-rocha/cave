import { Camera } from './Camera';
import { DensityField } from './DensityField';
import { MarchingSquares } from './MarchingSquares';
import { Renderer } from './Renderer';
import { InputHandler } from './InputHandler';
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
    // World configuration
    const worldConfig: WorldConfig = {
      width: 200, // metres
      height: 120, // metres
      gridPitch: 0.1, // metres (h)
      isoValue: 128
    };

    // Brush settings
    this.brushSettings = {
      radius: 2, // metres
      strength: 30 // 0-255
    };

    // Setup canvas
    this.canvas = document.getElementById('canvas') as HTMLCanvasElement;
    if (!this.canvas) {
      throw new Error('Canvas not found');
    }

    // Initialize camera (centered on world)
    this.camera = new Camera(
      worldConfig.width / 2,
      worldConfig.height / 2,
      50 // initial PPM (pixels per metre)
    );

    // Initialize density field
    this.densityField = new DensityField(worldConfig);

    // Initialize marching squares
    this.marchingSquares = new MarchingSquares(this.densityField, worldConfig.isoValue);

    // Initialize renderer
    this.renderer = new Renderer(this.canvas, this.camera);

    // Initialize input handler
    this.inputHandler = new InputHandler(
      this.canvas,
      this.camera,
      this.densityField,
      this.brushSettings
    );

    this.inputHandler.onCarve = () => {
      this.needsRemesh = true;
    };

    this.inputHandler.onCarveEnd = () => {
      this.needsRemesh = true; // Final remesh
    };

    // Setup UI
    this.setupUI();

    // Window resize
    window.addEventListener('resize', () => {
      this.renderer.resize();
    });

    // Start render loop
    this.start();
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
      resetButton.addEventListener('click', () => {
        this.densityField.reset();
        this.needsRemesh = true;
      });
    }
  }

  private start(): void {
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
    const polylines = this.marchingSquares.generateContours();
    this.renderer.updatePolylines(polylines);
    this.densityField.clearDirty();
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

// Start the application
const app = new CarvableCaves();

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
