import * as THREE from 'three';
import { Line2, LineMaterial, damp, glowTexture, makeLine, setLinePositions } from './util';
import { WASH_RES } from '../physics/fieldTypes';
import { ScreenLabel } from '../ui/screenLabel';

/** Base: anything that fades in/out over ~200 ms. */
abstract class Fader {
  readonly group = new THREE.Group();
  enabled = false;
  protected alpha = 0;
  protected abstract applyAlpha(a: number): void;
  update(dt: number, _camera: THREE.Camera) {
    const target = this.enabled ? 1 : 0;
    if (Math.abs(this.alpha - target) > 1e-3) {
      this.alpha = damp(this.alpha, target, 18, dt);
      if (Math.abs(this.alpha - target) < 1e-3) this.alpha = target;
      this.applyAlpha(this.alpha);
    }
    this.group.visible = this.alpha > 0.001;
  }
}

// ------------------------------------------------------------------ field lines
export class FieldLinesOverlay extends Fader {
  private material = new LineMaterial({
    color: 0x5cc8ff,
    linewidth: 1.3,
    transparent: true,
    opacity: 0,
    depthWrite: false,
  });
  private lines: Line2[] = [];

  setLines(lines: Float32Array[]) {
    for (const l of this.lines) {
      this.group.remove(l);
      l.geometry.dispose();
    }
    this.lines = lines.filter((l) => l.length >= 6).map((l) => makeLine(l, this.material));
    for (const l of this.lines) {
      l.renderOrder = 1;
      this.group.add(l);
    }
  }

  protected applyAlpha(a: number) {
    this.material.opacity = 0.38 * a;
  }
}

// ------------------------------------------------------------------ field-strength wash
const washVertex = /* glsl */ `
  varying vec2 vPos;
  void main() {
    vPos = position.xy;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  }`;
const washFragment = /* glsl */ `
  uniform sampler2D uTex;
  uniform float uOpacity;
  uniform float uRadius;
  uniform float uHalf;
  uniform vec3 uWeak;
  uniform vec3 uStrong;
  varying vec2 vPos;
  void main() {
    float t = texture2D(uTex, (vPos + uHalf) / (2.0 * uHalf)).r;
    vec3 col = mix(uWeak, uStrong, t);
    float edge = smoothstep(uRadius, uRadius * 0.82, length(vPos));
    float a = uOpacity * edge * (0.22 + 0.5 * t);
    gl_FragColor = vec4(col, a);
    #include <colorspace_fragment>
  }`;

export function makeWashMaterial(tex: THREE.Texture, radius: number, half: number) {
  return new THREE.ShaderMaterial({
    uniforms: {
      uTex: { value: tex },
      uOpacity: { value: 0 },
      uRadius: { value: radius },
      uHalf: { value: half },
      uWeak: { value: new THREE.Color(0xbfe4ff) },
      uStrong: { value: new THREE.Color(0x0d4bc4) },
    },
    vertexShader: washVertex,
    fragmentShader: washFragment,
    transparent: true,
    depthWrite: false,
    side: THREE.DoubleSide,
  });
}

/** Maps |B|/|B_centre| to 0..1 (0.5 = same as the centre). */
export const washValue = (ratio: number) => Math.max(0, Math.min(1, 0.5 + (ratio - 1) / 0.6));

export class WashOverlay extends Fader {
  private data = new Uint8Array(WASH_RES * WASH_RES).fill(128);
  private tex = new THREE.DataTexture(this.data, WASH_RES, WASH_RES, THREE.RedFormat, THREE.UnsignedByteType);
  private material: THREE.ShaderMaterial;

  constructor() {
    super();
    this.tex.magFilter = THREE.LinearFilter;
    this.tex.minFilter = THREE.LinearFilter;
    this.tex.needsUpdate = true;
    this.material = makeWashMaterial(this.tex, 7.85, 8);
    const mesh = new THREE.Mesh(new THREE.CircleGeometry(7.85, 96), this.material);
    mesh.position.z = -0.05;
    mesh.renderOrder = 0;
    this.group.add(mesh);
  }

  setWash(ratios: Float32Array) {
    for (let i = 0; i < ratios.length; i++) this.data[i] = Math.round(255 * washValue(ratios[i]));
    this.tex.needsUpdate = true;
  }

  protected applyAlpha(a: number) {
    this.material.uniforms.uOpacity.value = a;
  }
}

// ------------------------------------------------------------------ guiding centre
export class GuidingCentreOverlay extends Fader {
  private material = new LineMaterial({
    color: 0xffffff,
    linewidth: 2,
    dashed: true,
    dashSize: 0.55,
    gapSize: 0.4,
    transparent: true,
    opacity: 0,
    depthWrite: false,
  });
  private line: Line2;
  private dots: THREE.Points;
  private dotMat: THREE.PointsMaterial;

  constructor() {
    super();
    this.line = makeLine([0, 0, 0, 0, 0.01, 0], this.material);
    this.line.renderOrder = 4;
    this.dotMat = new THREE.PointsMaterial({
      map: glowTexture(),
      color: 0xffffff,
      size: 0.9,
      transparent: true,
      opacity: 0,
      depthWrite: false,
    });
    this.dots = new THREE.Points(new THREE.BufferGeometry(), this.dotMat);
    this.dots.renderOrder = 4;
    this.group.add(this.line, this.dots);
  }

  /** centres in cm; the line is clipped to the bulb */
  setCentres(centres: THREE.Vector3[], bulbRadius = 7.6) {
    const inside = centres.filter((c) => c.length() < bulbRadius);
    this.dots.geometry.dispose();
    this.dots.geometry = new THREE.BufferGeometry().setFromPoints(inside);
    if (centres.length >= 2) {
      const a = centres[0];
      const dir = centres[centres.length - 1].clone().sub(a);
      if (dir.length() < 1e-3) {
        this.line.visible = false;
        return;
      }
      dir.normalize();
      // extend through the whole bulb along the drift direction
      const pts: number[] = [];
      for (let s = -16; s <= 16; s += 0.25) {
        const p = a.clone().addScaledVector(dir, s);
        if (p.length() < bulbRadius) pts.push(p.x, p.y, p.z + 0.15);
      }
      if (pts.length >= 6) {
        setLinePositions(this.line, pts);
        this.line.visible = true;
        return;
      }
    }
    this.line.visible = false;
  }

  protected applyAlpha(a: number) {
    this.material.opacity = 0.85 * a;
    this.dotMat.opacity = a;
  }
}

// ------------------------------------------------------------------ ruler
export class RulerOverlay extends Fader {
  private barMat = new LineMaterial({ color: 0xffffff, linewidth: 1.6, transparent: true, opacity: 0, depthWrite: false });
  private tickMat = new THREE.LineBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0, depthWrite: false });
  private bar: Line2;
  private ticks: THREE.LineSegments;
  private label: ScreenLabel;
  private valid = false;

  constructor() {
    super();
    this.bar = makeLine([0, 0, 0, 0, 1, 0], this.barMat);
    this.ticks = new THREE.LineSegments(new THREE.BufferGeometry(), this.tickMat);
    this.bar.renderOrder = 5;
    this.ticks.renderOrder = 5;
    this.group.add(this.bar, this.ticks);
    this.label = new ScreenLabel('ruler-label');
  }

  /** Snap to two neighbouring loop points (cm). Pass null to hide. `label` overrides the printed gap. */
  setSpan(a: THREE.Vector3 | null, b: THREE.Vector3 | null, label?: string) {
    this.valid = !!(a && b && Math.abs(b.y - a.y) > 0.05);
    if (!this.valid || !a || !b) return;
    const x = Math.max(a.x, b.x) + 1.1;
    const z = 0.4;
    const y0 = a.y;
    const y1 = b.y;
    setLinePositions(this.bar, [x, y0, z, x, y1, z]);
    const seg: number[] = [];
    // end markers reaching back to the beam
    seg.push(a.x, y0, z, x + 0.5, y0, z, b.x, y1, z, x + 0.5, y1, z);
    const lo = Math.min(y0, y1);
    const hi = Math.max(y0, y1);
    for (let k = 0; ; k++) {
      const y = lo + k * 0.2;
      if (y > hi + 1e-6) break;
      const len = k % 5 === 0 ? 0.45 : 0.22;
      seg.push(x, y, z, x + len, y, z);
    }
    this.ticks.geometry.dispose();
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(seg, 3));
    this.ticks.geometry = g;
    this.label.position.set(x + 2.3, (y0 + y1) / 2, z);
    this.label.text = label ?? `${Math.abs(y1 - y0).toFixed(1)} cm`;
  }

  hideLabel() {
    this.label.el.style.opacity = '0';
  }

  update(dt: number, camera: THREE.Camera) {
    const was = this.enabled;
    this.enabled = was && this.valid;
    super.update(dt, camera);
    this.enabled = was;
    this.label.opacity = this.alpha;
    this.label.update(camera);
  }

  protected applyAlpha(a: number) {
    this.barMat.opacity = 0.9 * a;
    this.tickMat.opacity = 0.75 * a;
  }
}
