import { describe, it, expect } from 'vitest';
import { designTables, toCsv, toGeoJson, toXlsx } from '../exports.js';
import { runSnapshot, runDailyScan, EARTH_RADIUS_M } from '../loadflow.js';
import { walkthroughIsland } from './fixtures/walkthroughIsland.js';

// P6.6 — exports.

describe('exports', () => {
  const d = walkthroughIsland();
  const snap = runSnapshot(d, { year: 0, hour: 20, solarMult: 0 });

  it('tables cover inputs and the computed results', () => {
    const t = designTables(d, { snapshot: snap, daily: runDailyScan(d, 0) });
    const names = t.map(x => x.name);
    ['Transformers', 'Poles', 'Loads', 'PV', 'BESS', 'Open points', 'Conductors', 'Settings', 'Snapshot y0 20h', 'Snapshot violations', '24 h scan', 'Fault levels', 'Protection'].forEach(n => expect(names).toContain(n));
    expect(t.find(x => x.name === 'Loads').rows).toHaveLength(d.loads.length);
    const sn = t.find(x => x.name === 'Snapshot y0 20h');
    const p3 = sn.rows.find(r => r[0] === 'P3');
    expect(p3[1]).toBeCloseTo(212.86, 2); // V A at P3, 20:00 (golden 212.9)
    expect(t.find(x => x.name === '24 h scan').rows).toHaveLength(24);
  });

  it('CSV quotes commas, quotes and newlines (RFC 4180)', () => {
    const csv = toCsv({ name: 'x', columns: ['a', 'b'], rows: [['1,2', 'say "hi"'], ['line\nbreak', null]] });
    expect(csv).toBe('a,b\r\n"1,2","say ""hi"""\r\n"line\nbreak",\r\n');
  });

  it('GeoJSON: placed poles and spans with results; unplaced items counted', () => {
    const k = 180 / (Math.PI * EARTH_RADIUS_M);
    const g = { ...d, transformers: d.transformers.map(t => ({ ...t, lat: 6.9, lng: 79.9 })), poles: d.poles.map(p => (p.id === 'P1' ? { ...p, lat: 6.9 + 40 * k, lng: 79.9 } : p)) };
    const gj = toGeoJson(g, snap);
    expect(gj.type).toBe('FeatureCollection');
    expect(gj.unplaced).toBe(2);
    const kinds = gj.features.map(f => f.properties.kind);
    expect(kinds).toEqual(['transformer', 'pole', 'span']);
    const pole = gj.features[1];
    expect(pole.geometry.coordinates).toEqual([79.9, 6.9 + 40 * k]); // [lon, lat]
    expect(pole.properties.vA).toBeCloseTo(snap.poleResults[0].volt.A, 2);
    expect(gj.features[2].geometry.type).toBe('LineString');
  });

  it('Excel: a workbook with one sheet per table, readable back', async () => {
    const tables = designTables(d, { snapshot: snap });
    const buf = await toXlsx(tables);
    const { default: ExcelJS } = await import('exceljs');
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.load(buf);
    expect(wb.worksheets.map(w => w.name)).toEqual(tables.map(t => t.name));
    const loads = wb.getWorksheet('Loads');
    expect(loads.getRow(1).getCell(1).value).toBe('Id');
    expect(loads.rowCount).toBe(d.loads.length + 1);
  });
});
