// Pointer-tracked tilt for stat tiles (UI stage 1). Pure maths, unit-tested in Node.

/**
 * Rotation for a pointer at (px, py) over `rect`: flat at the centre, ±maxDeg at the edges
 * (clamped outside), so the tile leans toward the pointer. A zero-size rect stays flat.
 * @returns {{ rx: number, ry: number }} degrees around the X and Y axes
 */
export function tiltFor(px, py, rect, maxDeg = 3) {
  const { left, top, width, height } = rect;
  if (!(width > 0) || !(height > 0)) return { rx: 0, ry: 0 };
  const clamp = (v) => Math.max(-1, Math.min(1, v));
  const nx = clamp((px - left - width / 2) / (width / 2));
  const ny = clamp((py - top - height / 2) / (height / 2));
  // `+ 0` turns -0 into 0.
  return { rx: -ny * maxDeg + 0, ry: nx * maxDeg + 0 };
}
