import { describe, it, expect } from 'vitest';
import { tiltFor } from '../tilt.js';

// UI stage 1 — pointer-tracked tilt maths for stat tiles (lib/tilt.js).
describe('tiltFor', () => {
  const r = { left: 0, top: 0, width: 200, height: 100 };

  it('is flat at the centre and reaches ±3° at the corners', () => {
    expect(tiltFor(100, 50, r)).toEqual({ rx: 0, ry: 0 });
    expect(tiltFor(0, 0, r)).toEqual({ rx: 3, ry: -3 });
    expect(tiltFor(200, 100, r)).toEqual({ rx: -3, ry: 3 });
  });

  it('clamps outside the rectangle and is flat for a zero-size one', () => {
    expect(tiltFor(-500, 50, r).ry).toBe(-3);
    expect(tiltFor(10, 10, { left: 0, top: 0, width: 0, height: 0 })).toEqual({ rx: 0, ry: 0 });
  });
});
