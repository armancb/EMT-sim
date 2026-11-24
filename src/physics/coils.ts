// Model B: the real coil geometry, and a Biot–Savart field evaluator.
import { R_COIL } from './constants';

export type Vec3 = [number, number, number];

export interface CoilPose {
  center: Vec3; // m
  normal: Vec3; // coil axis (direction of its field at its centre)
  u: Vec3; // in-plane basis, u × w = normal
  w: Vec3;
  /** rotation about the vertical (y) axis that maps +z onto `normal`, rad */
  yaw: number;
}

/**
 * Each coil is turned by tilt/2 about its own vertical axis, and sits a distance R0 from the
 * doughnut's symmetry axis (the vertical line x = -R0, z = 0), so the coil centres stay R apart.
 */
export function coilPoses(tiltDeg: number): [CoilPose, CoilPose] {
  const a = (tiltDeg * Math.PI) / 360;
  const make = (s: 1 | -1): CoilPose => {
    let center: Vec3;
    if (a < 1e-9) {
      center = [0, 0, (s * R_COIL) / 2];
    } else {
      const R0 = R_COIL / (2 * Math.sin(a));
      center = [-R0 * (1 - Math.cos(a)), 0, s * R0 * Math.sin(a)];
    }
    const sa = Math.sin(a);
    const ca = Math.cos(a);
    return {
      center,
      normal: [-s * sa, 0, ca],
      u: [ca, 0, s * sa],
      w: [0, 1, 0],
      yaw: -s * a,
    };
  };
  return [make(1), make(-1)];
}

/**
 * Biot–Savart field of both coils, each split into `segments` straight pieces.
 * Returned in units of (mu0 N I / 4pi); callers only use ratios and directions.
 */
export function makeBiotSavart(tiltDeg: number, segments = 72) {
  const poses = coilPoses(tiltDeg);
  const total = segments * poses.length;
  const mid = new Float64Array(total * 3);
  const dl = new Float64Array(total * 3);
  let k = 0;
  for (const p of poses) {
    for (let i = 0; i < segments; i++) {
      const t0 = (i / segments) * Math.PI * 2;
      const t1 = ((i + 1) / segments) * Math.PI * 2;
      for (let c = 0; c < 3; c++) {
        const p0 = p.center[c] + R_COIL * (Math.cos(t0) * p.u[c] + Math.sin(t0) * p.w[c]);
        const p1 = p.center[c] + R_COIL * (Math.cos(t1) * p.u[c] + Math.sin(t1) * p.w[c]);
        mid[k * 3 + c] = (p0 + p1) / 2;
        dl[k * 3 + c] = p1 - p0;
      }
      k++;
    }
  }

  return (x: number, y: number, z: number, out: Float64Array | number[]) => {
    let bx = 0;
    let by = 0;
    let bz = 0;
    for (let i = 0; i < total; i++) {
      const rx = x - mid[i * 3];
      const ry = y - mid[i * 3 + 1];
      const rz = z - mid[i * 3 + 2];
      const r2 = rx * rx + ry * ry + rz * rz;
      const inv = 1 / (r2 * Math.sqrt(r2));
      const lx = dl[i * 3];
      const ly = dl[i * 3 + 1];
      const lz = dl[i * 3 + 2];
      bx += (ly * rz - lz * ry) * inv;
      by += (lz * rx - lx * rz) * inv;
      bz += (lx * ry - ly * rx) * inv;
    }
    out[0] = bx;
    out[1] = by;
    out[2] = bz;
  };
}
