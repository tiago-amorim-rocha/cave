/**
 * Tiny Force Scenario - Start with very small forces to debug torque application
 *
 * Applies a tiny constant horizontal input (0.01 = 1%) for several seconds
 * to observe torque accumulation and segment behavior in detail.
 */

import type { InputEvent, IScenario } from './types';

export class TinyForceScenario implements IScenario {
  private readonly duration: number; // seconds
  private readonly inputMagnitude: number; // [0, 1]
  private readonly fps: number = 60;

  /**
   * @param duration - Duration in seconds
   * @param inputMagnitude - Input magnitude (0.01 = 1%, 0.1 = 10%, etc.)
   */
  constructor(duration: number = 3, inputMagnitude: number = 0.01) {
    this.duration = duration;
    this.inputMagnitude = inputMagnitude;
  }

  getName(): string {
    return 'Tiny Force Test';
  }

  getDescription(): string {
    return `Apply tiny horizontal force (${(this.inputMagnitude * 100).toFixed(1)}%) for ${this.duration}s to observe torque accumulation`;
  }

  getTotalSteps(): number {
    return Math.floor(this.duration * this.fps);
  }

  isDone(step: number): boolean {
    return step >= this.getTotalSteps();
  }

  getInput(step: number): InputEvent {
    // Constant tiny horizontal input throughout duration
    return {
      x: this.inputMagnitude,
      y: 0,
      magnitude: this.inputMagnitude
    };
  }
}
