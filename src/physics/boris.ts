/**
 * Phase-exact Boris push.
 *
 * state[o..o+5] = [x, y, z, vx, vy, vz]; velocity lives on half steps (leapfrog).
 * The classic Boris rotation uses t = (q/m) B dt/2, which turns the velocity by
 * 2·atan(|t|) instead of ω·dt: a small phase lag that accumulates (~2.4 mm after
 * 8 orbits at 400 steps/orbit). Using |t| = tan(ω dt / 2) makes the gyration phase
 * exact in a uniform field while keeping the speed exactly conserved.
 *
 * `E` (optional) adds the usual half-kicks for an electric field.
 * `o` lets many particles share one flat array without allocating views.
 */
export function borisStep(
  state: Float64Array,
  B: ArrayLike<number>,
  qm: number,
  dt: number,
  E?: ArrayLike<number>,
  o = 0,
): void {
  let vx = state[o + 3];
  let vy = state[o + 4];
  let vz = state[o + 5];

  if (E) {
    const h = (qm * dt) / 2;
    vx += h * E[0];
    vy += h * E[1];
    vz += h * E[2];
  }

  const bx = B[0];
  const by = B[1];
  const bz = B[2];
  const bm = Math.sqrt(bx * bx + by * by + bz * bz);
  if (bm > 0) {
    const f = Math.tan((qm * bm * dt) / 2) / bm;
    const tx = bx * f;
    const ty = by * f;
    const tz = bz * f;
    const s = 2 / (1 + tx * tx + ty * ty + tz * tz);
    // v' = v + v × t
    const px = vx + (vy * tz - vz * ty);
    const py = vy + (vz * tx - vx * tz);
    const pz = vz + (vx * ty - vy * tx);
    // v+ = v + v' × (s t)
    vx += (py * tz - pz * ty) * s;
    vy += (pz * tx - px * tz) * s;
    vz += (px * ty - py * tx) * s;
  }

  if (E) {
    const h = (qm * dt) / 2;
    vx += h * E[0];
    vy += h * E[1];
    vz += h * E[2];
  }

  state[o + 3] = vx;
  state[o + 4] = vy;
  state[o + 5] = vz;
  state[o] += vx * dt;
  state[o + 1] += vy * dt;
  state[o + 2] += vz * dt;
}
