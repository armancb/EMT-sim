import * as THREE from 'three';

const layer = () => document.getElementById('labels')!;
const v = new THREE.Vector3();

/** A small HTML label pinned to a 3D point. */
export class ScreenLabel {
  readonly el: HTMLDivElement;
  readonly position = new THREE.Vector3();
  opacity = 0;

  constructor(className: string, text = '') {
    this.el = document.createElement('div');
    this.el.className = `label3d ${className}`;
    this.el.textContent = text;
    this.el.style.opacity = '0';
    layer().appendChild(this.el);
  }

  set text(t: string) {
    if (this.el.textContent !== t) this.el.textContent = t;
  }

  update(camera: THREE.Camera) {
    v.copy(this.position).project(camera);
    const visible = this.opacity > 0.01 && v.z < 1;
    this.el.style.opacity = visible ? String(this.opacity) : '0';
    if (!visible) return;
    const x = (v.x * 0.5 + 0.5) * window.innerWidth;
    const y = (-v.y * 0.5 + 0.5) * window.innerHeight;
    this.el.style.transform = `translate(${x.toFixed(1)}px, ${y.toFixed(1)}px) translate(-50%, -50%)`;
  }
}
