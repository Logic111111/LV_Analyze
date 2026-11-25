// Basic / Advanced mode. Plain JS (no JSX) so it is unit-tested in Node.
export const MODE_KEY = 'fi-mode';

/** Anything other than a stored 'advanced' is Basic, the default. */
export function parseMode(stored) {
  return stored === 'advanced' ? 'advanced' : 'basic';
}
