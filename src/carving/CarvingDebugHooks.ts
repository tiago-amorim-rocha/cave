import type { DensityField } from '../DensityField';
import type { PipelineConfig } from '../PipelineConfig';
import type { RemeshManager } from '../RemeshManager';
import type { Renderer } from '../Renderer';

export interface CarvingDebugContext {
  config: PipelineConfig;
  densityField: DensityField;
  remeshManager: RemeshManager;
  renderer: Renderer;
}

export interface CarvingDebugHooks {
  onCarveStamped(): void;
  advanceStep(): void;
  dispose(): void;
}

export interface CarvingDebugHost {
  getCarvingDebugContext(): CarvingDebugContext;
  setCarvingDebugHooks(hooks: CarvingDebugHooks | null): void;
}

