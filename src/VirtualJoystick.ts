/**
 * Virtual joystick for mobile touch controls
 * Provides normalized 2D input vector for character movement
 */

export interface JoystickInput {
  x: number; // -1 (left) to 1 (right)
  y: number; // -1 (up) to 1 (down)
  magnitude: number; // 0 to 1
}

export interface JoystickOptions {
  /** Base position in screen coordinates */
  x: number;
  y: number;
  /** Outer radius in pixels */
  outerRadius: number;
  /** Inner stick radius in pixels */
  innerRadius: number;
  /** Maximum displacement of stick from center */
  maxDisplacement: number;
  /** Deadzone (0-1) to ignore small movements */
  deadzone: number;
}

export class VirtualJoystick {
  private options: JoystickOptions;
  private active = false;
  private touchId: number | null = null;
  private visible = true; // Track visibility state

  // Stick position relative to base
  private stickX = 0;
  private stickY = 0;

  // Current normalized input
  private input: JoystickInput = { x: 0, y: 0, magnitude: 0 };

  constructor(options: Partial<JoystickOptions> = {}) {
    this.options = {
      x: options.x ?? 60,
      y: options.y ?? window.innerHeight - 60,
      outerRadius: options.outerRadius ?? 72,
      innerRadius: options.innerRadius ?? 27,
      maxDisplacement: options.maxDisplacement ?? 45,
      deadzone: options.deadzone ?? 0.15,
    };

    this.setupTouchListeners();
  }

  /**
   * Setup touch event listeners
   */
  private setupTouchListeners(): void {
    const canvas = document.querySelector('canvas');
    if (!canvas) {
      console.warn('[VirtualJoystick] Canvas not found, touch events disabled');
      return;
    }

    // Prevent default touch behavior on canvas
    canvas.addEventListener('touchstart', (e) => {
      this.handleTouchStart(e);
    }, { passive: false });

    canvas.addEventListener('touchmove', (e) => {
      this.handleTouchMove(e);
    }, { passive: false });

    canvas.addEventListener('touchend', (e) => {
      this.handleTouchEnd(e);
    }, { passive: false });

    canvas.addEventListener('touchcancel', (e) => {
      this.handleTouchEnd(e);
    }, { passive: false });
  }

  /**
   * Handle touch start
   */
  private handleTouchStart(e: TouchEvent): void {
    // Ignore if not visible
    if (!this.visible) {
      return;
    }

    // Only activate on touches in the joystick area
    for (let i = 0; i < e.changedTouches.length; i++) {
      const touch = e.changedTouches[i];
      const dx = touch.clientX - this.options.x;
      const dy = touch.clientY - this.options.y;
      const distance = Math.sqrt(dx * dx + dy * dy);

      // Check if touch is within joystick outer radius
      if (distance <= this.options.outerRadius && !this.active) {
        this.active = true;
        this.touchId = touch.identifier;
        this.updateStickPosition(touch.clientX, touch.clientY);
        e.preventDefault();
        break;
      }
    }
  }

  /**
   * Handle touch move
   */
  private handleTouchMove(e: TouchEvent): void {
    if (!this.active || this.touchId === null) return;

    // Find our touch
    for (let i = 0; i < e.changedTouches.length; i++) {
      const touch = e.changedTouches[i];
      if (touch.identifier === this.touchId) {
        this.updateStickPosition(touch.clientX, touch.clientY);
        e.preventDefault();
        break;
      }
    }
  }

  /**
   * Handle touch end
   */
  private handleTouchEnd(e: TouchEvent): void {
    if (!this.active || this.touchId === null) return;

    // Find our touch
    for (let i = 0; i < e.changedTouches.length; i++) {
      const touch = e.changedTouches[i];
      if (touch.identifier === this.touchId) {
        this.active = false;
        this.touchId = null;
        this.stickX = 0;
        this.stickY = 0;
        this.updateInput();
        e.preventDefault();
        break;
      }
    }
  }

  /**
   * Update stick position from touch coordinates
   */
  private updateStickPosition(touchX: number, touchY: number): void {
    // Calculate displacement from center
    let dx = touchX - this.options.x;
    let dy = touchY - this.options.y;
    let distance = Math.sqrt(dx * dx + dy * dy);

    // Clamp to max displacement
    if (distance > this.options.maxDisplacement) {
      const angle = Math.atan2(dy, dx);
      dx = Math.cos(angle) * this.options.maxDisplacement;
      dy = Math.sin(angle) * this.options.maxDisplacement;
      distance = this.options.maxDisplacement;
    }

    this.stickX = dx;
    this.stickY = dy;
    this.updateInput();
  }

  /**
   * Update normalized input vector
   */
  private updateInput(): void {
    const distance = Math.sqrt(this.stickX * this.stickX + this.stickY * this.stickY);
    const maxDist = this.options.maxDisplacement;

    // Normalize to -1..1 range
    let magnitude = distance / maxDist;

    // Apply deadzone
    if (magnitude < this.options.deadzone) {
      this.input = { x: 0, y: 0, magnitude: 0 };
      return;
    }

    // Rescale magnitude to account for deadzone
    magnitude = (magnitude - this.options.deadzone) / (1 - this.options.deadzone);
    magnitude = Math.min(magnitude, 1);

    // Calculate normalized direction
    const normalizedX = distance > 0 ? this.stickX / distance : 0;
    const normalizedY = distance > 0 ? this.stickY / distance : 0;

    this.input = {
      x: normalizedX * magnitude,
      y: normalizedY * magnitude,
      magnitude,
    };
  }

  /**
   * Get current input state
   */
  getInput(): JoystickInput {
    return this.input;
  }

  /**
   * Check if joystick is active
   */
  isActive(): boolean {
    return this.active;
  }

  /**
   * Update joystick position (e.g., on window resize)
   */
  setPosition(x: number, y: number): void {
    this.options.x = x;
    this.options.y = y;
  }

  /**
   * Set joystick visibility
   */
  setVisible(visible: boolean): void {
    this.visible = visible;

    // Deactivate joystick if hiding while active
    if (!visible && this.active) {
      this.active = false;
      this.touchId = null;
      this.stickX = 0;
      this.stickY = 0;
      this.updateInput();
    }
  }

  /**
   * Check if joystick is visible
   */
  isVisible(): boolean {
    return this.visible;
  }

  /**
   * Render joystick on canvas
   */
  render(ctx: CanvasRenderingContext2D): void {
    // Don't render if not visible
    if (!this.visible) {
      return;
    }

    ctx.save();

    // Outer circle (base)
    ctx.beginPath();
    ctx.arc(this.options.x, this.options.y, this.options.outerRadius, 0, Math.PI * 2);
    ctx.fillStyle = this.active ? 'rgba(255, 255, 255, 0.15)' : 'rgba(255, 255, 255, 0.1)';
    ctx.fill();
    ctx.strokeStyle = 'rgba(255, 255, 255, 0.3)';
    ctx.lineWidth = 2;
    ctx.stroke();

    // Inner stick
    const stickCenterX = this.options.x + this.stickX;
    const stickCenterY = this.options.y + this.stickY;

    ctx.beginPath();
    ctx.arc(stickCenterX, stickCenterY, this.options.innerRadius, 0, Math.PI * 2);
    ctx.fillStyle = this.active ? 'rgba(255, 255, 255, 0.5)' : 'rgba(255, 255, 255, 0.3)';
    ctx.fill();
    ctx.strokeStyle = 'rgba(255, 255, 255, 0.6)';
    ctx.lineWidth = 2;
    ctx.stroke();

    // Direction indicator (when active and magnitude > 0)
    if (this.active && this.input.magnitude > 0.1) {
      ctx.beginPath();
      ctx.moveTo(this.options.x, this.options.y);
      ctx.lineTo(stickCenterX, stickCenterY);
      ctx.strokeStyle = 'rgba(255, 255, 255, 0.4)';
      ctx.lineWidth = 3;
      ctx.stroke();
    }

    ctx.restore();
  }

  /**
   * Update joystick position on window resize
   */
  handleResize(): void {
    // Keep joystick in bottom-left corner with less padding
    this.options.x = 60;
    this.options.y = window.innerHeight - 60;
  }
}
