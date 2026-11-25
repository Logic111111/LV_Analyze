import { describe, it, expect } from 'vitest';
import { parseMode, MODE_KEY } from '../mode.js';

// Basic / Advanced mode: anything but a stored 'advanced' opens the app in Basic.
describe('parseMode', () => {
  it('reads a stored advanced choice', () => {
    expect(parseMode('advanced')).toBe('advanced');
  });
  it('defaults to basic for nothing, junk or the wrong case', () => {
    ['basic', null, undefined, 'Advanced', 'x', ''].forEach(v => expect(parseMode(v), String(v)).toBe('basic'));
  });
  it('uses the fi-mode storage key', () => {
    expect(MODE_KEY).toBe('fi-mode');
  });
});
