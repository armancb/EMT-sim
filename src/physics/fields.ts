// Magnetic field models. All functions write into `out` to avoid allocation in hot loops.

export type FieldFn = (x: number, y: number, z: number, out: Float64Array) => void;

/**
 * Model A: ideal doughnut field. Bulb centre at the origin, coil axis = z,
 * x points away from the doughnut's hole, y is vertical.
 * Symmetry axis is the vertical line x = -R0, z = 0.  B = B0 R0 / rho  (phi-hat).
 * With R0 = Infinity it reduces to the uniform field B0 z-hat.
 */
export function torusField(B0: number, R0: number): FieldFn {
  if (!Number.isFinite(R0)) {
    return (_x, _y, _z, out) => {
      out[0] = 0;
      out[1] = 0;
      out[2] = B0;
    };
  }
  return (x, _y, z, out) => {
    const X = x + R0;
    const k = (B0 * R0) / (X * X + z * z);
    out[0] = -z * k;
    out[1] = 0;
    out[2] = X * k;
  };
}

/** |B| / B0 of Model A at a point in the z = 0 plane. */
export function torusStrengthRatio(x: number, R0: number): number {
  return Number.isFinite(R0) ? R0 / (x + R0) : 1;
}
