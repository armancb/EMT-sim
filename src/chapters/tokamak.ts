import * as THREE from 'three';
import { E_MAX, MINOR_A, Plasma, SAFETY_Q } from '../tokamak/particles';
import { Line2, LineMaterial, damp, hdr, makeLine, setLinePositions } from '../scene/util';
import { $, $$, type AppContext, type Chapter } from './types';

type StageId = 'A' | 'B' | 'C';

const CAPTIONS: Record<StageId, string> = {
  A: 'Electrons and ions drift in opposite directions.',
  B: 'The separated charge pushes the whole plasma outward. It’s lost.',
  C: 'Twisting the field lines lets the charges flow back. This is why real tokamaks need a plasma current.',
};

const SCALE = 30; // 1 tokamak unit = 30 cm on screen
const STAGE_A_SECONDS = 4;
const HELIX_R = 0.22;

const vesselVertex = /* glsl */ `
  varying vec3 vN;
  varying vec3 vV;
  void main() {
    vec4 mv = modelViewMatrix * vec4(position, 1.0);
    vN = normalize(normalMatrix * normal);
    vV = normalize(-mv.xyz);
    gl_Position = projectionMatrix * mv;
  }`;
const vesselFragment = /* glsl */ `
  uniform vec3 uColor;
  uniform float uOpacity;
  varying vec3 vN;
  varying vec3 vV;
  void main() {
    float f = pow(1.0 - abs(dot(normalize(vN), normalize(vV))), 2.5);
    gl_FragColor = vec4(uColor, uOpacity * (0.05 + 0.6 * f));
    #include <colorspace_fragment>
  }`;

export class TokamakChapter implements Chapter {
  readonly apparatusAlpha = 0;
  readonly group = new THREE.Group();
  private plasma = new Plasma();
  private stage: StageId = 'A';
  private elapsed = 0;
  private current = false;
  private playing = true;
  private active = false;
  private touched = false;

  private helixMat = new LineMaterial({
    color: 0x5cc8ff,
    linewidth: 1.4,
    transparent: true,
    opacity: 0.35,
    depthWrite: false,
  });
  private helices: Line2[] = [];
  private shownTwist = -1;
  private arrows: THREE.ArrowHelper[] = [];
  private arrowMats: THREE.Material[] = [];
  private glowTop: THREE.MeshBasicMaterial;
  private glowBottom: THREE.MeshBasicMaterial;

  private ui = {
    toggle: $<HTMLInputElement>('#plasma-current'),
    step: $('#tok-step'),
    reset: $('#tok-reset'),
    stages: $$('#stages span'),
  };

  constructor(private ctx: AppContext) {
    const world = new THREE.Group();
    world.scale.setScalar(SCALE);
    world.position.y = -2;
    this.group.add(world);

    // vessel
    const vessel = new THREE.Mesh(
      new THREE.TorusGeometry(1, MINOR_A, 48, 192),
      new THREE.ShaderMaterial({
        uniforms: { uColor: { value: new THREE.Color(0x9fd8ff) }, uOpacity: { value: 0.55 } },
        vertexShader: vesselVertex,
        fragmentShader: vesselFragment,
        transparent: true,
        depthWrite: false,
        side: THREE.DoubleSide,
      }),
    );
    vessel.rotation.x = Math.PI / 2;
    world.add(vessel);

    // 16 D-shaped copper coils
    const copper = new THREE.MeshStandardMaterial({ color: 0xb87333, metalness: 0.9, roughness: 0.35 });
    const coilGeo = new THREE.TorusGeometry(0.43, 0.028, 12, 72);
    for (let k = 0; k < 16; k++) {
      const phi = (k / 16) * Math.PI * 2;
      const c = new THREE.Mesh(coilGeo, copper);
      c.scale.set(1, 1.22, 1);
      c.position.set(Math.cos(phi), 0, Math.sin(phi));
      // torus axis (local z) must point along phi-hat = (-sin phi, 0, cos phi)
      c.rotation.y = -phi;
      world.add(c);
    }

    // charge-separation glows (electrons collect on top, ions below)
    const glowGeo = new THREE.TorusGeometry(1, 0.07, 16, 160);
    this.glowTop = new THREE.MeshBasicMaterial({
      color: hdr(0x6fb7ff, 1.6),
      transparent: true,
      opacity: 0,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
    });
    this.glowBottom = new THREE.MeshBasicMaterial({
      color: hdr(0xffb347, 1.6),
      transparent: true,
      opacity: 0,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
    });
    const top = new THREE.Mesh(glowGeo, this.glowTop);
    top.rotation.x = Math.PI / 2;
    top.position.y = 0.21;
    const bottom = new THREE.Mesh(glowGeo, this.glowBottom);
    bottom.rotation.x = Math.PI / 2;
    bottom.position.y = -0.21;
    world.add(top, bottom);

    // field lines: circles that twist into helices when the plasma current is on
    for (let k = 0; k < 6; k++) {
      const l = makeLine([0, 0, 0, 0, 0.01, 0], this.helixMat);
      this.helices.push(l);
      world.add(l);
    }
    this.setTwistLines(0);

    // vertical E-field arrows (stage B)
    for (let k = 0; k < 10; k++) {
      const phi = (k / 10) * Math.PI * 2 + 0.3;
      const a = new THREE.ArrowHelper(
        new THREE.Vector3(0, 1, 0),
        new THREE.Vector3(Math.cos(phi), -0.13, Math.sin(phi)),
        0.26,
        0x9fd8ff,
        0.07,
        0.05,
      );
      for (const m of [a.line.material, a.cone.material] as THREE.Material[]) {
        m.transparent = true;
        m.opacity = 0;
        m.depthWrite = false;
        this.arrowMats.push(m);
      }
      this.arrows.push(a);
      world.add(a);
    }

    world.add(this.plasma.group);
    this.group.visible = false;
    ctx.stage.scene.add(this.group);

    this.ui.toggle.addEventListener('change', () => this.setCurrent(this.ui.toggle.checked));
    this.ui.step.addEventListener('click', () => this.next());
    this.ui.reset.addEventListener('click', () => this.reset());
    ctx.stage.controls.addEventListener('start', () => {
      if (this.active) {
        this.touched = true;
        ctx.stage.controls.autoRotate = false;
      }
    });
  }

  private setTwistLines(twist: number) {
    if (Math.abs(twist - this.shownTwist) < 1e-3) return;
    this.shownTwist = twist;
    this.helices.forEach((line, k) => {
      const th0 = (k / 6) * Math.PI * 2;
      const pts: number[] = [];
      const n = 360;
      for (let i = 0; i <= n; i++) {
        const phi = (i / n) * Math.PI * 2 * Math.max(1, SAFETY_Q); // one closed field line
        const th = th0 + (twist * phi) / SAFETY_Q;
        const R = 1 + HELIX_R * Math.cos(th);
        pts.push(R * Math.cos(phi), HELIX_R * Math.sin(th), R * Math.sin(phi));
      }
      setLinePositions(line, pts);
    });
  }

  private setCurrent(on: boolean) {
    this.current = on;
    this.ui.toggle.checked = on;
    this.plasma.respawn = on;
    if (!on) this.elapsed = Math.max(this.elapsed, STAGE_A_SECONDS);
    this.refreshStage();
  }

  private refreshStage() {
    const s: StageId = this.current ? 'C' : this.elapsed >= STAGE_A_SECONDS ? 'B' : 'A';
    if (s !== this.stage || !this.captionShown) {
      this.stage = s;
      this.ui.stages.forEach((el) => el.classList.toggle('on', el.dataset.stage === s));
      this.ui.step.textContent = s === 'C' ? 'Done' : 'Step ▸';
      if (this.active) {
        this.ctx.setNarration(CAPTIONS[s]);
        this.captionShown = true;
      }
    }
  }
  private captionShown = false;

  private reset() {
    this.plasma.reset();
    this.elapsed = 0;
    this.current = false;
    this.ui.toggle.checked = false;
    this.captionShown = false;
    this.refreshStage();
  }

  enter() {
    this.active = true;
    this.group.visible = true;
    const c = this.ctx.stage.controls;
    c.enabled = true;
    c.autoRotate = !this.touched;
    // portrait screens: back off so the whole doughnut fits across
    const k = this.ctx.stage.camera.aspect < 1 ? 2.4 : 1;
    this.ctx.stage.goTo({ position: [0, 50 * k, 96 * k], target: [0, -4, 0] }, 800);
    this.reset();
  }

  exit() {
    this.active = false;
    this.group.visible = false;
    this.ctx.stage.controls.autoRotate = false;
  }

  update(dt: number) {
    if (!this.active) return;
    if (this.playing) this.elapsed += dt;
    this.refreshStage();

    // field twist animates in/out over ~1.5 s
    const twistTarget = this.current ? 1 : 0;
    this.plasma.twist = damp(this.plasma.twist, twistTarget, 3, dt);
    if (Math.abs(this.plasma.twist - twistTarget) < 1e-3) this.plasma.twist = twistTarget;
    this.setTwistLines(this.plasma.twist);

    // the separated charge builds a vertical E field in stage B; twisted lines short it out
    const eTarget = this.stage === 'B' ? this.plasma.separationField() : 0;
    this.plasma.Ey = damp(this.plasma.Ey, eTarget, this.stage === 'C' ? 2.5 : 1.2, dt);

    this.plasma.update(dt, this.playing);

    const sep = this.plasma.separation();
    this.glowTop.opacity = damp(this.glowTop.opacity, Math.min(0.55, Math.max(0, sep.eTop) * 1.6) * sep.aliveFrac, 4, dt);
    this.glowBottom.opacity = damp(this.glowBottom.opacity, Math.min(0.55, Math.max(0, sep.iBottom) * 1.6) * sep.aliveFrac, 4, dt);
    const arrowAlpha = Math.min(1, Math.abs(this.plasma.Ey) / E_MAX) * 0.7;
    for (const m of this.arrowMats) m.opacity = arrowAlpha;
  }

  next() {
    if (this.stage === 'A') {
      this.elapsed = STAGE_A_SECONDS;
      this.refreshStage();
      return true;
    }
    if (this.stage === 'B') {
      this.setCurrent(true);
      return true;
    }
    return false;
  }

  prev() {
    if (this.stage === 'C') {
      this.setCurrent(false);
      return true;
    }
    if (this.stage === 'B') {
      this.reset();
      return true;
    }
    return false;
  }

  togglePlay() {
    this.playing = !this.playing;
  }
}
