import { createCanonicalLoop, replaceCanonicalRange, type CanonicalLoop } from './CanonicalGeometry';
import type { Point } from '../types';

function assert(condition: boolean, message: string): void {
  if (!condition) {
    throw new Error(`[CanonSurgeryTest] ${message}`);
  }
}

function makeLoop(vertices: Point[]): CanonicalLoop {
  return createCanonicalLoop(vertices);
}

function runTests(): void {
  const gridPitch = 0.2;

  // Simple replacement (same topology)
  const base = makeLoop([
    { x: 0, y: 0 },
    { x: 2, y: 0 },
    { x: 2, y: 2 },
    { x: 0, y: 2 },
    { x: 0, y: 0 },
  ]);
  const replacement = [
    { x: 1, y: 0 },
    { x: 2, y: 1 },
  ];
  const res1 = replaceCanonicalRange(base, 1, 2, replacement, gridPitch);
  assert(res1.length === 1, 'Simple replacement should keep single loop');

  // Split: construct replacement that closes a small loop and continues
  const splitReplacement = [
    { x: 2, y: 0 },
    { x: 3, y: 0 },
    { x: 3, y: 1 },
    { x: 2, y: 1 },
    { x: 2, y: 0 }, // closes small loop
    { x: 2, y: 2 },
  ];
  const res2 = replaceCanonicalRange(base, 1, 2, splitReplacement, gridPitch);
  assert(res2.length >= 1, 'Split replacement should return at least one loop');

  console.log('[CanonSurgeryTest] Passed', {
    simple: res1.length,
    split: res2.length,
  });
}

// Run only when explicitly requested
if (typeof process !== 'undefined' && process.env?.CANON_SURGERY_TEST === '1') {
  runTests();
}

export { runTests as runCanonicalSurgeryTests };
