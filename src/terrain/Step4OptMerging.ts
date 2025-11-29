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

  /** For cold anchors: the loop-local canonical index this anchor represents */
  canonicalLoopIndex?: number;

  /** For cold anchors: the canonical loop ID this anchor belongs to */
  canonicalLoopId?: LoopId;
}

/**
 * Processed segment ready for merging
 */
export interface ProcessedSegment {
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
 * Find an opt vertex that contains a specific loop-local canonical index.
 *
 * An opt vertex "contains" a loop-local index if canonStartId <= loopIndex <= canonEndId.
 * This assumes that opt vertices use loop-local indices (0..n-1) in their canonStartId/canonEndId fields.
 *
 * @param optVertices - Array of optimized vertices from a canonical loop
 * @param loopIndex - Loop-local index (0..n-1) from canonicalEndpointIndices
 * @returns The opt vertex containing this index, or undefined if not found
 */
function findOptVertexByLoopIndex(
  optVertices: OptVertex[],
  loopIndex: number
): OptVertex | undefined {
  return optVertices.find(
    (ov) => ov.canonStartId <= loopIndex && loopIndex <= ov.canonEndId
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
  let canonicalLoopIndex: number | undefined;
  let canonicalLoopId: LoopId | undefined;

  // Case 1: Previous segment is cold - use its END opt vertex
  if (!prevSegment.isNew && prevSegment.sourceCanonicalId !== undefined) {
    const canonLoop = canonicalLoopsMap.get(prevSegment.sourceCanonicalId);
    if (canonLoop && canonLoop.optVertices && prevSegment.canonicalEndpointIndices) {
      // Use loop-local index (0..n-1) to directly look up opt vertex
      const endIndex = prevSegment.canonicalEndpointIndices[1];

      console.log('[Step4] Looking up cold-opt anchor (prev segment end)', {
        canonicalLoopId: prevSegment.sourceCanonicalId,
        endIndex,
        optVerticesCount: canonLoop.optVertices.length
      });

      // Find the opt vertex containing this canonical index
      const foundOptVertex = findOptVertexByLoopIndex(
        canonLoop.optVertices,
        endIndex
      );

      if (foundOptVertex) {
        position = { x: foundOptVertex.x, y: foundOptVertex.y };
        source = 'cold-opt';
        optVertex = foundOptVertex;
        canonicalLoopIndex = endIndex;
        canonicalLoopId = prevSegment.sourceCanonicalId;
        console.log('[Step4] ✓ Anchor from prev cold segment (opt)', {
          boundaryIndex,
          stitchedIndex,
          endIndex,
          position
        });
      } else {
        console.warn('[Step4] ✗ Failed to find opt vertex for loop index', {
          endIndex,
          canonicalLoopId: prevSegment.sourceCanonicalId,
          optVerticesCount: canonLoop.optVertices.length
        });
      }
    }
  }

  // Case 2: Next segment is cold - use its START opt vertex (if we don't have one yet)
  if (!optVertex && !nextSegment.isNew && nextSegment.sourceCanonicalId !== undefined) {
    const canonLoop = canonicalLoopsMap.get(nextSegment.sourceCanonicalId);
    if (canonLoop && canonLoop.optVertices && nextSegment.canonicalEndpointIndices) {
      // Use loop-local index (0..n-1) to directly look up opt vertex
      const startIndex = nextSegment.canonicalEndpointIndices[0];

      console.log('[Step4] Looking up cold-opt anchor (next segment start)', {
        canonicalLoopId: nextSegment.sourceCanonicalId,
        startIndex,
        optVerticesCount: canonLoop.optVertices.length
      });

      // Find the opt vertex containing this canonical index
      const foundOptVertex = findOptVertexByLoopIndex(
        canonLoop.optVertices,
        startIndex
      );

      if (foundOptVertex) {
        position = { x: foundOptVertex.x, y: foundOptVertex.y };
        source = 'cold-opt';
        optVertex = foundOptVertex;
        canonicalLoopIndex = startIndex;
        canonicalLoopId = nextSegment.sourceCanonicalId;
        console.log('[Step4] ✓ Anchor from next cold segment (opt)', {
          boundaryIndex,
          stitchedIndex,
          startIndex,
          position
        });
      } else {
        console.warn('[Step4] ✗ Failed to find opt vertex for loop index', {
          startIndex,
          canonicalLoopId: nextSegment.sourceCanonicalId,
          optVerticesCount: canonLoop.optVertices.length
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
    stitchedIndex,
    canonicalLoopIndex,
    canonicalLoopId
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
 * 2. Find opt vertices that contain the start/end loop-local indices
 * 3. Extract the range of opt vertices between them
 * 4. Handle wrapping for closed loops
 * 5. Snap endpoints to anchors
 *
 * @param segment - The cold segment ancestry
 * @param canonicalLoopsMap - Map of canonical loops
 * @param startAnchor - Anchor at segment start
 * @param endAnchor - Anchor at segment end
 * @param stitchedLoopId - ID of the stitched loop (for debugging)
 * @param segmentIndex - Index of this segment in the stitched loop (for debugging)
 * @returns Opt vertices for this segment (includes start, excludes end)
 */
function extractColdOptSegment(
  segment: SegmentAncestry,
  canonicalLoopsMap: Map<LoopId, CanonicalLoop>,
  startAnchor: Anchor,
  endAnchor: Anchor,
  stitchedLoopId: LoopId,
  segmentIndex: number
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

  if (!segment.canonicalEndpointIndices) {
    throw new Error(
      `[Step4] Cold segment missing canonicalEndpointIndices (loop-local indices)`
    );
  }

  const [startLoopIndex, endLoopIndex] = segment.canonicalEndpointIndices;

  console.log('[Step4] Extracting cold opt segment', {
    sourceCanonicalId: segment.sourceCanonicalId,
    loopIndexRange: [startLoopIndex, endLoopIndex],
    optVertexCount: canonLoop.optVertices?.length ?? 0,
    // Log canonical ranges for first/last few opt vertices to see the pattern
    firstOptVertices: canonLoop.optVertices?.slice(0, Math.min(5, canonLoop.optVertices.length)).map((ov, i) => ({
      idx: i,
      canonRange: [ov.canonStartId, ov.canonEndId]
    })) ?? [],
    lastOptVertices: canonLoop.optVertices?.slice(-Math.min(5, canonLoop.optVertices.length)).map((ov, i) => ({
      idx: canonLoop.optVertices!.length - Math.min(5, canonLoop.optVertices!.length) + i,
      canonRange: [ov.canonStartId, ov.canonEndId]
    })) ?? []
  });

  // Find opt vertex indices that contain the loop-local indices
  const startOptIdx = canonLoop.optVertices.findIndex(
    (ov) => ov.canonStartId <= startLoopIndex && startLoopIndex <= ov.canonEndId
  );
  const endOptIdx = canonLoop.optVertices.findIndex(
    (ov) => ov.canonStartId <= endLoopIndex && endLoopIndex <= ov.canonEndId
  );

  if (startOptIdx === -1) {
    throw new Error(
      `[Step4] Could not find opt vertex containing loop index ${startLoopIndex}`
    );
  }
  if (endOptIdx === -1) {
    throw new Error(
      `[Step4] Could not find opt vertex containing loop index ${endLoopIndex}`
    );
  }

  console.log('[Step4] Found opt indices', {
    startOptIdx,
    endOptIdx,
    totalOptVertices: canonLoop.optVertices.length,
    startOptVertex: canonLoop.optVertices[startOptIdx] ? {
      canonRange: [canonLoop.optVertices[startOptIdx].canonStartId, canonLoop.optVertices[startOptIdx].canonEndId],
      pos: [canonLoop.optVertices[startOptIdx].x.toFixed(3), canonLoop.optVertices[startOptIdx].y.toFixed(3)]
    } : null,
    endOptVertex: canonLoop.optVertices[endOptIdx] ? {
      canonRange: [canonLoop.optVertices[endOptIdx].canonStartId, canonLoop.optVertices[endOptIdx].canonEndId],
      pos: [canonLoop.optVertices[endOptIdx].x.toFixed(3), canonLoop.optVertices[endOptIdx].y.toFixed(3)]
    } : null
  });

  // ====== ARC SELECTION BASED ON CANONICAL ANCESTRY ======

  // 1. Compute canonical ID paths (what the stitched segment actually follows)
  const canonicalLoopSize = canonLoop.vertices.length;

  // Forward path: startLoopIndex -> endLoopIndex (positive direction)
  const canonicalIdPathForward: number[] = [];
  let idx = startLoopIndex;
  while (true) {
    canonicalIdPathForward.push(idx);
    if (idx === endLoopIndex) break;
    idx = (idx + 1) % canonicalLoopSize;
    if (canonicalIdPathForward.length > canonicalLoopSize) break; // Safety
  }

  // Backward path: startLoopIndex -> endLoopIndex (negative direction)
  const canonicalIdPathBackward: number[] = [];
  idx = startLoopIndex;
  while (true) {
    canonicalIdPathBackward.push(idx);
    if (idx === endLoopIndex) break;
    idx = (idx - 1 + canonicalLoopSize) % canonicalLoopSize;
    if (canonicalIdPathBackward.length > canonicalLoopSize) break; // Safety
  }

  // 2. Compute opt indices for both arc directions
  const forwardArcOptIndices: number[] = [];
  if (endOptIdx >= startOptIdx) {
    // No wrapping
    for (let i = startOptIdx; i < endOptIdx; i++) {
      forwardArcOptIndices.push(i);
    }
  } else {
    // Wrapping forward
    for (let i = startOptIdx; i < canonLoop.optVertices.length; i++) {
      forwardArcOptIndices.push(i);
    }
    for (let i = 0; i < endOptIdx; i++) {
      forwardArcOptIndices.push(i);
    }
  }

  const backwardArcOptIndices: number[] = [];
  if (startOptIdx >= endOptIdx) {
    // No wrapping
    for (let i = startOptIdx; i > endOptIdx; i--) {
      backwardArcOptIndices.push(i);
    }
  } else {
    // Wrapping backward
    for (let i = startOptIdx; i >= 0; i--) {
      backwardArcOptIndices.push(i);
    }
    for (let i = canonLoop.optVertices.length - 1; i > endOptIdx; i--) {
      backwardArcOptIndices.push(i);
    }
  }

  // 3. Score both arcs by canonical ancestry matching
  /**
   * Score an arc by how well its opt vertices cover the canonical ID path.
   * Returns matches (total canonical IDs covered) and longestRun (longest
   * contiguous sequence of covered IDs).
   */
  function scoreArcByAncestry(
    optIndices: number[],
    canonicalPath: number[],
    optVertices: OptVertex[]
  ): { matches: number; longestRun: number } {
    let matches = 0;
    let currentRun = 0;
    let longestRun = 0;

    for (const canonId of canonicalPath) {
      // Check if any opt vertex in this arc covers this canonical ID
      const covered = optIndices.some((optIdx) => {
        const ov = optVertices[optIdx];
        return ov.canonStartId <= canonId && canonId <= ov.canonEndId;
      });

      if (covered) {
        matches++;
        currentRun++;
        longestRun = Math.max(longestRun, currentRun);
      } else {
        currentRun = 0;
      }
    }

    return { matches, longestRun };
  }

  const forwardScore = scoreArcByAncestry(
    forwardArcOptIndices,
    canonicalIdPathForward,
    canonLoop.optVertices
  );

  const backwardScore = scoreArcByAncestry(
    backwardArcOptIndices,
    canonicalIdPathBackward,
    canonLoop.optVertices
  );

  // 4. Choose arc based on ancestry score (longestRun primary, matches secondary)
  let useForwardArc: boolean;
  let selectionMethod: 'ancestry' | 'length-fallback';

  const MIN_ANCESTRY_THRESHOLD = 2; // Require at least some ancestry match

  if (
    forwardScore.longestRun >= MIN_ANCESTRY_THRESHOLD ||
    backwardScore.longestRun >= MIN_ANCESTRY_THRESHOLD
  ) {
    // Use ancestry-based selection
    selectionMethod = 'ancestry';

    if (forwardScore.longestRun !== backwardScore.longestRun) {
      // Primary: choose arc with longer contiguous ancestry run
      useForwardArc = forwardScore.longestRun > backwardScore.longestRun;
    } else {
      // Tiebreaker: choose arc with more total matches
      useForwardArc = forwardScore.matches >= backwardScore.matches;
    }
  } else {
    // Ancestry matching failed, fall back to length heuristic
    selectionMethod = 'length-fallback';

    const stitchedSegmentLength = segment.vertexRange[1] - segment.vertexRange[0];
    const forwardDiff = Math.abs(forwardArcOptIndices.length - stitchedSegmentLength);
    const backwardDiff = Math.abs(backwardArcOptIndices.length - stitchedSegmentLength);

    useForwardArc = forwardDiff <= backwardDiff;

    console.warn('[Step4][Cold] Low ancestry match, using length fallback', {
      forwardScore,
      backwardScore,
      stitchedSegmentLength,
      forwardDiff,
      backwardDiff
    });
  }

  console.log('[Step4][Cold] Arc selection (ancestry-based)', {
    stitchedSegmentLength: segment.vertexRange[1] - segment.vertexRange[0],
    startOptIdx,
    endOptIdx,
    totalOptVertices: canonLoop.optVertices.length,
    startLoopIndex,
    endLoopIndex,
    forwardArc: {
      optIndices: forwardArcOptIndices.length,
      optIndicesArray: forwardArcOptIndices.slice(0, 10), // First 10 for debugging
      canonicalPath: canonicalIdPathForward.length,
      canonicalPathSample: canonicalIdPathForward.slice(0, 10), // First 10 for debugging
      ancestry: forwardScore
    },
    backwardArc: {
      optIndices: backwardArcOptIndices.length,
      optIndicesArray: backwardArcOptIndices.slice(0, 10), // First 10 for debugging
      canonicalPath: canonicalIdPathBackward.length,
      canonicalPathSample: canonicalIdPathBackward.slice(0, 10), // First 10 for debugging
      ancestry: backwardScore
    },
    chosen: useForwardArc ? 'forward' : 'backward',
    method: selectionMethod
  });

  // 5. Extract the chosen arc
  const result: OptVertex[] = [];

  if (useForwardArc) {
    // Forward arc: startOptIdx -> endOptIdx (positive direction)
    if (endOptIdx >= startOptIdx) {
      // No wrapping
      for (let i = startOptIdx; i < endOptIdx; i++) {
        result.push({ ...canonLoop.optVertices[i] });
      }
    } else {
      // Wrapping forward
      for (let i = startOptIdx; i < canonLoop.optVertices.length; i++) {
        result.push({ ...canonLoop.optVertices[i] });
      }
      for (let i = 0; i < endOptIdx; i++) {
        result.push({ ...canonLoop.optVertices[i] });
      }
    }
  } else {
    // Backward arc: startOptIdx -> endOptIdx (negative direction)
    if (startOptIdx >= endOptIdx) {
      // No wrapping
      for (let i = startOptIdx; i > endOptIdx; i--) {
        result.push({ ...canonLoop.optVertices[i] });
      }
    } else {
      // Wrapping backward
      for (let i = startOptIdx; i >= 0; i--) {
        result.push({ ...canonLoop.optVertices[i] });
      }
      for (let i = canonLoop.optVertices.length - 1; i > endOptIdx; i--) {
        result.push({ ...canonLoop.optVertices[i] });
      }
    }
  }

  // Snap first vertex to start anchor AND update canonical mappings
  if (result.length > 0) {
    // Determine the actual canonical index for this anchor
    // If the anchor has its own canonical loop index stored, use that
    // Otherwise fall back to startLoopIndex (for compatibility)
    const actualCanonicalIndex = startAnchor.canonicalLoopIndex ?? startLoopIndex;

    result[0] = {
      ...result[0],
      x: startAnchor.position.x,
      y: startAnchor.position.y,
      // Update canonical IDs to match the actual anchor position
      canonStartId: actualCanonicalIndex,
      canonEndId: actualCanonicalIndex
    };

    // Validate that the anchor position is close to the canonical position
    // Only validate if anchor belongs to the same canonical loop
    if (startAnchor.canonicalLoopId === segment.sourceCanonicalId &&
        startAnchor.canonicalLoopIndex !== undefined) {
      const canonVertex = canonLoop.vertices[startAnchor.canonicalLoopIndex];
      const distanceToCanonical = Math.sqrt(
        Math.pow(startAnchor.position.x - canonVertex.x, 2) +
        Math.pow(startAnchor.position.y - canonVertex.y, 2)
      );

      if (distanceToCanonical > 1.0) {
        console.error('[Step4][Cold] Start anchor far from canonical vertex!', {
          anchorCanonicalIndex: startAnchor.canonicalLoopIndex,
          segmentStartIndex: startLoopIndex,
          segmentEndIndex: endLoopIndex,
          anchorPos: startAnchor.position,
          canonicalPos: canonVertex,
          distance: distanceToCanonical.toFixed(3)
        });
      } else {
        console.log('[Step4][Cold] Start anchor validated', {
          anchorCanonicalIndex: startAnchor.canonicalLoopIndex,
          segmentStartIndex: startLoopIndex,
          segmentEndIndex: endLoopIndex,
          distanceToCanonical: distanceToCanonical.toFixed(3)
        });
      }
    } else {
      console.log('[Step4][Cold] Start anchor validation skipped (different loop or no canonical index)', {
        anchorLoopId: startAnchor.canonicalLoopId,
        segmentLoopId: segment.sourceCanonicalId,
        anchorCanonicalIndex: startAnchor.canonicalLoopIndex
      });
    }
  }

  // Note: We do NOT snap the last vertex to endAnchor because we're using
  // the "include start, exclude end" convention. The next segment will
  // include the end anchor as its start.

  console.log('[Step4][Cold] Extraction complete', {
    extractedVertexCount: result.length,
    expectedLength: useForwardArc
      ? forwardArcOptIndices.length
      : backwardArcOptIndices.length,
    selectionMethod,
    ancestryScore: useForwardArc ? forwardScore : backwardScore,
    extractedVertices: result.map((v, i) => ({
      idx: i,
      canonRange: [v.canonStartId, v.canonEndId],
      pos: [v.x.toFixed(3), v.y.toFixed(3)]
    }))
  });

  return result;
}

// ============================================================================
// 3. Warm Segment Processing
// ============================================================================

/**
 * Process a warm segment and snap its endpoints to anchors.
 *
 * Strategy:
 * 1. Extract warm vertices from stitched loop
 * 2. Assign fresh canonical IDs to maintain ancestry
 * 3. Snap first vertex to start anchor
 * 4. Return vertices (includes start, excludes end)
 *
 * Note: Optimization is currently DISABLED for warm segments.
 *
 * @param segment - The warm segment ancestry
 * @param stitchedVertices - All vertices from the stitched loop
 * @param startAnchor - Anchor at segment start
 * @param endAnchor - Anchor at segment end
 * @param optimizationOptions - Pipeline options (unused, kept for API compatibility)
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

  console.log('[Step4] Processing warm segment (optimization DISABLED)', {
    vertexRange: [startIdx, endIdx],
    vertexCount: endIdx - startIdx,
    startAnchor: {
      stitchedIndex: startAnchor.stitchedIndex,
      position: startAnchor.position,
      source: startAnchor.source
    },
    endAnchor: {
      stitchedIndex: endAnchor.stitchedIndex,
      position: endAnchor.position,
      source: endAnchor.source
    },
    totalStitchedVertices: stitchedVertices.length
  });

  // Extract warm vertices from stitched loop
  // Use "include start, exclude end" convention to match segment merging
  const warmVerts: Point[] = [];
  for (let i = startIdx; i < endIdx; i++) {
    warmVerts.push({ ...stitchedVertices[i] });
  }

  console.log('[Step4] Extracted warm vertices', {
    extractedCount: warmVerts.length,
    firstVertex: warmVerts[0],
    lastVertex: warmVerts[warmVerts.length - 1]
  });

  // Check if vertices need to be reversed based on which end is closer to start anchor
  if (warmVerts.length >= 2) {
    const distToFirst = Math.sqrt(
      Math.pow(warmVerts[0].x - startAnchor.position.x, 2) +
      Math.pow(warmVerts[0].y - startAnchor.position.y, 2)
    );
    const distToLast = Math.sqrt(
      Math.pow(warmVerts[warmVerts.length - 1].x - startAnchor.position.x, 2) +
      Math.pow(warmVerts[warmVerts.length - 1].y - startAnchor.position.y, 2)
    );

    console.log('[Step4] Checking vertex order', {
      distToFirst: distToFirst.toFixed(3),
      distToLast: distToLast.toFixed(3),
      shouldReverse: distToLast < distToFirst
    });

    // If last vertex is closer to start anchor, reverse the vertices
    if (distToLast < distToFirst) {
      warmVerts.reverse();
      console.log('[Step4] ✓ Reversed warm vertices to match anchor direction');
    }
  }

  // Convert to OptVertex[] with fresh canonical IDs (no optimization)
  const result: OptVertex[] = warmVerts.map((v) => ({
    x: v.x,
    y: v.y,
    canonStartId: allocateId(),
    canonEndId: allocateId()
  }));

  // Snap first vertex to start anchor
  if (result.length > 0) {
    const beforeSnap = { ...result[0] };
    result[0] = {
      ...result[0],
      x: startAnchor.position.x,
      y: startAnchor.position.y
    };

    const snapDistance = Math.sqrt(
      Math.pow(result[0].x - beforeSnap.x, 2) +
      Math.pow(result[0].y - beforeSnap.y, 2)
    );

    console.log('[Step4] Snapped first vertex to start anchor', {
      before: beforeSnap,
      after: result[0],
      snapDistance: snapDistance.toFixed(3)
    });
  }

  // Note: We do NOT snap the last vertex to endAnchor (see cold extraction comment)

  console.log('[Step4] Warm segment processed (no optimization)', {
    vertexCount: result.length,
    firstVertex: result[0],
    lastVertex: result[result.length - 1],
    allVertices: result.map((v, i) => ({
      idx: i,
      pos: [v.x.toFixed(3), v.y.toFixed(3)]
    }))
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
    // anchors[i] is the boundary AFTER segment i, so we need to use the previous anchor as the start
    const startAnchor = anchors[(i + anchors.length - 1) % anchors.length];
    const endAnchor = anchors[i];

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
        endAnchor,
        stitchedLoop.id,
        i
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

  // DETAILED LOGGING: Step 4 complete summary
  console.log(`[Step4][OptLoop] {
  loopId: ${stitchedLoop.id},
  warmSegments: [${processedSegments.filter(s => s.kind === 'warm').map((s, i) => `\n    { index: ${processedSegments.indexOf(s)}, vertices: ${s.optVertices.length} }`).join(',')}
  ],
  coldSegments: [${processedSegments.filter(s => s.kind === 'cold').map((s, i) => `\n    { index: ${processedSegments.indexOf(s)}, vertices: ${s.optVertices.length} }`).join(',')}
  ],
  totalOptVertices: ${finalOptVertices.length},
  anchors: [
    { x: ${anchors[0]?.position.x.toFixed(2)}, y: ${anchors[0]?.position.y.toFixed(2)} }${anchors[1] ? `,\n    { x: ${anchors[1].position.x.toFixed(2)}, y: ${anchors[1].position.y.toFixed(2)} }` : ''}
  ]
}`);

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
