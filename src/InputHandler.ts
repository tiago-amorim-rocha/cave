import type { Camera } from './Camera';
import type { DensityField } from './DensityField';
import type { BrushSettings } from './types';

type Point = { x: number; y: number };

/**
 * Handle pointer input for pan, zoom, and carving using modern Pointer Events API
 * Based on industry best practices for canvas gesture handling
 */
export class InputHandler {
  private canvas: HTMLCanvasElement;
  private camera: Camera;
  private densityField: DensityField;
  private brushSettings: BrushSettings;

  // Pointer tracking (unified for mouse, touch, pen)
  private pointers = new Map<number, Point>();

  // Pinch zoom state
  private startDist = 0;
  private startScale = 1;
  private startCentroid: Point | null = null;

  // Single pointer pan state
  private lastPanPoint: Point | null = null;

  // Modifier keys
  private addMode = false; // true = add, false = subtract

  // Carving throttle
  private lastCarveTime = 0;
  private carveThrottleMs = 33; // ~30 Hz

  // Callbacks
  public onCarve?: () => void;
  public onCarveEnd?: () => void;

  // Camera controls enabled state
  private cameraControlsEnabled = true;

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
    // Pointer events (unified for touch/mouse/pen)
    this.canvas.addEventListener('pointerdown', this.onPointerDown.bind(this));
    this.canvas.addEventListener('pointermove', this.onPointerMove.bind(this));
    this.canvas.addEventListener('pointerup', this.onPointerUp.bind(this));
    this.canvas.addEventListener('pointercancel', this.onPointerUp.bind(this));
    this.canvas.addEventListener('pointerleave', this.onPointerLeave.bind(this));

    // Wheel for mouse zoom
    this.canvas.addEventListener('wheel', this.onWheel.bind(this));

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

  private toLocal(e: PointerEvent): Point {
    const rect = this.canvas.getBoundingClientRect();
    return {
      x: e.clientX - rect.left,
      y: e.clientY - rect.top
    };
  }

  private onPointerDown(e: PointerEvent): void {
    // Check if pointer is on a UI element
    const target = e.target as HTMLElement;
    if (target && target !== this.canvas) {
      return;
    }

    // Ignore if camera controls are disabled
    if (!this.cameraControlsEnabled) {
      return;
    }

    e.preventDefault();

    // Capture this pointer to receive all future events even if it moves off canvas
    this.canvas.setPointerCapture(e.pointerId);

    const point = this.toLocal(e);
    this.pointers.set(e.pointerId, point);

    if (this.pointers.size === 1) {
      // Single pointer - start pan
      this.lastPanPoint = point;
    } else if (this.pointers.size === 2) {
      // Two pointers - start pinch
      this.beginPinch();
    }
  }

  private onPointerMove(e: PointerEvent): void {
    if (!this.pointers.has(e.pointerId)) return;

    // Ignore if camera controls are disabled
    if (!this.cameraControlsEnabled) {
      return;
    }

    e.preventDefault();

    const point = this.toLocal(e);
    this.pointers.set(e.pointerId, point);

    if (this.pointers.size === 1) {
      // Single pointer pan
      this.pan(point);
    } else if (this.pointers.size === 2) {
      // Two pointer pinch
      this.pinch();
    }
  }

  private onPointerUp(e: PointerEvent): void {
    e.preventDefault();

    this.pointers.delete(e.pointerId);

    if (this.canvas.hasPointerCapture(e.pointerId)) {
      this.canvas.releasePointerCapture(e.pointerId);
    }

    // Reset states
    this.lastPanPoint = null;
    this.startCentroid = null;

    // If we still have pointers, restart gesture
    if (this.pointers.size === 1) {
      const [point] = this.pointers.values();
      this.lastPanPoint = point;
    } else if (this.pointers.size === 2) {
      this.beginPinch();
    }
  }

  private onPointerLeave(e: PointerEvent): void {
    // Only handle if we've lost capture
    if (!this.canvas.hasPointerCapture(e.pointerId)) {
      this.pointers.delete(e.pointerId);
      this.lastPanPoint = null;
      this.startCentroid = null;
    }
  }

  private onWheel(e: WheelEvent): void {
    // Ignore if camera controls are disabled
    if (!this.cameraControlsEnabled) {
      return;
    }

    e.preventDefault();

    const point = {
      x: e.clientX - this.canvas.getBoundingClientRect().left,
      y: e.clientY - this.canvas.getBoundingClientRect().top
    };

    const zoomDelta = e.deltaY > 0 ? 0.9 : 1.1;
    this.zoomAt(point, zoomDelta);
  }

  // Calculate centroid (midpoint) of all pointers
  private centroid(): Point {
    const points = [...this.pointers.values()];
    if (points.length === 0) return { x: 0, y: 0 };
    if (points.length === 1) return points[0];

    return {
      x: (points[0].x + points[1].x) / 2,
      y: (points[0].y + points[1].y) / 2
    };
  }

  // Calculate distance between two pointers
  private distance(): number {
    const points = [...this.pointers.values()];
    if (points.length < 2) return 0;

    const dx = points[0].x - points[1].x;
    const dy = points[0].y - points[1].y;
    return Math.hypot(dx, dy);
  }

  // Convert screen coordinates to world coordinates
  private screenToWorld(p: Point): Point {
    const dpr = window.devicePixelRatio || 1;
    const canvasWidth = this.canvas.width / dpr;
    const canvasHeight = this.canvas.height / dpr;

    return this.camera.screenToWorld(p.x, p.y, canvasWidth, canvasHeight);
  }

  // Initialize pinch gesture state
  private beginPinch(): void {
    this.startDist = this.distance();
    this.startScale = this.camera.zoom;
    this.startCentroid = this.centroid();
    this.lastPanPoint = null; // Disable single-finger pan during pinch
  }

  // Handle pinch zoom gesture
  private pinch(): void {
    if (!this.startCentroid) {
      this.beginPinch();
      return;
    }

    const currentCentroid = this.centroid();
    const currentDist = this.distance();

    if (this.startDist < 1) return; // Avoid division by zero

    // Calculate scale factor
    const scaleFactor = currentDist / this.startDist;
    const targetScale = this.startScale * scaleFactor;

    // Clamp to camera limits
    const newScale = Math.max(
      this.camera.minZoom,
      Math.min(this.camera.maxZoom, targetScale)
    );

    // Get world position at current centroid BEFORE zoom
    const worldBefore = this.screenToWorld(currentCentroid);

    // Apply new zoom
    this.camera.zoom = newScale;

    // Get world position at current centroid AFTER zoom
    const worldAfter = this.screenToWorld(currentCentroid);

    // Adjust camera position to keep the same world point under the centroid
    this.camera.x += (worldBefore.x - worldAfter.x);
    this.camera.y += (worldBefore.y - worldAfter.y);
  }

  // Handle single pointer pan
  private pan(currentPoint: Point): void {
    if (!this.lastPanPoint) {
      this.lastPanPoint = currentPoint;
      return;
    }

    const dx = currentPoint.x - this.lastPanPoint.x;
    const dy = currentPoint.y - this.lastPanPoint.y;

    // Pan in screen space
    this.camera.pan(dx, dy);

    this.lastPanPoint = currentPoint;
  }

  // Zoom at a specific screen point
  private zoomAt(screenPoint: Point, zoomDelta: number): void {
    const dpr = window.devicePixelRatio || 1;
    const canvasWidth = this.canvas.width / dpr;
    const canvasHeight = this.canvas.height / dpr;

    this.camera.zoomAt(screenPoint.x, screenPoint.y, zoomDelta, canvasWidth, canvasHeight);
  }

  /**
   * Called once per frame to process any pending input updates
   * This is where we would handle batched input if needed
   */
  public update(): void {
    // Currently input is processed immediately in event handlers
    // This method exists for future rAF-based input batching if needed
  }

  setBrushSettings(settings: BrushSettings): void {
    this.brushSettings = settings;
  }

  /**
   * Enable or disable camera controls (pan, zoom)
   */
  setCameraControlsEnabled(enabled: boolean): void {
    this.cameraControlsEnabled = enabled;

    // Clear any active pan/zoom state when disabling
    if (!enabled) {
      this.pointers.clear();
      this.lastPanPoint = null;
      this.startCentroid = null;
    }
  }
}
