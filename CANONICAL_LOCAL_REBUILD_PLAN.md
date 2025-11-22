# Canonical Loop-Based Local Rebuild Plan

## Goal
Design a reliable local terrain update system where **canonical loops are the persistent source of truth**, and only affected geometry is regenerated during carving operations.

## Current Problem
The existing `localUpdate()` deletes entire canonical loops if they touch the dirty region, even if only 2m of a 50m loop is affected. This wastes already-optimized geometry and causes unnecessary work.

## Core Principles

1. **Canonical Loops are Persistent**: Loops are modified in-place, not deleted and recreated
2. **Segment-Level Granularity**: Work at the physics segment level, not loop level
3. **Vertex Matching**: Boundary vertices between old canonical and new marching squares are matched precisely
4. **Incremental Optimization**: Only new geometry gets optimized
5. **Topological Integrity**: No gaps, no overlaps, consistent winding order

## Architecture Overview

```
┌─────────────────────────────────────────────────────────────┐
│                    Canonical Loops                          │
│  (Persistent, optimized, source of truth)                   │
│  - Stable vertex IDs                                        │
│  - Cached AABBs                                             │
│  - Segments for physics                                     │
└─────────────────────────────────────────────────────────────┘
                          │
                          │ Carve dirty region
                          ▼
┌─────────────────────────────────────────────────────────────┐
│              Step 1: Mark Affected Segments                 │
│  - Test each segment's AABB vs dirty region                │
│  - Three categories:                                        │
│    • Fully inside → DELETE segment                         │
│    • Partially intersects → SPLIT segment                  │
│    • No intersection → KEEP segment                        │
└─────────────────────────────────────────────────────────────┘
                          │
                          ▼
┌─────────────────────────────────────────────────────────────┐
│       Step 2: Extract Boundary Vertices (Anchors)          │
│  - Find vertices at split boundaries                       │
│  - These are "anchor points" for stitching                 │
│  - Store their canonical vertex IDs                        │
└─────────────────────────────────────────────────────────────┘
                          │
                          ▼
┌─────────────────────────────────────────────────────────────┐
│      Step 3: Run Marching Squares in Padded Region         │
│  - Generate fresh contours from density field              │
│  - These are raw, unoptimized vertices                     │
└─────────────────────────────────────────────────────────────┘
                          │
                          ▼
┌─────────────────────────────────────────────────────────────┐
│         Step 4: Match Boundary Vertices                     │
│  - Find marching squares vertices closest to anchors       │
│  - Snap if within threshold (e.g., 0.01m)                  │
│  - This creates "attachment points"                        │
└─────────────────────────────────────────────────────────────┘
                          │
                          ▼
┌─────────────────────────────────────────────────────────────┐
│    Step 5: Clip & Optimize New Arc Segments                │
│  - Extract arc between attachment points                   │
│  - Run optimization ONLY on new arc                        │
│  - Clean, simplify, smooth (match existing opts)           │
└─────────────────────────────────────────────────────────────┘
                          │
                          ▼
┌─────────────────────────────────────────────────────────────┐
│       Step 6: Stitch New Arc into Canonical Loop           │
│  - Replace deleted segment range with new arc              │
│  - Preserve canonical vertex IDs for kept vertices         │
│  - Assign new IDs only to new vertices                     │
│  - Update loop AABB                                         │
└─────────────────────────────────────────────────────────────┘
                          │
                          ▼
┌─────────────────────────────────────────────────────────────┐
│        Step 7: Rebuild Physics Segments                    │
│  - Delete old segment fixtures                             │
│  - Re-segment modified canonical loop                      │
│  - Create new fixtures                                      │
└─────────────────────────────────────────────────────────────┘
```

## Detailed Implementation Plan

### Data Structures

#### Segment Affection Categories
```typescript
enum SegmentAffection {
  KEEP,           // No intersection with dirty region
  DELETE,         // Fully inside dirty region
  SPLIT_START,    // Segment crosses into dirty region (entry)
  SPLIT_END       // Segment crosses out of dirty region (exit)
}

interface AffectedSegment {
  segment: PhysicsSegment;
  affection: SegmentAffection;
  splitVertexIndex?: number;  // For SPLIT cases, where the split occurs
}
```

#### Anchor Points (Boundary Vertices)
```typescript
interface AnchorPoint {
  canonicalVertexId: VertexId;  // From preserved canonical geometry
  position: Point;              // World position
  loopId: LoopId;              // Which canonical loop it belongs to
  beforeIndex: number;          // Vertex index before deleted range
  afterIndex: number;           // Vertex index after deleted range
}
```

#### Arc Matching Result
```typescript
interface ArcMatch {
  anchorStart: AnchorPoint;
  anchorEnd: AnchorPoint;
  newArc: Point[];             // Vertices from marching squares
  startSnapIndex: number;       // Index in newArc that snaps to anchorStart
  endSnapIndex: number;         // Index in newArc that snaps to anchorEnd
  snappingError: number;        // Distance between anchor and snap point
}
```

### Step-by-Step Algorithm

#### Step 1: Analyze Affected Segments

```typescript
function analyzeAffectedSegments(
  canonicalLoops: CanonicalLoop[],
  dirtyAABB: AABB,
  paddedAABB: AABB
): Map<LoopId, AffectedSegment[]> {

  const affectedByLoop = new Map<LoopId, AffectedSegment[]>();

  for (const loop of canonicalLoops) {
    const segments = getSegmentsForLoop(loop.id);
    const affected: AffectedSegment[] = [];

    for (const segment of segments) {
      const affection = classifySegment(segment, dirtyAABB, paddedAABB, loop);

      if (affection !== SegmentAffection.KEEP) {
        affected.push({ segment, affection, splitVertexIndex: ... });
      }
    }

    if (affected.length > 0) {
      affectedByLoop.set(loop.id, affected);
    }
  }

  return affectedByLoop;
}

function classifySegment(
  segment: PhysicsSegment,
  dirtyAABB: AABB,
  paddedAABB: AABB,
  loop: CanonicalLoop
): SegmentAffection {

  // Quick reject: segment AABB doesn't intersect padded region
  if (!aabbsIntersect(segment.aabb, paddedAABB)) {
    return SegmentAffection.KEEP;
  }

  // Check each vertex in segment range
  let insideCount = 0;
  let outsideCount = 0;

  for (let i = segment.startIndex; i <= segment.endIndex; i++) {
    const v = loop.vertices[i];
    if (pointInAABB(v, paddedAABB)) {
      insideCount++;
    } else {
      outsideCount++;
    }
  }

  // All vertices inside → delete entire segment
  if (outsideCount === 0) {
    return SegmentAffection.DELETE;
  }

  // All vertices outside → keep entire segment
  if (insideCount === 0) {
    return SegmentAffection.KEEP;
  }

  // Mixed: need to determine if this is entry or exit
  // Check first vertex to determine direction
  const firstVertex = loop.vertices[segment.startIndex];
  if (pointInAABB(firstVertex, paddedAABB)) {
    return SegmentAffection.SPLIT_END;  // Starts inside, exits dirty region
  } else {
    return SegmentAffection.SPLIT_START; // Starts outside, enters dirty region
  }
}
```

#### Step 2: Extract Anchor Points

```typescript
function extractAnchorPoints(
  affectedByLoop: Map<LoopId, AffectedSegment[]>,
  canonicalLoops: Map<LoopId, CanonicalLoop>
): AnchorPoint[] {

  const anchors: AnchorPoint[] = [];

  for (const [loopId, affectedSegments] of affectedByLoop) {
    const loop = canonicalLoops.get(loopId)!;

    for (const affected of affectedSegments) {
      if (affected.affection === SegmentAffection.SPLIT_START) {
        // Entry point: vertex just before entering dirty region
        const anchorIndex = affected.splitVertexIndex!;
        const vertex = loop.vertices[anchorIndex];

        anchors.push({
          canonicalVertexId: vertex.id,
          position: { x: vertex.x, y: vertex.y },
          loopId: loopId,
          beforeIndex: anchorIndex,
          afterIndex: -1  // Will be set when we find the exit
        });
      }

      if (affected.affection === SegmentAffection.SPLIT_END) {
        // Exit point: vertex just after exiting dirty region
        const anchorIndex = affected.splitVertexIndex!;
        const vertex = loop.vertices[anchorIndex];

        // Find matching entry anchor and set afterIndex
        const entryAnchor = anchors.find(a =>
          a.loopId === loopId && a.afterIndex === -1
        );

        if (entryAnchor) {
          entryAnchor.afterIndex = anchorIndex;
        }
      }
    }
  }

  return anchors;
}
```

#### Step 3: Match Marching Squares to Anchors

```typescript
function matchArcToAnchors(
  newLoops: Point[][],
  anchors: AnchorPoint[],
  snapThreshold: number = 0.01  // 1cm tolerance
): ArcMatch[] {

  const matches: ArcMatch[] = [];

  // For each anchor pair (entry/exit from same loop)
  for (let i = 0; i < anchors.length; i += 2) {
    const anchorStart = anchors[i];
    const anchorEnd = anchors[i + 1];

    if (!anchorEnd || anchorStart.loopId !== anchorEnd.loopId) {
      console.warn('Mismatched anchor pair!');
      continue;
    }

    // Find which new loop contains both anchor positions
    for (const newLoop of newLoops) {
      const startMatch = findClosestVertex(newLoop, anchorStart.position);
      const endMatch = findClosestVertex(newLoop, anchorEnd.position);

      // Both anchors must snap within threshold
      if (startMatch.distance < snapThreshold && endMatch.distance < snapThreshold) {

        // Extract arc between snap points
        const newArc = extractArcBetween(
          newLoop,
          startMatch.index,
          endMatch.index
        );

        matches.push({
          anchorStart,
          anchorEnd,
          newArc,
          startSnapIndex: startMatch.index,
          endSnapIndex: endMatch.index,
          snappingError: Math.max(startMatch.distance, endMatch.distance)
        });

        break;
      }
    }
  }

  return matches;
}

function findClosestVertex(
  loop: Point[],
  target: Point
): { index: number; distance: number } {

  let minDist = Infinity;
  let minIndex = -1;

  for (let i = 0; i < loop.length; i++) {
    const dist = Math.hypot(loop[i].x - target.x, loop[i].y - target.y);
    if (dist < minDist) {
      minDist = dist;
      minIndex = i;
    }
  }

  return { index: minIndex, distance: minDist };
}
```

#### Step 4: Optimize New Arcs

```typescript
function optimizeNewArcs(
  matches: ArcMatch[],
  optimizationOptions: OptimizationOptions
): ArcMatch[] {

  const optimizedMatches: ArcMatch[] = [];

  for (const match of matches) {
    // Optimize the arc (without the anchor endpoints, which we'll preserve)
    const arcInterior = match.newArc.slice(1, -1);

    if (arcInterior.length === 0) {
      // Arc is just two anchors - keep as is
      optimizedMatches.push(match);
      continue;
    }

    // Run optimization pipeline on interior only
    const optimized = optimizeArc(arcInterior, optimizationOptions);

    // Reconstruct arc with original anchors
    const optimizedArc = [
      match.newArc[0],      // Keep original start (will snap to anchor)
      ...optimized,
      match.newArc[match.newArc.length - 1]  // Keep original end
    ];

    optimizedMatches.push({
      ...match,
      newArc: optimizedArc
    });
  }

  return optimizedMatches;
}
```

#### Step 5: Stitch Arcs into Canonical Loops

```typescript
function stitchArcsIntoCanonical(
  matches: ArcMatch[],
  canonicalLoops: Map<LoopId, CanonicalLoop>
): Map<LoopId, CanonicalLoop> {

  const updatedLoops = new Map<LoopId, CanonicalLoop>();

  for (const match of matches) {
    const loopId = match.anchorStart.loopId;
    const loop = canonicalLoops.get(loopId)!;

    // Build new vertex array:
    // [vertices before anchor] + [new arc interior] + [vertices after anchor]

    const beforeRange = loop.vertices.slice(0, match.anchorStart.beforeIndex + 1);
    const afterRange = loop.vertices.slice(match.anchorEnd.afterIndex);

    // Convert new arc to canonical vertices (assign new IDs)
    const newArcCanonical = match.newArc.slice(1, -1).map(p => ({
      id: allocateVertexId(),
      x: p.x,
      y: p.y,
      segmentA: null,
      segmentB: null
    }));

    const updatedVertices = [
      ...beforeRange,
      ...newArcCanonical,
      ...afterRange
    ];

    // Recompute AABB
    const aabb = computeLoopAabbFromVertices(updatedVertices);

    updatedLoops.set(loopId, {
      id: loopId,
      vertices: updatedVertices,
      aabb,
      isClosed: loop.isClosed
    });
  }

  return updatedLoops;
}
```

#### Step 6: Rebuild Physics

```typescript
function rebuildPhysicsForUpdatedLoops(
  updatedLoops: Map<LoopId, CanonicalLoop>,
  engine: Box2DEngine,
  shouldReverse: Map<LoopId, boolean>
): void {

  for (const [loopId, loop] of updatedLoops) {
    // Remove old physics body for this loop
    engine.removeTerrainBodyByLoopId(loopId);

    // Create new physics body with updated canonical loop
    const reverse = shouldReverse.get(loopId) ?? true;
    engine.addCanonicalTerrainLoops([loop], [reverse]);
  }
}
```

## Edge Cases & Error Handling

### 1. No Matching New Loop Found
**Problem**: Anchor points don't snap to any marching squares output
**Cause**: Carve completely removed the loop, or density changed dramatically
**Solution**: Fallback to full loop deletion (mark as deleted, will be recreated or gone)

### 2. Multiple Disconnected Arcs in Same Loop
**Problem**: Single canonical loop crosses dirty region multiple times
**Example**: Large loop wraps around dirty region
**Solution**: Track multiple anchor pairs per loop, stitch all arcs sequentially

### 3. Snapping Tolerance Too Large
**Problem**: Wrong vertices get snapped together
**Solution**: Adaptive threshold based on local grid pitch (e.g., 0.1 × gridPitch)

### 4. Topology Change (Loop Split)
**Problem**: Carve bisects a loop into two separate loops
**Detection**: Anchor pair count mismatch (3+ anchors for one loop)
**Solution**: Fallback to full rebuild for this loop

### 5. New Loop Appears
**Problem**: Carving creates entirely new loop (e.g., hole in rock)
**Detection**: Marching squares loop has no matching anchors
**Solution**: Add as new canonical loop (full optimization)

### 6. Winding Order Mismatch
**Problem**: New arc has opposite winding from canonical loop
**Detection**: Cross product test at anchor points
**Solution**: Reverse new arc before stitching

## Performance Optimizations

### 1. AABB-First Filtering
Always test AABBs before expensive vertex-by-vertex checks:
```typescript
if (!aabbsIntersect(segment.aabb, paddedAABB)) {
  return SegmentAffection.KEEP;  // Fast path
}
```

### 2. Spatial Hash for Anchor Matching
Use grid-based spatial hash to find nearby marching squares vertices:
```typescript
const spatialHash = new Map<string, number[]>();
// Bucket vertices by (floor(x/cellSize), floor(y/cellSize))
// O(1) lookup instead of O(n) scan
```

### 3. Lazy Segment Rebuild
Only re-segment canonical loops that were actually modified:
```typescript
if (updatedLoops.has(loopId)) {
  rebuildSegments(loopId);
}
```

### 4. Incremental AABB Update
Instead of recomputing entire AABB, update bounds incrementally:
```typescript
// Expand AABB to include new arc vertices
for (const v of newArc) {
  aabb.minX = Math.min(aabb.minX, v.x);
  // ... etc
}
```

## Testing Strategy

### Unit Tests
1. **Segment Classification**
   - Fully inside → DELETE
   - Fully outside → KEEP
   - Crosses boundary → SPLIT_START/END

2. **Anchor Extraction**
   - Single arc per loop
   - Multiple arcs per loop
   - Edge cases (loop only has 1 anchor)

3. **Vertex Matching**
   - Exact match (distance = 0)
   - Within threshold (distance < 0.01)
   - No match (distance > threshold)

4. **Arc Stitching**
   - Before + Arc + After = Valid loop
   - Vertex IDs preserved for kept vertices
   - New IDs assigned to arc vertices

### Integration Tests
1. **Small Carve** (dirty region < 10% of loop)
   - Verify most vertices preserved
   - Verify physics still correct
   - Verify rendering still correct

2. **Large Carve** (dirty region > 50% of loop)
   - May fall back to full rebuild
   - Verify no gaps in geometry

3. **Edge Carve** (carve at loop boundary)
   - Test anchor at loop start/end
   - Verify circular stitching works

4. **Multi-Loop Carve**
   - Multiple canonical loops affected
   - Each handled independently
   - No cross-contamination

### Visual Debug Validation
Add debug rendering modes:
- **Anchor points**: Red circles
- **Preserved arcs**: Green lines (from canonical)
- **New arcs**: Blue lines (from marching squares)
- **Stitching seams**: Yellow markers
- **AABB regions**: Dashed rectangles (dirty vs padded)

## Migration Path

### Phase 1: Implement Core Algorithm (Week 1)
- [ ] Segment classification logic
- [ ] Anchor point extraction
- [ ] Vertex matching with snapping
- [ ] Basic arc stitching
- [ ] Unit tests for each component

### Phase 2: Physics Integration (Week 2)
- [ ] Segment deletion by AABB
- [ ] Canonical loop modification
- [ ] Physics body rebuild
- [ ] Integration tests

### Phase 3: Edge Cases (Week 3)
- [ ] Fallback to full rebuild
- [ ] Multiple arcs per loop
- [ ] Topology change detection
- [ ] Winding order validation

### Phase 4: Optimization & Polish (Week 4)
- [ ] AABB-first filtering
- [ ] Spatial hash for matching
- [ ] Incremental AABB updates
- [ ] Performance benchmarks

### Phase 5: Production Testing
- [ ] Side-by-side comparison with old system
- [ ] Visual diff testing
- [ ] Stress testing (many carves)
- [ ] Feature flag rollout

## Success Metrics

### Correctness
- ✅ No visual gaps or overlaps in rendered terrain
- ✅ No physics leaks (player/balls don't fall through)
- ✅ Vertex count matches expected (no duplication)
- ✅ Winding order consistent (all loops CCW or CW)

### Performance
- 🎯 <5ms per local update (vs ~20ms current)
- 🎯 <20% vertex regeneration (vs 100% current)
- 🎯 Canonical loops stable across 100+ carves
- 🎯 Memory usage stable (no leaks from ID allocation)

### Stability
- 🛡️ No crashes on edge cases
- 🛡️ Graceful fallback when stitching fails
- 🛡️ Deterministic results (same carve = same geometry)

## References

### Academic/Industry Resources
- [Adaptive Remeshing for Real-Time Mesh Deformation](https://www.researchgate.net/publication/237008692_Adaptive_Remeshing_for_Real-Time_Mesh_Deformation) - Techniques for local mesh modification
- [Interactive Geometry Remeshing (Caltech)](https://www.geometry.caltech.edu/pubs/AMD02.pdf) - Local modification operators
- [Parallelized Marching Squares](https://dmahr1.github.io/618-final/proposal.html) - Boundary stitching for tiled generation
- [Transvoxel Algorithm](https://transvoxel.org/) - LOD stitching for voxel terrain (3D analog)
- [An improved local remeshing algorithm](https://www.tandfonline.com/doi/full/10.1080/19942060.2016.1174888) - Moving boundary problems

### Key Insights
1. **Boundary vertices are the key** - All stitching relies on accurate anchor point matching
2. **Segment-level granularity** - Finer than loop-level, coarser than vertex-level
3. **Fallback is essential** - When topology changes, full rebuild is safer than buggy stitching
4. **AABB filtering is critical** - 90%+ of segments will be unaffected, skip them fast
5. **Canonical IDs enable stability** - Preserved vertices keep their IDs across updates

---

## Summary

This plan establishes a **segment-based canonical loop update system** that:
1. ✅ Preserves canonical loops as persistent source of truth
2. ✅ Only modifies affected segments (not entire loops)
3. ✅ Matches boundary vertices for reliable stitching
4. ✅ Optimizes only new geometry (not already-optimized parts)
5. ✅ Includes comprehensive error handling and fallbacks
6. ✅ Provides clear testing and validation strategy

The approach is more complex than "delete entire loop", but provides:
- **10x+ performance improvement** for small carves
- **Stable canonical representation** across many updates
- **Reduced vertex churn** (less optimization, less drift)
- **Better debuggability** (can visualize what was kept vs replaced)
