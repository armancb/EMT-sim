import { BEAM_LIMIT, GUN_OFFSET, derive, type Derived, type Settings } from './constants';
import { borisStep } from './boris';
import { torusField, type FieldFn } from './fields';

export type Launch = 'gun' | 'centered';

export interface TrajectoryOptions {
  maxLoops?: number;
  /** Stop when the particle leaves this sphere (m). Infinity = never. */
  bound?: number;
  stepsPerOrbit?: number;
  launch?: Launch;
  /** Override the field model (default: Model A, the ideal doughnut). */
  field?: FieldFn;
}

export interface Trajectory {
  /** xyz triples in metres */
  points: Float64Array;
  count: number;
  /** position each time the velocity completes a full turn (first entry = launch point) */
  loopRecords: [number, number, number][];
  /** fractional index into `points` for each loop record */
  loopIndices: number[];
  exited: boolean;
  maxSpeedError: number;
  /** mean change in y per loop (signed, m); null if fewer than one complete loop */
  measuredShift: number | null;
  derived: Derived;
}

const TWO_PI = Math.PI * 2;

/**
 * Electron gun sits at the bottom of the bulb firing along +x, so the electron curves up.
 * A positron drifts the other way (down), so its source is mirrored to the top of the bulb,
 * also firing along +x, so it curves down into the bulb.
 */
export function launchState(s: Settings, d: Derived, launch: Launch): Float64Array {
  const st = new Float64Array(6);
  const offset = launch === 'gun' ? GUN_OFFSET : d.rL;
  st[1] = s.particle === 'electron' ? -offset : offset;
  st[3] = d.speed;
  return st;
}

export function computeTrajectory(s: Settings, opts: TrajectoryOptions = {}): Trajectory {
  const d = derive(s);
  const maxLoops = opts.maxLoops ?? 8;
  const bound = opts.bound ?? BEAM_LIMIT;
  const spo = opts.stepsPerOrbit ?? 400;
  const field = opts.field ?? torusField(d.B0, d.R0);
  const dt = d.period / spo;
  const maxSteps = Math.ceil(maxLoops * spo * 1.6) + 16;

  const pts = new Float64Array((maxSteps + 2) * 3);
  let n = 0;
  const push = (x: number, y: number, z: number) => {
    pts[n * 3] = x;
    pts[n * 3 + 1] = y;
    pts[n * 3 + 2] = z;
    n++;
  };

  const st = launchState(s, d, opts.launch ?? 'gun');
  push(st[0], st[1], st[2]);

  const B = new Float64Array(3);
  const records: [number, number, number][] = [[st[0], st[1], st[2]]];
  const loopIndices = [0];
  let prevVx = st[3];
  let prevVy = st[4];
  let angle = 0;
  let nextLoop = 1;
  let exited = false;
  let maxErr = 0;
  const v0 = d.speed;
  const b2 = bound * bound;

  for (let i = 0; i < maxSteps; i++) {
    const ax = st[0];
    const ay = st[1];
    const az = st[2];
    field(ax, ay, az, B);
    borisStep(st, B, d.qm, dt);

    const sp = Math.hypot(st[3], st[4], st[5]);
    const err = Math.abs(sp - v0) / v0;
    if (err > maxErr) maxErr = err;

    const cross = prevVx * st[4] - prevVy * st[3];
    const dot = prevVx * st[3] + prevVy * st[4];
    const prevAngle = angle;
    angle += Math.abs(Math.atan2(cross, dot));
    prevVx = st[3];
    prevVy = st[4];

    const r2 = st[0] * st[0] + st[1] * st[1] + st[2] * st[2];
    if (r2 > b2) {
      // clip the last segment to the glass
      const dx = st[0] - ax;
      const dy = st[1] - ay;
      const dz = st[2] - az;
      const aa = dx * dx + dy * dy + dz * dz;
      const bb = ax * dx + ay * dy + az * dz;
      const cc = ax * ax + ay * ay + az * az - b2;
      const f = aa > 0 ? (-bb + Math.sqrt(Math.max(0, bb * bb - aa * cc))) / aa : 0;
      push(ax + f * dx, ay + f * dy, az + f * dz);
      exited = true;
      break;
    }

    push(st[0], st[1], st[2]);

    let done = false;
    while (angle >= nextLoop * TWO_PI) {
      const f = (nextLoop * TWO_PI - prevAngle) / (angle - prevAngle);
      const rec: [number, number, number] = [
        ax + f * (st[0] - ax),
        ay + f * (st[1] - ay),
        az + f * (st[2] - az),
      ];
      records.push(rec);
      loopIndices.push(n - 2 + f);
      nextLoop++;
      if (records.length - 1 >= maxLoops) {
        // end the path exactly on the final loop point
        pts[(n - 1) * 3] = rec[0];
        pts[(n - 1) * 3 + 1] = rec[1];
        pts[(n - 1) * 3 + 2] = rec[2];
        loopIndices[loopIndices.length - 1] = n - 1;
        done = true;
        break;
      }
    }
    if (done) break;
  }

  const loops = records.length - 1;
  const measuredShift = loops >= 1 ? (records[loops][1] - records[0][1]) / loops : null;

  return {
    points: pts.subarray(0, n * 3),
    count: n,
    loopRecords: records,
    loopIndices,
    exited,
    maxSpeedError: maxErr,
    measuredShift,
    derived: d,
  };
}

export interface ExperimentResult {
  /** what the audience sees: stops at the glass or after 8 loops */
  beam: Trajectory;
  /** same launch, no glass, 3 loops, used for the "measured" readout and guiding centre */
  measure: Trajectory;
  derived: Derived;
}

export function simulateExperiment(s: Settings): ExperimentResult {
  const beam = computeTrajectory(s, { maxLoops: 8 });
  const measure = computeTrajectory(s, { maxLoops: 3, bound: Infinity });
  return { beam, measure, derived: beam.derived };
}

/** Centroid of each complete loop: the guiding centre positions (m). */
export function loopCentroids(t: Trajectory): [number, number, number][] {
  const out: [number, number, number][] = [];
  for (let k = 0; k + 1 < t.loopIndices.length; k++) {
    const a = Math.floor(t.loopIndices[k]);
    const b = Math.floor(t.loopIndices[k + 1]);
    let sx = 0;
    let sy = 0;
    let sz = 0;
    let c = 0;
    for (let i = a; i < b; i++) {
      sx += t.points[i * 3];
      sy += t.points[i * 3 + 1];
      sz += t.points[i * 3 + 2];
      c++;
    }
    if (c > 0) out.push([sx / c, sy / c, sz / c]);
  }
  return out;
}
