import type { Camera } from '../Camera';
import type { DensityField } from '../DensityField';
import type { WaterParticlesParams } from './WaterParams';

type GPUDeviceAny = any;
type GPUCanvasContextAny = any;

const SENTINEL = 0xffffffff;

function clamp(v: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, v));
}

export class WaterWebGPU {
  private canvas: HTMLCanvasElement;
  private densityField: DensityField;

  private device: GPUDeviceAny | null = null;
  private context: GPUCanvasContextAny | null = null;
  private format: any | null = null;

  private simPipelineSpawn: any | null = null;
  private simPipelineClearGrid: any | null = null;
  private simPipelineIntegrate: any | null = null;
  private simPipelineRebuildGrid: any | null = null;
  private simPipelinePost: any | null = null;
  private simPipelineViscosity: any | null = null;
  private simPipelinePbfLambda: any | null = null;
  private simPipelinePbfApply: any | null = null;

  private renderPipeline: any | null = null;
  private thicknessPipeline: any | null = null;
  private compositePipeline: any | null = null;
  private debugPipeline: any | null = null;

  private simUniformBuffer: any | null = null;
  private renderUniformBuffer: any | null = null;

  private densityTexture: any | null = null;
  private densityTextureView: any | null = null;
  private densitySampler: any | null = null;
  private densityTexW = 0;
  private densityTexH = 0;
  private densityBytesPerRow = 0;
  private densityUploadStaging = new Uint8Array(0);

  private posBuffer: any | null = null;
  private velBuffer: any | null = null;
  private prevPosBuffer: any | null = null;
  private collidedNBuffer: any | null = null;
  private gridHeadBuffer: any | null = null;
  private gridNextBuffer: any | null = null;
  private densityBuffer: any | null = null;
  private lambdaBuffer: any | null = null;

  private simBindGroup: any | null = null;
  private renderBindGroup: any | null = null;
  private compositeBindGroup: any | null = null;

  private thicknessTexture: any | null = null;
  private thicknessTextureView: any | null = null;
  private thicknessSampler: any | null = null;
  private thicknessW = 0;
  private thicknessH = 0;

  private ready = false;
  private simOk = true;

  private params: WaterParticlesParams;
  private spawnCenterX = 0;
  private spawnCenterY = 0;

  private spawnTimeRemaining = 0;
  private spawnAccumulator = 0;
  private aliveCount = 0;
  private tick = 0;

  private capacity = 0;
  private gridCols = 0;
  private gridRows = 0;
  private gridCellCount = 0;
  private cellSize = 0;
  private minDist = 0;

  constructor(canvas: HTMLCanvasElement, densityField: DensityField, params: WaterParticlesParams) {
    this.canvas = canvas;
    this.densityField = densityField;
    this.params = { ...params };
  }

  isReady(): boolean {
    return this.ready;
  }

  getCount(): number {
    return this.aliveCount;
  }

  getParams(): WaterParticlesParams {
    return { ...this.params };
  }

  setSpawnCenter(x: number, y: number): void {
    this.spawnCenterX = x;
    this.spawnCenterY = y;
  }

  respawn(): void {
    this.aliveCount = 0;
    this.spawnTimeRemaining = this.params.spawnDuration;
    this.spawnAccumulator = 0;
    this.tick = 0;
  }

  clear(): void {
    this.aliveCount = 0;
    this.spawnTimeRemaining = 0;
    this.spawnAccumulator = 0;
  }

  updateParams(partial: Partial<WaterParticlesParams>): void {
    this.params = { ...this.params, ...partial };
    this.applyParamClamps();
    this.ensureCapacity(this.params.maxParticles);
    this.recomputeGrid();
    this.recreateBindGroups();
    if (this.aliveCount > this.params.maxParticles) this.aliveCount = this.params.maxParticles;
  }

  async init(): Promise<void> {
    const nav: any = navigator as any;
    if (!nav.gpu) throw new Error('[WaterWebGPU] WebGPU not available (navigator.gpu missing)');
    const adapter =
      (await nav.gpu.requestAdapter({ powerPreference: 'high-performance' })) ??
      (await nav.gpu.requestAdapter());
    if (!adapter) throw new Error('[WaterWebGPU] Failed to request adapter (WebGPU disabled or unsupported GPU/browser)');
    const device = await adapter.requestDevice();
    this.device = device;
    try {
      device.addEventListener?.('uncapturederror', (ev: any) => {
        const msg = ev?.error?.message ?? String(ev?.error ?? ev);
        console.error('[WaterWebGPU] GPU uncaptured error:', ev?.error ?? ev);
        (globalThis as any).log?.(`[WaterWebGPU] GPU error: ${msg}`);
      });
      device.lost?.then?.((info: any) => {
        const msg = info?.message ?? String(info);
        console.error('[WaterWebGPU] Device lost:', info);
        (globalThis as any).log?.(`[WaterWebGPU] Device lost: ${msg}`);
      });
    } catch {
      // Optional diagnostics only.
    }

    const ctx = (this.canvas as any).getContext('webgpu');
    if (!ctx) throw new Error('[WaterWebGPU] Failed to get webgpu context');
    this.context = ctx;

    this.format = nav.gpu.getPreferredCanvasFormat();
    this.configure();
    this.createThicknessResources();

    this.applyParamClamps();
    this.ensureCapacity(this.params.maxParticles);
    this.recomputeGrid();
    this.createDensityResources();
    this.uploadDensityField();
    this.createPipelinesAndBindGroups();

    this.respawn();
    this.ready = true;
  }

  setSize(widthPx: number, heightPx: number): void {
    if (this.canvas.width === widthPx && this.canvas.height === heightPx) return;
    this.canvas.width = widthPx;
    this.canvas.height = heightPx;
    if (this.ready) {
      this.configure();
      this.createThicknessResources();
      this.recreateBindGroups();
    }
  }

  uploadDensityField(): void {
    if (!this.device) return;

    const w = this.densityField.gridWidth;
    const h = this.densityField.gridHeight;
    const data = this.densityField.data;

    // If the density field resized, recreate the GPU texture and update bind groups.
    if (!this.densityTexture || this.densityTexW !== w || this.densityTexH !== h) {
      this.createDensityResources();
      this.recreateBindGroups();
      if (!this.densityTexture) return;
    }

    // WebGPU requires bytesPerRow to be 256-byte aligned for texture uploads.
    const align = 256;
    const bytesPerRow = Math.ceil(w / align) * align;
    if (this.densityBytesPerRow !== bytesPerRow || this.densityUploadStaging.length !== bytesPerRow * h) {
      this.densityBytesPerRow = bytesPerRow;
      this.densityUploadStaging = new Uint8Array(bytesPerRow * h);
    }
    for (let y = 0; y < h; y++) {
      const src = y * w;
      const dst = y * bytesPerRow;
      this.densityUploadStaging.set(data.subarray(src, src + w), dst);
    }

    this.device.queue.writeTexture(
      { texture: this.densityTexture },
      this.densityUploadStaging,
      { bytesPerRow, rowsPerImage: h },
      { width: w, height: h }
    );
  }

  fixedUpdate(dtMs: number): void {
    if (!this.ready) return;
    if (!this.params.enabled) return;
    if (!this.device) return;
    if (!this.simOk) return;

    const dtSec = dtMs / 1000;
    this.tick++;

    let spawnStart = 0;
    let spawnCount = 0;
    if (this.spawnTimeRemaining > 0) {
      this.spawnAccumulator += this.params.spawnRate * dtSec;
      spawnCount = Math.min(
        Math.floor(this.spawnAccumulator),
        Math.max(0, this.params.maxParticles - this.aliveCount)
      );
      if (spawnCount > 0) {
        this.spawnAccumulator -= spawnCount;
        spawnStart = this.aliveCount;
        this.aliveCount += spawnCount;
      }
      this.spawnTimeRemaining = Math.max(0, this.spawnTimeRemaining - dtSec);
    }

    const substeps = Math.max(1, Math.floor(this.params.substeps));
    const subDt = dtSec / substeps;
    const dampingFactor = Math.max(0, 1 - this.params.linearDamping * subDt);

    const encoder = this.device.createCommandEncoder();

    // Spawn once per fixedUpdate (before substeps) so it becomes active immediately.
    if (spawnCount > 0 && this.simPipelineSpawn) {
      this.writeSimUniforms({
        dt: subDt,
        dampingFactor,
        spawnStart,
        spawnCount,
      });
      const pass = encoder.beginComputePass();
      pass.setPipeline(this.simPipelineSpawn);
      pass.setBindGroup(0, this.simBindGroup);
      pass.dispatchWorkgroups(1);
      pass.end();
    } else {
      this.writeSimUniforms({ dt: subDt, dampingFactor, spawnStart: 0, spawnCount: 0 });
    }

    for (let s = 0; s < substeps; s++) {
      // Clear grid heads
      if (!this.simPipelineClearGrid) break;
      {
        const pass = encoder.beginComputePass();
        pass.setPipeline(this.simPipelineClearGrid);
        pass.setBindGroup(0, this.simBindGroup);
        const wg = 256;
        const groups = Math.ceil(this.gridCellCount / wg);
        pass.dispatchWorkgroups(groups);
        pass.end();
      }

      // Integrate + collide + build grid
      if (!this.simPipelineIntegrate) break;
      {
        const pass = encoder.beginComputePass();
        pass.setPipeline(this.simPipelineIntegrate);
        pass.setBindGroup(0, this.simBindGroup);
        const wg = 256;
        const groups = Math.ceil(this.aliveCount / wg);
        pass.dispatchWorkgroups(groups);
        pass.end();
      }

      if (
        this.params.pbfEnabled &&
        this.params.pbfIterations > 0 &&
        this.simPipelinePbfLambda &&
        this.simPipelinePbfApply &&
        this.simPipelineClearGrid &&
        this.simPipelineRebuildGrid
      ) {
        const wg = 256;
        for (let iter = 0; iter < this.params.pbfIterations; iter++) {
          const passClear = encoder.beginComputePass();
          passClear.setPipeline(this.simPipelineClearGrid);
          passClear.setBindGroup(0, this.simBindGroup);
          const gridGroups = Math.ceil(this.gridCellCount / wg);
          passClear.dispatchWorkgroups(gridGroups);
          passClear.end();

          const passBuild = encoder.beginComputePass();
          passBuild.setPipeline(this.simPipelineRebuildGrid);
          passBuild.setBindGroup(0, this.simBindGroup);
          const buildGroups = Math.ceil(this.aliveCount / wg);
          passBuild.dispatchWorkgroups(buildGroups);
          passBuild.end();

          const passLambda = encoder.beginComputePass();
          passLambda.setPipeline(this.simPipelinePbfLambda);
          passLambda.setBindGroup(0, this.simBindGroup);
          const lambdaGroups = Math.ceil(this.aliveCount / wg);
          passLambda.dispatchWorkgroups(lambdaGroups);
          passLambda.end();

          const passApply = encoder.beginComputePass();
          passApply.setPipeline(this.simPipelinePbfApply);
          passApply.setBindGroup(0, this.simBindGroup);
          const applyGroups = Math.ceil(this.aliveCount / wg);
          passApply.dispatchWorkgroups(applyGroups);
          passApply.end();
        }
      }

      // Post-collide + velocities
      if (!this.simPipelinePost) break;
      {
        const pass = encoder.beginComputePass();
        pass.setPipeline(this.simPipelinePost);
        pass.setBindGroup(0, this.simBindGroup);
        const wg = 256;
        const groups = Math.ceil(this.aliveCount / wg);
        pass.dispatchWorkgroups(groups);
        pass.end();
      }

      if (this.params.viscosityStrength > 0 && this.simPipelineViscosity && this.simPipelineClearGrid && this.simPipelineRebuildGrid) {
        const wg = 256;

        const passClear = encoder.beginComputePass();
        passClear.setPipeline(this.simPipelineClearGrid);
        passClear.setBindGroup(0, this.simBindGroup);
        const gridGroups = Math.ceil(this.gridCellCount / wg);
        passClear.dispatchWorkgroups(gridGroups);
        passClear.end();

        const passBuild = encoder.beginComputePass();
        passBuild.setPipeline(this.simPipelineRebuildGrid);
        passBuild.setBindGroup(0, this.simBindGroup);
        const buildGroups = Math.ceil(this.aliveCount / wg);
        passBuild.dispatchWorkgroups(buildGroups);
        passBuild.end();

        const passVisc = encoder.beginComputePass();
        passVisc.setPipeline(this.simPipelineViscosity);
        passVisc.setBindGroup(0, this.simBindGroup);
        const groups = Math.ceil(this.aliveCount / wg);
        passVisc.dispatchWorkgroups(groups);
        passVisc.end();
      }
    }

    this.device.queue.submit([encoder.finish()]);
  }

  render(camera: Camera, dpr: number, opts?: { opaqueBackground?: boolean; debugQuad?: boolean }): void {
    if (!this.ready) return;
    if (!this.device || !this.context) return;

    this.createThicknessResources();
    this.recreateBindGroups();
    if (!this.thicknessTextureView || !this.thicknessTexture) return;

    const encoder = this.device.createCommandEncoder();
    const view = this.context.getCurrentTexture().createView();
    const opaque = opts?.opaqueBackground ?? false;

    const w = Math.max(1, this.canvas.width);
    const h = Math.max(1, this.canvas.height);
    const zoomPx = camera.zoom * dpr;

    // camX, camY, zoomPx, invW, invH, radius, aliveCount(u32), pad
    const ab = new ArrayBuffer(32);
    const f = new Float32Array(ab);
    f[0] = camera.x;
    f[1] = camera.y;
    f[2] = zoomPx;
    f[3] = 1 / w;
    f[4] = 1 / h;
    f[5] = this.params.particleRadius;
    this.device.queue.writeBuffer(this.renderUniformBuffer, 0, ab);
    this.device.queue.writeBuffer(this.renderUniformBuffer, 24, new Uint32Array([this.aliveCount]));

    const thicknessPass = encoder.beginRenderPass({
      colorAttachments: [
        {
          view: this.thicknessTextureView,
          clearValue: { r: 0, g: 0, b: 0, a: 0 },
          loadOp: 'clear',
          storeOp: 'store',
        },
      ],
    });

    if (this.thicknessPipeline && this.renderBindGroup && this.posBuffer) {
      thicknessPass.setPipeline(this.thicknessPipeline);
      thicknessPass.setBindGroup(0, this.renderBindGroup);
      thicknessPass.setVertexBuffer(0, this.posBuffer);
      thicknessPass.draw(6, this.aliveCount);
    }
    thicknessPass.end();

    const pass = encoder.beginRenderPass({
      colorAttachments: [
        {
          view,
          clearValue: opaque ? { r: 0.40, g: 0.34, b: 0.47, a: 1 } : { r: 0, g: 0, b: 0, a: 0 },
          loadOp: 'clear',
          storeOp: 'store',
        },
      ],
    });

    // Ultra-simple debug draw to verify the WebGPU canvas is presenting.
    // Draws a fullscreen triangle (teal) + centered red square.
    if (opts?.debugQuad && this.debugPipeline) {
      pass.setPipeline(this.debugPipeline);
      pass.draw(3); // fullscreen triangle (vertex_index 0..2)
      pass.draw(6, 1, 3); // centered square (vertex_index 3..8)
      pass.end();
      this.device.queue.submit([encoder.finish()]);
      return;
    }

    if (!this.compositeBindGroup || !this.compositePipeline || !this.renderUniformBuffer || !this.posBuffer) {
      pass.end();
      this.device.queue.submit([encoder.finish()]);
      return;
    }

    pass.setPipeline(this.compositePipeline);
    pass.setBindGroup(0, this.compositeBindGroup);
    pass.draw(3);
    pass.end();
    this.device.queue.submit([encoder.finish()]);
  }

  private configure(): void {
    if (!this.context || !this.device || !this.format) return;
    this.context.configure({
      device: this.device,
      format: this.format,
      alphaMode: 'premultiplied',
    });
  }

  private applyParamClamps(): void {
    this.params.particleRadius = clamp(this.params.particleRadius, 0.02, 0.5);
    this.params.gravityY = clamp(this.params.gravityY, -50, 50);
    this.params.linearDamping = clamp(this.params.linearDamping, 0, 10);
    this.params.viscosityStrength = clamp(this.params.viscosityStrength, 0, 1);
    this.params.pbfIterations = Math.floor(clamp(this.params.pbfIterations, 0, 10));
    this.params.pbfRadius = clamp(this.params.pbfRadius, 0.05, 2);
    this.params.pbfRestDensity = clamp(this.params.pbfRestDensity, 0.1, 1000);
    this.params.pbfStiffness = clamp(this.params.pbfStiffness, 0, 1);
    this.params.pbfSCorrK = clamp(this.params.pbfSCorrK, 0, 1);
    this.params.pbfSCorrN = clamp(this.params.pbfSCorrN, 1, 8);
    this.params.pbfSCorrDq = clamp(this.params.pbfSCorrDq, 0.01, 1.5);
    this.params.spawnRate = clamp(this.params.spawnRate, 0, 100000);
    this.params.spawnDuration = clamp(this.params.spawnDuration, 0, 60);
    this.params.maxParticles = Math.floor(clamp(this.params.maxParticles, 0, 20000));
    this.params.spawnXSpread = clamp(this.params.spawnXSpread, 0, 50);
    this.params.spawnYJitter = clamp(this.params.spawnYJitter, 0, 50);
    this.params.substeps = Math.floor(clamp(this.params.substeps, 1, 8));
    this.params.collisionIterations = Math.floor(clamp(this.params.collisionIterations, 0, 20));
    this.params.collisionPushStep = clamp(this.params.collisionPushStep, 0.001, 1);
    this.params.collisionNormalDamping = clamp(this.params.collisionNormalDamping, 0, 1);
    this.params.collisionTangentDamping = clamp(this.params.collisionTangentDamping, 0, 1);
  }

  private ensureCapacity(minCapacity: number): void {
    if (!this.device) return;
    if (minCapacity <= this.capacity) return;
    this.capacity = minCapacity;

    const usageRW = (globalThis as any).GPUBufferUsage.STORAGE | (globalThis as any).GPUBufferUsage.COPY_DST;
    const usageRWCopy = usageRW | (globalThis as any).GPUBufferUsage.COPY_SRC;

    this.posBuffer?.destroy?.();
    this.velBuffer?.destroy?.();
    this.prevPosBuffer?.destroy?.();
    this.collidedNBuffer?.destroy?.();
    this.gridNextBuffer?.destroy?.();
    this.densityBuffer?.destroy?.();
    this.lambdaBuffer?.destroy?.();

    // Position buffer is written by compute and consumed as an instanced vertex buffer for rendering.
    const posUsage = usageRW | (globalThis as any).GPUBufferUsage.VERTEX;
    this.posBuffer = this.device.createBuffer({ size: this.capacity * 8, usage: posUsage });
    this.velBuffer = this.device.createBuffer({ size: this.capacity * 8, usage: usageRW });
    this.prevPosBuffer = this.device.createBuffer({ size: this.capacity * 8, usage: usageRW });
    this.collidedNBuffer = this.device.createBuffer({ size: this.capacity * 8, usage: usageRW });
    this.gridNextBuffer = this.device.createBuffer({ size: this.capacity * 4, usage: usageRWCopy });
    this.densityBuffer = this.device.createBuffer({ size: this.capacity * 4, usage: usageRW });
    this.lambdaBuffer = this.device.createBuffer({ size: this.capacity * 4, usage: usageRW });

    this.recreateBindGroups();
  }

  private recomputeGrid(): void {
    const { width, height, gridPitch } = this.densityField.config;
    this.minDist = Math.max(this.params.particleRadius * 2, gridPitch * 0.5);
    this.cellSize = Math.max(this.minDist, this.params.pbfRadius);
    this.gridCols = Math.max(1, Math.ceil(width / this.cellSize));
    this.gridRows = Math.max(1, Math.ceil(height / this.cellSize));
    this.gridCellCount = this.gridCols * this.gridRows;

    if (!this.device) return;
    const usage = (globalThis as any).GPUBufferUsage.STORAGE;
    this.gridHeadBuffer?.destroy?.();
    // atomic<u32> array
    this.gridHeadBuffer = this.device.createBuffer({ size: this.gridCellCount * 4, usage });
    this.recreateBindGroups();
  }

  private createDensityResources(): void {
    if (!this.device) return;
    const w = this.densityField.gridWidth;
    const h = this.densityField.gridHeight;
    this.densityTexture?.destroy?.();
    this.densityTexture = this.device.createTexture({
      size: { width: w, height: h },
      format: 'r8unorm',
      usage: (globalThis as any).GPUTextureUsage.TEXTURE_BINDING | (globalThis as any).GPUTextureUsage.COPY_DST,
    });
    this.densityTextureView = this.densityTexture.createView();
    this.densityTexW = w;
    this.densityTexH = h;
    this.densitySampler = this.device.createSampler({
      magFilter: 'linear',
      minFilter: 'linear',
      addressModeU: 'clamp-to-edge',
      addressModeV: 'clamp-to-edge',
    });
  }

  private createThicknessResources(): void {
    if (!this.device) return;
    const w = Math.max(1, this.canvas.width);
    const h = Math.max(1, this.canvas.height);
    if (this.thicknessTexture && this.thicknessW === w && this.thicknessH === h) return;

    this.thicknessTexture?.destroy?.();
    this.thicknessTexture = this.device.createTexture({
      size: { width: w, height: h },
      format: 'rgba16float',
      usage:
        (globalThis as any).GPUTextureUsage.RENDER_ATTACHMENT |
        (globalThis as any).GPUTextureUsage.TEXTURE_BINDING,
    });
    this.thicknessTextureView = this.thicknessTexture.createView();
    this.thicknessW = w;
    this.thicknessH = h;
    this.thicknessSampler = this.device.createSampler({
      magFilter: 'linear',
      minFilter: 'linear',
      addressModeU: 'clamp-to-edge',
      addressModeV: 'clamp-to-edge',
    });
  }

  private recreateBindGroups(): void {
    if (!this.device) return;
    if (!this.simUniformBuffer || !this.renderUniformBuffer) return;
    if (!this.posBuffer || !this.velBuffer || !this.prevPosBuffer || !this.gridNextBuffer || !this.gridHeadBuffer || !this.collidedNBuffer || !this.densityBuffer || !this.lambdaBuffer) return;
    if (!this.densityTextureView || !this.densitySampler) return;

    if (this.simPipelineIntegrate) {
      const layout = this.simPipelineIntegrate.getBindGroupLayout(0);
      this.simBindGroup = this.device.createBindGroup({
        layout,
        entries: [
          { binding: 0, resource: { buffer: this.simUniformBuffer } },
          { binding: 1, resource: { buffer: this.posBuffer } },
          { binding: 2, resource: { buffer: this.velBuffer } },
          { binding: 3, resource: { buffer: this.prevPosBuffer } },
          { binding: 4, resource: { buffer: this.collidedNBuffer } },
        { binding: 5, resource: { buffer: this.gridNextBuffer } },
        { binding: 6, resource: { buffer: this.gridHeadBuffer } },
        { binding: 7, resource: this.densityTextureView },
        { binding: 8, resource: this.densitySampler },
        { binding: 9, resource: { buffer: this.densityBuffer } },
        { binding: 10, resource: { buffer: this.lambdaBuffer } },
      ],
    });
    }

    if (this.thicknessPipeline) {
      const layout = this.thicknessPipeline.getBindGroupLayout(0);
      this.renderBindGroup = this.device.createBindGroup({
        layout,
        entries: [
          { binding: 0, resource: { buffer: this.renderUniformBuffer } },
        ],
      });
    }


    if (this.compositePipeline && this.thicknessTextureView && this.thicknessSampler) {
      const layout = this.compositePipeline.getBindGroupLayout(0);
      this.compositeBindGroup = this.device.createBindGroup({
        layout,
        entries: [
          { binding: 0, resource: this.thicknessTextureView },
          { binding: 1, resource: this.thicknessSampler },
        ],
      });
    }
  }

  private createPipelinesAndBindGroups(): void {
    if (!this.device || !this.format) return;
    if (!this.posBuffer || !this.velBuffer || !this.prevPosBuffer || !this.gridNextBuffer || !this.gridHeadBuffer || !this.collidedNBuffer || !this.densityBuffer || !this.lambdaBuffer) {
      throw new Error('[WaterWebGPU] Buffers not allocated');
    }
    if (!this.densityTextureView || !this.densitySampler) {
      throw new Error('[WaterWebGPU] Density resources not ready');
    }

    const simShader = `
struct SimUniforms {
  dt: f32,
  gravityY: f32,
  dampingFactor: f32,
  _pad0: f32,

  worldW: f32,
  worldH: f32,
  gridPitch: f32,
  invGridPitch: f32,

  iso: f32,
  particleRadius: f32,
  minDist: f32,
  minDistSq: f32,

  cellSize: f32,
  invCellSize: f32,
  invTexW: f32,
  invTexH: f32,

  aliveCount: u32,
  gridCols: u32,
  gridRows: u32,
  collisionIterations: u32,

  collisionPushMax: f32,
  collisionNormalDamp: f32,
  collisionTangentDamp: f32,
  viscosityStrength: f32,

  pbfRadius: f32,
  pbfRestDensity: f32,
  pbfStiffness: f32,
  pbfEpsilon: f32,

  pbfSCorrK: f32,
  pbfSCorrN: f32,
  pbfSCorrDq: f32,
  _pad2: f32,

  spawnStart: u32,
  spawnCount: u32,
  tick: u32,
  _pad1: u32,

  spawnCenterX: f32,
  spawnCenterY: f32,
  spawnXSpread: f32,
  spawnYJitter: f32,
}

@group(0) @binding(0) var<uniform> sim: SimUniforms;
@group(0) @binding(1) var<storage, read_write> pos: array<vec2f>;
@group(0) @binding(2) var<storage, read_write> vel: array<vec2f>;
@group(0) @binding(3) var<storage, read_write> prevPos: array<vec2f>;
@group(0) @binding(4) var<storage, read_write> collidedN: array<vec2f>;
@group(0) @binding(5) var<storage, read_write> gridNext: array<u32>;
@group(0) @binding(6) var<storage, read_write> gridHead: array<atomic<u32>>;
@group(0) @binding(7) var densityTex: texture_2d<f32>;
@group(0) @binding(8) var densitySamp: sampler;
@group(0) @binding(9) var<storage, read_write> density: array<f32>;
@group(0) @binding(10) var<storage, read_write> lambda: array<f32>;

fn hash32(x: u32) -> u32 {
  var v = x;
  v ^= v >> 16u;
  v *= 0x7feb352du;
  v ^= v >> 15u;
  v *= 0x846ca68bu;
  v ^= v >> 16u;
  return v;
}

fn rand01(seed: u32) -> f32 {
  let h = hash32(seed);
  return f32(h) / 4294967295.0;
}

fn densityAt(p: vec2f) -> f32 {
  let gx = clamp(p.x * sim.invGridPitch, 0.0, 1e9);
  let gy = clamp(p.y * sim.invGridPitch, 0.0, 1e9);
  // uv at texel center
  let uv = vec2f((gx + 0.5) * sim.invTexW, (gy + 0.5) * sim.invTexH);
  return textureSampleLevel(densityTex, densitySamp, uv, 0.0).r * 255.0;
}

fn poly6(r2: f32, h: f32) -> f32 {
  let h2 = h * h;
  if (r2 >= h2) { return 0.0; }
  let x = h2 - r2;
  let h4 = h2 * h2;
  let h8 = h4 * h4;
  let k = 4.0 / (3.14159265 * h8);
  return k * x * x * x;
}

fn spikyGrad(r: vec2f, h: f32) -> vec2f {
  let r2 = dot(r, r);
  let h2 = h * h;
  if (r2 >= h2 || r2 < 1e-12) { return vec2f(0.0); }
  let rlen = sqrt(r2);
  let x = h - rlen;
  let h3 = h2 * h;
  let h5 = h3 * h2;
  let k = -30.0 / (3.14159265 * h5);
  let scale = k * x * x / rlen;
  return r * scale;
}

fn clampLen(v: vec2f, maxLen: f32) -> vec2f {
  let l2 = dot(v, v);
  let m2 = maxLen * maxLen;
  if (l2 > m2) {
    let l = sqrt(l2);
    return v * (maxLen / max(l, 1e-12));
  }
  return v;
}

fn projectOutOfRock(pIn: vec2f, storeIndex: u32) -> vec2f {
  var p = vec2f(clamp(pIn.x, 0.0, sim.worldW), clamp(pIn.y, 0.0, sim.worldH));
  if (sim.collisionIterations == 0u) {
    collidedN[storeIndex] = vec2f(0.0);
    return p;
  }

  let r = sim.particleRadius;
  let eps = sim.gridPitch;
  // Scale collision bias slightly with dt so smaller substeps don't inject jittery micro-bounces.
  let dtScale = clamp(sim.dt * 60.0, 0.25, 2.0);
  let bias = sim.gridPitch * 0.01 * dtScale;
  var lastN = vec2f(0.0);
  var did = false;

  for (var it = 0u; it < sim.collisionIterations; it++) {
    var bestPen = -1e9;
    var bestP = p;
    // 5-point max penetration
    let p0 = p;
    let p1 = p + vec2f(r, 0.0);
    let p2 = p + vec2f(-r, 0.0);
    let p3 = p + vec2f(0.0, r);
    let p4 = p + vec2f(0.0, -r);
    let d0 = densityAt(p0) - sim.iso;
    if (d0 > bestPen) { bestPen = d0; bestP = p0; }
    let d1 = densityAt(p1) - sim.iso;
    if (d1 > bestPen) { bestPen = d1; bestP = p1; }
    let d2 = densityAt(p2) - sim.iso;
    if (d2 > bestPen) { bestPen = d2; bestP = p2; }
    let d3 = densityAt(p3) - sim.iso;
    if (d3 > bestPen) { bestPen = d3; bestP = p3; }
    let d4 = densityAt(p4) - sim.iso;
    if (d4 > bestPen) { bestPen = d4; bestP = p4; }

    if (bestPen <= 0.0) { break; }

    let dx = densityAt(bestP + vec2f(eps, 0.0)) - densityAt(bestP + vec2f(-eps, 0.0));
    let dy = densityAt(bestP + vec2f(0.0, eps)) - densityAt(bestP + vec2f(0.0, -eps));
    let gl = sqrt(dx * dx + dy * dy);
    if (gl < 1e-6) {
      // Small random nudge
      let rx = (rand01(sim.tick ^ (storeIndex * 1664525u)) * 2.0 - 1.0) * sim.collisionPushMax;
      let ry = (rand01(sim.tick ^ (storeIndex * 1013904223u)) * 2.0 - 1.0) * sim.collisionPushMax;
      p = vec2f(clamp(p.x + rx, 0.0, sim.worldW), clamp(p.y + ry, 0.0, sim.worldH));
      continue;
    }
    let n = vec2f(-dx / gl, -dy / gl);
    lastN = n;
    did = true;

    let desired = bestPen / gl + bias;
    let pushDist = clamp(desired, 0.0, sim.collisionPushMax);
    p = vec2f(clamp(p.x + n.x * pushDist, 0.0, sim.worldW), clamp(p.y + n.y * pushDist, 0.0, sim.worldH));
  }

  collidedN[storeIndex] = select(vec2f(0.0), lastN, did);
  return p;
}

@compute @workgroup_size(1)
fn spawn(@builtin(global_invocation_id) gid: vec3u) {
  if (gid.x != 0u) { return; }
  if (sim.spawnCount == 0u) { return; }

  let r = sim.particleRadius;
  let margin = r * 2.0 + sim.gridPitch;
  let baseX = clamp(sim.spawnCenterX, margin, sim.worldW - margin);
  let baseY = clamp(sim.spawnCenterY, margin, sim.worldH - margin);

  for (var k = 0u; k < sim.spawnCount; k++) {
    let i = sim.spawnStart + k;
    // Random in a small box; try a few times to land in empty space.
    var p0 = vec2f(baseX, baseY);
    for (var t = 0u; t < 12u; t++) {
      let seedX = sim.tick ^ (i * 747796405u) ^ (t * 1013904223u);
      let seedY = sim.tick ^ (i * 2891336453u) ^ (t * 1664525u);
      let sx = (rand01(seedX) * 2.0 - 1.0) * sim.spawnXSpread;
      let sy = (rand01(seedY) * 2.0 - 1.0) * sim.spawnYJitter;
      let cand = vec2f(clamp(baseX + sx, margin, sim.worldW - margin), clamp(baseY + sy, margin, sim.worldH - margin));
      if (densityAt(cand) < sim.iso) {
        p0 = cand;
        break;
      }
      p0 = cand;
    }
    // If we never found empty space, keep the last candidate (collision projection will try to resolve).
    pos[i] = p0;
    prevPos[i] = p0;
    let vx0 = (rand01(sim.tick ^ (i * 1597334677u)) * 2.0 - 1.0) * 0.2;
    vel[i] = vec2f(vx0, 0.0);
    collidedN[i] = vec2f(0.0);
  }
}

@compute @workgroup_size(256)
fn clearGrid(@builtin(global_invocation_id) gid: vec3u) {
  let idx = gid.x;
  if (idx >= u32(sim.gridCols * sim.gridRows)) { return; }
  atomicStore(&gridHead[idx], ${SENTINEL}u);
}

@compute @workgroup_size(256)
fn integrate(@builtin(global_invocation_id) gid: vec3u) {
  let i = gid.x;
  if (i >= sim.aliveCount) { return; }

  prevPos[i] = pos[i];
  collidedN[i] = vec2f(0.0);

  var v = vel[i];
  v *= sim.dampingFactor;
  v.y += sim.gravityY * sim.dt;
  var p = pos[i] + v * sim.dt;

  p = projectOutOfRock(p, i);

  pos[i] = p;
  vel[i] = v;

  // Build grid linked list
  let cx = clamp(u32(floor(p.x * sim.invCellSize)), 0u, sim.gridCols - 1u);
  let cy = clamp(u32(floor(p.y * sim.invCellSize)), 0u, sim.gridRows - 1u);
  let cell = cx + cy * sim.gridCols;
  let prev = atomicExchange(&gridHead[cell], i);
  gridNext[i] = prev;
}

@compute @workgroup_size(256)
fn rebuildGrid(@builtin(global_invocation_id) gid: vec3u) {
  let i = gid.x;
  if (i >= sim.aliveCount) { return; }

  let p = pos[i];
  let cx = clamp(u32(floor(p.x * sim.invCellSize)), 0u, sim.gridCols - 1u);
  let cy = clamp(u32(floor(p.y * sim.invCellSize)), 0u, sim.gridRows - 1u);
  let cell = cx + cy * sim.gridCols;
  let prev = atomicExchange(&gridHead[cell], i);
  gridNext[i] = prev;
}

@compute @workgroup_size(256)
fn pbfLambda(@builtin(global_invocation_id) gid: vec3u) {
  let i = gid.x;
  if (i >= sim.aliveCount) { return; }
  if (sim.pbfRadius <= 0.0 || sim.pbfRestDensity <= 0.0) {
    density[i] = 0.0;
    lambda[i] = 0.0;
    return;
  }

  let p = pos[i];
  let cx = i32(clamp(u32(floor(p.x * sim.invCellSize)), 0u, sim.gridCols - 1u));
  let cy = i32(clamp(u32(floor(p.y * sim.invCellSize)), 0u, sim.gridRows - 1u));
  let h = sim.pbfRadius;
  let h2 = h * h;

  var rho = 0.0;
  var gradSum = vec2f(0.0);
  var sumGrad2 = 0.0;

  for (var oy = -1; oy <= 1; oy++) {
    let ny = cy + oy;
    if (ny < 0 || ny >= i32(sim.gridRows)) { continue; }
    for (var ox = -1; ox <= 1; ox++) {
      let nx = cx + ox;
      if (nx < 0 || nx >= i32(sim.gridCols)) { continue; }
      let cell = u32(nx) + u32(ny) * sim.gridCols;
      var j = atomicLoad(&gridHead[cell]);
      while (j != ${SENTINEL}u) {
        if (j < sim.aliveCount) {
          let q = pos[j];
          let r = p - q;
          let r2 = dot(r, r);
          if (r2 <= h2) {
            rho += poly6(r2, h);
            if (j != i) {
              let grad = spikyGrad(r, h);
              gradSum += grad;
              sumGrad2 += dot(grad, grad);
            }
          }
        }
        j = gridNext[j];
      }
    }
  }

  let invRest = 1.0 / sim.pbfRestDensity;
  sumGrad2 = (sumGrad2 + dot(gradSum, gradSum)) * invRest * invRest;
  let c = rho * invRest - 1.0;
  let denom = sumGrad2 + sim.pbfEpsilon;
  lambda[i] = clamp(-sim.pbfStiffness * c / denom, -50.0, 50.0);
  density[i] = rho;
}

@compute @workgroup_size(256)
fn pbfApply(@builtin(global_invocation_id) gid: vec3u) {
  let i = gid.x;
  if (i >= sim.aliveCount) { return; }
  if (sim.pbfRadius <= 0.0 || sim.pbfRestDensity <= 0.0) { return; }

  let p = pos[i];
  let cx = i32(clamp(u32(floor(p.x * sim.invCellSize)), 0u, sim.gridCols - 1u));
  let cy = i32(clamp(u32(floor(p.y * sim.invCellSize)), 0u, sim.gridRows - 1u));
  let h = sim.pbfRadius;
  let h2 = h * h;
  let corrK = sim.pbfSCorrK;
  let corrN = sim.pbfSCorrN;
  let dq = clamp(sim.pbfSCorrDq, 0.0, h);
  let wq = poly6(dq * dq, h);

  var delta = vec2f(0.0);
  let lambdaI = lambda[i];

  for (var oy = -1; oy <= 1; oy++) {
    let ny = cy + oy;
    if (ny < 0 || ny >= i32(sim.gridRows)) { continue; }
    for (var ox = -1; ox <= 1; ox++) {
      let nx = cx + ox;
      if (nx < 0 || nx >= i32(sim.gridCols)) { continue; }
      let cell = u32(nx) + u32(ny) * sim.gridCols;
      var j = atomicLoad(&gridHead[cell]);
      while (j != ${SENTINEL}u) {
        if (j != i && j < sim.aliveCount) {
          let q = pos[j];
          let r = p - q;
          let r2 = dot(r, r);
          if (r2 <= h2) {
            let grad = spikyGrad(r, h);
            var sc = 0.0;
            if (wq > 0.0) {
              let w = poly6(r2, h);
              sc = -corrK * pow(w / wq, corrN);
            }
            delta += (lambdaI + lambda[j] + sc) * grad;
          }
        }
        j = gridNext[j];
      }
    }
  }

  let invRest = 1.0 / sim.pbfRestDensity;
  var dp = delta * invRest;
  // Keep PBF stable across substeps and avoid large corrections injecting huge velocities.
  let dtScale = clamp(sim.dt * 60.0, 0.25, 2.0);
  dp *= dtScale;
  dp = clampLen(dp, sim.minDist * 0.2);
  let pNew = vec2f(clamp(p.x + dp.x, 0.0, sim.worldW), clamp(p.y + dp.y, 0.0, sim.worldH));
  pos[i] = pNew;
}

@compute @workgroup_size(256)
fn viscosity(@builtin(global_invocation_id) gid: vec3u) {
  let i = gid.x;
  if (i >= sim.aliveCount) { return; }
  if (sim.viscosityStrength <= 0.0) { return; }

  let p = pos[i];
  let v0 = vel[i];
  let cx = i32(clamp(u32(floor(p.x * sim.invCellSize)), 0u, sim.gridCols - 1u));
  let cy = i32(clamp(u32(floor(p.y * sim.invCellSize)), 0u, sim.gridRows - 1u));

  var dv = vec2f(0.0);
  var wsum = 0.0;
  let minDist = sim.minDist;
  let minDistSq = sim.minDistSq;

  for (var oy = -1; oy <= 1; oy++) {
    let ny = cy + oy;
    if (ny < 0 || ny >= i32(sim.gridRows)) { continue; }
    for (var ox = -1; ox <= 1; ox++) {
      let nx = cx + ox;
      if (nx < 0 || nx >= i32(sim.gridCols)) { continue; }
      let cell = u32(nx) + u32(ny) * sim.gridCols;
      var j = atomicLoad(&gridHead[cell]);
      while (j != ${SENTINEL}u) {
        if (j != i && j < sim.aliveCount) {
          let q = pos[j];
          let dx = q.x - p.x;
          let dy = q.y - p.y;
          let d2 = dx*dx + dy*dy;
          if (d2 < minDistSq && d2 > 1e-12) {
            let d = sqrt(d2);
            let w = 1.0 - d / minDist;
            dv += (vel[j] - v0) * w;
            wsum += w;
          }
        }
        j = gridNext[j];
      }
    }
  }

  if (wsum > 0.0) {
    let scale = sim.viscosityStrength / wsum;
    vel[i] = v0 + dv * scale;
  }
}

@compute @workgroup_size(256)
fn post(@builtin(global_invocation_id) gid: vec3u) {
  let i = gid.x;
  if (i >= sim.aliveCount) { return; }

  var p = pos[i];
  p = projectOutOfRock(p, i);
  pos[i] = p;

  let prev = prevPos[i];
  var v = (p - prev) / sim.dt;

  let n = collidedN[i];
  if (n.x != 0.0 || n.y != 0.0) {
    // Remove inward velocity
    let vn0 = v.x * n.x + v.y * n.y;
    if (vn0 < 0.0) {
      v -= vn0 * n;
    }
    let vn = v.x * n.x + v.y * n.y;
    let vt = v - vn * n;
    let vnD = vn * (1.0 - sim.collisionNormalDamp);
    let vtD = vt * (1.0 - sim.collisionTangentDamp);
    v = vtD + vnD * n;
  }

  vel[i] = v;
}
`;

    const thicknessShader = `
struct RenderUniforms {
  camX: f32,
  camY: f32,
  zoomPx: f32,
  invW: f32,
  invH: f32,
  radius: f32,
  count: u32,
  _pad: u32,
}

@group(0) @binding(0) var<uniform> uni: RenderUniforms;

struct VSOut {
  @builtin(position) pos: vec4f,
  @location(0) local: vec2f,
}

fn quadLocal(vid: u32) -> vec2f {
  switch (vid) {
    case 0u: { return vec2f(-1.0, -1.0); }
    case 1u: { return vec2f( 1.0, -1.0); }
    case 2u: { return vec2f(-1.0,  1.0); }
    case 3u: { return vec2f(-1.0,  1.0); }
    case 4u: { return vec2f( 1.0, -1.0); }
    default: { return vec2f( 1.0,  1.0); }
  }
}

@vertex
fn vsMain(
  @builtin(vertex_index) vid: u32,
  @builtin(instance_index) iid: u32,
  @location(0) instPos: vec2f
) -> VSOut {
  var out: VSOut;
  if (iid >= uni.count) {
    out.pos = vec4f(2.0, 2.0, 0.0, 1.0);
    out.local = vec2f(0.0);
    return out;
  }
  let ndcX = (instPos.x - uni.camX) * uni.zoomPx * 2.0 * uni.invW;
  let ndcY = -(instPos.y - uni.camY) * uni.zoomPx * 2.0 * uni.invH;

  let local = quadLocal(vid);
  let rx = uni.radius * uni.zoomPx * 2.0 * uni.invW;
  let ry = uni.radius * uni.zoomPx * 2.0 * uni.invH;
  out.pos = vec4f(ndcX + local.x * rx, ndcY + local.y * ry, 0.0, 1.0);
  out.local = local;
  return out;
}

@fragment
fn fsMain(in: VSOut) -> @location(0) vec4f {
  let d2 = dot(in.local, in.local);
  if (d2 > 1.0) { discard; }
  let thickness = exp(-d2 * 4.0);
  return vec4f(thickness, thickness, thickness, thickness);
}
`;

    const compositeShader = `
struct VOut {
  @builtin(position) pos: vec4f,
  @location(0) uv: vec2f,
}

@group(0) @binding(0) var thicknessTex: texture_2d<f32>;
@group(0) @binding(1) var thicknessSamp: sampler;

fn fullscreenTri(vid: u32) -> vec2f {
  switch (vid) {
    case 0u: { return vec2f(-1.0, -1.0); }
    case 1u: { return vec2f( 3.0, -1.0); }
    default: { return vec2f(-1.0,  3.0); }
  }
}

@vertex
fn vsMain(@builtin(vertex_index) vid: u32) -> VOut {
  var out: VOut;
  let p = fullscreenTri(vid);
  out.pos = vec4f(p, 0.0, 1.0);
  out.uv = p * vec2f(0.5, -0.5) + vec2f(0.5, 0.5);
  return out;
}

fn sampleThickness(uv: vec2f) -> f32 {
  return textureSample(thicknessTex, thicknessSamp, clamp(uv, vec2f(0.0), vec2f(1.0))).r;
}

@fragment
fn fsMain(in: VOut) -> @location(0) vec4f {
  let px = vec2f(dpdx(in.uv.x), dpdy(in.uv.y));
  let stepUv = vec2f(max(abs(px.x), 0.0005), max(abs(px.y), 0.0005));

  let c = sampleThickness(in.uv);
  let l = sampleThickness(in.uv + vec2f(-stepUv.x, 0.0));
  let r = sampleThickness(in.uv + vec2f( stepUv.x, 0.0));
  let u = sampleThickness(in.uv + vec2f(0.0, -stepUv.y));
  let d = sampleThickness(in.uv + vec2f(0.0,  stepUv.y));

  let smooth = (c * 2.0 + l + r + u + d) / 6.0;
  let edge = smoothstep(0.08, 0.22, smooth);
  if (edge <= 0.001) { discard; }

  let grad = vec2f(r - l, d - u);
  let n = normalize(vec3f(-grad.x * 4.0, -grad.y * 4.0, 1.0));
  let light = normalize(vec3f(-0.35, -0.5, 0.79));
  let lit = clamp(dot(n, light), 0.0, 1.0);
  let fres = pow(1.0 - clamp(n.z, 0.0, 1.0), 2.0);

  let deepColor = vec3f(0.08, 0.32, 0.78);
  let shallowColor = vec3f(0.30, 0.70, 1.0);
  let color = mix(shallowColor, deepColor, clamp(smooth * 0.9, 0.0, 1.0));
  color += 0.2 * lit + 0.35 * fres;

  let alpha = clamp(edge * (0.45 + smooth * 0.75), 0.0, 0.92);
  return vec4f(color * alpha, alpha);
}
`;

    const debugShader = `
struct VSOut {
  @builtin(position) pos: vec4f,
  @location(0) kind: f32,
}

fn fullscreenTri(vid: u32) -> vec2f {
  // Fullscreen triangle
  switch (vid) {
    case 0u: { return vec2f(-1.0, -1.0); }
    case 1u: { return vec2f( 3.0, -1.0); }
    default: { return vec2f(-1.0,  3.0); }
  }
}

fn squarePos(vid: u32) -> vec2f {
  // Centered square: NDC in [-0.2, 0.2]
  switch (vid) {
    case 0u: { return vec2f(-0.2, -0.2); }
    case 1u: { return vec2f( 0.2, -0.2); }
    case 2u: { return vec2f(-0.2,  0.2); }
    case 3u: { return vec2f(-0.2,  0.2); }
    case 4u: { return vec2f( 0.2, -0.2); }
    default: { return vec2f( 0.2,  0.2); }
  }
}

@vertex
fn vsMain(@builtin(vertex_index) vid: u32) -> VSOut {
  var out: VSOut;
  if (vid < 3u) {
    let p = fullscreenTri(vid);
    out.pos = vec4f(p, 0.0, 1.0);
    out.kind = 0.0;
  } else {
    let p = squarePos(vid - 3u);
    out.pos = vec4f(p, 0.0, 1.0);
    out.kind = 1.0;
  }
  return out;
}

@fragment
fn fsMain(in: VSOut) -> @location(0) vec4f {
  // Teal background + red square
  if (in.kind > 0.5) {
    return vec4f(1.0, 0.2, 0.2, 1.0);
  }
  return vec4f(0.0, 0.8, 0.8, 1.0);
}
`;

    const simModule = this.device.createShaderModule({ code: simShader });
    const thicknessModule = this.device.createShaderModule({ code: thicknessShader });
    const compositeModule = this.device.createShaderModule({ code: compositeShader });
    const debugModule = this.device.createShaderModule({ code: debugShader });
    this.logCompilationInfo('sim', simModule);
    this.logCompilationInfo('thickness', thicknessModule);
    this.logCompilationInfo('composite', compositeModule);
    this.logCompilationInfo('debug', debugModule);

    this.simUniformBuffer = this.device.createBuffer({
      size: 160,
      usage: (globalThis as any).GPUBufferUsage.UNIFORM | (globalThis as any).GPUBufferUsage.COPY_DST,
    });

    this.renderUniformBuffer = this.device.createBuffer({
      size: 32,
      usage: (globalThis as any).GPUBufferUsage.UNIFORM | (globalThis as any).GPUBufferUsage.COPY_DST,
    });

    const simBgl = this.device.createBindGroupLayout({
      entries: [
        { binding: 0, visibility: (globalThis as any).GPUShaderStage.COMPUTE, buffer: { type: 'uniform' } },
        { binding: 1, visibility: (globalThis as any).GPUShaderStage.COMPUTE, buffer: { type: 'storage' } },
        { binding: 2, visibility: (globalThis as any).GPUShaderStage.COMPUTE, buffer: { type: 'storage' } },
        { binding: 3, visibility: (globalThis as any).GPUShaderStage.COMPUTE, buffer: { type: 'storage' } },
        { binding: 4, visibility: (globalThis as any).GPUShaderStage.COMPUTE, buffer: { type: 'storage' } },
        { binding: 5, visibility: (globalThis as any).GPUShaderStage.COMPUTE, buffer: { type: 'storage' } },
        { binding: 6, visibility: (globalThis as any).GPUShaderStage.COMPUTE, buffer: { type: 'storage' } },
        { binding: 7, visibility: (globalThis as any).GPUShaderStage.COMPUTE, texture: { sampleType: 'float' } },
        { binding: 8, visibility: (globalThis as any).GPUShaderStage.COMPUTE, sampler: { type: 'filtering' } },
        { binding: 9, visibility: (globalThis as any).GPUShaderStage.COMPUTE, buffer: { type: 'storage' } },
        { binding: 10, visibility: (globalThis as any).GPUShaderStage.COMPUTE, buffer: { type: 'storage' } },
      ],
    });

    const simLayout = this.device.createPipelineLayout({ bindGroupLayouts: [simBgl] });
    this.simPipelineSpawn = this.createComputePipelineChecked('spawn', simLayout, simModule, 'spawn');
    this.simPipelineClearGrid = this.createComputePipelineChecked('clearGrid', simLayout, simModule, 'clearGrid');
    this.simPipelineIntegrate = this.createComputePipelineChecked('integrate', simLayout, simModule, 'integrate');
    this.simPipelineRebuildGrid = this.createComputePipelineChecked('rebuildGrid', simLayout, simModule, 'rebuildGrid');
    this.simPipelinePost = this.createComputePipelineChecked('post', simLayout, simModule, 'post');
    this.simPipelineViscosity = this.createComputePipelineChecked('viscosity', simLayout, simModule, 'viscosity');
    this.simPipelinePbfLambda = this.createComputePipelineChecked('pbfLambda', simLayout, simModule, 'pbfLambda');
    this.simPipelinePbfApply = this.createComputePipelineChecked('pbfApply', simLayout, simModule, 'pbfApply');

    this.simBindGroup = this.device.createBindGroup({
      layout: simBgl,
      entries: [
        { binding: 0, resource: { buffer: this.simUniformBuffer } },
        { binding: 1, resource: { buffer: this.posBuffer } },
        { binding: 2, resource: { buffer: this.velBuffer } },
        { binding: 3, resource: { buffer: this.prevPosBuffer } },
        { binding: 4, resource: { buffer: this.collidedNBuffer } },
        { binding: 5, resource: { buffer: this.gridNextBuffer } },
        { binding: 6, resource: { buffer: this.gridHeadBuffer } },
        { binding: 7, resource: this.densityTextureView },
        { binding: 8, resource: this.densitySampler },
        { binding: 9, resource: { buffer: this.densityBuffer } },
        { binding: 10, resource: { buffer: this.lambdaBuffer } },
      ],
    });

    const renderBgl = this.device.createBindGroupLayout({
      entries: [
        { binding: 0, visibility: (globalThis as any).GPUShaderStage.VERTEX, buffer: { type: 'uniform' } },
      ],
    });
    const renderLayout = this.device.createPipelineLayout({ bindGroupLayouts: [renderBgl] });
    this.thicknessPipeline = this.createRenderPipelineChecked('waterThickness', {
      layout: renderLayout,
      vertex: {
        module: thicknessModule,
        entryPoint: 'vsMain',
        buffers: [
          {
            arrayStride: 8,
            stepMode: 'instance',
            attributes: [{ shaderLocation: 0, offset: 0, format: 'float32x2' }],
          },
        ],
      },
      fragment: {
        module: thicknessModule,
        entryPoint: 'fsMain',
        targets: [
          {
            format: 'rgba16float',
            blend: {
              color: { srcFactor: 'one', dstFactor: 'one', operation: 'add' },
              alpha: { srcFactor: 'one', dstFactor: 'one', operation: 'add' },
            },
          },
        ],
      },
      primitive: { topology: 'triangle-list' },
    });

    this.compositePipeline = this.createRenderPipelineChecked('waterComposite', {
      layout: 'auto',
      vertex: { module: compositeModule, entryPoint: 'vsMain' },
      fragment: {
        module: compositeModule,
        entryPoint: 'fsMain',
        targets: [
          {
            format: this.format,
            blend: {
              color: { srcFactor: 'one', dstFactor: 'one-minus-src-alpha', operation: 'add' },
              alpha: { srcFactor: 'one', dstFactor: 'one-minus-src-alpha', operation: 'add' },
            },
          },
        ],
      },
      primitive: { topology: 'triangle-list' },
    });

    this.debugPipeline = this.createRenderPipelineChecked('debug', {
      layout: 'auto',
      vertex: { module: debugModule, entryPoint: 'vsMain' },
      fragment: {
        module: debugModule,
        entryPoint: 'fsMain',
        targets: [{ format: this.format }],
      },
      primitive: { topology: 'triangle-list' },
    });

    this.renderBindGroup = this.device.createBindGroup({
      layout: renderBgl,
      entries: [
        { binding: 0, resource: { buffer: this.renderUniformBuffer } },
      ],
    });

    if (this.compositePipeline && this.thicknessTextureView && this.thicknessSampler) {
      const compositeLayout = this.compositePipeline.getBindGroupLayout(0);
      this.compositeBindGroup = this.device.createBindGroup({
        layout: compositeLayout,
        entries: [
          { binding: 0, resource: this.thicknessTextureView },
          { binding: 1, resource: this.thicknessSampler },
        ],
      });
    }
  }

  private writeSimUniforms(extra: { dt: number; dampingFactor: number; spawnStart: number; spawnCount: number }): void {
    if (!this.device || !this.simUniformBuffer) return;
    const { width, height, gridPitch, isoValue } = this.densityField.config;
    const texW = this.densityField.gridWidth;
    const texH = this.densityField.gridHeight;

    const dt = extra.dt;
    const dtScale = clamp(dt * 60, 0.25, 2.0);
    const ab = new ArrayBuffer(160);
    const dv = new DataView(ab);

    let o = 0;
    const f32 = (v: number) => { dv.setFloat32(o, v, true); o += 4; };
    const u32 = (v: number) => { dv.setUint32(o, v >>> 0, true); o += 4; };

    f32(dt);
    f32(this.params.gravityY);
    f32(extra.dampingFactor);
    f32(0);

    f32(width);
    f32(height);
    f32(gridPitch);
    f32(1 / gridPitch);

    f32(isoValue);
    f32(this.params.particleRadius);
    f32(this.minDist);
    f32(this.minDist * this.minDist);

    f32(this.cellSize);
    f32(1 / this.cellSize);
    f32(1 / texW);
    f32(1 / texH);

    u32(this.aliveCount);
    u32(this.gridCols);
    u32(this.gridRows);
    u32(this.params.collisionIterations);

    f32(Math.max(this.params.collisionPushStep, gridPitch * 0.5) * dtScale);
    f32(this.params.collisionNormalDamping);
    f32(this.params.collisionTangentDamping);
    f32(this.params.viscosityStrength);

    f32(this.params.pbfRadius);
    f32(this.params.pbfRestDensity);
    f32(this.params.pbfStiffness);
    // Stabilizer for low-neighbor-count cases; PBF denominators can get tiny at the free surface.
    f32(0.1);

    f32(this.params.pbfSCorrK);
    f32(this.params.pbfSCorrN);
    f32(this.params.pbfSCorrDq);
    f32(0);

    u32(extra.spawnStart);
    u32(extra.spawnCount);
    u32(this.tick);
    u32(0);

    f32(this.spawnCenterX);
    f32(this.spawnCenterY);
    f32(this.params.spawnXSpread);
    f32(this.params.spawnYJitter);

    this.device.queue.writeBuffer(this.simUniformBuffer, 0, ab);
  }

  private logCompilationInfo(label: string, module: any): void {
    try {
      module?.getCompilationInfo?.().then((info: any) => {
        const msgs: any[] = info?.messages ?? [];
        const interesting = msgs.filter((m) => (m?.type ?? '') !== 'info');
        if (interesting.length === 0) return;
        for (const m of interesting) {
          const line = m?.lineNum ?? 0;
          const col = m?.linePos ?? 0;
          const type = m?.type ?? 'unknown';
          const msg = m?.message ?? String(m);
          (globalThis as any).log?.(`[WaterWebGPU][${label}] ${type} ${line}:${col} ${msg}`);
          console.error(`[WaterWebGPU][${label}] ${type} ${line}:${col} ${msg}`);
        }
      });
    } catch {
      // Optional diagnostics only.
    }
  }

  private createComputePipelineChecked(label: string, layout: any, module: any, entryPoint: string): any {
    if (!this.device) return null;
    try {
      this.device.pushErrorScope?.('validation');
      const pipeline = this.device.createComputePipeline({ label, layout, compute: { module, entryPoint } });
      this.device.popErrorScope?.().then((err: any) => {
        if (!err) return;
        const msg = err?.message ?? String(err);
        this.simOk = false;
        (globalThis as any).log?.(`[WaterWebGPU] ComputePipeline ${label} validation error: ${msg}`);
        console.error('[WaterWebGPU] ComputePipeline validation error:', label, err);
      });
      return pipeline;
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      this.simOk = false;
      (globalThis as any).log?.(`[WaterWebGPU] ComputePipeline ${label} exception: ${msg}`);
      console.error('[WaterWebGPU] ComputePipeline exception:', label, e);
      return null;
    }
  }

  private createRenderPipelineChecked(label: string, desc: any): any {
    if (!this.device) return null;
    try {
      this.device.pushErrorScope?.('validation');
      const pipeline = this.device.createRenderPipeline({ label, ...desc });
      this.device.popErrorScope?.().then((err: any) => {
        if (!err) return;
        const msg = err?.message ?? String(err);
        (globalThis as any).log?.(`[WaterWebGPU] RenderPipeline ${label} validation error: ${msg}`);
        console.error('[WaterWebGPU] RenderPipeline validation error:', label, err);
      });
      return pipeline;
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      (globalThis as any).log?.(`[WaterWebGPU] RenderPipeline ${label} exception: ${msg}`);
      console.error('[WaterWebGPU] RenderPipeline exception:', label, e);
      return null;
    }
  }
}
