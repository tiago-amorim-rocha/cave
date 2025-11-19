/**
 * Brush generator for creating blurred/soft brushes
 * Similar to Photoshop brush system - pre-generate brush textures for stamping
 */

export interface Brush {
  /** Brush texture data (0-255 values representing opacity/strength) */
  data: Uint8Array;
  /** Width in grid cells */
  width: number;
  /** Height in grid cells */
  height: number;
  /** Radius in metres (for reference) */
  radiusMetres: number;
}

export class BrushGenerator {
  /**
   * Create a radial gradient brush with soft edges
   *
   * @param radiusMetres - Brush radius in metres
   * @param gridPitch - Grid pitch in metres (h)
   * @param hardness - Hardness of brush edges (0 = very soft, 1 = hard edge)
   * @returns Brush texture
   */
  static createRadialBrush(radiusMetres: number, gridPitch: number, hardness: number = 0.5): Brush {
    // Convert radius to grid cells
    const radiusGrid = radiusMetres / gridPitch;

    // Brush dimensions (square texture centered on radius)
    const width = Math.ceil(radiusGrid * 2) + 1;
    const height = width; // Square brush

    // Create brush texture
    const data = new Uint8Array(width * height);

    // Center of brush
    const centerX = width / 2;
    const centerY = height / 2;

    // Generate radial gradient
    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        // Distance from center
        const dx = x - centerX;
        const dy = y - centerY;
        const distance = Math.sqrt(dx * dx + dy * dy);

        // Normalize distance to [0, 1]
        const normalizedDist = distance / radiusGrid;

        // Apply smoothstep with hardness control for soft falloff
        // hardness = 0 → very soft (wide falloff)
        // hardness = 1 → hard edge (sharp cutoff)
        let strength: number;
        if (normalizedDist >= 1.0) {
          strength = 0; // Outside brush radius
        } else {
          // Smoothstep function: 3t² - 2t³ (smooth S-curve)
          // Adjust falloff based on hardness
          const falloffStart = hardness;
          const falloffRange = 1.0 - falloffStart;

          if (normalizedDist <= falloffStart) {
            strength = 1.0; // Full strength in center
          } else {
            // Map to [0, 1] in falloff range
            const t = (normalizedDist - falloffStart) / falloffRange;
            // Inverted smoothstep (1 at start, 0 at end)
            strength = 1.0 - (3 * t * t - 2 * t * t * t);
          }
        }

        // Convert to 0-255 range
        data[y * width + x] = Math.floor(strength * 255);
      }
    }

    console.log(`[BrushGenerator] Created ${width}×${height} radial brush (${radiusMetres.toFixed(2)}m radius, hardness=${hardness})`);

    return {
      data,
      width,
      height,
      radiusMetres
    };
  }

  /**
   * Create a Gaussian blur brush (smooth natural falloff)
   *
   * @param radiusMetres - Brush radius in metres
   * @param gridPitch - Grid pitch in metres (h)
   * @param sigma - Standard deviation (controls blur amount, higher = softer)
   * @param strength - Strength multiplier (0-1), pre-baked into texture
   * @returns Brush texture
   */
  static createGaussianBrush(radiusMetres: number, gridPitch: number, sigma: number = 0.5, strength: number = 1.0): Brush {
    // Convert radius to grid cells
    const radiusGrid = radiusMetres / gridPitch;

    // Brush dimensions (square texture centered on radius)
    const width = Math.ceil(radiusGrid * 2) + 1;
    const height = width; // Square brush

    // Create brush texture
    const data = new Uint8Array(width * height);

    // Center of brush
    const centerX = width / 2;
    const centerY = height / 2;

    // Gaussian parameters
    const sigmaSq = sigma * sigma * radiusGrid * radiusGrid;
    const twoSigmaSq = 2 * sigmaSq;

    // Generate Gaussian gradient
    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        // Distance from center
        const dx = x - centerX;
        const dy = y - centerY;
        const distSq = dx * dx + dy * dy;

        // Gaussian function: e^(-dist²/(2σ²))
        const gaussianValue = Math.exp(-distSq / twoSigmaSq);

        // Apply strength multiplier and convert to 0-255 range (pre-baked)
        data[y * width + x] = Math.floor(gaussianValue * strength * 255);
      }
    }

    console.log(`[BrushGenerator] Created ${width}×${height} Gaussian brush (${radiusMetres.toFixed(2)}m radius, σ=${sigma}, strength=${strength})`);

    return {
      data,
      width,
      height,
      radiusMetres
    };
  }
}
