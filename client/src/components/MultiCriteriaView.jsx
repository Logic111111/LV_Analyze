import { useMemo, useState } from 'react';
import { useTheme } from '../context/ThemeContext.jsx';
import ChartCanvas from './ChartCanvas.jsx';
import { CHART_PALETTES, themedScales } from '../lib/chartTheme.js';
import { nonDominatedIndices, sortRows } from '../lib/pareto.js';

// Multi-criteria view (P4.5) beside an advisor's own ranking, which it never changes: a table
// sortable by any criterion, with the Pareto (non-dominated) options marked, and a scatter of any
// two criteria. Non-dominated points are drawn as triangles and the rest as circles, so the
// distinction never relies on colour alone.
//   items:    [{ id, label, values: { [criterion]: number | null } }], in the advisor's ranking order
//   criteria: [{ key, label, digits, missing? }] — all "lower is better"; `missing` explains a
//             criterion with no data yet (e.g. capex before costs are entered)
export default function MultiCriteriaView({ items, criteria, title = 'Compare by criteria', onPreview }) {
  const { theme } = useTheme();
  const palette = CHART_PALETTES[theme] || CHART_PALETTES.light;
  const [sort, setSort] = useState(null); // { key, dir } — null = the advisor's own ranking
  const withData = criteria.filter(c => items.some(it => Number.isFinite(it.values[c.key])));
  const dataKeys = withData.map(c => c.key).join(',');
  const [xKey, setXKey] = useState(withData[1]?.key || withData[0]?.key);
  const [yKey, setYKey] = useState(withData[0]?.key);

  const front = useMemo(() => new Set(nonDominatedIndices(items.map(it => it.values), dataKeys.split(',').filter(Boolean)).map(i => items[i].id)), [items, dataKeys]);
  const rows = sort ? sortRows(items, sort.key, sort.dir) : items;
  const rankOf = new Map(items.map((it, i) => [it.id, i + 1]));
  const fmt = (v, c) => (Number.isFinite(v) ? v.toFixed(c.digits) : '—');

  function toggle(key) {
    setSort(s => (!s || s.key !== key ? { key, dir: 'asc' } : s.dir === 'asc' ? { key, dir: 'desc' } : null));
  }

  const xC = criteria.find(c => c.key === xKey), yC = criteria.find(c => c.key === yKey);
  const chart = useMemo(() => {
    const pts = (onFront) => items.filter(it => front.has(it.id) === onFront && Number.isFinite(it.values[xKey]) && Number.isFinite(it.values[yKey]))
      .map(it => ({ x: it.values[xKey], y: it.values[yKey], label: it.label }));
    return {
      data: {
        datasets: [
          { label: 'Non-dominated (▲)', data: pts(true), pointStyle: 'triangle', pointRadius: 7, backgroundColor: palette.seriesColors[0] },
          { label: 'Dominated (●)', data: pts(false), pointStyle: 'circle', pointRadius: 4, backgroundColor: palette.axisColor }
        ]
      },
      options: {
        animation: false,
        plugins: {
          legend: { labels: { color: palette.legendColor, usePointStyle: true } },
          tooltip: { callbacks: { label: (ctx) => `${ctx.raw.label}: ${xC?.label} ${ctx.raw.x}, ${yC?.label} ${ctx.raw.y}` } }
        },
        scales: themedScales(palette, { xTitle: xC?.label, yTitle: yC?.label })
      }
    };
  }, [items, front, xKey, yKey, palette, xC, yC]);

  if (!items.length) return null;
  return (
    <div className="card" style={{ marginTop: 14 }}>
      <h2>{title}</h2>
      <p className="hint">The ranking above is unchanged. Here you can sort by any criterion (click a column heading; a third click returns to the advisor's ranking) and see which options are <b>non-dominated</b> — no other option is at least as good on every criterion and better on one. Lower is better for every criterion.</p>
      {criteria.filter(c => c.missing).map(c => <p key={c.key} className="hint" style={{ marginTop: 0 }}>{c.label}: {c.missing}</p>)}
      <div className="tbl-wrap"><table>
        <thead><tr>
          <th scope="col">Rank</th><th scope="col">Option</th>
          {criteria.map(c => (
            <th key={c.key} scope="col" aria-sort={sort?.key === c.key ? (sort.dir === 'asc' ? 'ascending' : 'descending') : 'none'}>
              <button className="sort" onClick={() => toggle(c.key)}>{c.label}{sort?.key === c.key ? (sort.dir === 'asc' ? ' ▲' : ' ▼') : ''}</button>
            </th>
          ))}
          <th scope="col">Non-dominated</th>{onPreview && <th></th>}
        </tr></thead>
        <tbody>
          {rows.map(it => (
            <tr key={it.id}>
              <td>{rankOf.get(it.id)}</td><td>{it.label}</td>
              {criteria.map(c => <td key={c.key}>{fmt(it.values[c.key], c)}</td>)}
              <td>{front.has(it.id) ? '▲ yes' : '—'}</td>
              {onPreview && <td><button className="mini" onClick={() => onPreview(it.id)}>Preview</button></td>}
            </tr>
          ))}
        </tbody>
      </table></div>
      {sort && <button className="mini" style={{ marginTop: 8 }} onClick={() => setSort(null)}>Back to the advisor's ranking</button>}
      {withData.length >= 2 && (
        <div style={{ marginTop: 12, minWidth: 0, position: 'relative' }}>
          <div className="grid g3">
            <label className="field"><span>Horizontal axis</span>
              <select value={xKey} onChange={e => setXKey(e.target.value)}>{withData.map(c => <option key={c.key} value={c.key}>{c.label}</option>)}</select></label>
            <label className="field"><span>Vertical axis</span>
              <select value={yKey} onChange={e => setYKey(e.target.value)}>{withData.map(c => <option key={c.key} value={c.key}>{c.label}</option>)}</select></label>
          </div>
          <ChartCanvas type="scatter" data={chart.data} options={chart.options} height={120} label={`Scatter of ${yC?.label} against ${xC?.label}; non-dominated options as triangles`} />
        </div>
      )}
    </div>
  );
}
