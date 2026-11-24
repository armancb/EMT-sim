import * as THREE from 'three';
import { DEFAULT_SETTINGS, PAPER_TILT, derive, type Settings } from '../physics/constants';
import { loopCentroids, simulateExperiment, type ExperimentResult } from '../physics/trajectory';
import type { FieldRequest, FieldResponse } from '../physics/fieldTypes';
import { Beam } from '../scene/beam';
import { FieldLinesOverlay, GuidingCentreOverlay, RulerOverlay, WashOverlay } from '../scene/overlays';
import type { CameraView } from '../scene/stage';
import { damp } from '../scene/util';
import { $, $$, paintRange, type AppContext, type Chapter } from './types';

const PRESETS: Record<string, Pick<Settings, 'tiltDeg' | 'current' | 'voltage'>> = {
  uniform: { tiltDeg: 0, current: 2.0, voltage: 250 },
  paper: { tiltDeg: PAPER_TILT, current: 2.0, voltage: 250 },
  exaggerated: { tiltDeg: 40, current: 1.4, voltage: 250 },
};
const PRESET_ORDER = ['uniform', 'paper', 'exaggerated'];

const CAMERAS: Record<string, CameraView> = {
  front: { position: [0, 2, 98], target: [0, -4, 0] },
  side: { position: [74, 34, 60], target: [0, -6, 0] },
  free: { position: [-62, 26, 76], target: [0, -5, 0] },
};

const fmtCm = (m: number) => {
  const cm = Math.abs(m) * 100;
  return `${cm < 0.1 ? cm.toFixed(2) : cm.toFixed(1)} cm`;
};

export class ExperimentChapter implements Chapter {
  readonly apparatusAlpha = 1;
  readonly group = new THREE.Group();
  private settings: Settings = { ...DEFAULT_SETTINGS };
  private shownTilt = 0;
  private result!: ExperimentResult;
  private beam = new Beam();
  private lines = new FieldLinesOverlay();
  private wash = new WashOverlay();
  private centre = new GuidingCentreOverlay();
  private ruler = new RulerOverlay();
  private playing = true;
  private active = false;
  private camera = 'front';
  private dragging = false;

  private worker: Worker;
  private fieldReqId = 0;
  private fieldTilt = NaN;
  private fieldTimer = 0;

  private ui = {
    tilt: $<HTMLInputElement>('#tilt'),
    current: $<HTMLInputElement>('#current'),
    voltage: $<HTMLInputElement>('#voltage'),
    tiltVal: $('#tilt-val'),
    currentVal: $('#current-val'),
    voltageVal: $('#voltage-val'),
    particleHint: $('#particle-hint'),
    play: $('#play'),
    readout: $('#readout'),
    roOrbit: $('#ro-orbit'),
    roShift: $('#ro-shift'),
    roPred: $('#ro-pred'),
    roBadge: $('#ro-badge'),
  };

  constructor(private ctx: AppContext) {
    this.group.add(this.wash.group, this.lines.group, this.beam.group, this.centre.group, this.ruler.group);
    ctx.stage.scene.add(this.group);

    this.worker = new Worker(new URL('../physics/fieldWorker.ts', import.meta.url), { type: 'module' });
    this.worker.onmessage = (e: MessageEvent<FieldResponse>) => {
      if (e.data.id !== this.fieldReqId) return;
      this.fieldTilt = e.data.tiltDeg;
      this.lines.setLines(e.data.lines);
      this.wash.setWash(e.data.wash);
    };

    this.bindUi();
    this.syncUi();
    this.recompute(true);
  }

  // ------------------------------------------------------------------ UI
  private bindUi() {
    const sliders: [HTMLInputElement, keyof Settings][] = [
      [this.ui.tilt, 'tiltDeg'],
      [this.ui.current, 'current'],
      [this.ui.voltage, 'voltage'],
    ];
    for (const [el, key] of sliders) {
      el.addEventListener('pointerdown', () => (this.dragging = true));
      el.addEventListener('input', () => {
        let v = Number(el.value);
        if (key === 'tiltDeg' && Math.abs(v - PAPER_TILT) < 0.7) v = PAPER_TILT; // snap to the paper's angle
        (this.settings[key] as number) = v;
        this.syncUi();
        this.recompute(!this.dragging);
      });
      el.addEventListener('change', () => {
        if (this.dragging) {
          this.dragging = false;
          this.recompute(true);
        }
      });
    }

    $$('#presets button').forEach((b) =>
      b.addEventListener('click', () => this.applyPreset(b.dataset.preset!)),
    );
    $$('#particle button').forEach((b) =>
      b.addEventListener('click', () => {
        this.settings.particle = b.dataset.particle as Settings['particle'];
        this.syncUi();
        this.recompute(true);
      }),
    );
    this.ui.play.addEventListener('click', () => this.togglePlay());
    $('#reset').addEventListener('click', () => {
      this.settings = { ...DEFAULT_SETTINGS };
      this.syncUi();
      this.recompute(true);
    });

    $$('#viewbar [data-view]').forEach((b) =>
      b.addEventListener('click', () => {
        const on = !b.classList.contains('on');
        b.classList.toggle('on', on);
        const view = b.dataset.view!;
        if (view === 'lines') this.lines.enabled = on;
        if (view === 'wash') this.wash.enabled = on;
        if (view === 'centre') this.centre.enabled = on;
        if (view === 'ruler') this.ruler.enabled = on;
        this.requestField();
      }),
    );
    $$('#viewbar [data-cam]').forEach((b) => b.addEventListener('click', () => this.setCamera(b.dataset.cam!)));
  }

  private setCamera(name: string) {
    this.camera = name;
    $$('#viewbar [data-cam]').forEach((b) => b.classList.toggle('active', b.dataset.cam === name));
    const c = this.ctx.stage.controls;
    c.autoRotate = name === 'free';
    this.ctx.stage.goTo(CAMERAS[name]);
  }

  private applyPreset(name: string) {
    Object.assign(this.settings, PRESETS[name]);
    this.syncUi();
    this.recompute(true);
  }

  private currentPresetIndex() {
    return PRESET_ORDER.findIndex((k) => {
      const p = PRESETS[k];
      return (
        Math.abs(p.tiltDeg - this.settings.tiltDeg) < 1e-6 &&
        Math.abs(p.current - this.settings.current) < 1e-6 &&
        Math.abs(p.voltage - this.settings.voltage) < 1e-6
      );
    });
  }

  private syncUi() {
    const s = this.settings;
    this.ui.tilt.value = String(s.tiltDeg);
    this.ui.current.value = String(s.current);
    this.ui.voltage.value = String(s.voltage);
    [this.ui.tilt, this.ui.current, this.ui.voltage].forEach(paintRange);
    const { B0 } = derive(s);
    this.ui.tiltVal.textContent = `${s.tiltDeg.toFixed(1)}°`;
    this.ui.currentVal.textContent = `${s.current.toFixed(2)} A · ${(B0 * 1000).toFixed(2)} mT`;
    this.ui.voltageVal.textContent = `${s.voltage.toFixed(0)} V`;
    this.ui.particleHint.textContent = s.particle === 'positron' ? 'same mass, opposite charge' : '';
    $$('#particle button').forEach((b) => b.classList.toggle('active', b.dataset.particle === s.particle));
    const idx = this.currentPresetIndex();
    $$('#presets button').forEach((b) => b.classList.toggle('active', PRESET_ORDER[idx] === b.dataset.preset));
  }

  // ------------------------------------------------------------------ physics → scene
  private recompute(regrow: boolean) {
    const s = this.settings;
    this.result = simulateExperiment(s);
    const { beam, measure, derived } = this.result;
    const uniform = s.tiltDeg < 0.05;

    // in a uniform field all 8 loops overlap exactly, so draw one
    const count = uniform && beam.loopIndices.length > 1 ? Math.round(beam.loopIndices[1]) + 1 : beam.count;
    const cm = new Float32Array(count * 3);
    for (let i = 0; i < count * 3; i++) cm[i] = beam.points[i] * 100;
    this.beam.setPath(cm, count, regrow);
    this.ctx.apparatus.setParticle(s.particle);

    // guiding centre + ruler
    const centres = loopCentroids(measure).map((c) => new THREE.Vector3(c[0] * 100, c[1] * 100, c[2] * 100));
    this.centre.setCentres(centres);
    const recs = beam.loopRecords.length >= 2 ? beam.loopRecords : measure.loopRecords;
    const toV = (r: number[]) => new THREE.Vector3(r[0] * 100, r[1] * 100, r[2] * 100);
    this.ruler.setSpan(uniform ? null : toV(recs[0]), uniform ? null : toV(recs[1]));

    // readout
    this.ui.readout.classList.toggle('uniform', uniform);
    this.ui.roOrbit.textContent = fmtCm(derived.rL);
    if (!uniform && measure.measuredShift !== null) {
      const m = Math.abs(measure.measuredShift);
      const p = derived.predictedShift;
      const diff = (Math.abs(m - p) / p) * 100;
      this.ui.roShift.textContent = fmtCm(m);
      this.ui.roPred.textContent = fmtCm(p);
      const warn = diff > 15;
      this.ui.roBadge.textContent = `✓ ${diff < 1 ? '<1' : diff.toFixed(0)}% apart`;
      this.ui.roBadge.classList.toggle('warn', warn);
    }

    this.updateNarration();
    this.requestField();
  }

  private requestField() {
    const wanted = this.lines.enabled || this.wash.enabled;
    if (!wanted || this.settings.tiltDeg === this.fieldTilt) return;
    clearTimeout(this.fieldTimer);
    this.fieldTimer = window.setTimeout(() => {
      const req: FieldRequest = { id: ++this.fieldReqId, tiltDeg: this.settings.tiltDeg };
      this.worker.postMessage(req);
    }, 90);
  }

  private updateNarration() {
    if (!this.active) return;
    const s = this.settings;
    const who = s.particle === 'electron' ? 'electron' : 'positron';
    let text: string;
    if (s.tiltDeg < 0.05) text = `Parallel coils make a uniform field, so the ${who} runs in a perfect circle.`;
    else if (s.particle === 'positron') text = 'Opposite charge, opposite drift.';
    else text = 'Tilted coils make the field stronger on one side, so the circle no longer closes.';
    this.ctx.setNarration(text);
  }

  // ------------------------------------------------------------------ Chapter
  enter() {
    this.active = true;
    this.group.visible = true;
    // another chapter may have moved the coils: glide back from wherever they are
    this.shownTilt = this.ctx.apparatus.tilt;
    this.ctx.stage.controls.enabled = true;
    this.setCamera(this.camera);
    this.recompute(true);
  }

  exit() {
    this.active = false;
    this.group.visible = false;
    this.ruler.hideLabel();
    this.ctx.stage.controls.autoRotate = false;
  }

  update(dt: number) {
    const stage = this.ctx.stage;
    // coils + gears follow the slider smoothly
    const target = this.settings.tiltDeg;
    if (this.active && Math.abs(this.shownTilt - target) > 1e-3) {
      this.shownTilt = damp(this.shownTilt, target, this.dragging ? 20 : 7, dt);
      if (Math.abs(this.shownTilt - target) < 1e-3) this.shownTilt = target;
      this.ctx.apparatus.setTilt(this.shownTilt);
    }
    if (!this.group.visible) return;
    this.beam.update(dt, this.playing);
    for (const o of [this.lines, this.wash, this.centre, this.ruler]) o.update(dt, stage.camera);
  }

  next() {
    const i = this.currentPresetIndex();
    if (i >= PRESET_ORDER.length - 1) return false;
    this.applyPreset(PRESET_ORDER[i + 1]);
    return true;
  }

  prev() {
    const i = this.currentPresetIndex();
    if (i <= 0) return false;
    this.applyPreset(PRESET_ORDER[i - 1]);
    return true;
  }

  togglePlay() {
    this.playing = !this.playing;
    this.ui.play.classList.toggle('paused', !this.playing);
  }
}
