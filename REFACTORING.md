# Refactoring Recommendations

This document outlines potential refactoring opportunities for future work.

## Completed Refactoring

✅ **Type Safety** (Completed - 2025-11-09)
- Removed all `any` types (except intentional ones in console interception)
- Added proper type definitions (BallRenderData, DensityField references, Camera)
- Better IDE autocomplete and type checking

✅ **Code Duplication** (Completed - 2025-11-09)
- Consolidated Point interface into types.ts
- Unified imports across 4 modules

✅ **Dead Code Removal** (Completed - 2025-11-09)
- Removed unused Matter.js legacy code (drawPhysicsBodies, drawBodyPart)
- Removed unused @types/matter-js dependency

✅ **Major Class Extraction** (Completed - 2025-11-09)
- **VertexOptimizationPipeline**: Extracted 150 lines of optimization logic
- **RemeshManager**: Extracted 80 lines of remeshing logic
- **VersionChecker**: Extracted 50 lines of version checking logic
- **main.ts**: Reduced from 908 → 629 lines (-30.7%)
- See `REFACTORING_SUMMARY.md` for full details

## Pending Refactoring Opportunities

### 1. Large main.ts (Priority: ~~Medium~~ ✅ **COMPLETED**)

**Original State:**
- 908 lines
- 34 methods
- Handled: initialization, remesh logic, vertex optimization pipeline, UI, physics integration

**✅ Completed Extractions:**

#### A. ✅ Extracted `VertexOptimizationPipeline` class (2025-11-09)
- Location: `src/VertexOptimizationPipeline.ts` (136 lines)
- Extracted ~150 lines from fullHeal() method
- Handles: cleanLoop, simplification, Chaikin, ISO-snapping
- Returns structured OptimizationResult with statistics

#### B. ✅ Extracted `RemeshManager` class (2025-11-09)
- Location: `src/RemeshManager.ts` (213 lines)
- Extracted ~80 lines of remeshing logic
- Manages: fullHeal(), incrementalUpdate(), isRockLoop()
- Integrates with physics, renderer, and optimization pipeline

#### C. ✅ Extracted `VersionChecker` utility (2025-11-09)
- Location: `src/VersionChecker.ts` (124 lines)
- Extracted ~50 lines of version checking logic
- Handles: polling, update detection, cache clearing

#### D. ✅ Simplified main.ts structure
- **New size**: 629 lines (down from 908)
- **Reduction**: -279 lines (-30.7%)
- **Methods**: ~15 (down from ~34)
- Focus: Application lifecycle and UI coordination only

**Impact:**
- ✅ Main file reduced from 908 → 629 lines
- ✅ Better testability (each class can be unit tested)
- ✅ Clearer responsibilities
- ✅ Easier onboarding for new contributors

**Remaining Opportunity:**

#### E. Extract `AppLifecycle` class (Future Work)
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
**Potential Benefits:**
- Further reduce main.ts by ~100 lines
- Separate lifecycle concerns
- Make initialization flow more explicit

**Current Status:** Not prioritized
- main.ts is now manageable at 629 lines
- Can extract later if needed

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
1. ✅ Type safety (DONE - 2025-11-09)
2. ✅ Code duplication (DONE - 2025-11-09)
3. ✅ Dead code removal (DONE - 2025-11-09)
4. ✅ Extract VertexOptimizationPipeline (DONE - 2025-11-09)
5. ✅ Extract RemeshManager (DONE - 2025-11-09)
6. ✅ Extract VersionChecker (DONE - 2025-11-09)
7. 🔄 Add tests (recommended before further refactoring)
8. 🔄 Extract AppLifecycle (optional, low priority)
9. 🔄 Configuration management
10. 🔄 Error handling improvements

**Status**: Major refactoring complete! See `REFACTORING_SUMMARY.md` for full details.
