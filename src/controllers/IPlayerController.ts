/**
 * Interface that all player controllers must implement
 */

export interface IPlayerController {
  /**
   * Update controller physics based on input
   * @param dt - Delta time in milliseconds
   */
  update(dt: number): void;

  /**
   * Get player position in world coordinates
   */
  getPosition(): { x: number; y: number };

  /**
   * Get player radius (for rendering)
   */
  getRadius(): number;

  /**
   * Get player height (for rendering and collision detection)
   */
  getHeight(): number;

  /**
   * Get the main player rigid body
   */
  getBody(): any;

  /**
   * Respawn player at new position
   * @param x - X position in metres
   * @param y - Y position in metres
   */
  respawn(x: number, y: number): void;

  /**
   * Set virtual joystick for mobile input
   * @param joystick - Joystick input { x, y } in [-1, 1]
   */
  setJoystick(joystick: { x: number; y: number }): void;

  /**
   * Check if player is grounded
   */
  isGrounded(): boolean;

  /**
   * Cleanup controller (remove physics bodies, event listeners, etc.)
   */
  destroy(): void;

  /**
   * Get controller type name (for debugging and UI)
   */
  getTypeName(): string;

  /**
   * Get all rigid bodies managed by this controller
   * Used for collision filtering and debug visualization
   */
  getAllBodies(): any[];

  /**
   * Optional debug draw method
   * @param ctx - Canvas rendering context
   * @param worldToScreen - Function to convert world coordinates to screen coordinates
   */
  debugDraw?(ctx: CanvasRenderingContext2D, worldToScreen: (x: number, y: number) => { x: number; y: number }): void;

  /**
   * Optional method to get current direction angle in radians
   * Used for directional rendering and carving
   * @returns Direction angle in radians (0 = right, PI/2 = down, etc.)
   */
  getDirection?(): number;
}
