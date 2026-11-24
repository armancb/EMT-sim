import * as THREE from 'three';
import { borisStep } from '../physics/boris';
import { glowTexture, hdr } from '../scene/util';

/*
 * Stylised tokamak plasma (not to scale). Normalised units:
 *   major radius R0 = 1, minor radius a = 0.3, |B| = 1 on the magnetic axis.
 *   electron q/m = -1; ion q/m = +1/25 (mass ratio 25, same energy as the electrons).
 * One real second advances SIM_RATE units of simulation time.
 */
export const MINOR_A = 0.3;
const N_PER_SPECIES = 300;
const N = N_PER_SPECIES * 2;
const TRAIL = 14;
const SIM_RATE = 400;
const DT = 0.25;
const MAX_STEPS_PER_FRAME = 48;
const V_E = 0.01;
const V_I = V_E / 5; // same energy, mass ratio 25
const SPARKS = 96;

/** stylised safety factor: field lines go round poloidally once per q toroidal turns */
export const SAFETY_Q = 1;

export const E_MAX = 4e-4;
const E_GAIN = 1.5e-3;

export class Plasma {
  readonly group = new THREE.Group();
  private state = new Float64Array(N * 6);
  private qm = new Float64Array(N);
  private alive = new Uint8Array(N);
  private respawnIn = new Float64Array(N);
  private trail = new Float32Array(N * TRAIL * 3);
  private trailLen = new Uint8Array(N);
  private trailHead = new Uint8Array(N);
  private simAcc = 0;

  /** 0 → pure toroidal field, 1 → full helical twist (plasma current on) */
  twist = 0;
  /** vertical electric field from charge separation (sim units) */
  Ey = 0;
  /** respawn particles lost to the wall (stage C only) */
  respawn = false;

  private points: THREE.Points;
  private pointPos = new Float32Array(N * 3);
  private trails: THREE.LineSegments;
  private trailPos = new Float32Array(N * (TRAIL - 1) * 2 * 3);
  private trailCol = new Float32Array(N * (TRAIL - 1) * 2 * 3);
  private baseCol: THREE.Color[] = [];

  private sparkPts: THREE.Points;
  private sparkPos = new Float32Array(SPARKS * 3);
  private sparkCol = new Float32Array(SPARKS * 3);
  private sparkLife = new Float32Array(SPARKS);
  private sparkNext = 0;

  private B = new Float64Array(3);
  private E = new Float64Array(3);

  constructor() {
    const eCol = hdr(0x6fb7ff, 1.8);
    const iCol = hdr(0xffb347, 1.6);
    const colors = new Float32Array(N * 3);
    for (let i = 0; i < N; i++) {
      const c = i < N_PER_SPECIES ? eCol : iCol;
      this.baseCol.push(c);
      colors.set([c.r, c.g, c.b], i * 3);
      this.qm[i] = i < N_PER_SPECIES ? -1 : 1 / 25;
    }

    const pg = new THREE.BufferGeometry();
    pg.setAttribute('position', new THREE.BufferAttribute(this.pointPos, 3));
    pg.setAttribute('color', new THREE.BufferAttribute(colors, 3));
    this.points = new THREE.Points(
      pg,
      new THREE.PointsMaterial({
        map: glowTexture(),
        size: 1.1,
        vertexColors: true,
        transparent: true,
        depthWrite: false,
        blending: THREE.AdditiveBlending,
      }),
    );

    const tg = new THREE.BufferGeometry();
    tg.setAttribute('position', new THREE.BufferAttribute(this.trailPos, 3));
    tg.setAttribute('color', new THREE.BufferAttribute(this.trailCol, 3));
    this.trails = new THREE.LineSegments(
      tg,
      new THREE.LineBasicMaterial({
        vertexColors: true,
        transparent: true,
        depthWrite: false,
        blending: THREE.AdditiveBlending,
      }),
    );

    const sg = new THREE.BufferGeometry();
    sg.setAttribute('position', new THREE.BufferAttribute(this.sparkPos, 3));
    sg.setAttribute('color', new THREE.BufferAttribute(this.sparkCol, 3));
    this.sparkPts = new THREE.Points(
      sg,
      new THREE.PointsMaterial({
        map: glowTexture(),
        size: 1.8,
        vertexColors: true,
        transparent: true,
        depthWrite: false,
        blending: THREE.AdditiveBlending,
      }),
    );

    for (const o of [this.points, this.trails, this.sparkPts]) {
      o.frustumCulled = false;
      this.group.add(o);
    }
    this.reset();
  }

  reset() {
    for (let i = 0; i < N; i++) this.spawn(i, 0.2);
    this.sparkLife.fill(0);
    this.sparkCol.fill(0);
    this.Ey = 0;
    this.twist = 0;
    this.respawn = false;
    this.simAcc = 0;
  }

  private spawn(i: number, maxR: number) {
    const st = this.state;
    const phi = Math.random() * Math.PI * 2;
    const r = maxR * Math.sqrt(Math.random());
    const th = Math.random() * Math.PI * 2;
    const R = 1 + r * Math.cos(th);
    const y = r * Math.sin(th);
    const cx = Math.cos(phi);
    const sz = Math.sin(phi);
    const o = i * 6;
    st[o] = R * cx;
    st[o + 1] = y;
    st[o + 2] = R * sz;
    // mostly field-aligned (passing) particles that stream round the doughnut
    const v = i < N_PER_SPECIES ? V_E : V_I;
    const pitch = 0.15 + Math.random() * 0.4;
    const vpar = v * Math.cos(pitch) * (Math.random() < 0.5 ? -1 : 1);
    const vperp = v * Math.sin(pitch);
    const psi = Math.random() * Math.PI * 2;
    // phi-hat = (-sin, 0, cos); R-hat = (cos, 0, sin); y-hat
    const pr = vperp * Math.cos(psi);
    const py = vperp * Math.sin(psi);
    st[o + 3] = -sz * vpar + cx * pr;
    st[o + 4] = py;
    st[o + 5] = cx * vpar + sz * pr;
    this.alive[i] = 1;
    this.respawnIn[i] = 0;
    this.trailLen[i] = 0;
    this.trailHead[i] = 0;
    this.pushTrail(i);
  }

  private field(x: number, y: number, z: number, out: Float64Array) {
    const R = Math.hypot(x, z);
    const Bt = 1 / R;
    const cx = x / R;
    const sz = z / R;
    out[0] = -sz * Bt;
    out[1] = 0;
    out[2] = cx * Bt;
    if (this.twist > 0) {
      const dR = R - 1;
      const r = Math.hypot(dR, y);
      if (r > 1e-9) {
        const bp = (this.twist * Bt * r) / SAFETY_Q; // B_pol = B_tor · r / (q R0)
        // theta-hat = (-y R-hat + dR y-hat) / r
        out[0] += (bp * (-y * cx)) / r;
        out[1] += (bp * dR) / r;
        out[2] += (bp * (-y * sz)) / r;
      }
    }
  }

  /** Charge-weighted mean height, normalised to the minor radius (negative = electrons on top). */
  separation(): { dipole: number; eTop: number; iBottom: number; aliveFrac: number } {
    let dip = 0;
    let ey = 0;
    let iy = 0;
    let ne = 0;
    let ni = 0;
    for (let i = 0; i < N; i++) {
      if (!this.alive[i]) continue;
      const y = this.state[i * 6 + 1];
      if (i < N_PER_SPECIES) {
        dip -= y;
        ey += y;
        ne++;
      } else {
        dip += y;
        iy += y;
        ni++;
      }
    }
    return {
      dipole: dip / (N * MINOR_A),
      eTop: ne ? ey / ne / MINOR_A : 0,
      iBottom: ni ? -iy / ni / MINOR_A : 0,
      aliveFrac: (ne + ni) / N,
    };
  }

  /** Target E from the charge separation (only meaningful when the field is not twisted). */
  separationField(): number {
    const { dipole } = this.separation();
    return Math.max(-E_MAX, Math.min(E_MAX, -E_GAIN * dipole));
  }

  private pushTrail(i: number) {
    const h = (this.trailHead[i] + 1) % TRAIL;
    this.trailHead[i] = h;
    const o = (i * TRAIL + h) * 3;
    this.trail[o] = this.state[i * 6];
    this.trail[o + 1] = this.state[i * 6 + 1];
    this.trail[o + 2] = this.state[i * 6 + 2];
    if (this.trailLen[i] < TRAIL) this.trailLen[i]++;
  }

  private spark(x: number, y: number, z: number, ion: boolean) {
    const k = this.sparkNext;
    this.sparkNext = (k + 1) % SPARKS;
    this.sparkPos[k * 3] = x;
    this.sparkPos[k * 3 + 1] = y;
    this.sparkPos[k * 3 + 2] = z;
    this.sparkLife[k] = ion ? -1 : 1; // sign remembers the colour
  }

  update(dt: number, playing: boolean) {
    if (playing) {
      this.simAcc += dt * SIM_RATE;
      let steps = Math.min(MAX_STEPS_PER_FRAME, Math.floor(this.simAcc / DT));
      this.simAcc -= steps * DT;
      if (this.simAcc > DT * 4) this.simAcc = 0; // don't spiral after a stall
      const st = this.state;
      const B = this.B;
      const E = this.E;
      E[1] = this.Ey;
      const useE = Math.abs(this.Ey) > 1e-9;
      while (steps-- > 0) {
        for (let i = 0; i < N; i++) {
          if (!this.alive[i]) continue;
          const o = i * 6;
          this.field(st[o], st[o + 1], st[o + 2], B);
          borisStep(st, B, this.qm[i], DT, useE ? E : undefined, o);
          const R = Math.hypot(st[o], st[o + 2]);
          const r = Math.hypot(R - 1, st[o + 1]);
          if (r > MINOR_A) {
            this.alive[i] = 0;
            this.respawnIn[i] = 0.2 + Math.random() * 1.3;
            this.spark(st[o], st[o + 1], st[o + 2], i >= N_PER_SPECIES);
          }
        }
      }
      for (let i = 0; i < N; i++) {
        if (this.alive[i]) this.pushTrail(i);
        else if (this.respawn && (this.respawnIn[i] -= dt) <= 0) this.spawn(i, 0.12);
      }
    }
    this.writeBuffers(dt, playing);
  }

  private writeBuffers(dt: number, playing: boolean) {
    const segs = TRAIL - 1;
    for (let i = 0; i < N; i++) {
      const o = i * 3;
      const live = this.alive[i] === 1;
      if (live) {
        this.pointPos[o] = this.state[i * 6];
        this.pointPos[o + 1] = this.state[i * 6 + 1];
        this.pointPos[o + 2] = this.state[i * 6 + 2];
      } else {
        this.pointPos[o] = this.pointPos[o + 1] = this.pointPos[o + 2] = 1e5; // parked off-screen
      }
      const c = this.baseCol[i];
      const len = live ? this.trailLen[i] : 0;
      const h = this.trailHead[i];
      for (let j = 0; j < segs; j++) {
        const base = ((i * segs + j) * 2) * 3;
        if (j + 1 < len) {
          const a = ((i * TRAIL + ((h - j + TRAIL) % TRAIL)) * 3);
          const b = ((i * TRAIL + ((h - j - 1 + TRAIL) % TRAIL)) * 3);
          for (let k = 0; k < 3; k++) {
            this.trailPos[base + k] = this.trail[a + k];
            this.trailPos[base + 3 + k] = this.trail[b + k];
          }
          const fa = 0.55 * (1 - j / segs);
          const fb = 0.55 * (1 - (j + 1) / segs);
          this.trailCol[base] = c.r * fa;
          this.trailCol[base + 1] = c.g * fa;
          this.trailCol[base + 2] = c.b * fa;
          this.trailCol[base + 3] = c.r * fb;
          this.trailCol[base + 4] = c.g * fb;
          this.trailCol[base + 5] = c.b * fb;
        } else {
          for (let k = 0; k < 6; k++) {
            this.trailPos[base + k] = 0;
            this.trailCol[base + k] = 0;
          }
        }
      }
    }

    const sparkE = hdr(0xbfe0ff, 3);
    const sparkI = hdr(0xffd08a, 3);
    for (let k = 0; k < SPARKS; k++) {
      const life = this.sparkLife[k];
      if (life === 0) continue;
      const mag = Math.abs(life);
      const next = playing ? Math.max(0, mag - dt / 0.6) : mag;
      this.sparkLife[k] = next * Math.sign(life);
      const c = life < 0 ? sparkI : sparkE;
      const f = next * next;
      this.sparkCol[k * 3] = c.r * f;
      this.sparkCol[k * 3 + 1] = c.g * f;
      this.sparkCol[k * 3 + 2] = c.b * f;
    }

    (this.points.geometry.getAttribute('position') as THREE.BufferAttribute).needsUpdate = true;
    (this.trails.geometry.getAttribute('position') as THREE.BufferAttribute).needsUpdate = true;
    (this.trails.geometry.getAttribute('color') as THREE.BufferAttribute).needsUpdate = true;
    (this.sparkPts.geometry.getAttribute('position') as THREE.BufferAttribute).needsUpdate = true;
    (this.sparkPts.geometry.getAttribute('color') as THREE.BufferAttribute).needsUpdate = true;
  }

  get deadCount() {
    let n = 0;
    for (let i = 0; i < N; i++) if (!this.alive[i]) n++;
    return n;
  }
}
