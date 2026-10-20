import { useState } from 'react';
import { useDesign } from '../context/DesignContext.jsx';
import { useEngineTask } from '../hooks/useEngineTask.js';
import TaskProgress from './TaskProgress.jsx';
import CsvButton from './CsvButton.jsx';
import { designTables, toXlsx, toGeoJson } from '../lib/exports.js';
import { downloadBlob, downloadText, safeName } from '../lib/sld/export.js';
import { runSnapshotAt } from '../lib/loadflow.js';

// Exports (P6.6): the whole design — inputs and results — as an Excel workbook, any one table as
// CSV, and the network as GeoJSON for GIS (poles and spans with coordinates, with results).
export default function ExportsCard() {
  const { design, lastResults, lastHosting } = useDesign();
  const task = useEngineTask();
  const [tables, setTables] = useState(null);
  const [msg, setMsg] = useState('');

  async function prepare() {
    const r = await task.run('dailyScan', { design, year: 0, loadMult: 1, solarMult: 1 }, 'Scanning 24 h for the export');
    if (!r.ok) return null;
    const t = designTables(design, { snapshot: lastResults, daily: r.result, hosting: lastHosting });
    setTables(t);
    return t;
  }
  async function xlsx() {
    const t = tables || await prepare();
    if (!t) return;
    const buf = await toXlsx(t);
    downloadBlob(new Blob([buf], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' }), safeName(design.name) + '.xlsx');
    setMsg(`Workbook with ${t.length} sheets downloaded.`);
  }
  function geojson() {
    const res = lastResults || runSnapshotAt(design, { year: 0, hour: 20, loadMult: 1, solarMult: 0 });
    const gj = toGeoJson(design, res);
    if (!gj.features.length) { setMsg('Nothing has coordinates yet — place the transformer and poles on the Map page first.'); return; }
    const { unplaced, ...out } = gj;
    downloadText(JSON.stringify(out, null, 1), safeName(design.name) + '.geojson', 'application/geo+json');
    setMsg(`GeoJSON with ${gj.features.length} features downloaded${unplaced ? ` (${unplaced} items without coordinates left out)` : ''}, results at ${lastResults ? `the latest snapshot (${String(res.hour).padStart(2, '0')}:00)` : 'night peak (20:00)'}.`);
  }
  return (
    <div className="card" style={{ marginTop: 14 }}>
      <h2>Export data</h2>
      <p className="hint">Excel: a sheet per table — every input (transformers, poles, loads, PV, BESS, open points, conductors, settings) and the results (latest snapshot, a fresh 24 h scan, fault levels, protection, and hosting if run). GeoJSON (WGS 84) for GIS: placed poles and spans with voltages and loading.</p>
      <button className="ghost" onClick={xlsx} disabled={task.running}>Excel workbook (.xlsx)</button>{' '}
      <button className="ghost" onClick={geojson}>GeoJSON</button>{' '}
      <button className="mini" onClick={prepare} disabled={task.running}>List tables for CSV…</button>
      <TaskProgress task={task} />
      {msg && <p className="hint" role="status">{msg}</p>}
      {tables && (
        <ul style={{ listStyle: 'none', padding: 0, margin: '10px 0 0', display: 'flex', flexWrap: 'wrap', gap: 8 }}>
          {tables.map(t => <li key={t.name}><CsvButton name={t.name} columns={t.columns} rows={t.rows} label={`${t.name} (${t.rows.length})`} /></li>)}
        </ul>
      )}
    </div>
  );
}
