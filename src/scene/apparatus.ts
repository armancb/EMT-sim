import * as THREE from 'three';
import { coilPoses } from '../physics/coils';

// 1 scene unit = 1 cm
const COIL_R = 15;
const BASE_TOP = -22;
const GEAR_R = 7.5;
const GEAR_TEETH = 28;

function windingBumpTexture(): THREE.Texture {
  const c = document.createElement('canvas');
  c.width = 8;
  c.height = 256;
  const g = c.getContext('2d')!;
  for (let y = 0; y < 256; y++) {
    const v = 0.5 + 0.5 * Math.sin((y / 256) * Math.PI * 2 * 16);
    const s = Math.round(255 * Math.pow(v, 0.6));
    g.fillStyle = `rgb(${s},${s},${s})`;
    g.fillRect(0, y, 8, 1);
  }
  const t = new THREE.CanvasTexture(c);
  t.wrapS = THREE.RepeatWrapping;
  t.wrapT = THREE.RepeatWrapping;
  t.repeat.set(1, 3);
  return t;
}

function gearGeometry(): THREE.BufferGeometry {
  const shape = new THREE.Shape();
  const rRoot = GEAR_R - 0.45;
  const rTip = GEAR_R + 0.45;
  const n = GEAR_TEETH;
  for (let k = 0; k < n; k++) {
    const a0 = ((k - 0.5) / n) * Math.PI * 2;
    const pts: [number, number][] = [
      [rRoot, a0],
      [rRoot, a0 + (0.18 / n) * Math.PI * 2],
      [rTip, a0 + (0.32 / n) * Math.PI * 2],
      [rTip, a0 + (0.68 / n) * Math.PI * 2],
      [rRoot, a0 + (0.82 / n) * Math.PI * 2],
    ];
    pts.forEach(([r, a], i) => {
      const x = r * Math.cos(a);
      const y = r * Math.sin(a);
      if (k === 0 && i === 0) shape.moveTo(x, y);
      else shape.lineTo(x, y);
    });
  }
  shape.closePath();
  // lightening holes
  for (let k = 0; k < 5; k++) {
    const a = (k / 5) * Math.PI * 2;
    const h = new THREE.Path();
    h.absarc(4.1 * Math.cos(a), 4.1 * Math.sin(a), 1.35, 0, Math.PI * 2, true);
    shape.holes.push(h);
  }
  const hub = new THREE.Path();
  hub.absarc(0, 0, 0.6, 0, Math.PI * 2, true);
  shape.holes.push(hub);
  const geo = new THREE.ExtrudeGeometry(shape, {
    depth: 0.9,
    bevelEnabled: true,
    bevelThickness: 0.08,
    bevelSize: 0.06,
    bevelSegments: 2,
    curveSegments: 6,
  });
  geo.rotateX(-Math.PI / 2);
  return geo;
}

const rimVertex = /* glsl */ `
  varying vec3 vN;
  varying vec3 vV;
  void main() {
    vec4 mv = modelViewMatrix * vec4(position, 1.0);
    vN = normalize(normalMatrix * normal);
    vV = normalize(-mv.xyz);
    gl_Position = projectionMatrix * mv;
  }`;
const rimFragment = /* glsl */ `
  uniform vec3 uColor;
  uniform float uOpacity;
  varying vec3 vN;
  varying vec3 vV;
  void main() {
    float f = pow(1.0 - abs(dot(normalize(vN), normalize(vV))), 3.0);
    gl_FragColor = vec4(uColor * f, f * uOpacity);
  }`;

type FadeInfo = { opacity: number; transparent: boolean; depthWrite: boolean };

export class Apparatus {
  readonly group = new THREE.Group();
  private coils: THREE.Group[] = [];
  private gears: THREE.Mesh[] = [];
  private gunBottom = new THREE.Group();
  private gunTop = new THREE.Group();
  private materials = new Set<THREE.Material>();
  private fadeInfo = new Map<THREE.Material, FadeInfo>();
  private rimMaterial: THREE.ShaderMaterial;
  private alpha = 1;

  constructor() {
    const copper = new THREE.MeshStandardMaterial({
      color: 0xb87333,
      metalness: 0.9,
      roughness: 0.35,
      bumpMap: windingBumpTexture(),
      bumpScale: 1.4,
    });
    const darkMetal = new THREE.MeshStandardMaterial({ color: 0x2a2d33, metalness: 0.75, roughness: 0.45 });
    const steel = new THREE.MeshStandardMaterial({ color: 0x8c9099, metalness: 0.95, roughness: 0.3 });
    const matte = new THREE.MeshStandardMaterial({ color: 0x101114, metalness: 0.1, roughness: 0.85 });
    const glass = new THREE.MeshPhysicalMaterial({
      color: 0xffffff,
      metalness: 0,
      roughness: 0.05,
      transmission: 0.95,
      ior: 1.5,
      thickness: 0.4,
      specularIntensity: 1,
      envMapIntensity: 1.2,
      depthWrite: false,
    });

    // ---- coils ----
    const coilGeo = new THREE.TorusGeometry(COIL_R, 0.62, 28, 200);
    const frameGeo = new THREE.TorusGeometry(COIL_R + 0.85, 0.22, 10, 160);
    const innerGeo = new THREE.TorusGeometry(COIL_R - 0.8, 0.16, 10, 160);
    const postLen = -(COIL_R + 0.85) - BASE_TOP;
    const postGeo = new THREE.CylinderGeometry(0.55, 0.55, postLen, 20);
    const clampGeo = new THREE.BoxGeometry(2.2, 1.6, 2.0);
    for (let i = 0; i < 2; i++) {
      const g = new THREE.Group();
      const ring = new THREE.Mesh(coilGeo, copper);
      const frame = new THREE.Mesh(frameGeo, darkMetal);
      const inner = new THREE.Mesh(innerGeo, darkMetal);
      const post = new THREE.Mesh(postGeo, darkMetal);
      post.position.y = BASE_TOP + postLen / 2;
      const clamp = new THREE.Mesh(clampGeo, darkMetal);
      clamp.position.y = -(COIL_R + 0.6);
      for (const m of [ring, frame, inner, post, clamp]) {
        m.castShadow = true;
        m.receiveShadow = true;
        g.add(m);
      }
      this.coils.push(g);
      this.group.add(g);
    }

    // ---- base plate + meshing gears ----
    const base = new THREE.Mesh(new THREE.BoxGeometry(62, 1.6, 40), matte);
    base.position.y = BASE_TOP - 0.8;
    base.receiveShadow = true;
    this.group.add(base);
    const feetGeo = new THREE.CylinderGeometry(1.4, 1.6, 0.8, 24);
    for (const [x, z] of [[-28, -17], [28, -17], [-28, 17], [28, 17]]) {
      const f = new THREE.Mesh(feetGeo, darkMetal);
      f.position.set(x, BASE_TOP - 2, z);
      this.group.add(f);
    }
    const gearGeo = gearGeometry();
    const hubGeo = new THREE.CylinderGeometry(1.1, 1.1, 1.6, 24);
    for (let i = 0; i < 2; i++) {
      const gear = new THREE.Mesh(gearGeo, steel);
      gear.castShadow = true;
      gear.receiveShadow = true;
      const hub = new THREE.Mesh(hubGeo, darkMetal);
      hub.position.y = 0.6;
      gear.add(hub);
      this.gears.push(gear);
      this.group.add(gear);
    }

    // ---- bulb stand: socket on a bracket arm from the right-hand post ----
    const socket = new THREE.Mesh(new THREE.CylinderGeometry(2.3, 2.6, 2.6, 40), matte);
    socket.position.y = -14.3;
    const arm = new THREE.Mesh(new THREE.BoxGeometry(22, 1.1, 2.2), darkMetal);
    arm.position.set(11, -16.1, 0);
    const standPost = new THREE.Mesh(new THREE.CylinderGeometry(0.8, 0.95, -16.1 - BASE_TOP, 24), darkMetal);
    standPost.position.set(22, (BASE_TOP - 16.1) / 2, 0);
    for (const m of [socket, arm, standPost]) {
      m.castShadow = true;
      m.receiveShadow = true;
      this.group.add(m);
    }

    // ---- glass bulb ----
    const bulb = new THREE.Mesh(new THREE.SphereGeometry(8, 72, 48), glass);
    bulb.renderOrder = 1;
    const neck = new THREE.Mesh(new THREE.CylinderGeometry(1.5, 1.7, 6, 32, 1, true), glass);
    neck.position.y = -10;
    this.rimMaterial = new THREE.ShaderMaterial({
      uniforms: { uColor: { value: new THREE.Color(0x9fd8ff) }, uOpacity: { value: 0.55 } },
      vertexShader: rimVertex,
      fragmentShader: rimFragment,
      transparent: true,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
    });
    const rim = new THREE.Mesh(new THREE.SphereGeometry(8.04, 72, 48), this.rimMaterial);
    this.group.add(bulb, neck, rim);

    // ---- electron gun (bottom) and mirrored positron source (top) ----
    this.buildGun(this.gunBottom, steel, darkMetal);
    this.buildGun(this.gunTop, steel, darkMetal);
    this.gunTop.scale.y = -1;
    const topCap = new THREE.Mesh(new THREE.CylinderGeometry(0.9, 1.1, 6, 24, 1, true), glass);
    topCap.position.y = -10.6; // mirrored to +10.6, sheathing the stem
    this.gunTop.add(topCap);
    this.gunTop.visible = false;
    this.group.add(this.gunBottom, this.gunTop);

    this.group.traverse((o) => {
      const m = (o as THREE.Mesh).material as THREE.Material | undefined;
      if (m && m !== this.rimMaterial) this.materials.add(m);
    });
    for (const m of this.materials) {
      this.fadeInfo.set(m, { opacity: m.opacity, transparent: m.transparent, depthWrite: m.depthWrite });
    }

    this.setTilt(0);
  }

  private buildGun(g: THREE.Group, steel: THREE.Material, dark: THREE.Material) {
    const stem = new THREE.Mesh(new THREE.CylinderGeometry(0.2, 0.26, 5.4, 12), dark);
    stem.position.set(-0.9, -10.6, 0);
    const nozzle = new THREE.Mesh(new THREE.CylinderGeometry(0.38, 0.38, 1.3, 20), steel);
    nozzle.rotation.z = Math.PI / 2;
    nozzle.position.set(-0.75, -7.5, 0);
    const anode = new THREE.Mesh(new THREE.TorusGeometry(0.42, 0.08, 8, 24), steel);
    anode.rotation.y = Math.PI / 2;
    anode.position.set(-0.08, -7.5, 0);
    const glow = new THREE.Mesh(
      new THREE.SphereGeometry(0.16, 12, 8),
      new THREE.MeshBasicMaterial({ color: new THREE.Color(3, 1.2, 0.4) }),
    );
    glow.position.set(-1.35, -7.5, 0);
    g.add(stem, nozzle, anode, glow);
  }

  /** current coil tilt (degrees), as last placed */
  tilt = 0;

  /** Place coils and gears for the given tilt (degrees). */
  setTilt(tiltDeg: number) {
    this.tilt = tiltDeg;
    const poses = coilPoses(tiltDeg);
    poses.forEach((p, i) => {
      const c = this.coils[i];
      c.position.set(p.center[0] * 100, 0, p.center[2] * 100);
      c.rotation.y = p.yaw;
      const g = this.gears[i];
      g.position.set(p.center[0] * 100, BASE_TOP + 0.08, p.center[2] * 100);
      // second gear offset by half a tooth so the teeth interleave
      g.rotation.y = p.yaw + (i === 1 ? Math.PI / GEAR_TEETH : 0);
    });
  }

  setParticle(kind: 'electron' | 'positron') {
    this.gunBottom.visible = true;
    this.gunTop.visible = kind === 'positron';
  }

  /** Fade the whole apparatus (0 = gone, 1 = solid). */
  setAlpha(alpha: number) {
    if (Math.abs(alpha - this.alpha) < 1e-4) return;
    this.alpha = alpha;
    this.group.visible = alpha > 0.005;
    const solid = alpha > 0.999;
    for (const m of this.materials) {
      const info = this.fadeInfo.get(m)!;
      const wantTransparent = solid ? info.transparent : true;
      if (m.transparent !== wantTransparent) {
        m.transparent = wantTransparent;
        m.needsUpdate = true;
      }
      m.opacity = solid ? info.opacity : info.opacity * alpha;
      m.depthWrite = solid ? info.depthWrite : false;
    }
    this.rimMaterial.uniforms.uOpacity.value = 0.55 * alpha;
  }
}
