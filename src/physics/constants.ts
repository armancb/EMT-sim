// Physical constants and apparatus parameters (SI units throughout).

export const ME = 9.1093837015e-31; // electron mass, kg
export const QE = 1.602176634e-19; // elementary charge, C
export const MU0 = 4e-7 * Math.PI; // vacuum permeability

// 3B Scientific U8481500 Helmholtz coil pair
export const N_TURNS = 124;
export const R_COIL = 0.15; // mean coil radius, m
export const HELMHOLTZ_FACTOR = 0.7155; // (4/5)^(3/2)

export const BULB_RADIUS = 0.08; // fine beam tube, m
export const BEAM_LIMIT = 0.0785; // beam stops at the inner glass surface
export const GUN_OFFSET = 0.075; // gun nozzle distance from the bulb centre

export const PAPER_TILT = 34.4; // degrees

export const RANGES = {
  tilt: { min: 0, max: 40, step: 0.1 },
  current: { min: 1.2, max: 3.0, step: 0.05 },
  voltage: { min: 150, max: 300, step: 5 },
} as const;

export type ParticleKind = 'electron' | 'positron';

export interface Settings {
  tiltDeg: number; // angle between the two coil axes
  current: number; // coil current, A
  voltage: number; // accelerating voltage, V
  particle: ParticleKind;
}

export const DEFAULT_SETTINGS: Settings = { tiltDeg: 0, current: 2.0, voltage: 250, particle: 'electron' };

export interface Derived {
  speed: number; // m/s
  B0: number; // field at the bulb centre, T
  R0: number; // radius of curvature of the field lines (Infinity when parallel), m
  qm: number; // signed charge-to-mass ratio
  rL: number; // Larmor radius, m
  period: number; // cyclotron period, s
  predictedShift: number; // pi rL^2 / R0, m (magnitude)
}

export function derive(s: Settings): Derived {
  const speed = Math.sqrt((2 * QE * s.voltage) / ME);
  const B0 = (HELMHOLTZ_FACTOR * MU0 * N_TURNS * s.current) / R_COIL;
  const half = (s.tiltDeg * Math.PI) / 360;
  const R0 = s.tiltDeg <= 1e-6 ? Infinity : R_COIL / (2 * Math.sin(half));
  const qm = ((s.particle === 'electron' ? -1 : 1) * QE) / ME;
  const rL = (ME * speed) / (QE * B0);
  const period = (2 * Math.PI * ME) / (QE * B0);
  const predictedShift = Number.isFinite(R0) ? (Math.PI * rL * rL) / R0 : 0;
  return { speed, B0, R0, qm, rL, period, predictedShift };
}
