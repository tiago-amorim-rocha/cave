import type { OptVertex } from './CanonicalGeometry';

/**
 * Chaikin smoothing that preserves ancestry ID ranges across generated vertices.
 * canonStartId = min of endpoints, canonEndId = max of endpoints.
 */
export function chaikinWithAncestry(
  vertices: OptVertex[],
  iterations: number = 1,
  ratio: number = 0.25,
  closed: boolean = true
): OptVertex[] {
  if (iterations <= 0 || vertices.length < 2) {
    return vertices.slice();
  }

  let working = vertices.slice();

  for (let iter = 0; iter < iterations; iter++) {
    const result: OptVertex[] = [];
    const edgeCount = closed ? working.length : working.length - 1;

    for (let i = 0; i < edgeCount; i++) {
      const a = working[i];
      const b = working[(i + 1) % working.length];

      const canonStartId = Math.min(a.canonStartId, b.canonStartId);
      const canonEndId = Math.max(a.canonEndId, b.canonEndId);

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
      result.push({ ...result[0] });
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
