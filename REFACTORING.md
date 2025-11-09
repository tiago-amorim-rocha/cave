# Refactoring Recommendations

This document outlines potential refactoring opportunities for future work.

## Completed Refactoring

✅ **Type Safety** (Completed)
- Removed all `any` types (except intentional ones in console interception)
- Added proper type definitions (BallRenderData, DensityField references, Camera)
- Better IDE autocomplete and type checking

✅ **Code Duplication** (Completed)
- Consolidated Point interface into types.ts
- Unified imports across 4 modules

✅ **Dead Code Removal** (Completed)
- Removed unused Matter.js legacy code (drawPhysicsBodies, drawBodyPart)
- Removed unused @types/matter-js dependency

## Pending Refactoring Opportunities

### 1. Large main.ts (Priority: Medium)

**Current State:**
- 878 lines
- 34 methods
- Handles: initialization, remesh logic, vertex optimization pipeline, UI, physics integration

**Recommended Breakdown:**

#### A. Extract `VertexOptimizationPipeline` class
```typescript
// src/VertexOptimizationPipeline.ts
class VertexOptimizationPipeline {
  constructor(
    private densityField: DensityField,
    private marchingSquares: MarchingSquares
  ) {}

  optimize(
    loops: Point[][],
    options: OptimizationOptions
  ): OptimizedResult {
    // Contains: cleanLoop, simplification, Chaikin, ISO-snapping, etc.
  }
}
```
**Benefits:**
- Isolates complex optimization logic (currently ~150 lines in fullHeal())
- Easier to test optimization pipeline independently
- Clearer separation of concerns

#### B. Extract `RemeshManager` class
```typescript
// src/RemeshManager.ts
class RemeshManager {
  private lastFullHealTime = 0;
  private needsFullHeal = false;

  constructor(
    private densityField: DensityField,
    private marchingSquares: MarchingSquares,
    private loopCache: LoopCache,
    private physics: RapierPhysics,
    private renderer: Renderer
  ) {}

  remesh(): void {
    // Contains: fullHeal(), incrementalUpdate(), isRockLoop(), etc.
  }
}
```
**Benefits:**
- Encapsulates remesh state and logic (~200 lines)
- Easier to add incremental update support later
- Clearer API for triggering remeshes

#### C. Extract `AppLifecycle` class
```typescript
// src/AppLifecycle.ts
class AppLifecycle {
  constructor(private app: CarvableCaves) {}

  async initialize(): Promise<void> {
    // Contains: start(), async Rapier init, player creation
  }

  startRenderLoop(): void {
    // Contains: loop(), updateFPS(), ball spawning
  }
}
```
**Benefits:**
- Separates lifecycle concerns from core logic
- Makes initialization flow more explicit
- Easier to add lifecycle hooks

#### D. Simplified main.ts structure
```typescript
// src/main.ts (reduced to ~300 lines)
class CarvableCaves {
  private remeshManager: RemeshManager;
  private optimizationPipeline: VertexOptimizationPipeline;
  private lifecycle: AppLifecycle;

  constructor() {
    // Initialize all managers
    this.remeshManager = new RemeshManager(/*...*/);
    this.optimizationPipeline = new VertexOptimizationPipeline(/*...*/);
    this.lifecycle = new AppLifecycle(this);
  }

  // High-level coordination only
}
```

**Impact:**
- Main file reduced from ~878 to ~300 lines
- Better testability (each class can be unit tested)
- Clearer responsibilities
- Easier onboarding for new contributors

**Risk Level:** 🟡 Medium
- Requires careful refactoring to avoid breaking existing functionality
- Need comprehensive testing after refactoring
- Should be done incrementally, not all at once

**Recommended Approach:**
1. Add comprehensive tests first
2. Extract one class at a time (start with VertexOptimizationPipeline)
3. Test after each extraction
4. Commit after each successful extraction

### 2. Configuration Management (Priority: Low)

**Current State:**
- WorldConfig, BrushSettings scattered across files
- Hard-coded values in multiple places

**Recommendation:**
```typescript
// src/config.ts
export class AppConfig {
  static readonly WORLD = {
    width: 50,
    height: 30,
    gridPitch: 0.2,
    isoValue: 128
  };

  static readonly PHYSICS = {
    gravity: { x: 0, y: 10 },
    fixedTimestep: 1 / 60
  };

  static readonly RENDERING = {
    targetFPS: 60,
    fullHealInterval: 5000
  };
}
```

**Benefits:**
- Single source of truth for configuration
- Easier to adjust parameters
- Better for testing different configurations

**Risk Level:** 🟢 Low
- Minimal risk, straightforward refactoring

### 3. Error Handling (Priority: Low)

**Current State:**
- Some try-catch blocks, but inconsistent
- Console logging for errors
- Some errors silently caught

**Recommendation:**
```typescript
// src/ErrorHandler.ts
class ErrorHandler {
  static handleRenderError(error: Error): void {
    console.error('[Render Error]', error);
    // Could add Sentry integration here
  }

  static handlePhysicsError(error: Error): void {
    console.error('[Physics Error]', error);
  }
}
```

**Benefits:**
- Consistent error handling
- Easier to add error reporting/telemetry
- Better debugging

**Risk Level:** 🟢 Low

## When to Refactor

**Good Times:**
- Before adding major new features
- When adding comprehensive test suite
- When multiple people start contributing
- When performance optimization is needed

**Bad Times:**
- Right before a release
- When under time pressure
- Without adequate testing infrastructure

## Testing Strategy

Before major refactoring:
1. Add integration tests for key flows:
   - Cave generation
   - Vertex optimization pipeline
   - Physics simulation
   - Remesh behavior
2. Add performance benchmarks
3. Consider visual regression testing

## Summary

The codebase is currently functional and well-structured. The main refactoring opportunity is breaking down main.ts into smaller, more focused classes. However, this should be done carefully with proper testing to avoid introducing bugs.

**Recommended Priority:**
1. ✅ Type safety (DONE)
2. ✅ Code duplication (DONE)
3. ✅ Dead code removal (DONE)
4. 🔄 Add tests (before refactoring main.ts)
5. 🔄 Extract VertexOptimizationPipeline
6. 🔄 Extract RemeshManager
7. 🔄 Extract AppLifecycle
8. 🔄 Configuration management
9. 🔄 Error handling improvements
