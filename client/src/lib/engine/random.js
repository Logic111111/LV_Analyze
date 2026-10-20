// @ts-check
// Seeded pseudo-random numbers for reproducible searches: annealing restarts in the phase
// optimiser (P4.1) and Monte Carlo planning (P4.4). Math.random can't be seeded, so a run could
// never be repeated or tested. mulberry32 is a tiny 32-bit generator: statistically fine for
// sampling (not for cryptography), and integer-exact, so a seed gives the same sequence in the
// browser, the worker and Node.

/** @param {number} seed @returns {() => number} uniform in [0, 1) */
export function mulberry32(seed) {
  let a = (Number(seed) || 0) >>> 0;
  return function next() {
    a = (a + 0x6D2B79F5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** An integer in [0, n). @param {() => number} rand @param {number} n */
export function randomInt(rand, n) { return Math.min(n - 1, Math.floor(rand() * n)); }
