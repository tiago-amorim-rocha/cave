import type { CarvingDebugContext, CarvingDebugHooks } from '../../carving/CarvingDebugHooks';
import type { CarveOption2DebugData, LocalUpdateDebugData } from '../../Renderer';
import type { LocalUpdateSession } from '../../RemeshManager';
import type { Vec2 } from '../../types';
import { CarvingDebugMode, getCarvingDebugModeLabel, nextCarvingDebugMode } from '../../CarvingDebugMode';

export class CarvingDebugController implements CarvingDebugHooks {
  private ctx: CarvingDebugContext;
  private carveOption2Debug: CarveOption2DebugData | null = null;
  private localUpdateSession: LocalUpdateSession | null = null;
  private mode: CarvingDebugMode = CarvingDebugMode.NONE;
  private lastDirtyRegion: { minX: number; minY: number; maxX: number; maxY: number } | null = null;
  private restoreFlags: { showDirtyAABB: boolean; showRebuiltChains: boolean; showSegmentDebug: boolean } | null = null;

  constructor(ctx: CarvingDebugContext) {
    this.ctx = ctx;
    this.restoreFlags = {
      showDirtyAABB: ctx.renderer.showDirtyAABB,
      showRebuiltChains: ctx.renderer.showRebuiltChains,
      showSegmentDebug: ctx.renderer.showSegmentDebug
    };
    ctx.renderer.showDirtyAABB = true;
    ctx.renderer.showRebuiltChains = true;
  }

  onCarveStamped(): void {
    this.localUpdateSession = null;
    this.ctx.renderer.setLocalUpdateDebug(null);
    this.refreshOption2DebugPreview();

    if (this.mode === CarvingDebugMode.NONE) {
      this.mode = CarvingDebugMode.DIRTY_AABB;
      this.ctx.renderer.setCarvingDebugMode(this.mode);
    }
  }

  advanceStep(): void {
    const next = nextCarvingDebugMode(this.mode);
    const from = getCarvingDebugModeLabel(this.mode);
    const to = getCarvingDebugModeLabel(next);

    if (import.meta.env.DEV) {
      console.log('[CarvingDebug] Step advanced', { from, to });
    }

    this.mode = next;
    this.ctx.renderer.setCarvingDebugMode(next);

    switch (next) {
      case CarvingDebugMode.DIRTY_AABB:
      case CarvingDebugMode.CANONICAL_AFFECTED:
      case CarvingDebugMode.CANONICAL_DIRTY_RANGES:
      case CarvingDebugMode.OPT_INVALIDATION:
        this.ctx.renderer.showSegmentDebug = false;
        this.ctx.renderer.setLocalUpdateDebug(null);
        this.refreshOption2DebugPreview();
        break;

      case CarvingDebugMode.LOCAL_MS_MATCH: {
        this.ctx.renderer.showSegmentDebug = false;
        const session = this.ensureLocalUpdateSession();
        if (!session) {
          this.ctx.renderer.setLocalUpdateDebug(null);
          break;
        }
        this.ctx.renderer.setLocalUpdateDebug(this.buildLocalUpdateDebugData(session));
        break;
      }

      case CarvingDebugMode.LOCAL_CANON_SURGERY_PREVIEW: {
        this.ctx.renderer.showSegmentDebug = false;
        const session = this.ensureLocalUpdateSession();
        if (!session) break;
        session.surgery.previewLoops = this.ctx.remeshManager.computeLocalUpdateCanonicalPreview(session);
        this.ctx.renderer.setLocalUpdateDebug(this.buildLocalUpdateDebugData(session));
        break;
      }

      case CarvingDebugMode.LOCAL_CANON_SURGERY_COMMIT: {
        this.ctx.renderer.showSegmentDebug = false;
        const session = this.ensureLocalUpdateSession();
        if (!session) break;
        this.ctx.remeshManager.commitLocalUpdateCanonical(session);
        this.ctx.renderer.setLocalUpdateDebug(this.buildLocalUpdateDebugData(session));
        break;
      }

      case CarvingDebugMode.LOCAL_OPT_AABB_INVALIDATION: {
        this.ctx.renderer.showSegmentDebug = false;
        const session = this.ensureLocalUpdateSession();
        if (!session) break;
        this.ctx.remeshManager.computeLocalUpdateOptAabbInvalidation(session);
        this.ctx.renderer.setLocalUpdateDebug(this.buildLocalUpdateDebugData(session));
        break;
      }

      case CarvingDebugMode.LOCAL_OPT_REBUILD: {
        this.ctx.renderer.showSegmentDebug = false;
        const session = this.ensureLocalUpdateSession();
        if (!session) break;
        this.ctx.remeshManager.rebuildLocalUpdateOpt(session);
        this.ctx.renderer.setLocalUpdateDebug(this.buildLocalUpdateDebugData(session));
        break;
      }

      case CarvingDebugMode.LOCAL_OPT_SPLICE_VALIDATE: {
        this.ctx.renderer.showSegmentDebug = false;
        const session = this.ensureLocalUpdateSession();
        if (!session) break;
        this.ctx.remeshManager.commitLocalUpdateOptSplice(session);
        this.ctx.renderer.setLocalUpdateDebug(this.buildLocalUpdateDebugData(session));
        break;
      }

      case CarvingDebugMode.LOCAL_PHYSICS_PLAN: {
        this.ctx.renderer.showSegmentDebug = false;
        const session = this.ensureLocalUpdateSession();
        if (!session) break;
        this.ctx.remeshManager.computeLocalUpdatePhysicsPlan(session);
        this.ctx.renderer.setLocalUpdateDebug(this.buildLocalUpdateDebugData(session));
        break;
      }

      case CarvingDebugMode.LOCAL_PHYSICS_APPLY: {
        this.ctx.renderer.showSegmentDebug = false;
        const session = this.ensureLocalUpdateSession();
        if (!session) break;
        // Preserve region after dirty flags are cleared.
        this.lastDirtyRegion = session.paddedAABB;
        this.ctx.renderer.setDirtyAABB(session.paddedAABB);
        this.ctx.remeshManager.applyLocalUpdatePhysics(session);
        this.ctx.renderer.setLocalUpdateDebug(this.buildLocalUpdateDebugData(session));
        break;
      }

      case CarvingDebugMode.SEGMENT_DEBUG:
        this.ctx.renderer.showSegmentDebug = true;
        break;

      case CarvingDebugMode.NONE:
      default:
        this.ctx.renderer.showSegmentDebug = false;
        this.clearOption2DebugPreview();
        break;
    }
  }

  dispose(): void {
    this.mode = CarvingDebugMode.NONE;
    this.ctx.renderer.setCarvingDebugMode(CarvingDebugMode.NONE);
    this.clearOption2DebugPreview();
    if (this.restoreFlags) {
      this.ctx.renderer.showDirtyAABB = this.restoreFlags.showDirtyAABB;
      this.ctx.renderer.showRebuiltChains = this.restoreFlags.showRebuiltChains;
      this.ctx.renderer.showSegmentDebug = this.restoreFlags.showSegmentDebug;
      this.restoreFlags = null;
    }
  }

  private aabbsIntersect(
    a: { minX: number; minY: number; maxX: number; maxY: number },
    b: { minX: number; minY: number; maxX: number; maxY: number }
  ): boolean {
    return !(a.maxX < b.minX || a.minX > b.maxX || a.maxY < b.minY || a.minY > b.maxY);
  }

  private computePaddedDirtyAabb(expandCells: number): { minX: number; minY: number; maxX: number; maxY: number } | null {
    const dirtyAabb = this.ctx.densityField.getDirtyWorldAABB();
    if (!dirtyAabb) return null;
    const gridPitch = this.ctx.densityField.config.gridPitch;
    return {
      minX: dirtyAabb.minX - expandCells * gridPitch,
      minY: dirtyAabb.minY - expandCells * gridPitch,
      maxX: dirtyAabb.maxX + expandCells * gridPitch,
      maxY: dirtyAabb.maxY + expandCells * gridPitch
    };
  }

  private computeCarveOption2Debug(expandCells: number): CarveOption2DebugData | null {
    const region = this.computePaddedDirtyAabb(expandCells);
    if (!region) return null;

    const canonicalLoops = this.ctx.remeshManager.getCanonicalLoops();
    const affectedCanonicalLoopIds: number[] = [];
    const dirtyRanges: CarveOption2DebugData['dirtyRanges'] = [];
    const optInvalidations: CarveOption2DebugData['optInvalidations'] = [];

    for (const loop of canonicalLoops) {
      if (!this.aabbsIntersect(loop.aabb, region)) continue;
      affectedCanonicalLoopIds.push(loop.id);

      const n = loop.vertices.length;
      const nUnique = loop.isClosed ? Math.max(1, n - 1) : n;
      const insideFlags: boolean[] = [];
      for (let i = 0; i < nUnique; i++) {
        const v = loop.vertices[i];
        insideFlags.push(v.x >= region.minX && v.x <= region.maxX && v.y >= region.minY && v.y <= region.maxY);
      }

      // Build contiguous inside runs (cyclic merge supported)
      const runs: Array<{ startIndex: number; endIndex: number }> = [];
      let runStart = -1;
      for (let i = 0; i < nUnique; i++) {
        if (insideFlags[i]) {
          if (runStart === -1) runStart = i;
        } else if (runStart !== -1) {
          runs.push({ startIndex: runStart, endIndex: i - 1 });
          runStart = -1;
        }
      }
      if (runStart !== -1) {
        runs.push({ startIndex: runStart, endIndex: nUnique - 1 });
      }

      if (runs.length === 0) {
        dirtyRanges.push({ loopId: loop.id, startIndex: 0, endIndex: Math.max(0, nUnique - 1) });
      } else if (runs.length >= 2 && insideFlags[0] && insideFlags[nUnique - 1]) {
        // Merge last run with first into a wrap range (start > end)
        const first = runs[0];
        const last = runs[runs.length - 1];
        dirtyRanges.push({ loopId: loop.id, startIndex: last.startIndex, endIndex: first.endIndex });
        for (let i = 1; i < runs.length - 1; i++) {
          dirtyRanges.push({ loopId: loop.id, startIndex: runs[i].startIndex, endIndex: runs[i].endIndex });
        }
      } else {
        for (const r of runs) dirtyRanges.push({ loopId: loop.id, startIndex: r.startIndex, endIndex: r.endIndex });
      }

      // Opt invalidation preview: mark individual opt indices and compress into spans.
      if (loop.optVertices && loop.optVertices.length > 0) {
        const rangesForLoop = dirtyRanges.filter(r => r.loopId === loop.id);

        const dirtyIntervalsUnwrapped: Array<{ start: number; end: number }> = [];
        for (const r of rangesForLoop) {
          if (nUnique <= 0) continue;
          if (r.startIndex <= r.endIndex) {
            dirtyIntervalsUnwrapped.push({ start: r.startIndex, end: r.endIndex });
            dirtyIntervalsUnwrapped.push({ start: r.startIndex + nUnique, end: r.endIndex + nUnique });
          } else {
            dirtyIntervalsUnwrapped.push({ start: r.startIndex, end: r.endIndex + nUnique });
          }
        }

        const invalidFlags = loop.optVertices.map((ov) =>
          dirtyIntervalsUnwrapped.some((d) => ov.canonEndId >= d.start && ov.canonStartId <= d.end)
        );

        const spans: Array<{ startOpt: number; endOpt: number }> = [];
        let spanStart = -1;
        for (let i = 0; i < invalidFlags.length; i++) {
          if (invalidFlags[i]) {
            if (spanStart === -1) spanStart = i;
          } else if (spanStart !== -1) {
            spans.push({ startOpt: spanStart, endOpt: i - 1 });
            spanStart = -1;
          }
        }
        if (spanStart !== -1) {
          spans.push({ startOpt: spanStart, endOpt: invalidFlags.length - 1 });
        }

        if (spans.length >= 2 && invalidFlags[0] && invalidFlags[invalidFlags.length - 1]) {
          const first = spans[0];
          const last = spans[spans.length - 1];
          const merged: Array<{ startOpt: number; endOpt: number }> = [];
          merged.push({ startOpt: last.startOpt, endOpt: first.endOpt }); // wrap span
          for (let i = 1; i < spans.length - 1; i++) merged.push(spans[i]);
          optInvalidations.push({ loopId: loop.id, spans: merged });
        } else {
          optInvalidations.push({ loopId: loop.id, spans });
        }
      }
    }

    return {
      region,
      affectedCanonicalLoopIds,
      dirtyRanges,
      optInvalidations
    };
  }

  private refreshOption2DebugPreview(): void {
    const expandCells = this.ctx.config.carveDebugExpandCells;
    const data = this.computeCarveOption2Debug(expandCells);
    this.carveOption2Debug = data;
    if (data) {
      this.lastDirtyRegion = data.region;
      this.ctx.renderer.setCarveOption2Debug(data);
      this.ctx.renderer.setDirtyAABB(data.region);
    } else if (this.lastDirtyRegion) {
      this.ctx.renderer.setDirtyAABB(this.lastDirtyRegion);
    }
  }

  private clearOption2DebugPreview(): void {
    this.carveOption2Debug = null;
    this.localUpdateSession = null;
    this.ctx.renderer.setCarveOption2Debug(null);
    this.ctx.renderer.setLocalUpdateDebug(null);
    this.ctx.renderer.setDirtyAABB(null);
    this.lastDirtyRegion = null;
  }

  private ensureLocalUpdateSession(): LocalUpdateSession | null {
    const expandCells = this.ctx.config.carveDebugExpandCells;
    if (this.localUpdateSession) return this.localUpdateSession;
    const session = this.ctx.remeshManager.beginLocalUpdateSession(expandCells);
    if (!session) return null;
    this.localUpdateSession = session;
    this.lastDirtyRegion = session.paddedAABB;
    this.ctx.renderer.setDirtyAABB(session.paddedAABB);
    return session;
  }

  private buildLocalUpdateDebugData(session: LocalUpdateSession): LocalUpdateDebugData {
    const toVec2 = (p: { x: number; y: number }): Vec2 => ({ x: p.x, y: p.y });

    const centroid = (pts: Vec2[]): Vec2 => {
      if (pts.length === 0) return { x: 0, y: 0 };
      const unique =
        pts.length >= 2 && Math.hypot(pts[0].x - pts[pts.length - 1].x, pts[0].y - pts[pts.length - 1].y) < 1e-6
          ? pts.slice(0, -1)
          : pts;

      let areaAcc = 0;
      let cxAcc = 0;
      let cyAcc = 0;
      const n = unique.length;
      for (let i = 0; i < n; i++) {
        const p = unique[i];
        const q = unique[(i + 1) % n];
        const cross = p.x * q.y - q.x * p.y;
        areaAcc += cross;
        cxAcc += (p.x + q.x) * cross;
        cyAcc += (p.y + q.y) * cross;
      }
      const area = areaAcc * 0.5;
      if (Math.abs(area) < 1e-8) {
        let sx = 0;
        let sy = 0;
        for (const p of unique) {
          sx += p.x;
          sy += p.y;
        }
        return { x: sx / n, y: sy / n };
      }
      const f = 1 / (6 * area);
      return { x: cxAcc * f, y: cyAcc * f };
    };

    const affectedCanonicalLoops = session.affectedCanonicals.map((l) => ({
      id: l.id,
      vertices: l.vertices.map(toVec2)
    }));

    const msCleanedLoops = session.msCleanedLoops.map((loop) => loop.map(toVec2));

    const newLoopById = new Map<number, Vec2[]>();
    for (const loop of session.newCanonicalLoops) {
      newLoopById.set(loop.id, loop.vertices.map(toVec2));
    }

    const oldLoopById = new Map<number, Vec2[]>();
    for (const loop of session.affectedCanonicals) {
      oldLoopById.set(loop.id, loop.vertices.map(toVec2));
    }

    const matches = session.surgery.matches.map((m) => {
      const oldVerts = oldLoopById.get(m.oldLoopId) ?? [];
      const newVerts = m.newLoopId ? (newLoopById.get(m.newLoopId) ?? []) : [];
      return {
        oldLoopId: m.oldLoopId,
        newLoopId: m.newLoopId,
        oldCentroid: centroid(oldVerts),
        newCentroid: m.newLoopId ? centroid(newVerts) : undefined
      };
    });

    const previewLoops = (session.surgery.previewLoops ?? session.surgery.replacements).map((l) => ({
      id: l.id,
      vertices: l.vertices.map(toVec2)
    }));

    const baseOptLoops = session.opt?.baseOptLoops?.map((loop) => loop.map(toVec2)) ?? [];
    const baseInvalidations = session.opt?.baseInvalidations ?? [];
    const rebuiltOptLoops = session.opt?.rebuiltOptLoops?.map((loop) => loop.map(toVec2)) ?? [];
    const splicedOptLoops = session.opt?.splicedOptLoops?.map((loop) => loop.map(toVec2)) ?? [];

    return {
      paddedAABB: session.paddedAABB,
      affectedCanonicalLoops,
      msCleanedLoops,
      matches,
      surgeryPreview: { replacementLoops: previewLoops },
      surgeryCommit: { replacementLoopIds: session.surgery.replacements.map((l) => l.id) },
      optAabbInvalidation: { optLoops: baseOptLoops, invalidations: baseInvalidations },
      optRebuild: { rebuiltOptLoops },
      optSplice: {
        splicedOptLoops,
        keptCount: session.opt?.baseOptLoops?.length ?? 0,
        rebuiltCount: session.opt?.rebuiltOptLoops?.length ?? 0
      },
      physicsPlan: {
        affectedBodyCount: session.physics?.affectedBodyCount ?? 0,
        loopsToAdd: session.surgery.replacements.length
      },
      physicsApply: {
        removedBodyCount: session.physics?.removedBodyCount ?? 0,
        loopsAdded: session.surgery.replacements.length
      }
    };
  }
}
