/**
 * Simple test scenario: Hold right input for N seconds
 *
 * Tests basic horizontal movement on flat ground.
 */

import type { IScenario, InputEvent } from './types';

export class HoldRightScenario implements IScenario {
  private durationSeconds: number;
  private inputMagnitude: number;
  private totalSteps: number;

  /**
   * @param durationSeconds - How long to hold right input
   * @param inputMagnitude - Input strength [0, 1], default 1.0 (full)
   * @param fps - Simulation framerate, default 60
   */
  constructor(durationSeconds: number = 5, inputMagnitude: number = 1.0, fps: number = 60) {
    this.durationSeconds = durationSeconds;
    this.inputMagnitude = Math.max(0, Math.min(1, inputMagnitude));
    this.totalSteps = Math.floor(durationSeconds * fps);
  }

  getName(): string {
    return 'Hold Right';
  }

  getDescription(): string {
    return `Hold right input (${this.inputMagnitude.toFixed(1)}) for ${this.durationSeconds}s`;
  }

  getInput(step: number): InputEvent {
    if (step < this.totalSteps) {
      return {
        x: this.inputMagnitude,
        y: 0,
        magnitude: this.inputMagnitude
      };
    } else {
      return {
        x: 0,
        y: 0,
        magnitude: 0
      };
    }
  }

  isDone(step: number): boolean {
    return step >= this.totalSteps;
  }

  getTotalSteps(): number {
    return this.totalSteps;
  }
}
