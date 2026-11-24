// Web Worker: real-coil (Biot–Savart) field products for the view toggles.
// Output is in scene units (cm).
import { makeBiotSavart } from './coils';
import { WASH_RES, type FieldRequest, type FieldResponse } from './fieldTypes';

const WASH_HALF = 0.08; // m
const TRACE_BOUND = 0.11; // m
const STEP = 0.0015; // m

interface WorkerScope {
  onmessage: ((e: MessageEvent<FieldRequest>) => void) | null;
  postMessage(msg: unknown, transfer: Transferable[]): void;
}
const ctx = self as unknown as WorkerScope;

ctx.onmessage = (e) => {
  const { id, tiltDeg } = e.data;
  const field = makeBiotSavart(tiltDeg);
  const b = new Float64Array(3);

  field(0, 0, 0, b);
  const bc = Math.hypot(b[0], b[1], b[2]);

  const wash = new Float32Array(WASH_RES * WASH_RES);
  for (let j = 0; j < WASH_RES; j++) {
    const y = -WASH_HALF + (2 * WASH_HALF * (j + 0.5)) / WASH_RES;
    for (let i = 0; i < WASH_RES; i++) {
      const x = -WASH_HALF + (2 * WASH_HALF * (i + 0.5)) / WASH_RES;
      field(x, y, 0, b);
      wash[j * WASH_RES + i] = Math.hypot(b[0], b[1], b[2]) / bc;
    }
  }

  const seeds: [number, number][] = [[0, 0]];
  for (let k = 0; k < 6; k++) {
    const t = (k / 6) * Math.PI * 2 + Math.PI / 6;
    seeds.push([0.032 * Math.cos(t), 0.032 * Math.sin(t)]);
  }
  for (let k = 0; k < 8; k++) {
    const t = (k / 8) * Math.PI * 2;
    seeds.push([0.06 * Math.cos(t), 0.06 * Math.sin(t)]);
  }

  const dir = (p: number[], out: number[]) => {
    field(p[0], p[1], p[2], b);
    const m = Math.hypot(b[0], b[1], b[2]) || 1;
    out[0] = b[0] / m;
    out[1] = b[1] / m;
    out[2] = b[2] / m;
  };

  const trace = (start: number[], sign: number): number[][] => {
    const pts: number[][] = [];
    const p = start.slice();
    const k1 = [0, 0, 0];
    const k2 = [0, 0, 0];
    const k3 = [0, 0, 0];
    const k4 = [0, 0, 0];
    const tmp = [0, 0, 0];
    const h = STEP * sign;
    for (let i = 0; i < 400; i++) {
      dir(p, k1);
      for (let c = 0; c < 3; c++) tmp[c] = p[c] + (h / 2) * k1[c];
      dir(tmp, k2);
      for (let c = 0; c < 3; c++) tmp[c] = p[c] + (h / 2) * k2[c];
      dir(tmp, k3);
      for (let c = 0; c < 3; c++) tmp[c] = p[c] + h * k3[c];
      dir(tmp, k4);
      for (let c = 0; c < 3; c++) p[c] += (h / 6) * (k1[c] + 2 * k2[c] + 2 * k3[c] + k4[c]);
      if (Math.hypot(p[0], p[1], p[2]) > TRACE_BOUND) break;
      pts.push(p.slice());
    }
    return pts;
  };

  const lines: Float32Array[] = [];
  for (const [sx, sy] of seeds) {
    const start = [sx, sy, 0];
    const back = trace(start, -1).reverse();
    const fwd = trace(start, 1);
    const all = [...back, start, ...fwd];
    const arr = new Float32Array(all.length * 3);
    all.forEach((q, i) => {
      arr[i * 3] = q[0] * 100;
      arr[i * 3 + 1] = q[1] * 100;
      arr[i * 3 + 2] = q[2] * 100;
    });
    lines.push(arr);
  }

  const res: FieldResponse = { id, tiltDeg, wash, lines };
  ctx.postMessage(res, [wash.buffer, ...lines.map((l) => l.buffer)]);
};
