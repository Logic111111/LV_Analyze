// @ts-check
// Geography for the map editor (P5.7). Coordinates are optional (lat/lng in decimal degrees on
// transformers and poles) and never change a result: span lengths stay the entered `spanM`. The
// map only *suggests* a measured length, applied when the user accepts it.
//
// Distance is the haversine great-circle distance on a sphere of radius 6 371 008.8 m (the IUGG
// mean Earth radius). Over LV span lengths (tens of metres) its error against the ellipsoid is
// well under a centimetre per 100 m, far below survey accuracy.
/** @import { Design } from './types.js' */

export const EARTH_RADIUS_M = 6371008.8;

/** @param {number} lat1 @param {number} lng1 @param {number} lat2 @param {number} lng2 @returns {number} metres */
export function haversineM(lat1, lng1, lat2, lng2) {
  const r = Math.PI / 180;
  const dLat = (lat2 - lat1) * r, dLng = (lng2 - lng1) * r;
  const a = Math.sin(dLat / 2) ** 2 + Math.cos(lat1 * r) * Math.cos(lat2 * r) * Math.sin(dLng / 2) ** 2;
  return 2 * EARTH_RADIUS_M * Math.asin(Math.min(1, Math.sqrt(a)));
}

/** @param {any} x */
export const hasCoords = (x) => !!x && Number.isFinite(Number(x.lat)) && Number.isFinite(Number(x.lng)) && x.lat !== null && x.lng !== null && x.lat !== '' && x.lng !== '';

/**
 * Measured vs entered length for every span whose two ends both have coordinates.
 * @param {Design} design
 * @returns {{ pole: string, parent: string, enteredM: number, measuredM: number, diffM: number, diffPct: number | null }[]}
 */
export function measuredSpans(design) {
  /** @type {Map<string, any>} */
  const nodes = new Map();
  design.transformers.forEach(t => nodes.set(t.id, t));
  design.poles.forEach(p => nodes.set(p.id, p));
  const out = [];
  design.poles.forEach(p => {
    const parent = nodes.get(p.parent);
    if (!hasCoords(p) || !hasCoords(parent)) return;
    const measuredM = haversineM(Number(parent.lat), Number(parent.lng), Number(p.lat), Number(p.lng));
    const enteredM = Number(p.spanM) || 0;
    out.push({ pole: p.id, parent: p.parent, enteredM, measuredM, diffM: measuredM - enteredM, diffPct: enteredM > 0 ? (measuredM - enteredM) / enteredM * 100 : null });
  });
  return out;
}

/** Sets spanM to the measured length (rounded to 0.1 m) for the given poles; pure. @param {Design} design @param {string[]} poleIds */
export function acceptMeasuredSpans(design, poleIds) {
  const m = new Map(measuredSpans(design).map(s => [s.pole, s.measuredM]));
  const ids = new Set(poleIds);
  return { ...design, poles: design.poles.map(p => (ids.has(p.id) && m.has(p.id) ? { ...p, spanM: Math.round(/** @type {number} */ (m.get(p.id)) * 10) / 10 } : p)) };
}
