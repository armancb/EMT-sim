import { describe, expect, it } from 'vitest';
import { BEAM_LIMIT, HELMHOLTZ_FACTOR, R_COIL, RANGES, derive, type Settings } from '../src/physics/constants';
import { computeTrajectory, simulateExperiment } from '../src/physics/trajectory';
import { makeBiotSavart } from '../src/physics/coils';

const S = (tiltDeg: number, current: number, voltage: number, particle: Settings['particle'] = 'electron'): Settings => ({
  tiltDeg,
  current,
  voltage,
  particle,
});

describe('definition of done (guide §11)', () => {
  it('tilt 0°: the loop closes: 8 loops end < 0.1 mm from the start', () => {
    const t = computeTrajectory(S(0, 2.0, 250), { maxLoops: 8 });
    expect(t.loopRecords.length).toBe(9);
    const a = t.loopRecords[0];
    const b = t.loopRecords[8];
    expect(Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2])).toBeLessThan(1e-4);
  });

  it('speed stays constant to within 0.01%', () => {
    for (const s of [S(0, 2, 250), S(34.4, 2, 250), S(40, 1.2, 300)]) {
      const t = computeTrajectory(s, { maxLoops: 8, bound: Infinity });
      expect(t.maxSpeedError).toBeLessThan(1e-4);
    }
  });

  it("paper's setup: shift per loop ≈ 1.6 cm, within 10% of prediction", () => {
    const r = simulateExperiment(S(34.4, 2.0, 250));
    const measured = r.measure.measuredShift!;
    expect(measured * 100).toBeCloseTo(1.6, 0);
    expect(Math.abs(measured - r.derived.predictedShift) / r.derived.predictedShift).toBeLessThan(0.1);
  });

  it('positron drifts the opposite way with the same size of shift', () => {
    const e = simulateExperiment(S(34.4, 2.0, 250, 'electron')).measure.measuredShift!;
    const p = simulateExperiment(S(34.4, 2.0, 250, 'positron')).measure.measuredShift!;
    expect(Math.sign(e)).toBe(1);
    expect(Math.sign(p)).toBe(-1);
    expect(Math.abs(Math.abs(e) - Math.abs(p)) / Math.abs(e)).toBeLessThan(1e-6);
  });

  it('every slider corner: the undrifted orbit fits inside the bulb, and the beam never crosses the glass', () => {
    for (const tilt of [RANGES.tilt.min, RANGES.tilt.max]) {
      for (const I of [RANGES.current.min, RANGES.current.max]) {
        for (const U of [RANGES.voltage.min, RANGES.voltage.max]) {
          for (const particle of ['electron', 'positron'] as const) {
            const r = simulateExperiment(S(tilt, I, U, particle));
            // orbit launched 7.5 cm from centre fits iff rL < 7.5 cm
            expect(r.derived.rL).toBeLessThan(0.075);
            const t = r.beam;
            for (let i = 0; i < t.count; i++) {
              const d = Math.hypot(t.points[i * 3], t.points[i * 3 + 1], t.points[i * 3 + 2]);
              expect(d).toBeLessThanOrEqual(BEAM_LIMIT + 1e-9);
            }
          }
        }
      }
    }
  });

  it('raising the field strength shrinks the shift ≈ 1/current²', () => {
    const a = simulateExperiment(S(34.4, 1.5, 250)).measure.measuredShift!;
    const b = simulateExperiment(S(34.4, 3.0, 250)).measure.measuredShift!;
    expect(a / b).toBeGreaterThan(3.6);
    expect(a / b).toBeLessThan(4.4);
  });
});

describe('reference numbers (guide §12)', () => {
  const rows: [number, number, number, number, number, number][] = [
    // tilt, I, U, B0 (mT), rL (cm), shift (cm)
    [0, 2.0, 250, 1.49, 3.6, 0],
    [34.4, 2.0, 250, 1.49, 3.6, 1.6],
    [34.4, 1.5, 250, 1.11, 4.8, 2.8],
    [34.4, 3.0, 150, 2.23, 1.9, 0.4],
    [40, 1.4, 250, 1.04, 5.1, 3.8],
    [40, 1.2, 300, 0.89, 6.6, 6.1],
  ];
  for (const [tilt, I, U, B, r, shift] of rows) {
    it(`${tilt}° · ${I} A · ${U} V`, () => {
      const res = simulateExperiment(S(tilt, I, U));
      const d = derive(S(tilt, I, U));
      expect(d.B0 * 1000).toBeCloseTo(B, 1);
      expect(Math.abs(d.rL * 100 - r)).toBeLessThan(0.06);
      expect(Math.abs(d.predictedShift * 100 - shift)).toBeLessThan(0.06);
      const m = res.measure.measuredShift! * 100;
      if (shift === 0) expect(Math.abs(m)).toBeLessThan(1e-3);
      // simulated values sit close to the simple model, drifting apart for the biggest orbits
      else expect(Math.abs(m - shift) / shift).toBeLessThan(0.25);
    });
  }
});

describe('model B (Biot–Savart)', () => {
  it('parallel coils reproduce the Helmholtz centre field', () => {
    const f = makeBiotSavart(0);
    const b = [0, 0, 0];
    f(0, 0, 0, b);
    // units of mu0 N I / 4pi  →  B = 0.7155 · 4pi / R
    const expected = (HELMHOLTZ_FACTOR * 4 * Math.PI) / R_COIL;
    expect(Math.abs(b[2] - expected) / expected).toBeLessThan(0.002);
    expect(Math.abs(b[0]) + Math.abs(b[1])).toBeLessThan(1e-9 * expected + 1e-9);
  });

  it('tilted coils: field is stronger on the side of the doughnut hole (-x)', () => {
    const f = makeBiotSavart(34.4);
    const a = [0, 0, 0];
    const c = [0, 0, 0];
    f(-0.05, 0, 0, a);
    f(0.05, 0, 0, c);
    expect(Math.hypot(...a)).toBeGreaterThan(Math.hypot(...c));
  });
});
