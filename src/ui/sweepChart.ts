// Minimal SVG chart for the Virtual Lab: measured points + two theory lines.
const NS = 'http://www.w3.org/2000/svg';
const W = 400;
const H = 240;
const M = { l: 34, r: 12, t: 10, b: 34 };
const X0 = 1.2;
const X1 = 3.0;
const Y_MAX = 7; // cm

const sx = (I: number) => M.l + ((I - X0) / (X1 - X0)) * (W - M.l - M.r);
const sy = (cm: number) => H - M.b - (cm / Y_MAX) * (H - M.t - M.b);

function el<K extends keyof SVGElementTagNameMap>(tag: K, attrs: Record<string, string | number>, parent?: Element) {
  const e = document.createElementNS(NS, tag);
  for (const [k, v] of Object.entries(attrs)) e.setAttribute(k, String(v));
  parent?.appendChild(e);
  return e;
}

export class SweepChart {
  private svg: SVGSVGElement;
  private points: SVGGElement;
  private theory: SVGGElement;
  private tip: HTMLDivElement;
  private data: { I: number; cm: number }[] = [];

  constructor(private host: HTMLElement) {
    this.svg = el('svg', { viewBox: `0 0 ${W} ${H}`, role: 'img', class: 'sweep-chart' });
    this.svg.setAttribute('aria-label', 'Shift per loop against coil current');

    // light horizontal gridlines + y labels
    const grid = el('g', { class: 'grid' }, this.svg);
    for (let y = 0; y <= Y_MAX; y++) {
      el('line', { x1: M.l, x2: W - M.r, y1: sy(y), y2: sy(y), class: y === 0 ? 'base' : '' }, grid);
      const t = el('text', { x: M.l - 8, y: sy(y) + 3.5, 'text-anchor': 'end' }, grid);
      t.textContent = String(y);
    }
    for (let I = 1.2; I <= 3.0001; I += 0.3) {
      const t = el('text', { x: sx(I), y: H - M.b + 16, 'text-anchor': 'middle' }, grid);
      t.textContent = I.toFixed(1);
    }
    const xl = el('text', { x: (M.l + W - M.r) / 2, y: H - 3, 'text-anchor': 'middle', class: 'axis' }, grid);
    xl.textContent = 'Coil current (A)';
    const yl = el('text', { x: M.l + 4, y: M.t + 10, class: 'axis' }, grid);
    yl.textContent = 'Shift per loop (cm)';

    this.theory = el('g', { class: 'theory' }, this.svg);
    this.points = el('g', { class: 'points' }, this.svg);
    host.appendChild(this.svg);

    this.tip = document.createElement('div');
    this.tip.className = 'chart-tip';
    host.appendChild(this.tip);
  }

  clear() {
    this.data = [];
    this.points.replaceChildren();
    this.theory.replaceChildren();
    this.updateLabel();
  }

  addPoint(I: number, cm: number) {
    this.data.push({ I, cm });
    const g = el('g', { class: 'pt', transform: `translate(${sx(I)} ${sy(cm)})` }, this.points);
    el('circle', { r: 11, class: 'hit' }, g);
    el('circle', { r: 4.5, class: 'dot' }, g);
    g.addEventListener('pointerenter', () => this.showTip(I, cm, `${I.toFixed(2)} A · ${cm.toFixed(1)} cm measured`));
    g.addEventListener('pointerleave', () => this.tip.classList.remove('on'));
    // drop-in: start invisible, reveal next frame so the CSS transition runs
    requestAnimationFrame(() => g.classList.add('in'));
    this.updateLabel();
  }

  /** Draw both theory curves (cm) and reveal them one after the other. */
  showTheory(currents: number[], simpleCm: number[], realCm: number[]) {
    this.theory.replaceChildren();
    const path = (ys: number[]) => ys.map((y, i) => `${i ? 'L' : 'M'}${sx(currents[i]).toFixed(1)} ${sy(y).toFixed(1)}`).join('');
    const simple = el('path', { d: path(simpleCm), class: 'line simple', pathLength: 1 }, this.theory);
    const real = el('path', { d: path(realCm), class: 'line real', pathLength: 1 }, this.theory);

    // direct labels where the lines are far apart: real above its line, simple below its line
    const at = (ys: number[], I: number) => {
      const f = ((I - currents[0]) / (currents[currents.length - 1] - currents[0])) * (currents.length - 1);
      const i = Math.min(currents.length - 2, Math.max(0, Math.floor(f)));
      return ys[i] + (ys[i + 1] - ys[i]) * (f - i);
    };
    const lr = el('text', { x: sx(1.36), y: sy(at(realCm, 1.36)) - 8, class: 'lbl real' }, this.theory);
    lr.textContent = 'Real coil shape';
    // under the dashed line, clear of it across the whole width of the text
    const lsY = Math.min(at(simpleCm, 1.24), at(simpleCm, 1.95));
    const ls = el('text', { x: sx(1.24), y: sy(lsY) + 22, class: 'lbl simple' }, this.theory);
    ls.textContent = 'Simple doughnut model';

    // hover anywhere on the plot: read both lines at that current
    const hit = el('rect', { x: M.l, y: M.t, width: W - M.l - M.r, height: H - M.t - M.b, class: 'plot-hit' });
    this.theory.appendChild(hit);
    const cross = el('line', { y1: M.t, y2: H - M.b, class: 'cross' }, this.theory);
    hit.addEventListener('pointermove', (e) => {
      const r = this.svg.getBoundingClientRect();
      const x = ((e.clientX - r.left) / r.width) * W;
      const I = Math.min(X1, Math.max(X0, X0 + ((x - M.l) / (W - M.l - M.r)) * (X1 - X0)));
      const k = Math.round(((I - X0) / (X1 - X0)) * (currents.length - 1));
      cross.setAttribute('x1', String(sx(currents[k])));
      cross.setAttribute('x2', String(sx(currents[k])));
      cross.classList.add('on');
      this.showTip(
        currents[k],
        Y_MAX,
        `${currents[k].toFixed(2)} A · real coils ${realCm[k].toFixed(1)} cm · simple model ${simpleCm[k].toFixed(1)} cm`,
      );
    });
    hit.addEventListener('pointerleave', () => {
      cross.classList.remove('on');
      this.tip.classList.remove('on');
    });
    // points stay on top of the hover rect
    this.svg.appendChild(this.points);

    requestAnimationFrame(() => {
      simple.classList.add('in');
      real.classList.add('in');
      this.theory.classList.add('in');
    });
  }

  private showTip(I: number, cm: number, text: string) {
    this.tip.textContent = text;
    const r = this.svg.getBoundingClientRect();
    const h = this.host.getBoundingClientRect();
    const k = r.width / W;
    this.tip.style.left = `${r.left - h.left + sx(I) * k}px`;
    this.tip.style.top = `${r.top - h.top + sy(cm) * k}px`;
    this.tip.classList.add('on');
  }

  private updateLabel() {
    const pts = this.data.map((d) => `${d.I.toFixed(2)} A: ${d.cm.toFixed(1)} cm`).join('; ');
    this.svg.setAttribute('aria-label', `Shift per loop against coil current. ${pts || 'No measurements yet.'}`);
  }
}
