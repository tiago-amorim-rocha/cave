export interface WaterParticlesParams {
  enabled: boolean;

  particleRadius: number;
  gravityY: number; // m/s^2 (positive is down)
  linearDamping: number; // 1/s (approx)

  viscosityStrength: number; // 0..1
  pbfEnabled: boolean;
  pbfIterations: number;
  pbfRadius: number; // metres
  pbfRestDensity: number;
  pbfStiffness: number; // 0..1
  pbfSCorrK: number; // 0..1
  pbfSCorrN: number;
  pbfSCorrDq: number; // metres

  spawnRate: number; // particles/sec
  spawnDuration: number; // seconds (after respawn)
  maxParticles: number;
  spawnXSpread: number; // metres
  spawnYJitter: number; // metres

  substeps: number;
  collisionIterations: number;
  collisionPushStep: number; // metres
  collisionNormalDamping: number; // 0..1
  collisionTangentDamping: number; // 0..1
}

export const DEFAULT_WATER_PARAMS: WaterParticlesParams = {
  enabled: true,

  particleRadius: 0.12,
  gravityY: 9,
  linearDamping: 0.05,

  viscosityStrength: 0.05,
  pbfEnabled: true,
  pbfIterations: 8,
  pbfRadius: 0.57,
  pbfRestDensity: 11.5,
  pbfStiffness: 1,
  pbfSCorrK: 0.001,
  pbfSCorrN: 4,
  pbfSCorrDq: 0.12,

  spawnRate: 102,
  spawnDuration: 10,
  maxParticles: 10000,
  spawnXSpread: 1.5,
  spawnYJitter: 0.5,

  substeps: 6,
  collisionIterations: 12,
  collisionPushStep: 0.05,
  collisionNormalDamping: 0.85,
  collisionTangentDamping: 0.14,
};
