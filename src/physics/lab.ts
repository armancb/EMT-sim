// Chapter 4 (Virtual Lab): a current sweep "measured" in the real coil field, plus two theory curves.
import { MU0, N_TURNS, PAPER_TILT, RANGES, derive, type Settings } from './constants';
import { makeBiotSavart } from './coils';
import type { FieldFn } from './fields';
import { computeTrajectory, type Trajectory } from './trajectory';

export const LAB_TILT = PAPER_TILT;
export const LAB_VOLTAGE = 250;
export const SWEEP_POINTS = 8;
export const READING_ERROR = 0.001; // ±0.1 cm, like a student with a ruler

const labSettings = (current: number): Settings => ({
  tiltDeg: LAB_TILT,
  current,
  voltage: LAB_VOLTAGE,
  particle: 'electron',
});

let cached: { tilt: number; fn: ReturnType<typeof makeBiotSavart> } | null = null;

/** Model B in tesla: the Biot–Savart field of the two real coils carrying `current`. */
export function realCoilField(tiltDeg: number, current: number): FieldFn {
  if (!cached || cached.tilt !== tiltDeg) cached = { tilt: tiltDeg, fn: makeBiotSavart(tiltDeg) };
  const bs = cached.fn;
  const k = (MU0 * N_TURNS * current) / (4 * Math.PI);
  return (x, y, z, out) => {
    bs(x, y, z, out);
    out[0] *= k;
    out[1] *= k;
    out[2] *= k;
  };
}

export interface LabRun {
  current: number;
  /** what the audience sees: from the gun, stopped by the glass */
  beam: Trajectory;
  /** same launch, no glass: the first two loop points are what the ruler spans */
  measure: Trajectory;
  /** true gap between the first two loops in the real field (m) */
  trueShift: number;
}

export function runLab(current: number): LabRun {
  const s = labSettings(current);
  const field = realCoilField(LAB_TILT, current);
  const beam = computeTrajectory(s, { maxLoops: 8, field });
  const measure = computeTrajectory(s, { maxLoops: 2, bound: Infinity, field });
  const r = measure.loopRecords;
  return { current, beam, measure, trueShift: Math.abs(r[1][1] - r[0][1]) };
}

export function linspace(a: number, b: number, n: number): number[] {
  return Array.from({ length: n }, (_, i) => a + ((b - a) * i) / (n - 1));
}

export const sweepCurrents = () => linspace(RANGES.current.min, RANGES.current.max, SWEEP_POINTS);

/** A reading with ±0.1 cm uniform error. */
export function withReadingError(shift: number, rand: () => number = Math.random): number {
  return Math.max(0, shift + (rand() * 2 - 1) * READING_ERROR);
}

export interface TheoryCurves {
  currents: number[];
  /** π r_L² / R₀ with the ideal doughnut (m) */
  simple: number[];
  /** shift computed through the real coil field (m) */
  real: number[];
}

/** Both theory lines on a fine current grid. ~20 short trajectories through Biot–Savart: a few tens of ms. */
export function theoryCurves(n = 19): TheoryCurves {
  const currents = linspace(RANGES.current.min, RANGES.current.max, n);
  return {
    currents,
    simple: currents.map((I) => derive(labSettings(I)).predictedShift),
    real: currents.map((I) => runLab(I).trueShift),
  };
}
