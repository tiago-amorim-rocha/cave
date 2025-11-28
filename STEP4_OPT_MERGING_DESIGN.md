# Step 4: Opt-Space Merging Design

## Overview

**Step 4** transforms the stitched loop (which is in canonical/marching-squares space) into the final optimized vertex array for physics simulation.

This document provides a complete conceptual design for Step 4, including data structures, algorithms, and implementation strategies.

## Context

### Pipeline Flow
1. **Step 1**: Marching Squares extracts new geometry from carved region
2. **Step 2**: Stitching combines new loops with boundary arcs into closed loops
3. **Step 3**: Classifies stitched loops into warm/cold segments (✓ COMPLETE)
4. **Step 4**: Merges segments in opt-space (THIS DOCUMENT)
5. **Step 5**: Updates physics colliders (future)

### Key Concepts

- **Warm segments**: New geometry from marching squares (needs optimization)
- **Cold segments**: Reused boundary arcs from existing canonical loops (already optimized)
- **Stitched space**: Canonical-space vertices after stitching (Step 2 output)
- **Opt space**: Optimized vertices ready for physics (Step 4 output)
- **Anchors**: Shared boundary points where warm and cold segments join

## 1. Purpose & Scope

**Step 4 Purpose**: Transform the segmented stitched loop into a final optimized vertex array by:
1. Reusing opt-space vertices from cold segments (already optimized canonical geometry)
2. Generating opt-space vertices for warm segments (newly carved geometry)
3. Ensuring exact joins at all warm/cold boundaries via shared anchor points

**Scope**: Pure geometry merging. No physics, no colliders. Input is segmented stitched loop, output is merged opt vertices.

## 2. Data Structures

### Input to Step 4

```typescript
interface Step4Input {
  // The complete stitched loop from Step 2
  stitchedLoop: StitchedLoop // contains vertices + segments with ancestry

  // Access to original canonical loops for cold segment lookups
  canonicalLoopsMap: Map<LoopId, CanonicalLoop>

  // The dirty region AABB (for determining warm vs cold)
  dirtyRegion: AABB

  // Optimization pipeline configuration
  optimizationOptions: OptimizationOptions
}
```

### Existing Types (from TerrainSurgery.ts)

```typescript
export interface StitchedLoop {
  id: number
  vertices: Point[]  // Stitched canonical-space vertices

  // Each segment describes a contiguous range in the stitched loop
  segments: SegmentAncestry[]
}

export interface SegmentAncestry {
  sourceLoopId: number
  isNew: boolean  // true = warm (marching squares), false = cold (boundary arc)
  sourceCanonicalId?: number  // For cold: which canonical loop
  canonicalEndpointIds?: [number, number]  // For cold: vertex IDs in canonical
  vertexRange: [number, number]  // Indices in stitched loop (inclusive)
  originalVertices: Point[]  // Original vertices from CarvedLoop
}
```

### Existing Types (from CanonicalGeometry.ts)

```typescript
interface OptVertex {
  x: number
  y: number
  canonStartId: VertexId  // First canonical vertex this opt vertex represents
  canonEndId: VertexId   // Last canonical vertex this opt vertex represents
}

interface CanonicalLoop {
  id: LoopId
  vertices: CanonicalVertex[]
  optVertices?: OptVertex[]  // Cached optimized vertices
  // ... other fields
}
```

### Output from Step 4

```typescript
interface Step4Output {
  // The final merged optimized loop ready for physics
  optVertices: OptVertex[]

  // Debug metadata
  debugInfo?: {
    segmentBoundaries: number[]  // Opt indices where segments join
    anchorCount: number
  }
}
```

### Internal Working Structures

```typescript
interface Anchor {
  // Position in world space (the authoritative anchor point)
  position: Point

  // Which stitched segment boundary this represents
  stitchedSegmentBoundary: number  // index in segments array

  // Source of truth for this anchor
  source: "cold-opt" | "cold-canonical" | "warm-stitched"

  // For cold anchors: the opt vertex this came from
  optVertex?: OptVertex
}

interface ProcessedSegment {
  kind: "warm" | "cold"
  optVertices: OptVertex[]  // INCLUDES start anchor, EXCLUDES end anchor
  startAnchor: Anchor
  endAnchor: Anchor
}
```

## 3. High-Level Algorithm

```
STEP 4 ALGORITHM: Opt-Space Merging

INPUT: stitchedLoop, canonicalLoopsMap, dirtyRegion, optimizationOptions
OUTPUT: optVertices[]

1. CLASSIFY SEGMENTS (refine SegmentAncestry into warm/cold)
   For each segment in stitchedLoop.segments:
     - If segment.isNew = true → WARM
     - If segment.isNew = false → COLD

2. IDENTIFY ANCHORS
   For each boundary between adjacent segments (n segments = n anchors):
     anchor = computeAnchor(segment[i], segment[i+1])
   Store anchors array

3. PROCESS EACH SEGMENT
   processedSegments = []
   For i = 0 to n-1:
     segment = stitchedLoop.segments[i]
     startAnchor = anchors[i]
     endAnchor = anchors[(i+1) % n]

     IF segment.isNew (WARM):
       optVerts = optimizeWarmSegment(
         segment, stitchedLoop.vertices,
         startAnchor, endAnchor
       )
     ELSE (COLD):
       optVerts = extractColdOptSegment(
         segment, canonicalLoopsMap,
         startAnchor, endAnchor
       )

     processedSegments.push({
       kind, optVertices: optVerts,
       startAnchor, endAnchor
     })

4. MERGE SEGMENTS
   result = []
   For each processedSegment:
     // Include start anchor, exclude end anchor (next segment's start)
     result.push(...processedSegment.optVertices)

   Return result
```

## 4. Anchor Computation Strategy

### Priority Rules

Anchors must be shared exactly at segment boundaries. The anchor position should come from the **most authoritative source** available.

**Priority** (highest to lowest):

1. **Cold-Opt**: If either adjacent segment is cold and has opt vertices, use the opt vertex position
2. **Cold-Canonical**: If either adjacent segment is cold but no opt exists yet, use canonical vertex position
3. **Warm-Stitched**: If both adjacent segments are warm, use the stitched vertex position

### Rationale

- Cold segments already have optimized geometry we want to preserve
- Their opt vertices are authoritative and stable
- Warm segments are flexible - we'll snap their endpoints to match cold boundaries
- For warm↔warm boundaries, use the stitched position as the shared constraint

### Detailed Cases

```
Boundary between segment[i] and segment[i+1]:

Case 1: Cold → Warm
  Anchor = opt vertex at END of cold segment[i]

Case 2: Warm → Cold
  Anchor = opt vertex at START of cold segment[i+1]

Case 3: Cold → Cold
  Anchor = opt vertex at END of cold segment[i]
  (Should equal opt vertex at START of segment[i+1])

Case 4: Warm → Warm
  Anchor = stitched vertex position at boundary
```

### Implementation

```typescript
function computeAnchor(
  prevSegment: SegmentAncestry,
  nextSegment: SegmentAncestry,
  stitchedLoop: StitchedLoop,
  canonicalLoopsMap: Map<LoopId, CanonicalLoop>
): Anchor {
  const boundaryStitchedIndex = prevSegment.vertexRange[1]
  const stitchedPos = stitchedLoop.vertices[boundaryStitchedIndex]

  // Try to get opt vertex from cold segments
  let optVertex: OptVertex | undefined
  let source: Anchor['source'] = "warm-stitched"

  // Case 1: Previous segment is cold
  if (!prevSegment.isNew && prevSegment.sourceCanonicalId) {
    const canonLoop = canonicalLoopsMap.get(prevSegment.sourceCanonicalId)!
    if (canonLoop.optVertices) {
      // Find the opt vertex corresponding to the END of the cold segment
      const canonEndId = prevSegment.canonicalEndpointIds![1]
      optVertex = findOptVertexByCanonicalId(canonLoop.optVertices, canonEndId)
      source = "cold-opt"
    }
  }

  // Case 2: Next segment is cold (if we haven't found opt yet)
  if (!optVertex && !nextSegment.isNew && nextSegment.sourceCanonicalId) {
    const canonLoop = canonicalLoopsMap.get(nextSegment.sourceCanonicalId)!
    if (canonLoop.optVertices) {
      // Find the opt vertex corresponding to the START of the cold segment
      const canonStartId = nextSegment.canonicalEndpointIds![0]
      optVertex = findOptVertexByCanonicalId(canonLoop.optVertices, canonStartId)
      source = "cold-opt"
    }
  }

  const position = optVertex ? { x: optVertex.x, y: optVertex.y } : stitchedPos

  return {
    position,
    stitchedSegmentBoundary: /* segment index */,
    source,
    optVertex
  }
}

function findOptVertexByCanonicalId(
  optVertices: OptVertex[],
  canonicalId: VertexId
): OptVertex | undefined {
  // Find opt vertex where canonStartId <= canonicalId <= canonEndId
  return optVertices.find(ov =>
    ov.canonStartId <= canonicalId && canonicalId <= ov.canonEndId
  )
}
```

## 5. Cold Segment Processing

### Challenge

Cold segments reference a range of canonical vertices from an existing loop. We need to extract the corresponding opt vertices.

### Key Insight

The existing `OptVertex` interface already contains the mapping! Each `OptVertex` has:
- `canonStartId`: The first canonical vertex this opt vertex represents
- `canonEndId`: The last canonical vertex this opt vertex represents

This was designed for Chaikin smoothing where one opt vertex can represent multiple canonical vertices.

### Algorithm

```typescript
function extractColdOptSegment(
  segment: SegmentAncestry,
  canonicalLoopsMap: Map<LoopId, CanonicalLoop>,
  startAnchor: Anchor,
  endAnchor: Anchor
): OptVertex[] {
  const canonLoop = canonicalLoopsMap.get(segment.sourceCanonicalId!)!
  if (!canonLoop.optVertices) {
    throw new Error("Cold segment missing opt vertices")
  }

  const [startCanonId, endCanonId] = segment.canonicalEndpointIds!

  // Find opt indices that contain these canonical IDs
  const startOptIdx = canonLoop.optVertices.findIndex(ov =>
    ov.canonStartId <= startCanonId && startCanonId <= ov.canonEndId
  )
  const endOptIdx = canonLoop.optVertices.findIndex(ov =>
    ov.canonStartId <= endCanonId && endCanonId <= ov.canonEndId
  )

  // Extract range (handle wrapping for closed loops)
  const result: OptVertex[] = []
  if (endOptIdx >= startOptIdx) {
    // Simple case: no wrapping
    result.push(...canonLoop.optVertices.slice(startOptIdx, endOptIdx + 1))
  } else {
    // Wrapping case (segment crosses loop boundary)
    result.push(...canonLoop.optVertices.slice(startOptIdx))
    result.push(...canonLoop.optVertices.slice(0, endOptIdx + 1))
  }

  // Snap first and last vertices to anchors for exact joining
  if (result.length > 0) {
    result[0] = { ...result[0], ...startAnchor.position }
    result[result.length - 1] = { ...result[result.length - 1], ...endAnchor.position }
  }

  return result
}
```

### Edge Cases

1. **Single opt vertex**: If start and end canonical IDs map to the same opt vertex, return just that vertex (snapped to both anchors)
2. **No opt vertices**: If canonical loop hasn't been optimized yet, fall back to extracting canonical vertices and running optimization
3. **Anchor mismatch**: If snapping changes position significantly (>1mm), log a warning

## 6. Warm Segment Processing

### Challenge

Warm segments are new geometry from marching squares. They need to be optimized while preserving endpoints to match anchors.

### Strategy

**Post-optimization snapping** (simpler and cleaner):
1. Extract warm vertices from stitched loop
2. Run full optimization pipeline
3. Snap first and last vertices to anchors

### Algorithm

```typescript
function optimizeWarmSegment(
  segment: SegmentAncestry,
  stitchedVertices: Point[],
  startAnchor: Anchor,
  endAnchor: Anchor,
  optimizationPipeline: VertexOptimizationPipeline,
  options: OptimizationOptions
): OptVertex[] {
  // Extract warm vertices from stitched loop
  const [startIdx, endIdx] = segment.vertexRange
  const warmVerts = stitchedVertices.slice(startIdx, endIdx + 1)

  // Run optimization pipeline
  const optimized = optimizationPipeline.optimize(warmVerts, options)

  // Snap endpoints to anchors for exact joining
  if (optimized.length > 0) {
    optimized[0] = { ...optimized[0], ...startAnchor.position }
    optimized[optimized.length - 1] = { ...optimized[optimized.length - 1], ...endAnchor.position }
  }

  return optimized
}
```

### OptVertex Ancestry for Warm Segments

Warm segments don't have pre-existing canonical ancestry (they're newly carved). Two options:

**Option A**: Assign new canonical IDs to warm vertices (RECOMMENDED)
```typescript
// When creating warm opt vertices, assign fresh canonical IDs
const newCanonId = allocateVertexId()
optVertex.canonStartId = newCanonId
optVertex.canonEndId = newCanonId
```

**Option B**: Use sentinel values (-1) to indicate "no canonical ancestry"
```typescript
optVertex.canonStartId = -1
optVertex.canonEndId = -1
```

**Recommendation**: Option A maintains the invariant that all opt vertices have valid canonical ancestry, useful for future carving operations.

## 7. Segment Merging

### Convention

Each `ProcessedSegment.optVertices`:
- **INCLUDES** the start anchor vertex
- **EXCLUDES** the end anchor vertex (it's the start of the next segment)

This avoids duplicates when concatenating.

### Algorithm

```typescript
function mergeSegments(processedSegments: ProcessedSegment[]): OptVertex[] {
  const result: OptVertex[] = []

  for (const segment of processedSegments) {
    result.push(...segment.optVertices)
  }

  return result
}
```

### Loop Closure

For closed loops:
- Last segment's end anchor = first segment's start anchor
- No duplicate needed (convention handles it)

## 8. Step 3 Validation (Optional Enhancement)

Add validation at the end of Step 3 to ensure clean input for Step 4:

```typescript
function validateSegmentAncestry(stitchedLoop: StitchedLoop): void {
  const segments = stitchedLoop.segments

  // Check coverage: segments must be contiguous and cover entire loop
  let expectedNextStart = 0
  for (const seg of segments) {
    if (seg.vertexRange[0] !== expectedNextStart) {
      throw new Error(`Gap in segment coverage at index ${expectedNextStart}`)
    }
    expectedNextStart = seg.vertexRange[1] + 1
  }

  // Check final segment ends at loop boundary
  const lastSeg = segments[segments.length - 1]
  if (lastSeg.vertexRange[1] !== stitchedLoop.vertices.length - 1) {
    throw new Error("Segments don't cover entire loop")
  }

  // Check cold segment metadata
  for (const seg of segments) {
    if (!seg.isNew) {
      if (seg.sourceCanonicalId === undefined) {
        throw new Error("Cold segment missing sourceCanonicalId")
      }
      if (seg.canonicalEndpointIds === undefined) {
        throw new Error("Cold segment missing canonicalEndpointIds")
      }
    }
  }
}
```

## 9. Open Questions

### Q1: Canonical Loop Availability
Are the original canonical loops guaranteed to still exist when Step 4 runs? Or could they have been deleted/modified?

**Impact**: If loops can be deleted, we need fallback handling for cold segments.

### Q2: Opt Vertex Existence
For cold segments, are we guaranteed that `canonLoop.optVertices` exists? Or do we need to handle the case where a canonical loop hasn't been optimized yet?

**Potential Solution**: Fall back to extracting canonical vertices and running optimization on-demand.

### Q3: Wrapping Arithmetic
For closed loops, do segments wrap around (last segment's end connects to first segment's start)? The current `vertexRange` suggests yes, but confirming.

**Impact**: Affects anchor computation and segment extraction logic.

### Q4: Multiple Cold Sources
Can a single stitched loop contain cold segments from multiple different canonical loops?

**Assumption**: Yes (based on code analysis). Step 4 should handle this naturally.

### Q5: Optimization Pipeline Interface
Does `VertexOptimizationPipeline.optimize()` already exist? What's its signature? Does it return `OptVertex[]` or `Point[]`?

**Current Analysis**: It likely returns `Point[]` with opt metadata added separately.

## 10. Implementation Checklist

- [ ] Implement `computeAnchor()`
- [ ] Implement `findOptVertexByCanonicalId()`
- [ ] Implement `extractColdOptSegment()`
- [ ] Implement `optimizeWarmSegment()`
- [ ] Implement `mergeSegments()`
- [ ] Add Step 3 validation (optional)
- [ ] Add debug visualization for anchors
- [ ] Add debug visualization for segment boundaries
- [ ] Write unit tests for anchor computation
- [ ] Write unit tests for cold segment extraction
- [ ] Write unit tests for warm segment optimization
- [ ] Write integration test for full Step 4 pipeline

## 11. Debug Visualization

### Anchor Markers
- Render anchors as colored dots at segment boundaries
- Color by source: blue=cold-opt, orange=cold-canonical, green=warm-stitched
- Size: 4-6 pixels

### Segment Boundaries
- Draw vertical lines at segment boundaries in opt-space
- Alternate colors for warm (red) and cold (blue) segments
- Display segment index labels

### Ancestry Overlay
- Highlight cold segments with transparency
- Show canonical loop ID as hover label
- Display canonical vertex ID range

## 12. Performance Considerations

### Time Complexity
- Anchor computation: O(n) where n = number of segments
- Cold extraction: O(m) where m = opt vertices per segment
- Warm optimization: O(k) where k = vertices per segment
- Merging: O(total opt vertices)
- **Overall**: O(total opt vertices)

### Space Complexity
- Anchors array: O(n)
- Processed segments: O(total opt vertices)
- No large temporary allocations

### Optimizations
- Reuse canonical loop lookups (cache Map access)
- Pre-allocate result array with estimated size
- Avoid intermediate copies when merging

---

**Document Status**: Draft Design (Pre-Implementation)
**Last Updated**: 2025-11-28
**Author**: Claude (with guidance from user context)
