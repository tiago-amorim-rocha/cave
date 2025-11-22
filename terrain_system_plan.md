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

## 12. Implementation Phases (Step-by-Step with Debug & Verification)

### Phase 1: Data Structures & Types

**Tasks:**
1. Create new file `src/terrain/CanonicalGeometry.ts`:
   - `CanonVertex` interface
   - `CanonicalLoop` interface (with `id`, `vertices`, `aabb`, `version`)
   - `OptVertex` interface (with `canonStart`, `canonEnd`)
   - `OptimizedLoop` interface
   - `PhysicsSegment` interface (with `canonicalStart`, `canonicalEnd`)

2. Add ID allocation helpers:
   - `allocateLoopId()`
   - `allocateVertexId()` (for debugging)
   - `allocateSegmentId()`

**Debug Logging:**
```typescript
console.log('[CanonicalGeometry] Created loop', {
  id: loop.id,
  vertices: loop.vertices.length,
  aabb: loop.aabb,
  version: loop.version
});
```

**Verification:**
- Types compile without errors
- IDs are unique and monotonic
- AABBs computed correctly

---

### Phase 2: Canonical Loop Creation (No Optimization Yet)

**Tasks:**
1. Modify `RemeshManager.fullHeal()`:
   - After `cleanLoop()`, create `CanonicalLoop` objects
   - Store in `this.canonicalLoops: CanonicalLoop[]`
   - Log vertex counts before/after cleanup

2. Keep existing optimization pipeline unchanged for now
   - Still use `VertexOptimizationPipeline`
   - Still create physics bodies the old way
   - This is a **safe transition** - system still works

**Debug Logging:**
```typescript
console.log('[Phase2] Created canonical loops', {
  count: canonicalLoops.length,
  totalVertices: canonicalLoops.reduce((sum, l) => sum + l.vertices.length, 0),
  aabbs: canonicalLoops.map(l => l.aabb)
});
```

**Visual Debug:**
- Add debug rendering mode: draw canonical vertices as small red dots
- Draw canonical AABBs as red rectangles
- Toggle with debug console

**Verification:**
- Canonical loops match cleaned marching squares output
- AABBs contain all vertices
- Version numbers initialized to 0
- App still renders and physics work (unchanged)

---

### Phase 3: Ancestry-Aware Chaikin

**Tasks:**
1. Create `src/terrain/ChaikinWithAncestry.ts`:
   ```typescript
   function chaikinWithAncestry(
     vertices: OptVertex[],
     iterations: number = 2
   ): OptVertex[]
   ```

2. Implement ancestry propagation:
   - For each pair `(a, b)`, create Q and R
   - `Q.canonStart = min(a.canonStart, b.canonStart)`
   - `Q.canonEnd = max(a.canonEnd, b.canonEnd)`
   - Same for R

3. Add detailed logging per iteration:
   ```typescript
   console.log('[Chaikin] Iteration ${i}', {
     before: vertices.length,
     after: result.length,
     ancestryRanges: result.map(v => [v.canonStart, v.canonEnd])
   });
   ```

**Visual Debug:**
- Color-code optimized vertices by ancestry range
- Hue based on `(canonStart + canonEnd) / 2`
- Draw ancestry range as text label on hover

**Verification:**
- After 2 iterations, vertex count = `original * 4` (roughly)
- Every `OptVertex` has valid `canonStart <= canonEnd`
- Ancestry ranges never shrink (only expand or stay same)
- No gaps in canonical coverage (union of all ranges = [0, N-1])

**Error Detection:**
- Assert `canonStart <= canonEnd` after each vertex creation
- Assert no vertex has `canonStart < 0` or `canonEnd >= canonical.length`

---

### Phase 4: Ancestry-Aware Visvalingam

**Tasks:**
1. Modify `PolylineSimplifier.ts`:
   - Accept `OptVertex[]` instead of `Point[]`
   - When removing vertex, just skip it
   - When keeping vertex, preserve `canonStart/canonEnd`

2. Add logging:
   ```typescript
   console.log('[Visvalingam] Simplification', {
     before: vertices.length,
     after: result.length,
     reduction: ((before - after) / before * 100).toFixed(1) + '%',
     preservedRanges: result.map(v => [v.canonStart, v.canonEnd])
   });
   ```

**Verification:**
- Vertex count reduced (as expected)
- All kept vertices have unchanged ancestry
- No new ancestry ranges created
- Geometry still looks smooth

---

### Phase 5: Full Optimization Pipeline with Ancestry

**Tasks:**
1. Create `src/terrain/OptimizationPipelineWithAncestry.ts`:
   ```typescript
   function optimizeWithAncestry(
     canonical: CanonicalLoop,
     options: OptimizationOptions
   ): OptimizedLoop
   ```

2. Pipeline steps:
   a. Initialize working vertices with ancestry
   b. Run Chaikin (2 iterations) with ancestry
   c. Run Visvalingam with ancestry
   d. Return `OptimizedLoop`

3. Add comprehensive logging:
   ```typescript
   console.log('[OptPipeline] Full optimization', {
     canonicalId: canonical.id,
     canonicalVerts: canonical.vertices.length,
     afterChaikin: chaikinResult.length,
     afterVisvalingam: optimized.vertices.length,
     ancestryCoverage: computeCoverage(optimized.vertices, canonical.vertices.length)
   });
   ```

**Visual Debug:**
- Draw canonical loop in red (raw)
- Draw optimized loop in blue (smooth)
- On hover, show ancestry range for each optimized vertex
- Highlight which canonical vertices are covered

**Verification:**
- Every canonical index [0, N-1] is covered by at least one optimized vertex
- No canonical index is "orphaned"
- Optimized loop is visually smoother than canonical
- Vertex reduction is reasonable (not too aggressive)

**Helper for Coverage Check:**
```typescript
function computeCoverage(optimized: OptVertex[], canonicalCount: number): boolean[] {
  const covered = new Array(canonicalCount).fill(false);
  for (const v of optimized) {
    for (let i = v.canonStart; i <= v.canonEnd; i++) {
      covered[i] = true;
    }
  }
  return covered;
}
```

---

### Phase 6: Segmentation with Canonical Ranges

**Tasks:**
1. Create `src/terrain/Segmenter.ts`:
   ```typescript
   function segmentOptimizedLoop(
     optimized: OptimizedLoop,
     maxVerts: number = 64
   ): PhysicsSegment[]
   ```

2. Build segments with ancestry:
   - Track `optStart`, `optEnd`
   - Compute `canonicalStart = optimized[optStart].canonStart`
   - Compute `canonicalEnd = optimized[optEnd].canonEnd`
   - Compute segment AABB

3. Add logging:
   ```typescript
   console.log('[Segmenter] Created segments', {
     loopId: optimized.canonicalId,
     segmentCount: segments.length,
     segments: segments.map(s => ({
       id: s.id,
       optRange: [s.optStart, s.optEnd],
       canonRange: [s.canonicalStart, s.canonicalEnd],
       aabb: s.aabb
     }))
   });
   ```

**Visual Debug:**
- Draw segment boundaries as yellow markers
- Draw segment AABBs as dashed yellow rectangles
- On hover, show canonical range covered by segment

**Verification:**
- Segments cover entire optimized loop (no gaps)
- Each segment's canonical range is valid
- Segment AABBs are correct
- No segment exceeds `maxVerts`

---

### Phase 7: Box2D Integration (Using Optimized Geometry)

**Tasks:**
1. Modify `Box2DEngine.ts`:
   - Accept `OptimizedLoop[]` instead of raw `Point[][]`
   - Build segments from optimized vertices
   - Create chain fixtures from segment vertex ranges
   - Store `PhysicsSegment[]` with `canonicalStart/canonicalEnd`

2. Add logging:
   ```typescript
   console.log('[Box2D] Created terrain bodies', {
     loopCount: optimizedLoops.length,
     totalSegments: segments.length,
     fixturesCreated: segments.filter(s => s.fixture !== null).length
   });
   ```

**Verification:**
- Physics still works correctly
- Player doesn't fall through terrain
- Collisions are accurate
- No visual/physics mismatch

---

### Phase 8: Local Update - Canonical Surgery

**Tasks:**
1. Implement `CanonicalLoop.replaceRange(startIdx, endIdx, newVertices)`:
   - Replace vertices in range with new ones
   - Re-run `cleanLoop()` on spliced result
   - Increment `version` number
   - Update AABB

2. Handle topology changes:
   - If new loop closes differently → split/merge detection
   - Return `CanonicalLoop[]` (might be 0, 1, or 2+ loops)

3. Add extensive logging:
   ```typescript
   console.log('[CanonSurgery] Replacing range', {
     loopId: loop.id,
     oldRange: [startIdx, endIdx],
     oldVerts: endIdx - startIdx + 1,
     newVerts: newVertices.length,
     oldVersion: loop.version,
     newVersion: loop.version + 1,
     topologyChange: resultLoops.length !== 1
   });
   ```

**Visual Debug:**
- Highlight dirty canonical range in bright red
- Show old vertices being removed in gray
- Show new vertices being inserted in green
- Animate the surgery (optional)

**Verification:**
- Loop still closed after surgery
- Winding order preserved (CCW)
- AABB updated correctly
- Version incremented

---

### Phase 9: Local Update - Optimized Rebuild

**Tasks:**
1. Implement overlap detection:
   ```typescript
   function findAffectedOptVertices(
     optimized: OptVertex[],
     dirtyStart: number,
     dirtyEnd: number
   ): { removeStart: number; removeEnd: number }
   ```

2. Remove affected optimized vertices

3. Re-optimize only the dirty canonical range:
   - Extract canonical slice `[dirtyStart..dirtyEnd]`
   - Run Chaikin + Visvalingam with ancestry
   - Stitch back into optimized loop

4. Add detailed logging:
   ```typescript
   console.log('[LocalOptRebuild] Rebuilding optimized range', {
     canonicalRange: [dirtyStart, dirtyEnd],
     removedOptVerts: removeEnd - removeStart + 1,
     newOptVerts: newOptimized.length,
     stitchPoints: [optimized[removeStart - 1], optimized[removeEnd + 1]]
   });
   ```

**Visual Debug:**
- Draw removed optimized vertices in red (fading out)
- Draw new optimized vertices in green (fading in)
- Highlight stitch boundaries with yellow circles
- Show before/after side-by-side

**Verification:**
- Optimized loop still closed
- No gaps at stitch boundaries
- Ancestry coverage still complete
- Geometry looks smooth

**Error Detection:**
- Assert no gaps in optimized vertex array
- Assert ancestry ranges still cover all canonical indices
- Assert stitched loop has correct vertex count

---

### Phase 10: Local Update - Segment Rebuild

**Tasks:**
1. Identify affected segments:
   ```typescript
   function findAffectedSegments(
     segments: PhysicsSegment[],
     dirtyStart: number,
     dirtyEnd: number
   ): PhysicsSegment[]
   ```
   - Check if `segment.canonicalEnd >= dirtyStart && segment.canonicalStart <= dirtyEnd`

2. Destroy affected fixtures

3. Re-segment the modified optimized loop region

4. Create new fixtures

5. Add logging:
   ```typescript
   console.log('[SegmentRebuild] Updating segments', {
     canonicalRange: [dirtyStart, dirtyEnd],
     affectedCount: affectedSegments.length,
     destroyedFixtures: affectedSegments.length,
     newSegments: newSegments.length,
     createdFixtures: newSegments.filter(s => s.fixture !== null).length
   });
   ```

**Visual Debug:**
- Draw destroyed segments in red (fading out)
- Draw new segments in green (fading in)
- Flash segment boundaries briefly

**Verification:**
- Physics still works after rebuild
- No duplicate fixtures
- All optimized vertices have corresponding physics
- Player collision still accurate

---

### Phase 11: End-to-End Local Update

**Tasks:**
1. Wire up full local update flow in `RemeshManager.localUpdate()`:
   ```typescript
   a. Get dirty AABB from density field
   b. Find affected canonical loops
   c. Run marching squares in dirty region
   d. Perform canonical surgery
   e. Rebuild affected optimized ranges
   f. Rebuild affected segments
   g. Update physics fixtures
   ```

2. Add high-level logging:
   ```typescript
   console.log('[LocalUpdate] Complete', {
     dirtyAABB,
     affectedLoops: affectedCanonical.length,
     totalCanonicalVerts: affectedCanonical.reduce(...),
     totalOptVertsRebuilt: ...,
     totalSegmentsRebuilt: ...,
     durationMs: performance.now() - t0
   });
   ```

**Visual Debug:**
- Draw dirty AABB as pulsing red rectangle
- Show affected canonical loops highlighted
- Animate the rebuild process
- Show performance stats overlay

**Verification:**
- After carving, terrain updates correctly
- Only dirty region is rebuilt (not entire world)
- Physics matches visuals exactly
- No performance regression
- Memory usage stable (no leaks)

---

### Phase 12: Error Handling & Edge Cases

**Tasks:**
1. Add defensive checks:
   - Canonical loop becomes invalid (< 3 vertices) → delete
   - Optimized vertex has invalid ancestry → error + fallback
   - Segment has no fixture → warning + skip
   - Dirty range exceeds loop bounds → clamp + warn

2. Fallback to full rebuild if:
   - Topology change too complex
   - Ancestry coverage broken
   - Stitching produces invalid geometry

3. Add error logging:
   ```typescript
   console.error('[LocalUpdate] Fallback to full rebuild', {
     reason: 'topology split detected',
     loopId: loop.id,
     dirtyRange: [dirtyStart, dirtyEnd]
   });
   ```

**Verification:**
- App never crashes on edge cases
- Fallback always produces valid geometry
- Errors are logged with enough context for debugging

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
