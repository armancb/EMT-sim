import { beforeAll, describe, expect, it } from 'vitest';

// Plasma builds a sprite texture via a 2D canvas; give node a minimal stand-in.
beforeAll(() => {
  const ctx2d = new Proxy({}, { get: () => () => ({ addColorStop() {} }) });
  (globalThis as any).document = {
    createElement: () => ({ width: 0, height: 0, getContext: () => ctx2d }),
  };
});

const damp = (c: number, t: number, l: number, dt: number) => t + (c - t) * Math.exp(-l * dt);
const DT = 1 / 60;

async function make() {
  const { Plasma } = await import('../src/tokamak/particles');
  return new Plasma();
}

describe('tokamak stages (stylised)', () => {
  it('A: electrons drift up, ions drift down', async () => {
    const p = await make();
    for (let i = 0; i < 4 * 60; i++) p.update(DT, true);
    const s = p.separation();
    expect(s.eTop).toBeGreaterThan(0.15);
    expect(s.iBottom).toBeGreaterThan(0.15);
  });

  it('B: charge separation field pushes the plasma out', async () => {
    const p = await make();
    for (let i = 0; i < 4 * 60; i++) p.update(DT, true);
    const before = p.separation().aliveFrac;
    for (let i = 0; i < 6 * 60; i++) {
      p.Ey = damp(p.Ey, p.separationField(), 1.2, DT);
      p.update(DT, true);
    }
    const after = p.separation().aliveFrac;
    expect(after).toBeLessThan(before * 0.35);
  });

  it('C: twisted field keeps the plasma confined', async () => {
    const p = await make();
    p.twist = 1;
    p.respawn = false; // measure confinement honestly, without refills
    for (let i = 0; i < 10 * 60; i++) p.update(DT, true);
    const s = p.separation();
    expect(s.aliveFrac).toBeGreaterThan(0.9);
    expect(Math.abs(s.eTop)).toBeLessThan(0.15);
    expect(Math.abs(s.iBottom)).toBeLessThan(0.15);
  });
});
