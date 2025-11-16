/**
 * Scenario types and interfaces
 *
 * Scenarios define scripted input sequences for headless testing.
 */

/**
 * Input event for player controller
 */
export interface InputEvent {
  /** Horizontal input [-1, 1] (negative = left, positive = right) */
  x: number;

  /** Vertical input [-1, 1] (negative = down, positive = up) */
  y: number;

  /** Input magnitude [0, 1] */
  magnitude: number;
}

/**
 * Base interface for test scenarios
 */
export interface IScenario {
  /**
   * Get the scenario name
   */
  getName(): string;

  /**
   * Get the scenario description
   */
  getDescription(): string;

  /**
   * Get input for the current step
   * @param step - Current simulation step (0-indexed)
   * @returns Input event for this step
   */
  getInput(step: number): InputEvent;

  /**
   * Check if scenario is complete
   * @param step - Current simulation step
   * @returns True if scenario should end
   */
  isDone(step: number): boolean;

  /**
   * Get total expected steps
   * @returns Total number of steps, or -1 for infinite
   */
  getTotalSteps(): number;
}
