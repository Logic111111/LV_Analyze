// @ts-check
// Smart-meter (AMI) import (P6.3). Interval energy readings (meter_id, timestamp, kWh) are mapped
// to connections by their `meterId`. From them come suggestions the user can apply:
//   - a normalised 24 h curve per load type: the average demand in each clock hour over all days
//     and all of that type's meters, divided by its own maximum (the form the app's curves use),
//     optionally separately for weekdays and weekends;
//   - each customer's peak (largest interval demand);
//   - the group ADMD: the coincident peak of the group's summed demand ÷ the number of customers,
//     as kVA (÷ the design's power factor) — the quantity the ADMD stands for.
// Timestamps are read as local wall-clock times (no time-zone conversion), so "2026-03-01 19:30"
// is 19:30 on the day it says.
/** @import { Design } from './types.js' */

export const AMI_TYPES = /** @type {const} */ (['general', 'ev', 'shop', 'evcs']);
export const CURVE_KEY = { general: 'loadCurve', ev: 'evCurve', shop: 'shopCurve', evcs: 'evcsCurve' };

/** "YYYY-MM-DD[T ]HH:MM[:SS]" → parts, or null. @param {string} s */
export function parseWallClock(s) {
  const m = /^(\d{4})-(\d{2})-(\d{2})[T ](\d{1,2}):(\d{2})(?::(\d{2}))?/.exec(String(s).trim());
  if (!m) return null;
  const [y, mo, d, h, mi] = [m[1], m[2], m[3], m[4], m[5]].map(Number);
  if (mo < 1 || mo > 12 || d < 1 || d > 31 || h > 23 || mi > 59) return null;
  const weekday = new Date(Date.UTC(y, mo - 1, d)).getUTCDay(); // 0 = Sunday
  return { day: `${m[1]}-${m[2]}-${m[3]}`, hour: h, minute: mi, weekend: weekday === 0 || weekday === 6, key: `${m[1]}-${m[2]}-${m[3]} ${String(h).padStart(2, '0')}:${m[5]}` };
}

/**
 * CSV "meter_id, timestamp, kWh" (comma, semicolon or tab; a header line is skipped). Bad lines
 * are reported, not guessed. @param {string} text
 */
export function parseAmiCsv(text) {
  const readings = [], errors = [];
  String(text).split(/\r?\n/).forEach((line, i) => {
    const t = line.trim();
    if (!t) return;
    const c = t.split(/[,;\t]/).map(x => x.trim());
    const ts = c.length >= 3 ? parseWallClock(c[1]) : null;
    const kwh = Number(c[2]);
    if (!ts || !c[0] || !Number.isFinite(kwh)) {
      if (i === 0) return; // header
      errors.push(`Line ${i + 1}: "${t.slice(0, 60)}" — expected meter id, YYYY-MM-DD HH:MM, kWh`);
      return;
    }
    readings.push({ meterId: c[0], ...ts, kwh });
  });
  return { readings, errors };
}

/**
 * @param {Design} design
 * @param {{ meterId: string, day: string, hour: number, minute: number, weekend: boolean, key: string, kwh: number }[]} readings
 * @param {{ intervalMin?: number, split?: boolean }} [opts]
 */
export function amiAnalysis(design, readings, opts = {}) {
  const intervalMin = Math.max(1, Number(opts.intervalMin) || 30);
  const toKw = 60 / intervalMin; // interval kWh → average kW over the interval
  const byMeter = new Map();
  design.loads.forEach(l => { if (l.meterId) byMeter.set(String(l.meterId), l); });
  const meters = new Set(readings.map(r => r.meterId));
  const unmapped = [...meters].filter(m => !byMeter.has(m)).sort();
  const withoutData = design.loads.filter(l => l.meterId && !meters.has(String(l.meterId))).map(l => l.id);
  const mapped = readings.filter(r => byMeter.has(r.meterId));
  const days = new Set(mapped.map(r => r.day));

  // Per customer: peak interval demand.
  /** @type {Map<string, number>} */
  const peak = new Map();
  mapped.forEach(r => { const kw = r.kwh * toKw; if (!peak.has(r.meterId) || kw > /** @type {number} */ (peak.get(r.meterId))) peak.set(r.meterId, kw); });
  const perCustomer = [...peak.entries()].map(([meterId, peakKw]) => ({ meterId, loadId: byMeter.get(meterId).id, type: byMeter.get(meterId).type, peakKw })).sort((a, b) => a.loadId.localeCompare(b.loadId));

  // Per type (and day class): mean demand in each clock hour over meters and days, normalised.
  /** @type {[string, boolean | null][]} */
  const classes = opts.split ? [['weekday', false], ['weekend', true]] : [['all', null]];
  const curves = {};
  AMI_TYPES.forEach(type => {
    const rs = mapped.filter(r => byMeter.get(r.meterId).type === type);
    if (!rs.length) return;
    curves[type] = {};
    classes.forEach(([name, weekend]) => {
      const sum = Array(24).fill(0), n = Array(24).fill(0);
      rs.filter(r => weekend === null || r.weekend === weekend).forEach(r => { sum[r.hour] += r.kwh * toKw; n[r.hour]++; });
      const mean = sum.map((s, h) => (n[h] ? s / n[h] : null));
      const max = Math.max(...mean.filter(x => x !== null));
      curves[type][name] = mean.every(x => x === null) || !(max > 0) ? null
        : { curve: mean.map(x => (x === null ? null : Math.round(x / max * 1000) / 1000)), hoursMissing: mean.filter(x => x === null).length, meanKw: mean };
    });
  });

  // Group ADMD per type: coincident peak of the summed demand ÷ customers, as kVA.
  const admd = {};
  AMI_TYPES.forEach(type => {
    const ids = [...new Set(mapped.filter(r => byMeter.get(r.meterId).type === type).map(r => r.meterId))];
    if (!ids.length) return;
    const total = new Map();
    mapped.forEach(r => { if (byMeter.get(r.meterId).type === type) total.set(r.key, (total.get(r.key) || 0) + r.kwh * toKw); });
    let best = { kw: 0, at: null };
    total.forEach((kw, at) => { if (kw > best.kw) best = { kw, at }; });
    admd[type] = { customers: ids.length, coincidentPeakKw: best.kw, at: best.at, admdKw: best.kw / ids.length, admdKva: best.kw / ids.length / Number(design.pf) };
  });

  return { intervalMin, meters: meters.size, mappedMeters: new Set(mapped.map(r => r.meterId)).size, unmapped, withoutData, days: days.size, perCustomer, curves, admd };
}

/** The suggestions applied (only what the user ticked). @param {Design} design @param {any} analysis @param {{ curves?: Record<string, string>, admd?: boolean }} pick */
export function applyAmiSuggestions(design, analysis, pick) {
  const out = { ...design };
  Object.entries(pick.curves || {}).forEach(([type, cls]) => {
    const c = analysis.curves[type] && analysis.curves[type][cls];
    if (c && c.hoursMissing === 0) out[CURVE_KEY[type]] = c.curve.slice();
  });
  if (pick.admd && analysis.admd.general) out.admd = Math.round(analysis.admd.general.admdKva * 100) / 100;
  return out;
}
