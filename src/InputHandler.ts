import type { Camera } from './Camera';
import type { DensityField } from './DensityField';
import type { BrushSettings } from './types';

/**
 * Handle touch/mouse input for pan, zoom, and carving
 */
export class InputHandler {
  private canvas: HTMLCanvasElement;
  private camera: Camera;
  private densityField: DensityField;
  private brushSettings: BrushSettings;

  private isPanning = false;
  private isCarving = false;
  private addMode = false; // true = add, false = subtract

  private lastPointerX = 0;
  private lastPointerY = 0;

  // For touch handling - simplified approach
  private lastTouchDistance = 0;
  private lastTouchCenter = { x: 0, y: 0 };
  private lastZoom = 0;

  // Carving throttle
  private lastCarveTime = 0;
  private carveThrottleMs = 33; // ~30 Hz

  // Callbacks
  public onCarve?: () => void;
  public onCarveEnd?: () => void;

  constructor(
    canvas: HTMLCanvasElement,
    camera: Camera,
    densityField: DensityField,
    brushSettings: BrushSettings
  ) {
    this.canvas = canvas;
    this.camera = camera;
    this.densityField = densityField;
    this.brushSettings = brushSettings;

    this.setupListeners();
  }

  private setupListeners(): void {
    // Mouse events
    this.canvas.addEventListener('mousedown', this.onPointerDown.bind(this));
    this.canvas.addEventListener('mousemove', this.onPointerMove.bind(this));
    this.canvas.addEventListener('mouseup', this.onPointerUp.bind(this));
    this.canvas.addEventListener('wheel', this.onWheel.bind(this));

    // Touch events
    this.canvas.addEventListener('touchstart', this.onTouchStart.bind(this), { passive: false });
    this.canvas.addEventListener('touchmove', this.onTouchMove.bind(this), { passive: false });
    this.canvas.addEventListener('touchend', this.onTouchEnd.bind(this), { passive: false });
    this.canvas.addEventListener('touchcancel', this.onTouchEnd.bind(this), { passive: false });

    // Keyboard for modifier keys
    window.addEventListener('keydown', this.onKeyDown.bind(this));
    window.addEventListener('keyup', this.onKeyUp.bind(this));

    // Prevent context menu
    this.canvas.addEventListener('contextmenu', (e) => e.preventDefault());
  }

  private onKeyDown(e: KeyboardEvent): void {
    if (e.key === 'Shift' || e.key === 'Alt' || e.key === 'Control') {
      this.addMode = true;
    }
  }

  private onKeyUp(e: KeyboardEvent): void {
    if (e.key === 'Shift' || e.key === 'Alt' || e.key === 'Control') {
      this.addMode = false;
    }
  }

  private onPointerDown(e: MouseEvent): void {
    const rect = this.canvas.getBoundingClientRect();
    const x = (e.clientX - rect.left) * (this.canvas.width / rect.width);
    const y = (e.clientY - rect.top) * (this.canvas.height / rect.height);

    this.lastPointerX = x;
    this.lastPointerY = y;

    if (e.button === 0 || e.button === 2) {
      // Left click or right click: pan (carving disabled)
      this.isPanning = true;
    }
  }

  private onPointerMove(e: MouseEvent): void {
    const rect = this.canvas.getBoundingClientRect();
    const x = (e.clientX - rect.left) * (this.canvas.width / rect.width);
    const y = (e.clientY - rect.top) * (this.canvas.height / rect.height);

    const dx = x - this.lastPointerX;
    const dy = y - this.lastPointerY;

    if (this.isPanning) {
      this.camera.pan(dx, dy);
    }

    if (this.isCarving) {
      this.carveAt(x, y);
    }

    this.lastPointerX = x;
    this.lastPointerY = y;
  }

  private onPointerUp(_e: MouseEvent): void {
    if (this.isCarving) {
      this.isCarving = false;
      this.onCarveEnd?.();
    }
    this.isPanning = false;
  }

  private onWheel(e: WheelEvent): void {
    e.preventDefault();

    const rect = this.canvas.getBoundingClientRect();
    const x = (e.clientX - rect.left) * (this.canvas.width / rect.width);
    const y = (e.clientY - rect.top) * (this.canvas.height / rect.height);

    const zoomDelta = e.deltaY > 0 ? 0.9 : 1.1;
    this.camera.zoomAt(x, y, zoomDelta, this.canvas.width, this.canvas.height);
  }

  private getTouchPosition(touch: Touch): { x: number; y: number } {
    const rect = this.canvas.getBoundingClientRect();
    const x = (touch.clientX - rect.left) * (this.canvas.width / rect.width);
    const y = (touch.clientY - rect.top) * (this.canvas.height / rect.height);
    return { x, y };
  }

  private getTouchCenter(touches: TouchList): { x: number; y: number } {
    if (touches.length === 1) {
      return this.getTouchPosition(touches[0]);
    }
    const t1 = this.getTouchPosition(touches[0]);
    const t2 = this.getTouchPosition(touches[1]);
    return {
      x: (t1.x + t2.x) / 2,
      y: (t1.y + t2.y) / 2
    };
  }

  private getTouchDistance(touches: TouchList): number {
    if (touches.length < 2) return 0;
    const t1 = this.getTouchPosition(touches[0]);
    const t2 = this.getTouchPosition(touches[1]);
    return Math.hypot(t2.x - t1.x, t2.y - t1.y);
  }

  private onTouchStart(e: TouchEvent): void {
    // Check if touch is on a UI element
    const target = e.target as HTMLElement;
    if (target && target !== this.canvas) {
      return;
    }

    e.preventDefault();

    const touches = e.touches;

    if (touches.length === 1) {
      // Single touch: pan
      const pos = this.getTouchPosition(touches[0]);
      this.lastPointerX = pos.x;
      this.lastPointerY = pos.y;
      this.isPanning = true;
    } else if (touches.length === 2) {
      // Two fingers: pinch zoom
      this.isPanning = false;
      this.isCarving = false;

      // Store initial state
      this.lastTouchCenter = this.getTouchCenter(touches);
      this.lastTouchDistance = this.getTouchDistance(touches);
      this.lastZoom = this.camera.zoom;
    }
  }

  private onTouchMove(e: TouchEvent): void {
    const target = e.target as HTMLElement;
    if (target && target !== this.canvas) {
      return;
    }

    e.preventDefault();

    const touches = e.touches;

    if (touches.length === 1 && this.isPanning) {
      // Single finger pan
      const pos = this.getTouchPosition(touches[0]);
      const dx = pos.x - this.lastPointerX;
      const dy = pos.y - this.lastPointerY;

      this.camera.pan(dx, dy);

      this.lastPointerX = pos.x;
      this.lastPointerY = pos.y;
    } else if (touches.length === 2) {
      // Two finger pinch zoom
      const currentCenter = this.getTouchCenter(touches);
      const currentDistance = this.getTouchDistance(touches);

      if (this.lastTouchDistance > 0) {
        // Calculate scale change
        const scale = currentDistance / this.lastTouchDistance;

        // Apply zoom centered on the last touch center (not current center)
        // This prevents drift by keeping the zoom anchored to where the pinch started
        const zoomDelta = scale;
        this.camera.zoomAt(
          this.lastTouchCenter.x,
          this.lastTouchCenter.y,
          zoomDelta,
          this.canvas.width,
          this.canvas.height
        );

        // Pan based on center movement (allows panning while pinching)
        const dx = currentCenter.x - this.lastTouchCenter.x;
        const dy = currentCenter.y - this.lastTouchCenter.y;
        this.camera.pan(dx, dy);
      }

      // Update for next frame
      this.lastTouchCenter = currentCenter;
      this.lastTouchDistance = currentDistance;
    }
  }

  private onTouchEnd(e: TouchEvent): void {
    const target = e.target as HTMLElement;
    if (target && target !== this.canvas) {
      return;
    }

    e.preventDefault();

    const touches = e.touches;

    if (touches.length === 0) {
      // All touches ended
      if (this.isCarving) {
        this.onCarveEnd?.();
      }
      this.isCarving = false;
      this.isPanning = false;
      this.lastTouchDistance = 0;
    } else if (touches.length === 1) {
      // Back to single touch - restart pan
      const pos = this.getTouchPosition(touches[0]);
      this.lastPointerX = pos.x;
      this.lastPointerY = pos.y;
      this.isPanning = true;
      this.lastTouchDistance = 0;
    } else if (touches.length === 2) {
      // Still 2 touches - reinitialize pinch state
      this.lastTouchCenter = this.getTouchCenter(touches);
      this.lastTouchDistance = this.getTouchDistance(touches);
      this.lastZoom = this.camera.zoom;
    }
  }

  private carveAt(screenX: number, screenY: number): void {
    // Throttle carving
    const now = performance.now();
    if (now - this.lastCarveTime < this.carveThrottleMs) {
      return;
    }
    this.lastCarveTime = now;

    // Convert screen to world coords
    const worldPos = this.camera.screenToWorld(screenX, screenY, this.canvas.width, this.canvas.height);

    // Apply brush
    this.densityField.applyBrush(
      worldPos.x,
      worldPos.y,
      this.brushSettings.radius,
      this.brushSettings.strength,
      this.addMode
    );

    this.onCarve?.();
  }

  setBrushSettings(settings: BrushSettings): void {
    this.brushSettings = settings;
  }
}
