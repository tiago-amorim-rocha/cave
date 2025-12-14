/**
 * Carving Debug Visualization Modes
 *
 * Defines a clear state machine for debug visualization to prevent rendering conflicts.
 * Only one mode can be active at a time, ensuring clean visualization without overlaps.
 */

/**
 * Debug visualization modes for the carving pipeline.
 *
 * Step progression:
 * NONE → CARVED_LOOPS → STITCHED_LOOPS → REUSE_PLAN → OPT_MERGING → WARM_OPTIMIZATION → NONE (cycles back)
 */
export enum CarvingDebugMode {
  /**
   * No debug visualization (default state)
   * Shows only the final physics-ready terrain
   */
  NONE = 'none',

  /**
   * Step 1: Show raw carved loops from marching squares
   * - Displays newly carved terrain fragments
   * - Shows carve region boundary
   */
  CARVED_LOOPS = 'carved_loops',

  /**
   * Step 2: Show stitched canonical loops
   * - Displays how carved loops are stitched to existing canonical geometry
   * - Shows segment boundaries with ancestry markers
   * - Replaces Step 1 visualization
   */
  STITCHED_LOOPS = 'stitched_loops',

  /**
   * Step 3: Show reuse plan (segment classification)
   * - Displays warm (new) vs cold (reused) segment classification
   * - Shows canonical vertex ancestry for cold segments
   * - Highlights which geometry can be reused
   */
  REUSE_PLAN = 'reuse_plan',

  /**
   * Step 4: Show opt-space merging (before optimization)
   * - Displays merged loops with boundary vertices
   * - Shows warm (rebuilt) vs cold (reused) segments
   * - Visualizes segment boundaries in opt space
   * - Warm segments NOT YET optimized
   */
  OPT_MERGING = 'opt_merging',

  /**
   * Step 5: Show warm segment optimization
   * - Displays Chaikin smoothing + post-simplification
   * - Shows optimized warm segments with fixed boundaries
   * - Final step before physics integration
   */
  WARM_OPTIMIZATION = 'warm_optimization'
}

/**
 * Get the next debug mode in the progression cycle.
 *
 * @param current - Current debug mode
 * @returns Next mode in the cycle
 */
export function nextCarvingDebugMode(current: CarvingDebugMode): CarvingDebugMode {
  switch (current) {
    case CarvingDebugMode.NONE:
      return CarvingDebugMode.CARVED_LOOPS;
    case CarvingDebugMode.CARVED_LOOPS:
      return CarvingDebugMode.STITCHED_LOOPS;
    case CarvingDebugMode.STITCHED_LOOPS:
      return CarvingDebugMode.REUSE_PLAN;
    case CarvingDebugMode.REUSE_PLAN:
      return CarvingDebugMode.OPT_MERGING;
    case CarvingDebugMode.OPT_MERGING:
      return CarvingDebugMode.WARM_OPTIMIZATION;
    case CarvingDebugMode.WARM_OPTIMIZATION:
      return CarvingDebugMode.NONE;
    default:
      return CarvingDebugMode.NONE;
  }
}

/**
 * Get a human-readable label for a debug mode.
 *
 * @param mode - Debug mode
 * @returns Human-readable label
 */
export function getCarvingDebugModeLabel(mode: CarvingDebugMode): string {
  switch (mode) {
    case CarvingDebugMode.NONE:
      return 'No Debug';
    case CarvingDebugMode.CARVED_LOOPS:
      return 'Step 1: Carved Loops';
    case CarvingDebugMode.STITCHED_LOOPS:
      return 'Step 2: Stitched Loops';
    case CarvingDebugMode.REUSE_PLAN:
      return 'Step 3: Reuse Plan';
    case CarvingDebugMode.OPT_MERGING:
      return 'Step 4: Opt-Space Merging';
    case CarvingDebugMode.WARM_OPTIMIZATION:
      return 'Step 5: Warm Optimization';
    default:
      return 'Unknown';
  }
}
