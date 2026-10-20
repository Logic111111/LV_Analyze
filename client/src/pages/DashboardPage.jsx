import { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useDesign } from '../context/DesignContext.jsx';
import { api } from '../api.js';

// Fleet dashboard (P6.5): every design the user can open (own and shared with their
// organisations), from the summaries stored at each save — sortable, filterable, and a
// "worst first" view (most violations, then the furthest voltage from nominal).
const COLS = [
  ['name', 'Design', 'text'], ['status', 'Status', 'text'], ['owner', 'Owner / organisation', 'text'], ['updatedAt', 'Updated', 'date'],
  ['violations', 'Violations (24 h)', 'num'], ['worstV', 'Worst voltage', 'num'], ['txPeakPct', 'Transformer peak %', 'num'],
  ['lossKwhDay', 'Losses kWh/day', 'num'], ['hostingTotalKva', 'PV headroom kVA', 'num'], ['protection', 'Protection', 'text']
];
const valueOf = (d, key) => {
  const s = d.summary || {};
  switch (key) {
    case 'violations': return s.violations ? s.violations.total : null;
    case 'worstV': return s.worstDeviationPct ?? null; // sort by deviation from nominal
    case 'owner': return d.own ? 'me' : (d.ownerEmail || '');
    case 'updatedAt': return new Date(d.updatedAt).getTime();
    case 'name': case 'status': return d[key];
    default: return s[key] ?? null;
  }
};

export default function DashboardPage() {
  const { loadDesign } = useDesign();
  const navigate = useNavigate();
  const [rows, setRows] = useState(null);
  const [error, setError] = useState('');
  const [q, setQ] = useState('');
  const [status, setStatus] = useState('');
  const [sort, setSort] = useState({ key: 'worst', dir: 'desc' });

  useEffect(() => { api.listDesigns().then(r => setRows(r.designs)).catch(e => setError(e.message)); }, []);

  const shown = useMemo(() => {
    if (!rows) return [];
    const ql = q.trim().toLowerCase();
    let list = rows.filter(d => (!status || d.status === status) && (!ql || [d.name, d.ownerEmail, d.orgName].some(x => x && x.toLowerCase().includes(ql))));
    const nullLast = (a, b, cmp) => (a == null && b == null ? 0 : a == null ? 1 : b == null ? -1 : cmp);
    if (sort.key === 'worst') {
      list = [...list].sort((a, b) => nullLast(valueOf(a, 'violations'), valueOf(b, 'violations'), valueOf(b, 'violations') - valueOf(a, 'violations'))
        || nullLast(valueOf(a, 'worstV'), valueOf(b, 'worstV'), valueOf(b, 'worstV') - valueOf(a, 'worstV')));
    } else {
      const col = COLS.find(c => c[0] === sort.key);
      const sign = sort.dir === 'asc' ? 1 : -1;
      list = [...list].sort((a, b) => {
        const x = valueOf(a, sort.key), y = valueOf(b, sort.key);
        return nullLast(x, y, col[2] === 'text' ? String(x).localeCompare(String(y)) * sign : (x - y) * sign);
      });
    }
    return list;
  }, [rows, q, status, sort]);

  const toggle = (key) => setSort(s => (s.key === key ? { key, dir: s.dir === 'asc' ? 'desc' : 'asc' } : { key, dir: 'asc' }));
  async function open(id) { await loadDesign(id); navigate('/app/diagram'); }

  return (
    <div>
      <div className="card">
        <h2>Fleet dashboard</h2>
        <p className="hint">Every design you can open — yours and those shared with your organisations — from the summary stored when each was last saved (24 h at year 0, nominal load and solar). Designs saved before the dashboard existed show "—" until they are opened and saved again.</p>
        <div className="grid g3">
          <label className="field"><span>Search name, owner or organisation</span><input value={q} onChange={e => setQ(e.target.value)} /></label>
          <label className="field"><span>Status</span>
            <select value={status} onChange={e => setStatus(e.target.value)}>
              <option value="">Any</option><option value="draft">Draft</option><option value="submitted">Submitted</option><option value="approved">Approved</option><option value="rejected">Rejected</option>
            </select></label>
          <div className="field"><span>View</span>
            <label className="chk"><input type="checkbox" checked={sort.key === 'worst'} onChange={e => setSort(e.target.checked ? { key: 'worst', dir: 'desc' } : { key: 'updatedAt', dir: 'desc' })} /> Worst first</label></div>
        </div>
        {error && <p className="hint" role="alert" style={{ color: 'var(--bad)' }}>{error}</p>}
      </div>
      <div className="card" style={{ marginTop: 14 }}>
        {!rows ? <p className="hint">Loading…</p> : !rows.length ? <p className="hint">No saved designs yet.</p> : (
          <div className="tbl-wrap" style={{ maxHeight: 'none' }}><table>
            <thead><tr>
              {COLS.map(([key, label]) => (
                <th key={key} scope="col" aria-sort={sort.key === key ? (sort.dir === 'asc' ? 'ascending' : 'descending') : 'none'}>
                  <button className="sort" onClick={() => toggle(key)}>{label}{sort.key === key ? (sort.dir === 'asc' ? ' ▲' : ' ▼') : ''}</button>
                </th>
              ))}<th scope="col"></th>
            </tr></thead>
            <tbody>
              {shown.map(d => {
                const s = d.summary;
                return (
                  <tr key={d.id}>
                    <td>{d.name}</td>
                    <td><span className={'pill ' + (d.status === 'approved' ? 'ok' : d.status === 'rejected' ? 'bad' : d.status === 'submitted' ? 'warn' : '')}>{d.status}</span></td>
                    <td>{d.own ? 'me' : d.ownerEmail}{d.orgName ? ` · ${d.orgName}` : ''}</td>
                    <td>{new Date(d.updatedAt).toLocaleDateString()}</td>
                    <td>{s ? <span className={'pill ' + (s.violations.total ? 'bad' : 'ok')} title={`${s.violations.undervoltage} under, ${s.violations.overvoltage} over, ${s.violations.thermal} thermal, ${s.violations.transformer} transformer`}>{s.violations.total}</span> : '—'}</td>
                    <td>{s ? `${s.worstV} V (${s.worstAt})` : '—'}</td>
                    <td>{s ? s.txPeakPct : '—'}</td>
                    <td>{s ? s.lossKwhDay.toFixed(2) : '—'}</td>
                    <td>{s && s.hostingTotalKva != null ? s.hostingTotalKva : '—'}</td>
                    <td>{s ? s.protection : '—'}</td>
                    <td><button className="mini" onClick={() => open(d.id)}>Open</button></td>
                  </tr>
                );
              })}
            </tbody>
          </table></div>
        )}
      </div>
    </div>
  );
}
