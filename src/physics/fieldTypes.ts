// Shared between the main thread and fieldWorker.ts (kept separate so importing it never runs worker code).

export const WASH_RES = 96;

export interface FieldRequest {
  id: number;
  tiltDeg: number;
}

export interface FieldResponse {
  id: number;
  tiltDeg: number;
  /** |B| / |B(centre)| on a WASH_RES × WASH_RES grid over [-8, 8] cm, plane z = 0 */
  wash: Float32Array;
  /** traced field lines, xyz triples in cm */
  lines: Float32Array[];
}
