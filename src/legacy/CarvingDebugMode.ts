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
 * NONE → DIRTY_AABB → CANONICAL_AFFECTED → CANONICAL_DIRTY_RANGES → OPT_INVALIDATION
 *     → LOCAL_MS_MATCH → LOCAL_CANON_SURGERY_PREVIEW → LOCAL_CANON_SURGERY_COMMIT
 *     → LOCAL_OPT_AABB_INVALIDATION → LOCAL_OPT_REBUILD → LOCAL_OPT_SPLICE_VALIDATE
 *     → LOCAL_PHYSICS_PLAN → LOCAL_PHYSICS_APPLY → SEGMENT_DEBUG → NONE (cycles back)
 */
export enum CarvingDebugMode {
  /**
   * No debug visualization (default state)
   * Shows only the final physics-ready terrain
   */
  NONE = 'none',

  /**
   * Step 1: Dirty region AABB
   * - Shows the dirty AABB produced by stamping the carve brush
   */
  DIRTY_AABB = 'dirty_aabb',

  /**
   * Step 2: Canonical loops affected by dirty region
   * - Highlights which canonical loops intersect the dirty AABB
   */
  CANONICAL_AFFECTED = 'canonical_affected',

  /**
   * Step 3: Dirty canonical index ranges (per affected loop)
   * - Visualizes which canonical vertex indices are considered dirty
   */
  CANONICAL_DIRTY_RANGES = 'canonical_dirty_ranges',

  /**
   * Step 4: Opt-vertex invalidation preview
   * - Shows which opt vertices would be invalidated/rebuilt based on dirty canonical ranges
   */
  OPT_INVALIDATION = 'opt_invalidation',

  /**
   * Step 5a: Marching-squares loops + matching plan
   * - Shows cleaned MS loops in the padded dirty region
   * - Shows how new loops match affected canonical loops
   */
  LOCAL_MS_MATCH = 'local_ms_match',

  /**
   * Step 5b: Canonical surgery preview (no mutation)
   * - Shows would-be replacements for affected canonical loops
   */
  LOCAL_CANON_SURGERY_PREVIEW = 'local_canon_surgery_preview',

  /**
   * Step 5c: Commit canonical surgery
   * - Mutates canonical loops (read-only layer) to reflect the local update
   */
  LOCAL_CANON_SURGERY_COMMIT = 'local_canon_surgery_commit',

  /**
   * Step 5d: Opt-layer invalidation (AABB-based)
   * - Marks which existing opt loops intersect the padded dirty region
   */
  LOCAL_OPT_AABB_INVALIDATION = 'local_opt_aabb_invalidation',

  /**
   * Step 5e: Rebuild opt loops for replacements
   * - Runs the optimization pipeline for replacement canonical loops
   */
  LOCAL_OPT_REBUILD = 'local_opt_rebuild',

  /**
   * Step 5f: Splice rebuilt opt loops into global opt set
   * - Drops invalidated opt loops, appends rebuilt loops, validates
   */
  LOCAL_OPT_SPLICE_VALIDATE = 'local_opt_splice_validate',

  /**
   * Step 5g: Physics update plan
   * - Shows what will be removed/added in physics
   */
  LOCAL_PHYSICS_PLAN = 'local_physics_plan',

  /**
   * Step 5h: Apply physics update
   * - Applies region removal + adds replacement loops and refreshes rendering
   */
  LOCAL_PHYSICS_APPLY = 'local_physics_apply',

  /**
   * Step 6: Segment debug (after local update)
   * - Highlights physics segments and their canonical ranges
   */
  SEGMENT_DEBUG = 'segment_debug',
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
      return CarvingDebugMode.DIRTY_AABB;
    case CarvingDebugMode.DIRTY_AABB:
      return CarvingDebugMode.CANONICAL_AFFECTED;
    case CarvingDebugMode.CANONICAL_AFFECTED:
      return CarvingDebugMode.CANONICAL_DIRTY_RANGES;
    case CarvingDebugMode.CANONICAL_DIRTY_RANGES:
      return CarvingDebugMode.OPT_INVALIDATION;
    case CarvingDebugMode.OPT_INVALIDATION:
      return CarvingDebugMode.LOCAL_MS_MATCH;
    case CarvingDebugMode.LOCAL_MS_MATCH:
      return CarvingDebugMode.LOCAL_CANON_SURGERY_PREVIEW;
    case CarvingDebugMode.LOCAL_CANON_SURGERY_PREVIEW:
      return CarvingDebugMode.LOCAL_CANON_SURGERY_COMMIT;
    case CarvingDebugMode.LOCAL_CANON_SURGERY_COMMIT:
      return CarvingDebugMode.LOCAL_OPT_AABB_INVALIDATION;
    case CarvingDebugMode.LOCAL_OPT_AABB_INVALIDATION:
      return CarvingDebugMode.LOCAL_OPT_REBUILD;
    case CarvingDebugMode.LOCAL_OPT_REBUILD:
      return CarvingDebugMode.LOCAL_OPT_SPLICE_VALIDATE;
    case CarvingDebugMode.LOCAL_OPT_SPLICE_VALIDATE:
      return CarvingDebugMode.LOCAL_PHYSICS_PLAN;
    case CarvingDebugMode.LOCAL_PHYSICS_PLAN:
      return CarvingDebugMode.LOCAL_PHYSICS_APPLY;
    case CarvingDebugMode.LOCAL_PHYSICS_APPLY:
      return CarvingDebugMode.SEGMENT_DEBUG;
    case CarvingDebugMode.SEGMENT_DEBUG:
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
    case CarvingDebugMode.DIRTY_AABB:
      return 'Step 1: Dirty AABB';
    case CarvingDebugMode.CANONICAL_AFFECTED:
      return 'Step 2: Canonical Affected';
    case CarvingDebugMode.CANONICAL_DIRTY_RANGES:
      return 'Step 3: Canonical Dirty Ranges';
    case CarvingDebugMode.OPT_INVALIDATION:
      return 'Step 4: Opt Invalidation';
    case CarvingDebugMode.LOCAL_MS_MATCH:
      return 'Step 5a: MS Loops + Matching';
    case CarvingDebugMode.LOCAL_CANON_SURGERY_PREVIEW:
      return 'Step 5b: Canon Surgery Preview';
    case CarvingDebugMode.LOCAL_CANON_SURGERY_COMMIT:
      return 'Step 5c: Commit Canon Surgery';
    case CarvingDebugMode.LOCAL_OPT_AABB_INVALIDATION:
      return 'Step 5d: Opt Invalidation (AABB)';
    case CarvingDebugMode.LOCAL_OPT_REBUILD:
      return 'Step 5e: Opt Rebuild';
    case CarvingDebugMode.LOCAL_OPT_SPLICE_VALIDATE:
      return 'Step 5f: Opt Splice + Validate';
    case CarvingDebugMode.LOCAL_PHYSICS_PLAN:
      return 'Step 5g: Physics Plan';
    case CarvingDebugMode.LOCAL_PHYSICS_APPLY:
      return 'Step 5h: Apply Physics';
    case CarvingDebugMode.SEGMENT_DEBUG:
      return 'Step 6: Segment Debug';
    default:
      return 'Unknown';
  }
}
