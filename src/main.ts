import '@fontsource/inter/400.css';
import '@fontsource/inter/500.css';
import '@fontsource/inter/600.css';
import './style.css';

import { Stage } from './scene/stage';
import { Apparatus } from './scene/apparatus';
import { damp } from './scene/util';
import { ExperimentChapter } from './chapters/experiment';
import { WhyDriftsChapter } from './chapters/whyDrifts';
import { TokamakChapter } from './chapters/tokamak';
import { LabChapter } from './chapters/lab';
import { $, $$, type AppContext, type Chapter } from './chapters/types';

const canvas = $<HTMLCanvasElement>('#scene');
const stage = new Stage(canvas);
const apparatus = new Apparatus();
stage.scene.add(apparatus.group);

// ---------------------------------------------------------------- narration (crossfades on change)
const narrationEl = $('#narration');
let narrationText = '';
let narrationTimer = 0;
function setNarration(text: string) {
  if (text === narrationText) return;
  narrationText = text;
  clearTimeout(narrationTimer);
  narrationEl.classList.add('fading');
  narrationTimer = window.setTimeout(() => {
    narrationEl.textContent = text;
    narrationEl.classList.remove('fading');
  }, 230);
}

// ---------------------------------------------------------------- chapters
let current = 0;
const ctx: AppContext & { nextChapter(): void } = {
  stage,
  apparatus,
  setNarration,
  nextChapter: () => goToChapter(current + 1),
};
const chapters: Chapter[] = [new ExperimentChapter(ctx), new WhyDriftsChapter(ctx), new TokamakChapter(ctx), new LabChapter(ctx)];
let apparatusAlpha = 1;

function goToChapter(i: number) {
  i = Math.max(0, Math.min(chapters.length - 1, i));
  if (i === current && document.body.dataset.ready) return;
  chapters[current].exit();
  current = i;
  document.body.dataset.chapter = String(i + 1);
  $$('.chapter-bar button').forEach((b) => b.classList.toggle('active', Number(b.dataset.ch) === i + 1));
  chapters[i].enter();
  document.body.dataset.ready = '1';
}

$$('.chapter-bar button').forEach((b) => b.addEventListener('click', () => goToChapter(Number(b.dataset.ch) - 1)));

// ---------------------------------------------------------------- about popover
const about = $('#about');
$('#about-btn').addEventListener('click', (e) => {
  e.stopPropagation();
  about.hidden = !about.hidden;
});
document.addEventListener('click', (e) => {
  if (!about.hidden && !about.contains(e.target as Node)) about.hidden = true;
});

// ---------------------------------------------------------------- keyboard (works with a presentation clicker)
const fpsEl = $('#fps');
window.addEventListener('keydown', (e) => {
  const target = e.target as HTMLElement;
  const typing = target instanceof HTMLInputElement && target.type !== 'range' && target.type !== 'checkbox';
  if (typing || e.ctrlKey || e.metaKey || e.altKey) return;
  // range inputs keep their own arrow keys
  if (target instanceof HTMLInputElement && target.type === 'range' && e.key.startsWith('Arrow')) return;

  switch (e.key) {
    case '1':
    case '2':
    case '3':
    case '4':
      goToChapter(Number(e.key) - 1);
      break;
    case 'ArrowRight':
    case 'PageDown':
      if (!chapters[current].next()) goToChapter(current + 1);
      e.preventDefault();
      break;
    case 'ArrowLeft':
    case 'PageUp':
      if (!chapters[current].prev()) goToChapter(current - 1);
      e.preventDefault();
      break;
    case ' ':
      chapters[current].togglePlay();
      e.preventDefault();
      (document.activeElement as HTMLElement | null)?.blur();
      break;
    case 'p':
    case 'P':
      document.body.classList.toggle('presenting');
      break;
    case 'f':
    case 'F':
      if (document.fullscreenElement) document.exitFullscreen();
      else document.documentElement.requestFullscreen?.();
      break;
    case 'Escape':
      about.hidden = true;
      break;
    case '`':
      fpsEl.hidden = !fpsEl.hidden;
      break;
  }
});

// ---------------------------------------------------------------- render loop
// dev-only: ?maxdt=0.4 lets slow software renderers (headless checks) run in real time
const MAX_DT = (import.meta.env.DEV && Number(new URLSearchParams(location.search).get('maxdt'))) || 0.05;
let last = performance.now();
let fpsFrames = 0;
let fpsTime = 0;
function frame(now: number) {
  // rAF timestamps can precede a performance.now() taken during start-up → never let dt go negative
  const dt = Math.max(0, Math.min(MAX_DT, (now - last) / 1000));
  last = now;

  apparatusAlpha = damp(apparatusAlpha, chapters[current].apparatusAlpha, 6, dt);
  if (Math.abs(apparatusAlpha - chapters[current].apparatusAlpha) < 0.002) apparatusAlpha = chapters[current].apparatusAlpha;
  apparatus.setAlpha(apparatusAlpha);

  for (const c of chapters) c.update(dt);
  stage.update(dt);
  stage.render();

  if (!fpsEl.hidden) {
    fpsFrames++;
    fpsTime += dt;
    if (fpsTime >= 0.5) {
      fpsEl.textContent = `${Math.round(fpsFrames / fpsTime)} fps`;
      fpsFrames = 0;
      fpsTime = 0;
    }
  }
  requestAnimationFrame(frame);
}

goToChapter(0);
requestAnimationFrame(frame);

if (import.meta.env.DEV) (window as unknown as Record<string, unknown>).__app = { stage, apparatus, chapters };
