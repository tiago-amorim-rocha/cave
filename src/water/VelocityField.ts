export interface VelocityField {
  getCellVelocity(x: number, y: number): { u: number; v: number };
}

