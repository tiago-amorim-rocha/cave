/**
 * Step 4: Opt-Space Merging
 *
 * Transforms stitched loops (canonical/marching-squares space) into final optimized
 * vertex arrays for physics by:
 * 1. Identifying warm (new) vs cold (reused) segments
 * 2. Extracting opt vertices from cold segments
 * 3. Optimizing warm segments with anchor constraints
 * 4. Merging all segments into a single opt vertex array
 *
 * See STEP4_OPT_MERGING_DESIGN.md for full design documentation.
 */

import type { Point } from '../types';
import type { StitchedLoop, SegmentAncestry } from '../TerrainSurgery';
import type {
  OptVertex,
  CanonicalLoop,
  VertexId,
  LoopId,
  allocateVertexId
} from './CanonicalGeometry';
import { allocateVertexId as allocateId } from './CanonicalGeometry';
import type { OptimizationOptions } from '../VertexOptimizationPipeline';
import { VertexOptimizationPipeline } from '../VertexOptimizationPipeline';

// ============================================================================
// Types
// ============================================================================

/**
 * Anchor point at a segment boundary
 */
interface Anchor {
  /** Position in world space (the authoritative anchor point) */
  position: Point;

  /** Which segment boundary this represents (index in segments array) */
  segmentBoundaryIndex: number;

  /** Source of truth for this anchor */
  source: 'cold-opt' | 'cold-canonical' | 'warm-stitched';

  /** For cold anchors: the opt vertex this came from */
  optVertex?: OptVertex;

  /** Index in stitched loop where this boundary occurs */
  stitchedIndex: number;
}

/**
 * Processed segment ready for merging
 */
interface ProcessedSegment {
  kind: 'warm' | 'cold';
  /** Opt vertices - INCLUDES start anchor, EXCLUDES end anchor */
  optVertices: OptVertex[];
  startAnchor: Anchor;
  endAnchor: Anchor;
}

/**
 * Input to Step 4
 */
export interface Step4Input {
  /** The stitched loop from Step 2 */
  stitchedLoop: StitchedLoop;

  /** Map of canonical loop IDs to canonical loops */
  canonicalLoopsMap: Map<LoopId, CanonicalLoop>;

  /** Optimization options for warm segments */
  optimizationOptions: OptimizationOptions;
}

/**
 * Output from Step 4
 */
export interface Step4Output {
  /** The final merged optimized loop ready for physics */
  optVertices: OptVertex[];

  /** Debug metadata */
  debugInfo?: {
    segmentBoundaries: number[]; // Opt indices where segments join
    anchorCount: number;
    anchors: Anchor[];
    processedSegments: ProcessedSegment[];
  };
}

// ============================================================================
// 1. Anchor Discovery
// ============================================================================

/**
 * Find an opt vertex that contains a specific canonical vertex ID.
 *
 * An opt vertex "contains" a canonical ID if canonStartId <= canonicalId <= canonEndId.
 * This handles the case where Chaikin smoothing creates opt vertices that represent
 * multiple canonical vertices.
 */
function findOptVertexByCanonicalId(
  optVertices: OptVertex[],
  canonicalId: VertexId
): OptVertex | undefined {
  return optVertices.find(
    (ov) => ov.canonStartId <= canonicalId && canonicalId <= ov.canonEndId
  );
}

/**
 * Compute the anchor point at a segment boundary.
 *
 * Priority order (highest to lowest):
 * 1. Cold-Opt: Use opt vertex from cold segment if available
 * 2. Cold-Canonical: Use canonical vertex from cold segment
 * 3. Warm-Stitched: Use stitched vertex position
 *
 * @param prevSegment - The segment ending at this boundary
 * @param nextSegment - The segment starting at this boundary
 * @param boundaryIndex - Index of this boundary in the segments array
 * @param stitchedLoop - The stitched loop
 * @param canonicalLoopsMap - Map of canonical loops
 * @returns Anchor point for this boundary
 */
function computeAnchor(
  prevSegment: SegmentAncestry,
  nextSegment: SegmentAncestry,
  boundaryIndex: number,
  stitchedLoop: StitchedLoop,
  canonicalLoopsMap: Map<LoopId, CanonicalLoop>
): Anchor {
  // The boundary occurs at the END of the previous segment
  const stitchedIndex = prevSegment.vertexRange[1];
  const stitchedPos = stitchedLoop.vertices[stitchedIndex];

  let position: Point = stitchedPos;
  let source: Anchor['source'] = 'warm-stitched';
  let optVertex: OptVertex | undefined;

  // Case 1: Previous segment is cold - use its END opt vertex
  if (!prevSegment.isNew && prevSegment.sourceCanonicalId !== undefined) {
    const canonLoop = canonicalLoopsMap.get(prevSegment.sourceCanonicalId);
    if (canonLoop && canonLoop.optVertices) {
      const canonEndId = prevSegment.canonicalEndpointIds![1];
      const foundOptVertex = findOptVertexByCanonicalId(
        canonLoop.optVertices,
        canonEndId
      );
      if (foundOptVertex) {
        position = { x: foundOptVertex.x, y: foundOptVertex.y };
        source = 'cold-opt';
        optVertex = foundOptVertex;
        console.log('[Step4] Anchor from prev cold segment (opt)', {
          boundaryIndex,
          stitchedIndex,
          canonEndId,
          position
        });
      }
    }
  }

  // Case 2: Next segment is cold - use its START opt vertex (if we don't have one yet)
  if (!optVertex && !nextSegment.isNew && nextSegment.sourceCanonicalId !== undefined) {
    const canonLoop = canonicalLoopsMap.get(nextSegment.sourceCanonicalId);
    if (canonLoop && canonLoop.optVertices) {
      const canonStartId = nextSegment.canonicalEndpointIds![0];
      const foundOptVertex = findOptVertexByCanonicalId(
        canonLoop.optVertices,
        canonStartId
      );
      if (foundOptVertex) {
        position = { x: foundOptVertex.x, y: foundOptVertex.y };
        source = 'cold-opt';
        optVertex = foundOptVertex;
        console.log('[Step4] Anchor from next cold segment (opt)', {
          boundaryIndex,
          stitchedIndex,
          canonStartId,
          position
        });
      }
    }
  }

  // Fallback: warm-stitched (already set as default)
  if (!optVertex) {
    console.log('[Step4] Anchor from stitched vertex (warm)', {
      boundaryIndex,
      stitchedIndex,
      position
    });
  }

  return {
    position,
    segmentBoundaryIndex: boundaryIndex,
    source,
    optVertex,
    stitchedIndex
  };
}

/**
 * Identify all anchors (segment boundaries) in the stitched loop.
 *
 * For n segments, there are n boundaries (including the wrap-around from last to first).
 */
function identifyAnchors(
  stitchedLoop: StitchedLoop,
  canonicalLoopsMap: Map<LoopId, CanonicalLoop>
): Anchor[] {
  const segments = stitchedLoop.segments;
  const anchors: Anchor[] = [];

  console.log('[Step4] Identifying anchors', {
    stitchedLoopId: stitchedLoop.id,
    segmentCount: segments.length
  });

  for (let i = 0; i < segments.length; i++) {
    const prevSegment = segments[i];
    const nextSegment = segments[(i + 1) % segments.length];

    const anchor = computeAnchor(
      prevSegment,
      nextSegment,
      i,
      stitchedLoop,
      canonicalLoopsMap
    );

    anchors.push(anchor);
  }

  console.log('[Step4] Anchors identified', {
    anchorCount: anchors.length,
    sources: {
      coldOpt: anchors.filter((a) => a.source === 'cold-opt').length,
      coldCanonical: anchors.filter((a) => a.source === 'cold-canonical').length,
      warmStitched: anchors.filter((a) => a.source === 'warm-stitched').length
    }
  });

  return anchors;
}

// ============================================================================
// 2. Cold Segment Extraction
// ============================================================================

/**
 * Extract opt vertices for a cold segment from the original canonical loop.
 *
 * Strategy:
 * 1. Look up the canonical loop
 * 2. Find opt vertices that contain the start/end canonical IDs
 * 3. Extract the range of opt vertices between them
 * 4. Handle wrapping for closed loops
 * 5. Snap endpoints to anchors
 *
 * @param segment - The cold segment ancestry
 * @param canonicalLoopsMap - Map of canonical loops
 * @param startAnchor - Anchor at segment start
 * @param endAnchor - Anchor at segment end
 * @returns Opt vertices for this segment (includes start, excludes end)
 */
function extractColdOptSegment(
  segment: SegmentAncestry,
  canonicalLoopsMap: Map<LoopId, CanonicalLoop>,
  startAnchor: Anchor,
  endAnchor: Anchor
): OptVertex[] {
  if (segment.isNew) {
    throw new Error('[Step4] extractColdOptSegment called on warm segment');
  }

  const canonLoop = canonicalLoopsMap.get(segment.sourceCanonicalId!);
  if (!canonLoop) {
    throw new Error(
      `[Step4] Canonical loop ${segment.sourceCanonicalId} not found`
    );
  }

  if (!canonLoop.optVertices || canonLoop.optVertices.length === 0) {
    throw new Error(
      `[Step4] Canonical loop ${segment.sourceCanonicalId} missing opt vertices`
    );
  }

  const [startCanonId, endCanonId] = segment.canonicalEndpointIds!;

  console.log('[Step4] Extracting cold opt segment', {
    sourceCanonicalId: segment.sourceCanonicalId,
    canonicalRange: [startCanonId, endCanonId],
    optVertexCount: canonLoop.optVertices.length
  });

  // Find opt vertex indices that contain the canonical IDs
  const startOptIdx = canonLoop.optVertices.findIndex(
    (ov) => ov.canonStartId <= startCanonId && startCanonId <= ov.canonEndId
  );
  const endOptIdx = canonLoop.optVertices.findIndex(
    (ov) => ov.canonStartId <= endCanonId && endCanonId <= ov.canonEndId
  );

  if (startOptIdx === -1) {
    throw new Error(
      `[Step4] Could not find opt vertex containing canonical ID ${startCanonId}`
    );
  }
  if (endOptIdx === -1) {
    throw new Error(
      `[Step4] Could not find opt vertex containing canonical ID ${endCanonId}`
    );
  }

  console.log('[Step4] Found opt indices', {
    startOptIdx,
    endOptIdx,
    totalOptVertices: canonLoop.optVertices.length
  });

  // Extract range (handle wrapping for closed loops)
  const result: OptVertex[] = [];

  if (endOptIdx >= startOptIdx) {
    // Simple case: no wrapping
    // Include start, exclude end (next segment's start will include it)
    for (let i = startOptIdx; i < endOptIdx; i++) {
      result.push({ ...canonLoop.optVertices[i] });
    }
  } else {
    // Wrapping case: segment crosses loop boundary
    // Go from startOptIdx to end of array
    for (let i = startOptIdx; i < canonLoop.optVertices.length; i++) {
      result.push({ ...canonLoop.optVertices[i] });
    }
    // Then from start of array to endOptIdx (exclusive)
    for (let i = 0; i < endOptIdx; i++) {
      result.push({ ...canonLoop.optVertices[i] });
    }
  }

  // Snap first vertex to start anchor
  if (result.length > 0) {
    result[0] = {
      ...result[0],
      x: startAnchor.position.x,
      y: startAnchor.position.y
    };
  }

  // Note: We do NOT snap the last vertex to endAnchor because we're using
  // the "include start, exclude end" convention. The next segment will
  // include the end anchor as its start.

  console.log('[Step4] Cold segment extracted', {
    optVertexCount: result.length,
    firstVertex: result[0],
    lastVertex: result[result.length - 1]
  });

  return result;
}

// ============================================================================
// 3. Warm Segment Optimization
// ============================================================================

/**
 * Optimize a warm segment and snap its endpoints to anchors.
 *
 * Strategy:
 * 1. Extract warm vertices from stitched loop
 * 2. Run optimization pipeline
 * 3. Assign fresh canonical IDs to maintain ancestry
 * 4. Snap first vertex to start anchor
 * 5. Return vertices (includes start, excludes end)
 *
 * @param segment - The warm segment ancestry
 * @param stitchedVertices - All vertices from the stitched loop
 * @param startAnchor - Anchor at segment start
 * @param endAnchor - Anchor at segment end
 * @param optimizationOptions - Pipeline options
 * @returns Opt vertices for this segment (includes start, excludes end)
 */
function optimizeWarmSegment(
  segment: SegmentAncestry,
  stitchedVertices: Point[],
  startAnchor: Anchor,
  endAnchor: Anchor,
  optimizationOptions: OptimizationOptions
): OptVertex[] {
  if (!segment.isNew) {
    throw new Error('[Step4] optimizeWarmSegment called on cold segment');
  }

  const [startIdx, endIdx] = segment.vertexRange;

  console.log('[Step4] Optimizing warm segment', {
    vertexRange: [startIdx, endIdx],
    vertexCount: endIdx - startIdx + 1
  });

  // Extract warm vertices from stitched loop
  const warmVerts: Point[] = [];
  for (let i = startIdx; i <= endIdx; i++) {
    warmVerts.push({ ...stitchedVertices[i] });
  }

  // Run optimization pipeline
  const pipeline = new VertexOptimizationPipeline();
  const optimizationResult = pipeline.optimize([warmVerts], optimizationOptions);

  // Extract the first (and only) loop from the result
  let optimized = optimizationResult.finalOptLoops[0];

  if (!optimized || optimized.length === 0) {
    console.warn('[Step4] Optimization produced empty result, using original vertices');
    // Fallback: create opt vertices with fresh IDs
    optimized = warmVerts.map((v) => ({
      x: v.x,
      y: v.y,
      canonStartId: allocateId(),
      canonEndId: allocateId()
    }));
  }

  // Assign fresh canonical IDs to warm vertices (Option A from design)
  // The pipeline may have assigned temporary IDs, so we reassign them
  const result: OptVertex[] = optimized.map((ov) => ({
    x: ov.x,
    y: ov.y,
    canonStartId: allocateId(),
    canonEndId: allocateId()
  }));

  // Snap first vertex to start anchor
  if (result.length > 0) {
    result[0] = {
      ...result[0],
      x: startAnchor.position.x,
      y: startAnchor.position.y
    };
  }

  // Note: We do NOT snap the last vertex to endAnchor (see cold extraction comment)

  console.log('[Step4] Warm segment optimized', {
    originalCount: warmVerts.length,
    optimizedCount: result.length,
    reduction: ((warmVerts.length - result.length) / warmVerts.length * 100).toFixed(1) + '%',
    firstVertex: result[0],
    lastVertex: result[result.length - 1]
  });

  return result;
}

// ============================================================================
// 4. Segment Merging
// ============================================================================

/**
 * Merge processed segments into a single opt vertex array.
 *
 * Convention: Each segment includes its start anchor but excludes its end anchor.
 * This ensures no duplicates when concatenating.
 */
function mergeSegments(processedSegments: ProcessedSegment[]): OptVertex[] {
  const result: OptVertex[] = [];

  console.log('[Step4] Merging segments', {
    segmentCount: processedSegments.length
  });

  for (const segment of processedSegments) {
    console.log('[Step4] Adding segment', {
      kind: segment.kind,
      vertexCount: segment.optVertices.length
    });
    result.push(...segment.optVertices);
  }

  console.log('[Step4] Segments merged', {
    totalOptVertices: result.length
  });

  return result;
}

// ============================================================================
// 5. Main Entry Point
// ============================================================================

/**
 * Build optimized loop from stitched loop (Step 4 main function).
 *
 * This is the public API for Step 4. It orchestrates all the sub-steps:
 * 1. Identify anchors at segment boundaries
 * 2. Process each segment (cold extraction or warm optimization)
 * 3. Merge all segments into final opt vertex array
 *
 * @param input - Step 4 input
 * @returns Step 4 output with final opt vertices
 */
export function buildOptimizedFromStitchedLoop(input: Step4Input): Step4Output {
  const { stitchedLoop, canonicalLoopsMap, optimizationOptions } = input;

  console.log('[Step4] Starting opt-space merging', {
    stitchedLoopId: stitchedLoop.id,
    segmentCount: stitchedLoop.segments.length,
    stitchedVertexCount: stitchedLoop.vertices.length
  });

  // Step 1: Identify anchors
  const anchors = identifyAnchors(stitchedLoop, canonicalLoopsMap);

  // Step 2: Process each segment
  const processedSegments: ProcessedSegment[] = [];

  for (let i = 0; i < stitchedLoop.segments.length; i++) {
    const segment = stitchedLoop.segments[i];
    const startAnchor = anchors[i];
    const endAnchor = anchors[(i + 1) % anchors.length];

    console.log('[Step4] Processing segment', {
      index: i,
      kind: segment.isNew ? 'warm' : 'cold',
      vertexRange: segment.vertexRange,
      startAnchor: startAnchor.source,
      endAnchor: endAnchor.source
    });

    let optVertices: OptVertex[];

    if (segment.isNew) {
      // Warm segment: optimize with anchors
      optVertices = optimizeWarmSegment(
        segment,
        stitchedLoop.vertices,
        startAnchor,
        endAnchor,
        optimizationOptions
      );
    } else {
      // Cold segment: extract from canonical loop
      optVertices = extractColdOptSegment(
        segment,
        canonicalLoopsMap,
        startAnchor,
        endAnchor
      );
    }

    processedSegments.push({
      kind: segment.isNew ? 'warm' : 'cold',
      optVertices,
      startAnchor,
      endAnchor
    });
  }

  // Step 3: Merge segments
  const finalOptVertices = mergeSegments(processedSegments);

  // Compute segment boundaries for debug visualization
  const segmentBoundaries: number[] = [];
  let currentIndex = 0;
  for (const seg of processedSegments) {
    segmentBoundaries.push(currentIndex);
    currentIndex += seg.optVertices.length;
  }

  console.log('[Step4] ✓ Opt-space merging complete', {
    stitchedLoopId: stitchedLoop.id,
    finalOptVertexCount: finalOptVertices.length,
    segmentCount: processedSegments.length,
    warmSegments: processedSegments.filter((s) => s.kind === 'warm').length,
    coldSegments: processedSegments.filter((s) => s.kind === 'cold').length
  });

  return {
    optVertices: finalOptVertices,
    debugInfo: {
      segmentBoundaries,
      anchorCount: anchors.length,
      anchors,
      processedSegments
    }
  };
}
