import { describe, expect, it } from 'vitest';
import { HELMHOLTZ_FACTOR, MU0, N_TURNS, R_COIL } from '../src/physics/constants';
import {
  READING_ERROR,
  SWEEP_POINTS,
  realCoilField,
  runLab,
  sweepCurrents,
  theoryCurves,
  withReadingError,
} from '../src/physics/lab';

describe('virtual lab (guide §8)', () => {
  it('sweeps 8 currents from 1.2 A to 3.0 A', () => {
    const c = sweepCurrents();
    expect(c.length).toBe(SWEEP_POINTS);
    expect(c[0]).toBeCloseTo(1.2, 9);
    expect(c[c.length - 1]).toBeCloseTo(3.0, 9);
  });

  it('real-coil field at the centre is close to the Helmholtz value, in tesla', () => {
    const b = new Float64Array(3);
    realCoilField(0, 2)(0, 0, 0, b);
    const expected = (HELMHOLTZ_FACTOR * MU0 * N_TURNS * 2) / R_COIL;
    expect(Math.abs(b[2] - expected) / expected).toBeLessThan(0.003);
  });

  it('reading error stays within ±0.1 cm and never goes negative', () => {
    expect(withReadingError(0.02, () => 0)).toBeCloseTo(0.02 - READING_ERROR, 12);
    expect(withReadingError(0.02, () => 1)).toBeCloseTo(0.02 + READING_ERROR, 12);
    expect(withReadingError(0.0005, () => 0)).toBe(0);
  });

  it('the two theory lines diverge for big orbits and nearly meet for small ones', () => {
    const t = theoryCurves(5);
    const ratio = t.real.map((r, i) => r / t.simple[i]);
    // low current = big orbit: real coils drift clearly further
    expect(ratio[0]).toBeGreaterThan(1.25);
    // high current = small orbit: the lines close up (but the real coils still drift a bit more)
    expect(ratio[ratio.length - 1]).toBeLessThan(1.2);
    expect(ratio[ratio.length - 1]).toBeGreaterThan(1);
    expect(ratio[0] - ratio[ratio.length - 1]).toBeGreaterThan(0.15);
    // shift falls monotonically with current on both lines
    for (let i = 1; i < t.currents.length; i++) {
      expect(t.real[i]).toBeLessThan(t.real[i - 1]);
      expect(t.simple[i]).toBeLessThan(t.simple[i - 1]);
    }
  });

  it('the visible beam never crosses the glass in the real field', () => {
    for (const I of sweepCurrents()) {
      const { beam } = runLab(I);
      for (let i = 0; i < beam.count; i++) {
        const d = Math.hypot(beam.points[i * 3], beam.points[i * 3 + 1], beam.points[i * 3 + 2]);
        expect(d).toBeLessThanOrEqual(0.0785 + 1e-9);
      }
      expect(beam.maxSpeedError).toBeLessThan(1e-4);
    }
  });
});
