import type { OptVertex } from './CanonicalGeometry';

/**
 * Chaikin smoothing that preserves ancestry ranges across generated vertices.
 * canonStart = min of endpoints, canonEnd = max of endpoints.
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

      const canonStart = Math.min(a.canonStart, b.canonStart);
      const canonEnd = Math.max(a.canonEnd, b.canonEnd);

      console.assert(
        canonStart <= canonEnd,
        '[Chaikin] Invalid ancestry range',
        { canonStart, canonEnd }
      );

      const q: OptVertex = {
        x: a.x * (1 - ratio) + b.x * ratio,
        y: a.y * (1 - ratio) + b.y * ratio,
        canonStart,
        canonEnd,
      };

      const r: OptVertex = {
        x: a.x * ratio + b.x * (1 - ratio),
        y: a.y * ratio + b.y * (1 - ratio),
        canonStart,
        canonEnd,
      };

      result.push(q, r);
    }

    if (closed && result.length > 0) {
      result.push({ ...result[0] });
    }

    console.log(`[Chaikin] Iteration ${iter}`, {
      before: working.length,
      after: result.length,
      sampleAncestry: result.slice(0, 5).map(v => [v.canonStart, v.canonEnd])
    });

    working = result;
  }

  return working;
}
