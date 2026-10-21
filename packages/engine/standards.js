// @ts-check
// Standards profiles (P2.7): the limits every result is judged against, as one named set.
//
// Where the values live: the voltage band stays in design.vnom / design.vdev (read throughout the
// engine since before profiles existed); everything else is in design.standards. Applying a
// profile writes both, and records the profile's name so a design shows which set it was checked
// against — editing any value afterwards turns it into a custom set.
//
// Only profiles with a stated source ship with the app. A utility's own limits are entered and
// saved by the user (never guessed here).
/** @import { Design, Standards } from './types.js' */

/**
 * @typedef {object} StandardsProfile
 * @property {string} id
 * @property {string} name
 * @property {string} [source]          Where the values come from.
 * @property {number} vnom              Nominal phase-neutral voltage, V.
 * @property {number} vdevPct           Allowed deviation, ±%.
 * @property {number} vufLimitPct       Voltage unbalance factor limit, %.
 * @property {boolean} vufAsViolation
 * @property {number} cableLoadingLimitPct  Thermal violation above this % of a span's rating.
 * @property {number} txLoadingLimitPct     Transformer overload above this % of rating (import only,
 *                                          unless design.standards.txLimitBothDirections — O3.5).
 * @property {number} disconnectTimeS       Fuse disconnection time for the protection check, s.
 */

/** @type {readonly StandardsProfile[]} */
export const BUILTIN_STANDARDS_PROFILES = Object.freeze([
  Object.freeze({
    id: 'app-defaults', name: 'Current app defaults',
    source: 'Exactly the limits Feeder Island has always used: 230 V ±6 %, conductors and transformers at 100 % of rating; VUF 2 % reported but not counted; 5 s disconnection.',
    vnom: 230, vdevPct: 6, vufLimitPct: 2, vufAsViolation: false, cableLoadingLimitPct: 100, txLoadingLimitPct: 100, disconnectTimeS: 5
  }),
  Object.freeze({
    id: 'en50160', name: 'EN 50160 supply voltage',
    source: 'EN 50160 LV supply voltage: Un 230 V ±10 % and voltage unbalance ≤ 2 % (both for 95 % of 10-min means over a week). EN 50160 sets no loading limits, so cables and transformers stay at 100 %; 5 s disconnection as for distribution circuits.',
    vnom: 230, vdevPct: 10, vufLimitPct: 2, vufAsViolation: true, cableLoadingLimitPct: 100, txLoadingLimitPct: 100, disconnectTimeS: 5
  })
]);

/** Defaults for every field of design.standards (the "Current app defaults" values). */
export const STANDARDS_DEFAULTS = Object.freeze({
  profileName: 'Current app defaults', vufLimitPct: 2, vufAsViolation: false, disconnectTimeS: 5, cableLoadingLimitPct: 100, txLoadingLimitPct: 100
});

/** The effective limits for a design, with defaults for anything missing. @param {Design} design */
export function standardsOf(design) {
  const s = /** @type {Partial<Standards> & Record<string, any>} */ (design.standards || {});
  const num = (v, d) => (Number.isFinite(Number(v)) && v !== null && v !== '' ? Number(v) : d);
  return {
    profileName: typeof s.profileName === 'string' ? s.profileName : STANDARDS_DEFAULTS.profileName,
    vnom: num(design.vnom, 230),
    vdevPct: num(design.vdev, 6),
    vufLimitPct: num(s.vufLimitPct, STANDARDS_DEFAULTS.vufLimitPct),
    vufAsViolation: !!s.vufAsViolation,
    cableLoadingLimitPct: num(s.cableLoadingLimitPct, STANDARDS_DEFAULTS.cableLoadingLimitPct),
    txLoadingLimitPct: num(s.txLoadingLimitPct, STANDARDS_DEFAULTS.txLoadingLimitPct),
    // O3.5: a transformer's heating doesn't depend on the direction of flow, so its limit can be
    // applied to reverse (export) flow too. Off unless set — absent means the historical
    // import-only rule, so every legacy result is unchanged.
    txLimitBothDirections: !!s.txLimitBothDirections,
    disconnectTimeS: Number(s.disconnectTimeS) === 0.4 ? 0.4 : 5
  };
}

/** The design's current limits in profile form (e.g. to save them under a new name). @param {Design} design @param {string} name @returns {StandardsProfile} */
export function profileFromDesign(design, name) {
  const s = standardsOf(design);
  return {
    id: 'user-' + name.trim().toLowerCase().replace(/[^a-z0-9]+/g, '-'), name: name.trim(),
    vnom: s.vnom, vdevPct: s.vdevPct, vufLimitPct: s.vufLimitPct, vufAsViolation: s.vufAsViolation,
    cableLoadingLimitPct: s.cableLoadingLimitPct, txLoadingLimitPct: s.txLoadingLimitPct, disconnectTimeS: s.disconnectTimeS
  };
}

/** Applies a profile; pure. @param {Design} design @param {StandardsProfile} p @returns {Design} */
export function applyStandardsProfile(design, p) {
  return {
    ...design,
    vnom: p.vnom, vdev: p.vdevPct,
    standards: {
      ...(design.standards || {}),
      profileName: p.name, vufLimitPct: p.vufLimitPct, vufAsViolation: p.vufAsViolation,
      cableLoadingLimitPct: p.cableLoadingLimitPct, txLoadingLimitPct: p.txLoadingLimitPct, disconnectTimeS: p.disconnectTimeS
    }
  };
}

/** True if the design's limits are exactly this profile's. @param {Design} design @param {StandardsProfile} p */
export function matchesProfile(design, p) {
  const s = standardsOf(design);
  return s.vnom === p.vnom && s.vdevPct === p.vdevPct && s.vufLimitPct === p.vufLimitPct && s.vufAsViolation === p.vufAsViolation
    && s.cableLoadingLimitPct === p.cableLoadingLimitPct && s.txLoadingLimitPct === p.txLoadingLimitPct && s.disconnectTimeS === p.disconnectTimeS;
}
