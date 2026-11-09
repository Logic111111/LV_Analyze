// Number interpolation for <Readout> (UI stage 1): changed results count from the old value to the
// new one. Pure functions, unit-tested in Node.

/** Ease-out cubic: fast start, gentle stop. t is clamped to [0, 1]. */
export function easeOutCubic(t) {
  const x = Math.min(1, Math.max(0, t));
  return 1 - (1 - x) ** 3;
}

/** The value shown elapsedMs into a count from `from` to `to`; `to` once done, for a zero
 *  duration (reduced motion), or when either end is not a finite number. */
export function countUpValue(from, to, elapsedMs, durationMs = 400) {
  if (!Number.isFinite(from) || !Number.isFinite(to) || durationMs <= 0 || elapsedMs >= durationMs) return to;
  return from + (to - from) * easeOutCubic(elapsedMs / durationMs);
}
