// @ts-check
// Seeded randomness for the optimisers (O1.1). Every stochastic search takes a `seed` (default 1)
// and draws only from a generator made here, so the same seed gives the same answer in the
// browser, the worker and Node. The generator is mulberry32 (random.js), shared with the P4.1
// annealing and the Monte Carlo study (import it from random.js).
import { mulberry32 } from '../random.js';


/** A generator for `seed` (default 1). @param {number} [seed] */
export function rngFor(seed = 1) { return mulberry32(Number.isFinite(Number(seed)) ? Number(seed) : 1); }

/** An integer in [0, n). @param {() => number} rand @param {number} n */
export function randInt(rand, n) { return n <= 1 ? 0 : Math.min(n - 1, Math.floor(rand() * n)); }

/** A shuffled copy (Fisher–Yates; every order equally likely). @template T @param {() => number} rand @param {readonly T[]} arr @returns {T[]} */
export function shuffle(rand, arr) {
  const out = arr.slice();
  for (let i = out.length - 1; i > 0; i--) { const j = randInt(rand, i + 1); const t = out[i]; out[i] = out[j]; out[j] = t; }
  return out;
}

/** One element, uniformly. @template T @param {() => number} rand @param {readonly T[]} arr @returns {T} */
export function choice(rand, arr) { return arr[randInt(rand, arr.length)]; }
