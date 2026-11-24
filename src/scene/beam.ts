import * as THREE from 'three';
import { Line2, LineMaterial, glowTexture, hdr, makeLine, samplePolyline, setLinePositions } from './util';

const MAX_SPARKS = 48;
const STEPS_PER_ORBIT = 400; // matches the integrator
export const DISPLAY_ORBIT_SECONDS = 2.4; // 24 ns orbit shown in 2.4 s → ×10⁸ slow motion
const REGROW_SECONDS = 0.8;
const SPARK_SPACING = STEPS_PER_ORBIT / 3;

/** The glowing electron beam: a static path plus sparks that show the direction of travel. */
export class Beam {
  readonly group = new THREE.Group();
  private core: Line2;
  private halo: Line2;
  private sparks: THREE.Points;
  private sparkPos = new Float32Array(MAX_SPARKS * 3);
  private head: THREE.Sprite;
  private pts: Float32Array = new Float32Array(6);
  private count = 2;
  private reveal = 1;
  private phase = 0;
  private tmp = new THREE.Vector3();

  constructor() {
    const coreMat = new LineMaterial({ color: hdr(0xff9a3c, 2.2), linewidth: 0.18, worldUnits: true });
    const haloMat = new LineMaterial({
      color: hdr(0xff6a1a, 0.8),
      linewidth: 0.7,
      worldUnits: true,
      transparent: true,
      opacity: 0.2,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
    });
    this.core = makeLine(this.pts, coreMat);
    this.halo = makeLine(this.pts, haloMat);
    this.halo.renderOrder = 2;

    const sg = new THREE.BufferGeometry();
    sg.setAttribute('position', new THREE.BufferAttribute(this.sparkPos, 3));
    this.sparks = new THREE.Points(
      sg,
      new THREE.PointsMaterial({
        map: glowTexture(),
        color: hdr(0xffd2a0, 3.0),
        size: 0.95,
        sizeAttenuation: true,
        transparent: true,
        depthWrite: false,
        blending: THREE.AdditiveBlending,
      }),
    );
    this.sparks.frustumCulled = false;
    this.sparks.renderOrder = 3;

    this.head = new THREE.Sprite(
      new THREE.SpriteMaterial({
        map: glowTexture(),
        color: hdr(0xffe0b8, 4),
        transparent: true,
        depthWrite: false,
        blending: THREE.AdditiveBlending,
      }),
    );
    this.head.scale.setScalar(1.6);
    this.head.renderOrder = 3;

    this.group.add(this.core, this.halo, this.sparks, this.head);
  }

  /** Replace the path (xyz in cm). With `regrow` the beam grows out of the gun over 0.8 s. */
  setPath(ptsCm: Float32Array, count: number, regrow: boolean) {
    this.pts = ptsCm;
    this.count = Math.max(2, count);
    setLinePositions(this.core, ptsCm.subarray(0, this.count * 3));
    this.halo.geometry = this.core.geometry;
    if (regrow) {
      this.reveal = 0;
      this.phase = 0;
    }
    this.applyReveal();
  }

  get isGrowing() {
    return this.reveal < 1;
  }

  private applyReveal() {
    const segs = this.count - 1;
    const visible = Math.max(0, Math.round(segs * this.reveal));
    this.core.geometry.instanceCount = visible;
  }

  update(dt: number, playing: boolean) {
    const segs = this.count - 1;
    if (this.reveal < 1) {
      if (playing) this.reveal = Math.min(1, this.reveal + dt / REGROW_SECONDS);
      this.applyReveal();
      this.head.visible = true;
      samplePolyline(this.pts, this.count, segs * this.reveal, this.tmp);
      this.head.position.copy(this.tmp);
    } else {
      this.head.visible = false;
    }

    if (playing) this.phase += (dt * STEPS_PER_ORBIT) / DISPLAY_ORBIT_SECONDS;

    // sparks spaced along the path, flowing in the direction of motion
    const n = Math.min(MAX_SPARKS, Math.max(1, Math.floor(segs / SPARK_SPACING)));
    const limit = segs * this.reveal;
    let shown = 0;
    for (let k = 0; k < n; k++) {
      const f = (this.phase + k * SPARK_SPACING) % Math.max(1, segs);
      if (f > limit) continue;
      samplePolyline(this.pts, this.count, f, this.tmp);
      this.sparkPos[shown * 3] = this.tmp.x;
      this.sparkPos[shown * 3 + 1] = this.tmp.y;
      this.sparkPos[shown * 3 + 2] = this.tmp.z;
      shown++;
    }
    const geo = this.sparks.geometry;
    geo.setDrawRange(0, shown);
    (geo.getAttribute('position') as THREE.BufferAttribute).needsUpdate = true;
  }
}
