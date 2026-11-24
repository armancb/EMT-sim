import * as THREE from 'three';
import { LAB_TILT, LAB_VOLTAGE, runLab, sweepCurrents, theoryCurves, withReadingError, type TheoryCurves } from '../physics/lab';
import { Beam } from '../scene/beam';
import { RulerOverlay } from '../scene/overlays';
import { damp } from '../scene/util';
import { SweepChart } from '../ui/sweepChart';
import { $, type AppContext, type Chapter } from './types';

const NARRATION = {
  idle: 'Step the current and measure each loop’s shift, like a student with a ruler.',
  running: 'Step the current and measure each loop’s shift, like a student with a ruler.',
  done: 'Real coils aren’t a perfect doughnut, so big orbits drift further than predicted.',
};

// per-point timeline (s): beam regrows, ruler snaps on, reading is plotted, next current
const T_RULER = 1.0;
const T_PLOT = 1.7;
const T_NEXT = 2.3;
const IDLE_CURRENT = 2.0;

type State = 'idle' | 'running' | 'done';

/** Chapter 4: sweep the coil current and compare the readings with two theory lines. */
export class LabChapter implements Chapter {
  readonly apparatusAlpha = 1;
  readonly group = new THREE.Group();
  private beam = new Beam();
  private ruler = new RulerOverlay();
  private chart: SweepChart;
  private state: State = 'idle';
  private currents = sweepCurrents();
  private k = 0;
  private t = 0;
  private reading = 0;
  private plotted = false;
  private theory: TheoryCurves | null = null;
  private playing = true;
  private active = false;
  private shownTilt = 0;

  private ui = {
    run: $<HTMLButtonElement>('#lab-run'),
    status: $('#lab-status'),
  };

  constructor(private ctx: AppContext) {
    this.group.add(this.beam.group, this.ruler.group);
    this.group.visible = false;
    ctx.stage.scene.add(this.group);
    this.chart = new SweepChart($('#lab-chart'));
    this.ui.run.addEventListener('click', () => this.start());
    window.addEventListener('resize', () => this.active && this.frameCamera());
    this.showCurrent(IDLE_CURRENT, false);
  }

  private showCurrent(I: number, withRuler: boolean) {
    const run = runLab(I);
    const { beam, measure } = run;
    const cm = new Float32Array(beam.count * 3);
    for (let i = 0; i < cm.length; i++) cm[i] = beam.points[i] * 100;
    this.beam.setPath(cm, beam.count, true);
    const r = measure.loopRecords;
    const v = (p: number[]) => new THREE.Vector3(p[0] * 100, p[1] * 100, p[2] * 100);
    this.reading = withReadingError(run.trueShift);
    this.ruler.setSpan(v(r[0]), v(r[1]), `${(this.reading * 100).toFixed(1)} cm`);
    this.ruler.enabled = false;
    if (!withRuler) this.ruler.hideLabel();
  }

  private start() {
    if (this.state === 'running') return;
    this.chart.clear();
    this.state = 'running';
    this.k = 0;
    this.t = 0;
    this.plotted = false;
    this.playing = true;
    this.showCurrent(this.currents[0], true);
    this.refreshUi();
  }

  private finish() {
    this.state = 'done';
    this.theory ??= theoryCurves();
    const th = this.theory;
    this.chart.showTheory(
      th.currents,
      th.simple.map((m) => m * 100),
      th.real.map((m) => m * 100),
    );
    this.refreshUi();
  }

  private refreshUi() {
    const b = this.ui.run;
    b.disabled = this.state === 'running';
    if (this.state === 'running') b.textContent = `Measuring ${this.k + 1} / ${this.currents.length}…`;
    else b.textContent = this.state === 'done' ? 'Run again' : 'Run current sweep';
    this.ui.status.textContent =
      this.state === 'running'
        ? `Coil current ${this.currents[this.k].toFixed(2)} A`
        : `Tilt ${LAB_TILT}° · ${LAB_VOLTAGE} V · reading error ±0.1 cm`;
    if (this.active) this.ctx.setNarration(NARRATION[this.state]);
  }

  private frameCamera() {
    // wide screens: slide the apparatus left so the chart card sits beside it
    const wide = window.innerWidth > 980;
    const x = wide ? 17 : 0;
    this.ctx.stage.goTo({ position: [x + 6, 6, 98], target: [x, -4, 0] }, 700);
  }

  enter() {
    this.active = true;
    this.group.visible = true;
    this.shownTilt = this.ctx.apparatus.tilt;
    this.ctx.apparatus.setParticle('electron');
    const c = this.ctx.stage.controls;
    c.enabled = true;
    c.autoRotate = false;
    this.frameCamera();
    this.refreshUi();
    // the theory lines need ~20 trajectories through Biot–Savart: do it before the sweep ends
    if (!this.theory) setTimeout(() => (this.theory ??= theoryCurves()), 900);
  }

  exit() {
    this.active = false;
    this.group.visible = false;
    this.ruler.hideLabel();
  }

  update(dt: number) {
    if (!this.active) return;
    if (Math.abs(this.shownTilt - LAB_TILT) > 1e-3) {
      this.shownTilt = damp(this.shownTilt, LAB_TILT, 7, dt);
      if (Math.abs(this.shownTilt - LAB_TILT) < 1e-3) this.shownTilt = LAB_TILT;
      this.ctx.apparatus.setTilt(this.shownTilt);
    }

    if (this.state === 'running' && this.playing) {
      this.t += dt;
      if (this.t >= T_RULER) this.ruler.enabled = true;
      if (this.t >= T_PLOT && !this.plotted) {
        this.chart.addPoint(this.currents[this.k], this.reading * 100);
        this.plotted = true;
      }
      if (this.t >= T_NEXT) {
        if (this.k + 1 >= this.currents.length) this.finish();
        else {
          this.k++;
          this.t = 0;
          this.plotted = false;
          this.showCurrent(this.currents[this.k], true);
          this.refreshUi();
        }
      }
    }

    const cam = this.ctx.stage.camera;
    this.beam.update(dt, this.playing);
    this.ruler.update(dt, cam);
  }

  next() {
    if (this.state === 'idle') {
      this.start();
      return true;
    }
    return this.state === 'running';
  }

  prev() {
    return false;
  }

  togglePlay() {
    this.playing = !this.playing;
  }
}
