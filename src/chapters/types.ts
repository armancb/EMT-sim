import type { Stage } from '../scene/stage';
import type { Apparatus } from '../scene/apparatus';

export interface AppContext {
  stage: Stage;
  apparatus: Apparatus;
  setNarration(text: string): void;
}

export interface Chapter {
  /** apparatus opacity while this chapter is active */
  readonly apparatusAlpha: number;
  enter(): void;
  exit(): void;
  update(dt: number): void;
  /** advance one step/preset; return false when there is nothing left (go to next chapter) */
  next(): boolean;
  prev(): boolean;
  togglePlay(): void;
}

export const $ = <T extends HTMLElement = HTMLElement>(sel: string, root: ParentNode = document) =>
  root.querySelector(sel) as T;
export const $$ = <T extends HTMLElement = HTMLElement>(sel: string, root: ParentNode = document) =>
  Array.from(root.querySelectorAll(sel)) as T[];

/** keep the orange "filled" part of a range input in sync */
export function paintRange(input: HTMLInputElement) {
  const min = Number(input.min);
  const max = Number(input.max);
  const p = ((Number(input.value) - min) / (max - min)) * 100;
  input.style.setProperty('--fill', `${p}%`);
}
