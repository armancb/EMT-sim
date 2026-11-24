import * as THREE from 'three';
import { Line2 } from 'three/addons/lines/Line2.js';
import { LineGeometry } from 'three/addons/lines/LineGeometry.js';
import { LineMaterial } from 'three/addons/lines/LineMaterial.js';

export { Line2, LineGeometry, LineMaterial };

let glowTex: THREE.Texture | null = null;
/** Soft round sprite used for sparks and particles. */
export function glowTexture(): THREE.Texture {
  if (glowTex) return glowTex;
  const c = document.createElement('canvas');
  c.width = 64;
  c.height = 64;
  const g = c.getContext('2d')!;
  const grad = g.createRadialGradient(32, 32, 0, 32, 32, 32);
  grad.addColorStop(0, 'rgba(255,255,255,1)');
  grad.addColorStop(0.25, 'rgba(255,255,255,0.75)');
  grad.addColorStop(0.6, 'rgba(255,255,255,0.15)');
  grad.addColorStop(1, 'rgba(255,255,255,0)');
  g.fillStyle = grad;
  g.fillRect(0, 0, 64, 64);
  glowTex = new THREE.CanvasTexture(c);
  return glowTex;
}

/** HDR colour (values > 1 feed the bloom pass). */
export function hdr(hex: number, intensity: number): THREE.Color {
  return new THREE.Color(hex).multiplyScalar(intensity);
}

export function makeLine(positions: ArrayLike<number>, material: LineMaterial): Line2 {
  const geo = new LineGeometry();
  geo.setPositions(Array.from(positions));
  const line = new Line2(geo, material);
  line.computeLineDistances();
  line.frustumCulled = false;
  return line;
}

export function setLinePositions(line: Line2, positions: ArrayLike<number>) {
  const old = line.geometry;
  const geo = new LineGeometry();
  geo.setPositions(Array.from(positions));
  line.geometry = geo;
  line.computeLineDistances();
  old.dispose();
}

/** Linear interpolation of a polyline (xyz triples) at a fractional index. */
export function samplePolyline(pts: ArrayLike<number>, count: number, f: number, out: THREE.Vector3) {
  const i = Math.max(0, Math.min(count - 1, Math.floor(f)));
  const j = Math.min(count - 1, i + 1);
  const t = Math.max(0, Math.min(1, f - i));
  out.set(
    pts[i * 3] + (pts[j * 3] - pts[i * 3]) * t,
    pts[i * 3 + 1] + (pts[j * 3 + 1] - pts[i * 3 + 1]) * t,
    pts[i * 3 + 2] + (pts[j * 3 + 2] - pts[i * 3 + 2]) * t,
  );
  return out;
}

export const damp = (current: number, target: number, lambda: number, dt: number) =>
  target + (current - target) * Math.exp(-lambda * dt);
