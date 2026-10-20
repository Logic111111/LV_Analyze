// Exports (P6.6): the design's inputs and results as tables — CSV for any one table, an Excel
// workbook (exceljs, MIT; loaded only when an export is asked for) with a sheet per table — and
// GeoJSON of the poles and spans with results, for GIS, when they have coordinates.
import { PHASES, faultLevels, protectionCheck, conductorParams, hasCoords, systemLossW } from './loadflow.js';

/** One table: { name, columns: string[], rows: any[][] }. */
const tbl = (name, columns, rows) => ({ name, columns, rows });
const r2 = (x, d = 2) => (Number.isFinite(x) ? Math.round(x * 10 ** d) / 10 ** d : x);

/**
 * Every input table, plus result tables for whatever has been computed.
 * @param {any} design
 * @param {{ snapshot?: any, daily?: any[], hosting?: any[], protection?: any }} [results]
 */
export function designTables(design, results = {}) {
  const t = [];
  t.push(tbl('Transformers', ['Id', 'Name', 'Rating kVA', 'Tap', 'HV V', 'X/R', 'Rg Ω', 'Latitude', 'Longitude'],
    design.transformers.map(x => [x.id, x.name, x.txRating, x.tap, x.hvActual, x.txXR, x.txGroundOhms, x.lat ?? '', x.lng ?? ''])));
  t.push(tbl('Poles', ['Id', 'Feeder', 'Parent', 'Span m', 'Conductor', 'Earthed', 'Rg Ω', 'Latitude', 'Longitude'],
    design.poles.map(p => [p.id, p.feeder, p.parent, p.spanM, p.cond, p.grounded ? 'yes' : 'no', p.grounded ? p.groundOhms : '', p.lat ?? '', p.lng ?? ''])));
  t.push(tbl('Loads', ['Id', 'Pole', 'Type', 'Phase', 'kVA (blank = ADMD)', 'Annual kWh', 'Meter id'],
    design.loads.map(l => [l.id, l.pole, l.type, l.phase, l.kva ?? '', l.annualKWh ?? '', l.meterId ?? ''])));
  t.push(tbl('PV', ['Id', 'Pole', 'Phase', 'kVA', 'Inverter mode'], design.pv.map(p => [p.id, p.pole, p.phase, p.kva, p.inverterMode || 'design default'])));
  t.push(tbl('BESS', ['Id', 'Pole', 'Phase', 'kVA', 'Mode', 'kWh'], design.bess.map(b => [b.id, b.pole, b.phase, b.kva, b.mode || 'schedule', b.kWh ?? ''])));
  t.push(tbl('Open points', ['Id', 'Pole A', 'Pole B', 'Length m', 'Conductor'], (design.openPoints || []).map(o => [o.id, o.poleA, o.poleB, o.spanM, o.cond])));
  t.push(tbl('Conductors', ['Code', 'R Ω/km', 'X Ω/km', 'Rn Ω/km', 'Xn Ω/km', 'Rating A', 'Cost LKR/m'],
    Object.keys(design.conductorLibrary || {}).map(code => { const c = design.conductorLibrary[code], p = conductorParams(design, code); return [code, r2(p.R, 4), r2(p.X, 4), r2(p.Rn, 4), r2(p.Xn, 4), p.I, c.costPerM ?? '']; })));
  t.push(tbl('Settings', ['Setting', 'Value'], [
    ['ADMD kVA', design.admd], ['Power factor', design.pf], ['Growth %/yr', design.growth], ['Nominal V', design.vnom], ['Deviation ±%', design.vdev],
    ['Max PV per connection kW', design.maxpv], ['Max BESS per connection kW', design.maxbess]
  ]));
  const s = results.snapshot;
  if (s) {
    t.push(tbl(`Snapshot y${s.year} ${String(s.hour).padStart(2, '0')}h`, ['Pole', ...PHASES.map(p => `V ${p}`), ...PHASES.map(p => `I ${p} A`), 'I N A', ...PHASES.map(p => `Loading ${p} %`), 'VUF %', 'Span flow kW', 'Span loss W'],
      s.poleResults.map(p => [p.id, ...PHASES.map(ph => r2(p.volt[ph])), ...PHASES.map(ph => r2(p.cur[ph])), r2(p.In), ...PHASES.map(ph => r2(p.condPct[ph], 1)), r2(p.vufPct), r2(p.flowKW), r2(s.lossByPole[p.id], 1)])));
    t.push(tbl('Snapshot violations', ['Where', 'Phase', 'Type', 'Value'], s.violations.map(v => [v.pole, v.phase, v.type, r2(v.value)])));
  }
  if (results.daily && results.daily.length) {
    t.push(tbl('24 h scan', ['Hour', 'Converged', 'Violations', 'Min V', 'Max V', 'Transformer %', 'Flow', 'Loss kW'],
      results.daily.map(r => {
        const vs = r.poleResults.flatMap(p => PHASES.map(ph => p.volt[ph]));
        return [r.hour, r.converged ? 'yes' : 'no', r.violations.length, r2(Math.min(...vs)), r2(Math.max(...vs)), r2(Math.max(...r.transformers.map(x => x.txPct)), 1), r.transformers.map(x => x.flowDirection).join('/'), r2(systemLossW(r).totalLossW / 1000, 3)];
      })));
  }
  if (results.hosting && results.hosting.length) {
    t.push(tbl('PV hosting (independent)', ['Pole', 'Phase', 'kVA', 'Limited by'], results.hosting.map(h => [h.pole, h.phase, h.kva, h.limit])));
  }
  const fl = faultLevels(design);
  t.push(tbl('Fault levels', ['Pole', 'Distance m', 'Ik3max kA', 'Ik1min kA'], fl.poles.map(f => [f.id, f.distanceM, r2(f.ik3MaxA / 1000, 3), r2(f.ik1MinA / 1000, 3)])));
  const prot = results.protection || (results.daily && results.daily.length ? protectionCheck(design, results.daily) : null);
  if (prot) t.push(tbl('Protection', ['Device', 'Fuse', 'Overall', 'Checks'], prot.devices.map(d => [d.label, d.fuseId || '—', d.overall, Object.entries(d.checks).map(([k, c]) => `${k}: ${c.status}`).join('; ')])));
  return t;
}

/** RFC 4180 CSV: fields with comma, quote or newline are quoted, quotes doubled. CRLF lines. */
export function toCsv(table) {
  const cell = (v) => { const s = v == null ? '' : String(v); return /[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s; };
  return [table.columns, ...table.rows].map(r => r.map(cell).join(',')).join('\r\n') + '\r\n';
}

/**
 * GeoJSON FeatureCollection (WGS 84 lon/lat): transformer and pole points with their results, and
 * span / open-point lines between placed ends. Items without coordinates are left out (and counted).
 * @param {any} design @param {any} [res] a snapshot of the design
 */
export function toGeoJson(design, res = null) {
  const at = new Map();
  [...design.transformers, ...design.poles].forEach(n => { if (hasCoords(n)) at.set(n.id, [Number(n.lng), Number(n.lat)]); });
  const pr = new Map((res ? res.poleResults : []).map(p => [p.id, p]));
  const tr = new Map((res ? res.transformers : []).map(t => [t.id, t]));
  const features = [];
  design.transformers.forEach(t => {
    if (!at.has(t.id)) return;
    const r = tr.get(t.id);
    features.push({ type: 'Feature', geometry: { type: 'Point', coordinates: at.get(t.id) }, properties: { kind: 'transformer', id: t.id, name: t.name, ratingKva: t.txRating, tap: t.tap, ...(r ? { loadingPct: r2(r.txPct, 1), flow: r.flowDirection } : {}) } });
  });
  design.poles.forEach(p => {
    if (!at.has(p.id)) return;
    const r = pr.get(p.id);
    const props = { kind: 'pole', id: p.id, feeder: p.feeder, earthed: !!p.grounded, connections: design.loads.filter(l => l.pole === p.id).length };
    if (r) PHASES.forEach(ph => { props[`v${ph}`] = r2(r.volt[ph]); });
    if (r) props.vufPct = r2(r.vufPct);
    if (r && res) props.voltageStatus = PHASES.some(ph => r.volt[ph] < res.vLimLow || r.volt[ph] > res.vLimHigh) ? 'violation' : 'ok';
    features.push({ type: 'Feature', geometry: { type: 'Point', coordinates: at.get(p.id) }, properties: props });
    if (at.has(p.parent)) {
      const sp = { kind: 'span', id: `${p.parent}-${p.id}`, from: p.parent, to: p.id, lengthM: p.spanM, conductor: p.cond };
      if (r) Object.assign(sp, { loadingPct: r2(Math.max(r.condPct.A, r.condPct.B, r.condPct.C), 1), flowKw: r2(r.flowKW), neutralA: r2(r.In) });
      features.push({ type: 'Feature', geometry: { type: 'LineString', coordinates: [at.get(p.parent), at.get(p.id)] }, properties: sp });
    }
  });
  (design.openPoints || []).forEach(o => {
    if (at.has(o.poleA) && at.has(o.poleB)) features.push({ type: 'Feature', geometry: { type: 'LineString', coordinates: [at.get(o.poleA), at.get(o.poleB)] }, properties: { kind: 'openPoint', id: o.id, lengthM: o.spanM, conductor: o.cond } });
  });
  const total = design.transformers.length + design.poles.length;
  return { type: 'FeatureCollection', name: design.name, features, unplaced: total - at.size };
}

/** Excel workbook (ArrayBuffer): one sheet per table, a bold header row, sensible widths. */
export async function toXlsx(tables, meta = {}) {
  const { default: ExcelJS } = await import('exceljs');
  const wb = new ExcelJS.Workbook();
  wb.creator = 'Feeder Island';
  wb.created = meta.created || new Date();
  const used = new Set();
  tables.forEach(t => {
    // Excel sheet names: ≤ 31 chars, no []:*?/\ and unique.
    let name = t.name.replace(/[[\]:*?/\\]/g, ' ').slice(0, 31) || 'Sheet';
    let k = 2;
    while (used.has(name.toLowerCase())) name = `${name.slice(0, 28)} ${k++}`;
    used.add(name.toLowerCase());
    const ws = wb.addWorksheet(name);
    ws.addRow(t.columns).font = { bold: true };
    t.rows.forEach(r => ws.addRow(r));
    ws.columns.forEach((col, i) => { col.width = Math.min(40, Math.max(8, ...[t.columns[i], ...t.rows.map(r => r[i])].map(v => String(v ?? '').length + 2))); });
    ws.views = [{ state: 'frozen', ySplit: 1 }];
  });
  return wb.xlsx.writeBuffer();
}
