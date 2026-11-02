/**
 * Easing and timed tweens, hand-rolled.
 *
 * The whole animation surface here is a stagger, a pulse and a camera move. That
 * is about forty lines, so it does not justify a 60KB animation library.
 */

export const easeOutCubic = (t: number) => 1 - Math.pow(1 - t, 3);
export const easeInOutCubic = (t: number) => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2);
export const easeOutBack = (t: number) => {
  const c1 = 1.70158, c3 = c1 + 1;
  return 1 + c3 * Math.pow(t - 1, 3) + c1 * Math.pow(t - 1, 2);
};
export const lerp = (a: number, b: number, t: number) => a + (b - a) * t;
export const clamp01 = (t: number) => (t < 0 ? 0 : t > 1 ? 1 : t);

export interface Tween {
  /** Advances the tween and returns true while it is still running. */
  update(nowMs: number): boolean;
  cancel(): void;
}

export function tween(opts: {
  durationMs: number;
  delayMs?: number;
  ease?: (t: number) => number;
  onUpdate: (t: number) => void;
  onComplete?: () => void;
}): Tween {
  const ease = opts.ease ?? easeOutCubic;
  const delay = opts.delayMs ?? 0;
  let start: number | null = null;
  let cancelled = false;
  let completed = false;
  return {
    update(now: number) {
      if (cancelled || completed) return false;
      start ??= now;
      const elapsed = now - start - delay;
      if (elapsed < 0) return true;
      const t = clamp01(elapsed / opts.durationMs);
      opts.onUpdate(ease(t));
      if (t >= 1) { completed = true; opts.onComplete?.(); return false; }
      return true;
    },
    cancel() { cancelled = true; },
  };
}

/** Honours the viewer's motion preference; checked at call time, not cached. */
export function prefersReducedMotion(): boolean {
  if (typeof window === 'undefined' || !window.matchMedia) return false;
  return window.matchMedia('(prefers-reduced-motion: reduce)').matches;
}
