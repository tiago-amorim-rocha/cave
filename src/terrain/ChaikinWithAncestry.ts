import type { OptVertex } from './CanonicalGeometry';

/**
 * Chaikin smoothing that preserves ancestry ID ranges across generated vertices.
 * canonStartId = min of endpoints, canonEndId = max of endpoints.
 */
export function chaikinWithAncestry(
  vertices: OptVertex[],
  iterations: number = 1,
  ratio: number = 0.25,
  closed: boolean = true,
  baseIndexPeriod?: number
): OptVertex[] {
  if (iterations <= 0 || vertices.length < 2) {
    return vertices.slice();
  }

  // Canonical ancestry is stored as loop-local indices. For closed loops, the edge
  // connecting the last vertex to the first must be treated as adjacent on a circle,
  // not as a huge numeric jump (N-1 -> 0). We "unwrap" that seam by allowing indices
  // to exceed N-1 and shifting the wrap endpoint by +N when needed.
  const period = baseIndexPeriod ?? vertices.length;

  let working = vertices.slice();

  for (let iter = 0; iter < iterations; iter++) {
    const result: OptVertex[] = [];
    const edgeCount = closed ? working.length : working.length - 1;

    for (let i = 0; i < edgeCount; i++) {
      const a = working[i];
      const b = working[(i + 1) % working.length];

      // Seam handling for closed loops: shift the wrap endpoint forward by +period
      // so the ancestry union stays local rather than expanding to [0..N-1].
      let bStart = b.canonStartId;
      let bEnd = b.canonEndId;
      if (closed && i === edgeCount - 1) {
        const aStart = a.canonStartId;
        // If b is "behind" a in the unwrapped index space, shift it forward.
        if (bEnd < aStart) {
          bStart += period;
          bEnd += period;
        }
      }

      const canonStartId = Math.min(a.canonStartId, bStart);
      const canonEndId = Math.max(a.canonEndId, bEnd);

      console.assert(
        canonStartId <= canonEndId,
        '[Chaikin] Invalid ancestry range',
        { canonStartId, canonEndId }
      );

      const q: OptVertex = {
        x: a.x * (1 - ratio) + b.x * ratio,
        y: a.y * (1 - ratio) + b.y * ratio,
        canonStartId,
        canonEndId,
      };

      const r: OptVertex = {
        x: a.x * ratio + b.x * (1 - ratio),
        y: a.y * ratio + b.y * (1 - ratio),
        canonStartId,
        canonEndId,
      };

      result.push(q, r);
    }

    if (closed && result.length > 0) {
      // Keep the loop "unwrapped" by shifting the closing duplicate forward by +period.
      result.push({
        ...result[0],
        canonStartId: result[0].canonStartId + period,
        canonEndId: result[0].canonEndId + period
      });
    }

    console.log(`[Chaikin] Iteration ${iter}`, {
      before: working.length,
      after: result.length,
      sampleAncestry: result.slice(0, 5).map(v => [v.canonStartId, v.canonEndId])
    });

    working = result;
  }

  return working;
}
