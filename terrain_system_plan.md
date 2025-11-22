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

## 12. What Claude Code Must Implement Next

**Step 1:** Introduce canonical + optimized vertex/loop types

**Step 2:** Modify existing pipeline to:
- Capture cleaned marching squares output as canonical
- Create an optimized copy with ancestry
- Run Chaikin twice with ancestry propagation
- Run Visvalingam post, preserving ancestry

**Step 3:** Implement segmentation with ancestry-based `canonicalStart/canonicalEnd`

**Step 4:** Implement local update logic:
- canonical surgery
- local optimized rebuild
- local segment rebuild

**Step 5:** Ensure Box2D fixture rebuild is based on canonical index ranges

**Step 6:** Ensure render loop uses optimized vertices

---

**End of Plan**
