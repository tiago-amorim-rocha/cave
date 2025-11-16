/**
 * Vertical Pulse Scenario - Apply tiny upward force to analyze joint behavior
 *
 * Applies a small vertical (upward) input for a short duration
 * to observe how forces propagate through the leg joints.
 */

import type { InputEvent, IScenario } from './types';

export class VerticalPulseScenario implements IScenario {
  private readonly duration: number; // seconds
  private readonly inputMagnitude: number; // [0, 1]
  private readonly fps: number = 60;

  /**
   * @param duration - Duration in seconds
   * @param inputMagnitude - Vertical input magnitude (0.01 = 1%, 0.1 = 10%, etc.)
   */
  constructor(duration: number = 2, inputMagnitude: number = 0.1) {
    this.duration = duration;
    this.inputMagnitude = inputMagnitude;
  }

  getName(): string {
    return 'Vertical Pulse Test';
  }

  getDescription(): string {
    return `Apply vertical upward force (${(this.inputMagnitude * 100).toFixed(1)}%) for ${this.duration}s to analyze joint forces`;
  }

  getTotalSteps(): number {
    return Math.floor(this.duration * this.fps);
  }

  isDone(step: number): boolean {
    return step >= this.getTotalSteps();
  }

  getInput(step: number): InputEvent {
    // Vertical input only (negative y = up in VirtualJoystick convention)
    return {
      x: 0,
      y: -this.inputMagnitude, // Negative = up
      magnitude: this.inputMagnitude
    };
  }
}
