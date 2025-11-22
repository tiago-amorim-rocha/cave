# **📄 Terrain System Overhaul: Canonical → Optimized → Segments (Full Plan)**

This document defines the complete architecture for your optimized, locally-updating, stitch-friendly cave system using:

- **Canonical loops** (raw → cleaned → stable topology truth)
- **Optimized loops** (Chaikin + Visvalingam smoothing with ancestry ranges)
- **Physics segments** (Box2D chain fixtures built from optimized patches)
- **Local update logic** based on canonical index ranges
- **Stable mapping** between canonical and optimized geometry using ancestry propagation

This is the plan Claude Code must implement inside the existing TS PWA cave project.

---

## 1. Concepts & Goals

### 🎯 Goals
- Fast local rebuilds after carving (dirty AABB).
- Avoid rebuilding entire world loops.
- Maintain visually optimized cave boundaries.
- Maintain correct Box2D physics locally.
- Support topology changes (loops split, merge, appear or disappear).
- Keep canonical geometry faithful to marching squares result.
- Safe/stable mapping between canonical and optimized vertices.
- Use optimized geometry directly for Box2D chain fixtures.

### Core Insight

**Canonical = truth. Optimized = smooth view. Segments = Box2D batching.**

Local updates only depend on which canonical indices changed.

---

## 2. High-Level Architecture

```
Marching Squares
    ↓
cleanLoop()                      ← canonical truth
    ↓
CanonicalLoop[]
    ↓
(local operation region extracted)
    ↓
Chaikin smoothing (with ancestry propagation)
    ↓
Visvalingam simplification (post)
    ↓
OptimizedLoop[]
    ↓
Segmenter
    ↓
Physics Segments (Box2D chain fixtures)
    ↓
Canvas Render (optimized vertices)
```

---

## 3. Data Structures

### 3.1 Canonical Vertices & Loops

Canonical = cleaned marching squares output.

```typescript
interface CanonVertex {
  x: number;
  y: number;
}

interface CanonicalLoop {
  id: number;
  vertices: CanonVertex[];        // Cleaned, raw geometry
  aabb: AABB;                     // Cached AABB for fast overlap checks
  version: number;                // Increment when loop is modified
}
```

**Why this form?**
- Clean
- Stable
- Represents real iso-surface exactly
- No smoothing or optimization
- Easy to run Boolean/surgery/marching-squares updates on

---

### 3.2 Optimized Vertices & Loops

Optimized loops carry ancestry information.

```typescript
type CanonIndex = number;

interface OptVertex {
  x: number;
  y: number;
  canonStart: CanonIndex;  // the earliest canonical index it covers
  canonEnd: CanonIndex;    // the latest canonical index it covers
}

interface OptimizedLoop {
  canonicalId: number;
  vertices: OptVertex[];
}
```

**How ancestry is created?**
- Initially: each vertex's `canonStart = canonEnd = i`
- Chaikin: new vertices combine ranges via:
  - `canonStart = min(a.canonStart, b.canonStart)`
  - `canonEnd   = max(a.canonEnd,   b.canonEnd)`
- Post-Visvalingam: surviving vertices keep their ancestry

This yields robust mapping: **Every optimized vertex knows which canonical range it represents.**

---

### 3.3 Physics Segments

Segments are slices of optimized loops for Box2D.

```typescript
interface Segment {
  id: number;
  loopCanonicalId: number;

  optStart: number;         // index in optimized.vertices[]
  optEnd: number;           // index in optimized.vertices[]

  canonicalStart: CanonIndex; // optimized[optStart].canonStart
  canonicalEnd: CanonIndex;   // optimized[optEnd].canonEnd

  fixture: b2Fixture | null;
  aabb: AABB;
}
```

**Segment invariants**
- Consecutive coverage of optimized vertices
- Bound canonical ranges
- Start/end always correspond to optimized vertices carrying ancestry

**Purpose**
- Provide manageable Box2D chain sizes
- Support partial rebuilds when canonical geometry changes

---

## 4. Canonical Processing

### 4.1 From marching squares → raw loops

Already implemented.

### 4.2 cleanLoop(rawLoop)

Run:
- `dedupe()` — remove duplicate consecutive vertices
- `cullTinyEdges(>0.3×gridPitch)` — remove micro jitter
- `ensureCCW()` — standardize loop orientation

This output becomes canonical.

**Why canonical after cleanup?**
- Stabilizes geometry
- Standardizes winding for later Boolean/surgery
- Removes degenerate shapes before ancestry tracking

---

## 5. Optimization Pipeline (on COPY of canonical)

### 5.1 Initialize working vertices with ancestry

```typescript
let working = canonical.vertices.map((v, i) => ({
  x: v.x,
  y: v.y,
  canonStart: i,
  canonEnd: i,
}));
```

---

### 5.2 Chaikin (2 iterations)

Chaikin doubles vertices each pass.

For each pair (a, b):

```typescript
Q = 0.75*a + 0.25*b
Q.canonStart = min(a.canonStart, b.canonStart)
Q.canonEnd   = max(a.canonEnd,   b.canonEnd)

R = 0.25*a + 0.75*b
R.canonStart = same
R.canonEnd   = same
```

Repeat twice.

This maintains correct ancestry across smoothing.

---

### 5.3 Visvalingam (post)

When removing a vertex v:
- Just drop it.

When keeping a vertex v:
- Preserve its `canonStart / canonEnd`.

This step never invents new ancestry ranges.

---

### 5.4 Final optimized loop

After Chaikin + post-Visvalingam:

```typescript
const optimized: OptVertex[] = workingAfterSimplifiers;
```

This is used for rendering and physics.

---

## 6. Segmenting Optimized Vertices for Box2D

**Rules:**
- Max vertices per segment (e.g., 64)
- Max world-length per segment (optional)
- Segments must align to optimized vertex indices

**Build:**

```typescript
segments = [];
start = 0;

while (start < optimized.length - 1) {
  end = advance until reach MAX_VERTS or MAX_LENGTH
  create segment:
    optStart = start
    optEnd   = end
    canonicalStart = optimized[start].canonStart
    canonicalEnd   = optimized[end].canonEnd
  segments.push(segment)
  start = end;
}
```

**Segments can change size after stitching**
- Rebuilt only for changed canonical ranges
- Kept stable elsewhere

---

## 7. Box2D Fixture Creation

For each segment:

```typescript
const verts = optimized.slice(optStart, optEnd + 1);

const chain = new b2ChainShape();
chain.CreateChain(verts.map(v => new b2Vec2(v.x, v.y)));

segment.fixture = terrainBody.CreateFixture(chain, 0);
```

Fixtures are rebuilt only when segments overlap dirty canonical indices.

---

## 8. Local Update After Carve (Dirty AABB)

When carving modifies the scalar field:

### 8.1 Update canonical geometry

1. Identify canonical loops whose AABB intersects the dirty region.
2. Re-run marching squares ONLY in dirty cells.
3. Perform canonical loop surgery:
   - Replace changed span(s)
   - Apply `cleanLoop()` to the new canonical geometry
   - Loop might topologically split or merge
4. Update canonical loop version numbers.

---

### 8.2 Update optimized geometry ONLY for changed canonical spans

For each affected canonical loop:

1. Identify canonical index ranges that changed: `[dirtyStart..dirtyEnd]`
2. Remove optimized vertices whose `canonStart..canonEnd` overlaps that range (drop entire segments, we'll rebuild locally)
3. Extract the updated canonical region
4. Re-run:
   - Chaikin (twice)
   - Visvalingam (post)
   - With ancestry propagation
5. Insert the new optimized chunk back into the optimized loop
6. Re-segment ONLY this local span into Box2D segments

---

### 8.3 Physics update

Destroy fixtures for segments where:

```typescript
segment.canonicalEnd   >= dirtyStart &&
segment.canonicalStart <= dirtyEnd
```

Recreate updated segments (only those).

Everything else stays untouched.

---

## 9. Rendering

Use the final optimized vertices:
- Either:
  - Draw full optimized loop per frame, or
  - Keep chunked offscreen canvases and redraw only dirty AABBs

Canonical vertices never go to rendering.

---

## 10. Topology Changes (Splits & Merges)

Because canonical is the truth:
- A carve can turn 1 loop → 2 loops
- Or 2 → 1
- Or create/delete small loops

This is handled entirely in canonical surgery.

Optimized loops & segments are rebuilt ONLY for loops whose canonical changed.

---

## 11. Guarantees of the System

### Guaranteed Properties:
- Optimized geometry always corresponds to canonical geometry via ancestry ranges.
- Only affected canonical spans force segment rebuild.
- No global re-optimization unless the entire canonical loop changed.
- Box2D chains always match visuals because they use the same optimized vertices.
- Chaikin smoothing never breaks canonical alignment because ancestry binds it.

### Performance:
- Re-optimization is local.
- Segment rebuild is local.
- Canonical updates are local marching squares.
- Huge worlds remain cheap per carve.

---

## 12. Implementation Phases (Testable Incremental Approach)

**Philosophy**: Each phase ships working code integrated into the running app. No "build everything then wire it up" approach. Every phase is testable end-to-end.

---

### Phase 1: Canonical Loops (Read-Only Layer)

**Goal**: Add canonical loops as a parallel layer without affecting existing system

**Tasks:**
1. Create `src/terrain/CanonicalGeometry.ts`:
   - `CanonVertex` interface (`x`, `y`)
   - `CanonicalLoop` interface (`id`, `vertices`, `aabb`, `version`)
   - `allocateLoopId()` helper
   - `computeLoopAABB(vertices)` helper

2. Modify `RemeshManager.fullHeal()`:
   - After `cleanLoop()`, create `CanonicalLoop` objects
   - Store in `this.canonicalLoops: CanonicalLoop[]`
   - **Keep existing optimization/physics unchanged**

3. Add debug visualization in `Renderer.ts`:
   - Toggle to show canonical vertices (red dots, 2px)
   - Toggle to show canonical AABBs (red rectangles)
   - Add to debug console

**Debug Logging:**
```typescript
console.log('[Phase1] Created canonical loops', {
  count: canonicalLoops.length,
  totalVertices: canonicalLoops.reduce((sum, l) => sum + l.vertices.length, 0),
  aabbs: canonicalLoops.map(l => l.aabb)
});
```

**End-to-End Test:**
- ✅ App loads and runs normally
- ✅ Can toggle canonical visualization (red dots)
- ✅ Canonical loops match cleaned marching squares output
- ✅ AABBs correctly contain all vertices
- ✅ Existing rendering and physics unchanged

**Ship It**: Canonical layer exists but doesn't affect anything yet

---

### Phase 2: Ancestry-Aware Chaikin (Replace Existing)

**Goal**: Replace existing Chaikin with ancestry-tracking version

**Tasks:**
1. Add `OptVertex` interface to `CanonicalGeometry.ts`:
   ```typescript
   interface OptVertex {
     x: number;
     y: number;
     canonStart: number;
     canonEnd: number;
   }
   ```

2. Create `src/terrain/ChaikinWithAncestry.ts`:
   - Implement `chaikinWithAncestry(vertices: OptVertex[], iterations)`
   - Propagate ancestry: `Q.canonStart = min(a.canonStart, b.canonStart)`
   - Add assertions: `canonStart <= canonEnd`

3. Modify `ChaikinSmoothing.ts`:
   - **Replace** existing `chaikinSmooth()` implementation
   - Initialize vertices with `canonStart = canonEnd = i`
   - Use ancestry-aware version
   - Return `OptVertex[]` instead of `Point[]`

4. Update `VertexOptimizationPipeline.ts`:
   - Accept `OptVertex[]` from Chaikin
   - Pass through to Visvalingam (ignore ancestry for now)
   - Convert back to `Point[]` for physics

**Debug Logging:**
```typescript
console.log('[Chaikin] Iteration ${i}', {
  before: vertices.length,
  after: result.length,
  sampleAncestry: result.slice(0, 5).map(v => [v.canonStart, v.canonEnd])
});
```

**Visual Debug:**
- Color-code optimized vertices by ancestry range (hue based on `(canonStart + canonEnd) / 2`)
- Draw ancestry range as text on hover

**End-to-End Test:**
- ✅ App still works identically
- ✅ Terrain looks the same (Chaikin behavior unchanged)
- ✅ Every `OptVertex` has valid `canonStart <= canonEnd`
- ✅ Ancestry ranges never shrink across iterations
- ✅ Can visualize ancestry coloring

**Ship It**: Chaikin now tracks ancestry (but nothing uses it yet)

---

### Phase 3: Ancestry-Aware Visvalingam (Preserve Ancestry)

**Goal**: Modify Visvalingam to preserve ancestry through simplification

**Tasks:**
1. Modify `PolylineSimplifier.ts`:
   - Accept `OptVertex[]` (check if vertex has `canonStart/End`)
   - When removing vertex: just skip it
   - When keeping vertex: preserve ancestry unchanged
   - Return `OptVertex[]` if input had ancestry

2. Update `VertexOptimizationPipeline.ts`:
   - Pass `OptVertex[]` through Visvalingam
   - Store final `OptVertex[]` for later use
   - Still convert to `Point[]` for physics (Phase 4 will fix this)

**Debug Logging:**
```typescript
console.log('[Visvalingam] Simplification', {
  before: vertices.length,
  after: result.length,
  reduction: ((before - after) / before * 100).toFixed(1) + '%',
  ancestryPreserved: result.every(v => v.canonStart !== undefined)
});
```

**End-to-End Test:**
- ✅ App still works identically
- ✅ Terrain looks the same
- ✅ All kept vertices have unchanged ancestry
- ✅ No new ancestry ranges created
- ✅ Coverage check passes (all canonical indices covered)

**Ship It**: Full optimization pipeline now has end-to-end ancestry

---

### Phase 4: Physics Segments with Canonical Ranges

**Goal**: Add canonical range tracking to physics segments

**Tasks:**
1. Add `PhysicsSegment` interface to `CanonicalGeometry.ts`:
   ```typescript
   interface PhysicsSegment {
     id: number;
     loopCanonicalId: number;
     optStart: number;
     optEnd: number;
     canonicalStart: number;
     canonicalEnd: number;
     fixture: b2Fixture | null;
     aabb: AABB;
   }
   ```

2. Modify `Box2DEngine.ts`:
   - When building segments, compute canonical ranges:
     - `canonicalStart = optimized[optStart].canonStart`
     - `canonicalEnd = optimized[optEnd].canonEnd`
   - Store `PhysicsSegment[]` instead of just fixtures
   - Add helper: `getSegmentsForLoop(loopId)`

3. Add segment debug visualization:
   - Draw segment boundaries as yellow markers
   - Show canonical range on hover
   - Toggle in debug console

**Debug Logging:**
```typescript
console.log('[Box2D] Created segments', {
  loopId: loop.id,
  segmentCount: segments.length,
  segments: segments.map(s => ({
    id: s.id,
    optRange: [s.optStart, s.optEnd],
    canonRange: [s.canonicalStart, s.canonicalEnd]
  }))
});
```

**End-to-End Test:**
- ✅ App still works identically
- ✅ Physics unchanged
- ✅ Segments have valid canonical ranges
- ✅ Can visualize segment canonical ranges
- ✅ Segments cover entire optimized loop (no gaps)

**Ship It**: Physics segments now know their canonical ancestry

---

### Phase 5: Canonical Surgery (Unit Tested, Not Integrated Yet)

**Goal**: Implement canonical loop surgery without integrating into carving yet

**Tasks:**
1. Add methods to `CanonicalGeometry.ts`:
   ```typescript
   function replaceCanonicalRange(
     loop: CanonicalLoop,
     startIdx: number,
     endIdx: number,
     newVertices: CanonVertex[]
   ): CanonicalLoop[]
   ```
   - Splice in new vertices
   - Re-run `cleanLoop()`
   - Recompute AABB
   - Increment `version`
   - Return array (handles split/merge)

2. Write unit tests (or manual test function):
   - Test simple replacement (same topology)
   - Test loop split (1 → 2)
   - Test loop merge (2 → 1)
   - Test edge cases (empty range, full loop, etc.)

**Debug Logging:**
```typescript
console.log('[CanonSurgery] Replacing range', {
  loopId: loop.id,
  oldRange: [startIdx, endIdx],
  newVerts: newVertices.length,
  resultLoops: resultLoops.length,
  topologyChange: resultLoops.length !== 1
});
```

**End-to-End Test:**
- ✅ Surgery function exists and is tested
- ✅ Handle topology changes correctly
- ✅ AABBs updated correctly
- ✅ Versions incremented
- ⚠️ **Not called by carving yet** (Phase 6 will integrate)

**Ship It**: Surgery logic is tested but not used yet

---

### Phase 6: Local Update - Canonical Layer Only

**Goal**: Update canonical loops locally when carving, but fallback to full rebuild for optimized/physics

**Tasks:**
1. Modify `RemeshManager.localUpdate()`:
   ```typescript
   a. Get dirty AABB from density field
   b. Find affected canonical loops (AABB intersection)
   c. Run marching squares in dirty region
   d. Perform canonical surgery on affected loops
   e. **FALLBACK**: Do full rebuild for optimized/physics
   ```

2. Add method: `findAffectedCanonicalLoops(dirtyAABB)`

3. Add method: `matchNewLoopsToOld(oldLoops, newLoops, dirtyAABB)`
   - Match by overlap/proximity
   - Handle topology changes

**Debug Logging:**
```typescript
console.log('[LocalUpdate] Canonical surgery', {
  dirtyAABB,
  affectedLoops: affectedCanonical.length,
  surgeryResults: results.map(r => ({
    oldLoopId: r.oldId,
    newLoopCount: r.newLoops.length
  })),
  fallbackToFullRebuild: true  // For optimized/physics
});
```

**Visual Debug:**
- Highlight affected canonical loops in bright red
- Show dirty AABB pulsing
- Animate surgery (old vertices fade out, new fade in)

**End-to-End Test:**
- ✅ Carving updates canonical loops locally
- ✅ Canonical visualization shows local update
- ✅ App still works (falls back to full rebuild for physics)
- ✅ Terrain matches (full rebuild ensures correctness)
- ✅ Performance not improved yet (expected)

**Ship It**: Canonical layer updates locally, rest falls back

---

### Phase 7: Local Update - Optimized Layer

**Goal**: Update optimized geometry locally, still full rebuild physics

**Tasks:**
1. Add method: `findAffectedOptVertices(optimized, dirtyStart, dirtyEnd)`:
   ```typescript
   // Find opt vertices whose canonStart..canonEnd overlaps [dirtyStart, dirtyEnd]
   return { removeStart, removeEnd };
   ```

2. Add method: `rebuildOptimizedRange(canonical, dirtyStart, dirtyEnd)`:
   - Extract canonical slice
   - Run Chaikin + Visvalingam with ancestry
   - Return new `OptVertex[]`

3. Add method: `stitchOptimizedRange(optimized, removeStart, removeEnd, newOptVerts)`:
   - Remove affected range
   - Insert new optimized vertices
   - Verify no gaps

4. Modify `RemeshManager.localUpdate()`:
   - After canonical surgery, rebuild affected optimized ranges
   - **Still do full physics rebuild** (Phase 8 will fix this)

**Debug Logging:**
```typescript
console.log('[LocalOptRebuild] Rebuilding range', {
  canonRange: [dirtyStart, dirtyEnd],
  removedOptVerts: removeEnd - removeStart + 1,
  newOptVerts: newOptVerts.length,
  ancestryCoverage: checkCoverage(stitched, canonical.length)
});
```

**Visual Debug:**
- Show removed opt vertices (red, fading)
- Show new opt vertices (green, fading)
- Highlight stitch boundaries (yellow circles)

**End-to-End Test:**
- ✅ Carving updates optimized geometry locally
- ✅ No gaps at stitch boundaries
- ✅ Ancestry coverage complete
- ✅ Geometry looks smooth
- ✅ App still works (physics full rebuild ensures correctness)

**Ship It**: Two-layer local update (canonical + optimized)

---

### Phase 8: Local Update - Physics Segments (Complete!)

**Goal**: Update physics segments locally - **full local update working**

**Tasks:**
1. Add method: `findAffectedSegments(segments, dirtyStart, dirtyEnd)`:
   ```typescript
   return segments.filter(s =>
     s.canonicalEnd >= dirtyStart &&
     s.canonicalStart <= dirtyEnd
   );
   ```

2. Add method: `rebuildSegmentsForRange(optimized, affectedOptStart, affectedOptEnd)`:
   - Re-segment only the affected optimized range
   - Return new `PhysicsSegment[]`

3. Modify `Box2DEngine.ts`:
   - Add `destroySegments(segments[])`
   - Add `createSegmentsForRange(optimized, startIdx, endIdx)`

4. Modify `RemeshManager.localUpdate()`:
   - After optimized rebuild, find affected segments
   - Destroy old fixtures
   - Create new fixtures
   - **No more full rebuild!**

**Debug Logging:**
```typescript
console.log('[SegmentRebuild] Local physics update', {
  canonRange: [dirtyStart, dirtyEnd],
  affectedSegments: affectedSegs.length,
  destroyedFixtures: affectedSegs.length,
  newSegments: newSegs.length,
  createdFixtures: newSegs.length
});
```

**Visual Debug:**
- Flash destroyed segments (red)
- Flash new segments (green)
- Show segment boundaries updating

**End-to-End Test:**
- ✅ Carving updates all three layers locally
- ✅ Only dirty region rebuilt (not entire world)
- ✅ Physics works correctly (no leaks)
- ✅ Terrain matches exactly
- ✅ **Performance improvement visible!**

**Ship It**: 🎉 **FULL LOCAL UPDATE WORKING!** 🎉

---

### Phase 9: Error Handling & Edge Cases

**Goal**: Make local updates robust and production-ready

**Tasks:**
1. Add defensive checks:
   - Canonical loop < 3 vertices → delete
   - Invalid ancestry → error + full rebuild
   - Topology change too complex → full rebuild
   - Coverage gaps detected → full rebuild

2. Add fallback logic:
   ```typescript
   try {
     return localUpdate();
   } catch (err) {
     console.error('[LocalUpdate] Failed, falling back', err);
     return fullHeal();
   }
   ```

3. Add validation helpers:
   - `validateAncestry(optVerts, canonicalCount)`
   - `validateCoverage(optVerts, canonicalCount)`
   - `validateTopology(loop)`

**Debug Logging:**
```typescript
console.error('[LocalUpdate] Fallback to full rebuild', {
  reason: err.message,
  loopId: loop.id,
  dirtyRange: [dirtyStart, dirtyEnd],
  stack: err.stack
});
```

**End-to-End Test:**
- ✅ Rapid carving doesn't crash
- ✅ Complex topology changes handled
- ✅ Fallback always produces valid geometry
- ✅ Errors logged with context

**Ship It**: Local updates are robust and production-ready

---

### Phase 10: Performance Optimization & Polish

**Goal**: Hit performance targets and polish UX

**Tasks:**
1. Add performance logging:
   - Track time per phase (canonical, optimized, physics)
   - Track memory usage
   - Log statistics

2. Optimize hot paths:
   - Cache AABB intersection results
   - Use spatial hash for segment lookups
   - Lazy recompute AABBs

3. Add debug console enhancements:
   - Performance stats panel
   - Vertex count comparison (local vs full)
   - Memory usage chart

**Performance Targets:**
- Full world rebuild: < 50ms (baseline)
- Local update: < 10ms (10x improvement) ✅
- Memory: stable across 100+ carves ✅

**Debug Logging:**
```typescript
console.log('[LocalUpdate] Performance', {
  totalMs: performance.now() - t0,
  breakdown: {
    canonical: canonMs,
    optimized: optMs,
    physics: physicsMs
  },
  vertsCost: {
    fullRebuild: totalCanonicalVerts,
    localRebuild: rebuiltVerts,
    savings: (1 - rebuiltVerts / totalCanonicalVerts) * 100 + '%'
  }
});
```

**End-to-End Test:**
- ✅ Local update < 10ms for small carves
- ✅ Memory stable (profile 100 carves)
- ✅ Debug console shows performance gains

**Ship It**: 🚀 **Production-ready local updates!** 🚀

---

## 13. Debug Console Integration

Add debug panel buttons:
- **Toggle Canonical**: Show/hide canonical vertices (red)
- **Toggle Optimized**: Show/hide optimized vertices (blue)
- **Toggle Ancestry**: Show ancestry ranges on hover
- **Toggle Segments**: Show segment boundaries & AABBs
- **Toggle Dirty Region**: Show last dirty AABB
- **Highlight Loop**: Click to select and highlight a specific loop
- **Stats Panel**: Show vertex counts, segment counts, coverage %

Add debug keyboard shortcuts:
- `C`: Toggle canonical view
- `O`: Toggle optimized view
- `A`: Toggle ancestry visualization
- `S`: Toggle segment boundaries
- `D`: Toggle dirty region

---

## 14. Performance Benchmarks

Track and log:
- Time to create canonical loops
- Time to optimize (Chaikin + Visvalingam)
- Time to segment
- Time to create physics fixtures
- Time for local update (total)
- Memory usage before/after

Target metrics:
- Full world rebuild: < 50ms (current baseline)
- Local update: < 10ms (10x improvement)
- Memory: stable across 100+ carves

---

**End of Plan**
