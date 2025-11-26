import type { WorldConfig } from './types';

/**
 * Centralized configuration for the entire cave generation and rendering pipeline.
 *
 * This class consolidates all magic numbers and tunable parameters from across
 * the codebase into a single, well-documented location.
 *
 * Configuration sections:
 * - World: Grid dimensions and density parameters
 * - Cave Generation: Perlin noise and procedural generation
 * - Camera: Viewport, zoom, and follow behavior
 * - Player: Spawn validation and physics
 * - Optimization: Vertex simplification and smoothing
 * - Carving: Brush tool parameters (currently disabled)
 * - Debug: Development and visualization settings
 */
export class PipelineConfig {
  // ============================================================================
  // WORLD CONFIGURATION
  // Grid dimensions and density field parameters
  // ============================================================================

  /** World width in metres (compact for faster gameplay) */
  readonly worldWidth = 32;

  /** World height in metres (compact for faster gameplay) */
  readonly worldHeight = 32;

  /** Grid pitch (h) in metres - resolution of density field sampling */
  readonly gridPitch = 0.5;

  /** ISO value for marching squares (0-255) - density threshold between rock and cave */
  readonly isoValue = 128;

  // ============================================================================
  // CAVE GENERATION
  // Procedural generation parameters using Perlin noise
  // ============================================================================

  /** Perlin noise scale - smaller values create larger cave features */
  readonly perlinScale = 0.05;

  /** Number of octaves for fractal noise - higher values add more detail */
  readonly perlinOctaves = 4;

  /** Cave threshold - controls cave/rock ratio (higher = more caves, range: -1 to 1) */
  readonly perlinThreshold = 0;

  /** Perlin noise persistence - controls amplitude decay across octaves */
  readonly perlinPersistence = 0.5;

  /** Perlin noise lacunarity - controls frequency increase across octaves */
  readonly perlinLacunarity = 2.0;

  /** Solid rock border width in grid cells - prevents open loops at boundaries */
  readonly borderWidth = 2;

  // ============================================================================
  // CAMERA CONFIGURATION
  // Viewport control, zoom limits, and follow behavior
  // ============================================================================

  /** Initial camera zoom in pixels-per-metre (PPM) - 2x zoom for closer view */
  readonly cameraInitialZoom = 50;

  /** Minimum zoom level (PPM) - furthest out the camera can zoom */
  readonly cameraMinZoom = 10;

  /** Maximum zoom level (PPM) - closest the camera can zoom */
  readonly cameraMaxZoom = 400;

  /** Base zoom when player is stationary (PPM) */
  readonly cameraBaseZoom = 40;

  /** Minimum dynamic zoom when moving fast (PPM) */
  readonly cameraMinDynamicZoom = 30;

  /** Speed threshold for max zoom-out (m/s) */
  readonly cameraSpeedThreshold = 4.0;

  /** Zoom transition smoothing speed (0-1, lower = smoother) */
  readonly cameraZoomSmoothSpeed = 0.03;

  /** Maximum look-ahead distance in metres (camera overshoot in movement direction) */
  readonly cameraLookAheadDistance = 0.6;

  /** Speed threshold for maximum look-ahead (m/s) */
  readonly cameraLookAheadSpeed = 4.0;

  /** Camera follow smoothing (0-1, lower = smoother but slower) */
  readonly cameraSmoothSpeed = 0.06;

  // ============================================================================
  // PLAYER SPAWN CONFIGURATION
  // Validation and safety parameters for player spawning
  // ============================================================================

  /** Player spawn radius for collision checking (metres) */
  readonly playerSpawnRadius = 1.5;

  /** Safety margin to account for marching squares interpolation drift (metres) */
  readonly spawnSafetyMargin = 1.0;

  /** Open space check distance - ensures decent clearance around spawn (metres) */
  readonly spawnOpenSpaceCheck = 2.0;

  /** Number of perimeter checks around spawn position */
  readonly spawnPerimeterChecks = 16;

  /** Maximum spawn position search attempts before regenerating world */
  readonly spawnMaxRetries = 10;

  /** Spawn chamber width (metres) - for clearSpawnArea */
  readonly spawnChamberWidth = 10;

  /** Spawn chamber height (metres) - for clearSpawnArea */
  readonly spawnChamberHeight = 6;

  /** Spawn chamber floor thickness (metres) - solid platform below spawn */
  readonly spawnFloorThickness = 2;

  // ============================================================================
  // VERTEX OPTIMIZATION PIPELINE
  // Simplification and smoothing parameters
  // ============================================================================

  /** Pre-Chaikin simplification epsilon (0 = disabled) - Visvalingam-Whyatt threshold in m² */
  readonly simplificationEpsilon = 0;

  /** Enable Chaikin corner-cutting smoothing for organic cave shapes */
  readonly chaikinEnabled = true;

  /** Chaikin smoothing iterations (1-4 recommended, each iteration doubles vertex count) */
  readonly chaikinIterations = 2;

  /** Chaikin corner-cutting ratio (0.25 = classic Chaikin algorithm) */
  readonly chaikinRatio = 0.25;

  /** Post-smoothing simplification epsilon (metres²) - removes redundant vertices from Chaikin */
  readonly simplificationEpsilonPost = 0.05;

  // ============================================================================
  // MARCHING SQUARES
  // Contour extraction and topology parameters
  // ============================================================================

  /** Quantization step for vertex snapping (fraction of grid pitch) - prevents float mismatches */
  readonly marchingSquaresQuantizationFactor = 8;

  /** Maximum steps when tracing contour loops - prevents infinite loops */
  readonly marchingSquaresMaxSteps = 100000;

  /** Expand cells when generating contours in dirty regions - for boundary handling */
  readonly marchingSquaresExpandCells = 1;

  // ============================================================================
  // CARVING SYSTEM (Currently Disabled)
  // Brush tool parameters for terrain modification
  // ============================================================================

  /** AABB expand cells for carving debug visualization - increased padding for better visualization */
  readonly carveDebugExpandCells = 1;

  /** Carve brush radius in metres */
  readonly carveRadius = 2.0;

  /** Carve brush strength (0-1, controls how much material is removed) */
  readonly carveStrength = 0.25;

  /** Carve offset - distance ahead of player to place brush (metres) */
  readonly carveOffset = 2.5;

  /** Gaussian brush sigma for soft falloff */
  readonly carveBrushSigma = 0.5;

  // ============================================================================
  // DEBUG AND DEVELOPMENT
  // Testing, visualization, and diagnostic settings
  // ============================================================================

  /** Enable automated joystick test for debugging movement */
  readonly testEnabled = true;

  /** Enable character control mode (vs camera pan/zoom) */
  readonly characterControlMode = true;

  /** Enable debug loop capture for carved areas */
  readonly debugCaptureEnabled = true;

  // ============================================================================
  // HELPER METHODS
  // Convenience getters for derived or composite values
  // ============================================================================

  /**
   * Get WorldConfig for legacy compatibility
   */
  getWorldConfig(): WorldConfig {
    return {
      width: this.worldWidth,
      height: this.worldHeight,
      gridPitch: this.gridPitch,
      isoValue: this.isoValue
    };
  }

  /**
   * Get initial camera position (world center)
   */
  getCameraInitialPosition(): { x: number; y: number } {
    return {
      x: this.worldWidth / 2,
      y: this.worldHeight / 2
    };
  }

  /**
   * Get preferred player spawn position (world center)
   */
  getPlayerSpawnPosition(): { x: number; y: number } {
    return {
      x: this.worldWidth / 2,
      y: this.worldHeight / 2
    };
  }

  /**
   * Get marching squares quantization step (derived from grid pitch)
   */
  getMarchingSquaresQuantizationStep(): number {
    return this.gridPitch / this.marchingSquaresQuantizationFactor;
  }

  /**
   * Create a deep copy of this config (for modifications)
   */
  clone(): PipelineConfig {
    const clone = new PipelineConfig();
    Object.assign(clone, this);
    return clone;
  }
}

/**
 * Default global configuration instance
 * Can be imported and used throughout the application
 */
export const DEFAULT_CONFIG = new PipelineConfig();
