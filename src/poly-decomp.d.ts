/**
 * Type declarations for poly-decomp library
 */

declare module 'poly-decomp' {
  interface Point {
    x: number;
    y: number;
  }

  function quickDecomp(polygon: Point[]): Point[][];
  function makeCCW(polygon: Point[]): void;
  function isSimple(polygon: Point[]): boolean;
  function removeCollinearPoints(polygon: Point[], threshold?: number): void;

  const decomp: {
    quickDecomp: typeof quickDecomp;
    makeCCW: typeof makeCCW;
    isSimple: typeof isSimple;
    removeCollinearPoints: typeof removeCollinearPoints;
  };

  export default decomp;
}
