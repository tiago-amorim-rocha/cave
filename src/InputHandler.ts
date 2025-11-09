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

  // For touch handling
  private touches: Map<number, { x: number; y: number }> = new Map();
  private previousTouches: Map<number, { x: number; y: number }> = new Map();
  private initialPinchDistance = 0;
  private initialZoom = 0;
  private pinchCenter = { x: 0, y: 0 };

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

  private onTouchStart(e: TouchEvent): void {
    // Check if touch is on a UI element (button, slider, etc)
    const target = e.target as HTMLElement;
    if (target && target !== this.canvas) {
      return; // Let the UI element handle it
    }

    e.preventDefault();

    // Store previous state
    this.previousTouches.clear();
    this.touches.forEach((pos, id) => {
      this.previousTouches.set(id, { ...pos });
    });

    // Update current touches
    this.touches.clear();
    for (let i = 0; i < e.touches.length; i++) {
      const touch = e.touches[i];
      const pos = this.getTouchPosition(touch);
      this.touches.set(touch.identifier, pos);
    }

    if (this.touches.size === 1) {
      // Single touch: start panning
      const [touch] = this.touches.values();
      this.lastPointerX = touch.x;
      this.lastPointerY = touch.y;
      this.isPanning = true;
    } else if (this.touches.size === 2) {
      // Two touches: prepare for pinch zoom
      this.isPanning = false;
      this.isCarving = false;

      const touchArray = Array.from(this.touches.values());
      const [t1, t2] = touchArray;

      // Calculate initial pinch distance
      this.initialPinchDistance = Math.hypot(t2.x - t1.x, t2.y - t1.y);
      this.initialZoom = this.camera.zoom;

      // Calculate pinch center point
      this.pinchCenter = {
        x: (t1.x + t2.x) / 2,
        y: (t1.y + t2.y) / 2
      };
    }
  }

  private onTouchMove(e: TouchEvent): void {
    // Check if touch started on a UI element
    const target = e.target as HTMLElement;
    if (target && target !== this.canvas) {
      return; // Let the UI element handle it
    }

    e.preventDefault();

    // Store previous state
    this.previousTouches.clear();
    this.touches.forEach((pos, id) => {
      this.previousTouches.set(id, { ...pos });
    });

    // Update current touches
    this.touches.clear();
    for (let i = 0; i < e.touches.length; i++) {
      const touch = e.touches[i];
      const pos = this.getTouchPosition(touch);
      this.touches.set(touch.identifier, pos);
    }

    if (this.touches.size === 1 && this.previousTouches.size === 1) {
      // Single touch: pan
      const [touchId] = this.touches.keys();
      const currentPos = this.touches.get(touchId)!;
      const previousPos = this.previousTouches.get(touchId);

      if (previousPos) {
        const dx = currentPos.x - previousPos.x;
        const dy = currentPos.y - previousPos.y;
        this.camera.pan(dx, dy);
      }

      this.lastPointerX = currentPos.x;
      this.lastPointerY = currentPos.y;
    } else if (this.touches.size === 2) {
      // Two touches: pinch zoom
      const touchArray = Array.from(this.touches.values());
      const [t1, t2] = touchArray;

      // Calculate current distance
      const currentDistance = Math.hypot(t2.x - t1.x, t2.y - t1.y);

      // Calculate current center
      const currentCenter = {
        x: (t1.x + t2.x) / 2,
        y: (t1.y + t2.y) / 2
      };

      if (this.initialPinchDistance > 0) {
        // Calculate zoom scale
        const scale = currentDistance / this.initialPinchDistance;
        const newZoom = Math.max(
          this.camera.minZoom,
          Math.min(this.camera.maxZoom, this.initialZoom * scale)
        );

        // Apply zoom centered on the pinch center
        const zoomDelta = newZoom / this.camera.zoom;
        this.camera.zoomAt(
          this.pinchCenter.x,
          this.pinchCenter.y,
          zoomDelta,
          this.canvas.width,
          this.canvas.height
        );
      }

      // Also pan based on center movement
      if (this.previousTouches.size === 2) {
        const prevTouchArray = Array.from(this.previousTouches.values());
        const [p1, p2] = prevTouchArray;
        const previousCenter = {
          x: (p1.x + p2.x) / 2,
          y: (p1.y + p2.y) / 2
        };

        const dx = currentCenter.x - previousCenter.x;
        const dy = currentCenter.y - previousCenter.y;
        this.camera.pan(dx, dy);
      }
    }
  }

  private onTouchEnd(e: TouchEvent): void {
    // Check if touch is on a UI element
    const target = e.target as HTMLElement;
    if (target && target !== this.canvas) {
      return; // Let the UI element handle it
    }

    e.preventDefault();

    // Store previous state
    this.previousTouches.clear();
    this.touches.forEach((pos, id) => {
      this.previousTouches.set(id, { ...pos });
    });

    // Update touches based on remaining touches
    this.touches.clear();
    for (let i = 0; i < e.touches.length; i++) {
      const touch = e.touches[i];
      const pos = this.getTouchPosition(touch);
      this.touches.set(touch.identifier, pos);
    }

    if (this.touches.size === 0) {
      // All touches ended
      if (this.isCarving) {
        this.onCarveEnd?.();
      }
      this.isCarving = false;
      this.isPanning = false;
      this.initialPinchDistance = 0;
    } else if (this.touches.size === 1) {
      // Back to single touch: restart panning
      const [touch] = this.touches.values();
      this.lastPointerX = touch.x;
      this.lastPointerY = touch.y;
      this.isPanning = true;
      this.initialPinchDistance = 0;
    } else if (this.touches.size === 2) {
      // Still have 2 touches, reinitialize pinch
      const touchArray = Array.from(this.touches.values());
      const [t1, t2] = touchArray;
      this.initialPinchDistance = Math.hypot(t2.x - t1.x, t2.y - t1.y);
      this.initialZoom = this.camera.zoom;
      this.pinchCenter = {
        x: (t1.x + t2.x) / 2,
        y: (t1.y + t2.y) / 2
      };
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
