import * as THREE from 'three';
import { computeTrajectory, loopCentroids, type Trajectory } from '../physics/trajectory';
import { GuidingCentreOverlay, RulerOverlay } from '../scene/overlays';
import { LineGeometry, LineMaterial, Line2, damp, glowTexture, hdr, makeLine, samplePolyline } from '../scene/util';
import { ScreenLabel } from '../ui/screenLabel';
import { $, $$, paintRange, type AppContext, type Chapter } from './types';

const CAPTIONS = [
  'In a stronger field the electron turns more tightly…',
  '…and in a weaker field it swings wider.',
  'Tight half + wide half doesn’t join up.',
  'So every loop shifts sideways: that’s the grad-B drift.',
];

const TIGHT = new THREE.Color(0xff8a2a);
const WIDE = new THREE.Color(0xffd9a0);
const NEUTRAL = new THREE.Color(0xffb36a);

const washVertex = /* glsl */ `
  varying vec2 vPos;
  void main() {
    vec4 wp = modelMatrix * vec4(position, 1.0);
    vPos = wp.xy;
    gl_Position = projectionMatrix * viewMatrix * wp;
  }`;
const washFragment = /* glsl */ `
  uniform float uR0;       // cm; <= 0 means uniform
  uniform float uOpacity;
  uniform vec2 uCentre;
  varying vec2 vPos;
  void main() {
    float ratio = uR0 > 0.0 ? uR0 / max(vPos.x + uR0, 1.0) : 1.0;
    float t = clamp(0.5 + log(ratio) / 1.3, 0.0, 1.0);
    vec3 col = mix(vec3(0.75, 0.89, 1.0), vec3(0.05, 0.29, 0.77), t);
    vec2 d = (vPos - uCentre) / vec2(30.0, 24.0);
    float edge = smoothstep(1.0, 0.55, length(d));
    gl_FragColor = vec4(col, uOpacity * edge * (0.12 + 0.5 * t));
    #include <colorspace_fragment>
  }`;

/** Chapter 2: one electron, seen face-on, over a field-strength wash. */
export class WhyDriftsChapter implements Chapter {
  readonly apparatusAlpha = 0;
  readonly group = new THREE.Group();
  private tiltDeg = 40;
  private beat = 0;
  private traj!: Trajectory;
  private pts = new Float32Array(6);
  private tightFlags: boolean[] = [];
  private uniform = false;

  private washMat: THREE.ShaderMaterial;
  private pathMat = new LineMaterial({ color: 0xffffff, vertexColors: true, linewidth: 0.24, worldUnits: true });
  private path: Line2;
  private ghostMat = new LineMaterial({
    color: 0xcfd6e2,
    linewidth: 1.5,
    dashed: true,
    dashSize: 0.6,
    gapSize: 0.45,
    transparent: true,
    opacity: 0,
    depthWrite: false,
  });
  private ghost: Line2;
  private electron: THREE.Sprite;
  private ruler = new RulerOverlay();
  private centre = new GuidingCentreOverlay();
  private strongLabel = new ScreenLabel('field-label', 'Stronger field');
  private weakLabel = new ScreenLabel('field-label', 'Weaker field');

  private f = 0;
  private hold = 0;
  private playing = true;
  private active = false;
  private alpha = 0;
  private tmp = new THREE.Vector3();

  private ui = {
    slider: $<HTMLInputElement>('#gradient'),
    val: $('#grad-val'),
    next: $('#beat-next'),
    dots: $$('#beat-dots i'),
  };

  constructor(private ctx: AppContext & { nextChapter(): void }) {
    this.washMat = new THREE.ShaderMaterial({
      uniforms: { uR0: { value: 0 }, uOpacity: { value: 0 }, uCentre: { value: new THREE.Vector2(0, 4) } },
      vertexShader: washVertex,
      fragmentShader: washFragment,
      transparent: true,
      depthWrite: false,
    });
    const wash = new THREE.Mesh(new THREE.PlaneGeometry(80, 64), this.washMat);
    wash.position.set(0, 4, -0.4);

    this.path = makeLine([0, 0, 0, 0, 0.01, 0], this.pathMat);
    this.path.renderOrder = 2;
    this.ghost = makeLine([0, 0, 0, 0, 0.01, 0], this.ghostMat);
    this.ghost.renderOrder = 1;
    this.electron = new THREE.Sprite(
      new THREE.SpriteMaterial({
        map: glowTexture(),
        color: hdr(0xbfe4ff, 4),
        transparent: true,
        depthWrite: false,
        blending: THREE.AdditiveBlending,
      }),
    );
    this.electron.scale.setScalar(1.7);
    this.electron.renderOrder = 3;

    this.group.add(wash, this.ghost, this.path, this.electron, this.ruler.group, this.centre.group);
    this.group.visible = false;
    ctx.stage.scene.add(this.group);

    this.ui.slider.addEventListener('input', () => {
      this.tiltDeg = Number(this.ui.slider.value);
      this.rebuild();
    });
    this.ui.next.addEventListener('click', () => {
      if (!this.next()) this.ctx.nextChapter();
    });
    this.ui.dots.forEach((d, i) => d.addEventListener('click', () => this.setBeat(i)));

    this.rebuild();
  }

  private rebuild() {
    paintRange(this.ui.slider);
    this.ui.val.textContent = this.tiltDeg < 0.25 ? 'none' : `${this.tiltDeg.toFixed(0)}° coil tilt`;
    this.uniform = this.tiltDeg < 0.25;
    this.traj = computeTrajectory(
      { tiltDeg: this.uniform ? 0 : this.tiltDeg, current: 1.4, voltage: 250, particle: 'electron' },
      { launch: 'centered', maxLoops: 3, bound: Infinity },
    );
    const t = this.traj;
    const R0cm = t.derived.R0 * 100;
    this.washMat.uniforms.uR0.value = Number.isFinite(R0cm) ? R0cm : 0;

    this.pts = new Float32Array(t.count * 3);
    this.tightFlags = [];
    for (let i = 0; i < t.count; i++) {
      const x = t.points[i * 3] * 100;
      this.pts[i * 3] = x;
      this.pts[i * 3 + 1] = t.points[i * 3 + 1] * 100;
      this.pts[i * 3 + 2] = 0;
      this.tightFlags.push(Number.isFinite(R0cm) ? R0cm / (x + R0cm) > 1 : false);
    }
    const geo = new LineGeometry();
    geo.setPositions(this.pts);
    this.path.geometry.dispose();
    this.path.geometry = geo;
    this.applyColors();

    // ghost circle: where a closed orbit would have been
    const r = t.derived.rL * 100;
    const ring: number[] = [];
    for (let k = 0; k <= 128; k++) {
      const a = (k / 128) * Math.PI * 2;
      ring.push(r * Math.cos(a), r * Math.sin(a), -0.05);
    }
    const g2 = new LineGeometry();
    g2.setPositions(ring);
    this.ghost.geometry.dispose();
    this.ghost.geometry = g2;
    this.ghost.computeLineDistances();

    const recs = t.loopRecords.map((p) => new THREE.Vector3(p[0] * 100, p[1] * 100, 0));
    this.ruler.setSpan(this.uniform ? null : recs[0], this.uniform ? null : recs[1]);
    this.centre.setCentres(
      loopCentroids(t).map((c) => new THREE.Vector3(c[0] * 100, c[1] * 100, 0)),
      200,
    );

    this.strongLabel.position.set(-12.5, -8.2, 0);
    this.weakLabel.position.set(12.5, -8.2, 0);
    this.restart();
    if (this.active) this.frame();
  }

  private applyColors() {
    const n = this.tightFlags.length;
    const colors = new Float32Array(n * 3);
    const c = new THREE.Color();
    for (let i = 0; i < n; i++) {
      const tight = this.tightFlags[i];
      let k = 1.6;
      if (this.uniform) c.copy(NEUTRAL);
      else {
        c.copy(tight ? TIGHT : WIDE);
        if ((this.beat === 0 && !tight) || (this.beat === 1 && tight)) k = 0.22;
      }
      colors[i * 3] = c.r * k;
      colors[i * 3 + 1] = c.g * k;
      colors[i * 3 + 2] = c.b * k;
    }
    (this.path.geometry as LineGeometry).setColors(colors);
  }

  private loopsForBeat() {
    return this.beat < 3 ? 1 : 3;
  }

  private endIndex() {
    const li = this.traj.loopIndices;
    const L = Math.min(this.loopsForBeat(), li.length - 1);
    return li[L];
  }

  private restart() {
    this.f = 0;
    this.hold = 0;
  }

  private setBeat(b: number) {
    const prevLoops = this.loopsForBeat();
    this.beat = Math.max(0, Math.min(3, b));
    this.applyColors();
    if (this.loopsForBeat() !== prevLoops || this.beat < 2) this.restart();
    this.ui.dots.forEach((d, i) => d.classList.toggle('on', i <= this.beat));
    this.ui.next.textContent = this.beat === 3 ? 'Next chapter ▸' : 'Next ▸';
    this.ctx.setNarration(CAPTIONS[this.beat]);
    this.frame();
  }

  /** frame loop 1 closely for beats 1–3, all loops for beat 4 */
  private frame() {
    const cam = this.ctx.stage.camera;
    const half = THREE.MathUtils.degToRad(cam.fov / 2);
    const end = Math.floor(this.endIndex());
    let ymin = Infinity;
    let ymax = -Infinity;
    let xmax = 0;
    for (let i = 0; i <= end; i++) {
      ymin = Math.min(ymin, this.pts[i * 3 + 1]);
      ymax = Math.max(ymax, this.pts[i * 3 + 1]);
      xmax = Math.max(xmax, Math.abs(this.pts[i * 3]));
    }
    const cy = (ymin + ymax) / 2;
    const h = (ymax - ymin) / 2 + 6;
    const w = xmax + 9;
    const dist = Math.max(h / Math.tan(half), w / (Math.tan(half) * cam.aspect), 30);
    this.ctx.stage.goTo({ position: [0, cy, dist], target: [0, cy, 0] }, 700);
  }

  enter() {
    this.active = true;
    this.group.visible = true;
    this.alpha = 0;
    const c = this.ctx.stage.controls;
    c.enabled = false;
    c.autoRotate = false;
    this.setBeat(0);
  }

  exit() {
    this.active = false;
    this.group.visible = false;
    this.ruler.hideLabel();
    this.strongLabel.opacity = 0;
    this.weakLabel.opacity = 0;
    this.strongLabel.update(this.ctx.stage.camera);
    this.weakLabel.update(this.ctx.stage.camera);
  }

  update(dt: number) {
    if (!this.active) return;
    const cam = this.ctx.stage.camera;
    this.alpha = damp(this.alpha, 1, 5, dt);
    this.washMat.uniforms.uOpacity.value = this.alpha;

    const end = this.endIndex();
    const secondsPerLoop = this.beat < 3 ? 4 : 2.2;
    if (this.playing) {
      if (this.f < end) this.f = Math.min(end, this.f + (dt * 400) / secondsPerLoop);
      else if ((this.hold += dt) > 1.6) this.restart();
    }
    this.path.geometry.instanceCount = Math.max(0, Math.floor(this.f));
    samplePolyline(this.pts, this.traj.count, this.f, this.tmp);
    this.electron.position.copy(this.tmp);

    const ghostOn = this.beat >= 2 ? (this.beat === 3 ? 0.35 : 0.8) : 0.25;
    this.ghostMat.opacity = damp(this.ghostMat.opacity, ghostOn * this.alpha, 8, dt);
    this.ruler.enabled = this.beat === 2 && this.f >= end - 1;
    this.centre.enabled = this.beat === 3;
    this.ruler.update(dt, cam);
    this.centre.update(dt, cam);

    const labelAlpha = this.alpha * Math.min(1, this.tiltDeg / 8);
    this.strongLabel.opacity = labelAlpha;
    this.weakLabel.opacity = labelAlpha;
    this.strongLabel.update(cam);
    this.weakLabel.update(cam);
  }

  next() {
    if (this.beat >= 3) return false;
    this.setBeat(this.beat + 1);
    return true;
  }

  prev() {
    if (this.beat <= 0) return false;
    this.setBeat(this.beat - 1);
    return true;
  }

  togglePlay() {
    this.playing = !this.playing;
  }
}
