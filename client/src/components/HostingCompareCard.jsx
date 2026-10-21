import { useState } from 'react';
import TaskProgress from './TaskProgress.jsx';
import CsvButton from './CsvButton.jsx';
import OptimiserCertificate, { CertificateBadge } from './OptimiserCertificate.jsx';
import { useEngineTask } from '../hooks/useEngineTask.js';
import { standardsOf } from '../lib/loadflow.js';
import { optSummary } from '../lib/optSummary.js';
import { useDesign } from '../context/DesignContext.jsx';

// "How much more PV?" has three honest answers (O3.4), shown side by side: the first-come queue
// (legacy), the maximum total (SLP, O3.2) and the fair share (O3.3). Each answers a different
// question; the explanation shows — live, from this design — why capacities at different
// locations interact.
const ANSWERS = [
  { key: 'queue', title: 'First-come queue (legacy)', what: 'What approving applications one at a time, largest first, would add — each approval locked in before the next is tested. The total depends on the order.' },
  { key: 'slp', title: 'Maximum total (optimised)', what: 'The most PV the network can take at once, wherever it goes — found by successive linear programming, every step verified by full load flows.' },
  { key: 'fair', title: 'Fair share', what: 'The largest size every location could add at the same time — the same for every customer.' }
];
const loc = (a) => `${a.pole}-${a.phase}`;

export default function HostingCompareCard({ design }) {
  const [both, setBoth] = useState(() => standardsOf(design).txLimitBothDirections);
  const [cap, setCap] = useState('');
  const [res, setRes] = useState(null);
  const task = useEngineTask();
  const { recordOptimisation } = useDesign();

  async function run() {
    const capKva = cap === '' ? null : Math.max(0, Number(cap));
    const r = await task.run('hostingCompare', { design, txLimitBothDirections: both, capKva }, 'Comparing the three hosting answers');
    if (!r.ok) return;
    setRes({ ...r.result, capKva });
    const x = r.result;
    recordOptimisation('hosting', optSummary('PV hosting: queue, maximum total, fair share', `Queue ${x.queue.totalKva.toFixed(2)} kVA; maximum total ${x.slp.totalKva.toFixed(2)} kVA (LP estimate ${x.slp.bound != null ? x.slp.bound.toFixed(2) : '—'}); fair share ${x.fair.sizeKva.toFixed(3)} kVA × ${x.fair.locations.length} = ${x.fair.totalKva.toFixed(2)} kVA${x.txLimitBothDirections ? ' (transformer limit both ways)' : ''}`, x.slp));
  }
  const totals = res ? { queue: res.queue.totalKva, slp: res.slp.totalKva, fair: res.fair.totalKva } : null;
  const rows = res ? [...new Set([...res.queue.allocation, ...res.slp.allocation, ...res.fair.allocation].map(loc))].sort().map(k => ({
    key: k,
    queue: (res.queue.allocation.find(a => loc(a) === k) || {}).kva || 0,
    slp: (res.slp.allocation.find(a => loc(a) === k) || {}).kva || 0,
    fair: res.fair.allocation.length ? res.fair.sizeKva : 0
  })) : [];

  return (
    <div className="card" style={{ marginTop: 14 }}>
      <h2>Three answers to "how much more PV?"</h2>
      <p className="hint">The first-come queue, the maximum total and the fair share answer different questions. All three are verified with full load flows at 09:00–15:00 and judged like the searches above (no new or worsened violation).</p>
      <div className="grid g3" style={{ alignItems: 'end' }}>
        <label className="field"><span>Per-location cap, kVA (blank = the network's physical limit)</span>
          <input type="number" min="0" step="0.5" value={cap} onChange={e => setCap(e.target.value)} placeholder="no cap" /></label>
        <label className="chk"><input type="checkbox" checked={both} onChange={e => setBoth(e.target.checked)} /> Transformer limit applies to reverse flow too</label>
      </div>
      <button className="primary" onClick={run} disabled={task.running}>Compare</button>
      <TaskProgress task={task} />
      {res && (
        <div style={{ marginTop: 12 }}>
          <div className="grid g3" style={{ alignItems: 'stretch' }}>
            {ANSWERS.map(a => (
              <div key={a.key} className="note" style={{ minWidth: 0 }}>
                <div className="section-title" style={{ marginTop: 0 }}>{a.title}</div>
                <p style={{ fontSize: 22, margin: '4px 0' }}><b>{totals[a.key].toFixed(2)} kVA</b></p>
                {a.key === 'fair' && <p style={{ margin: 0 }}>{res.fair.sizeKva.toFixed(3)} kVA at each of {res.fair.locations.length} locations</p>}
                {a.key !== 'queue' ? <CertificateBadge result={res[a.key]} /> : <span className="pill">order-dependent</span>}
                <p className="hint" style={{ marginBottom: 0 }}>{a.what}</p>
                {res.reverse[a.key] && res.reverse[a.key].pct > 100 && !res.txLimitBothDirections && (
                  <p className="hint" role="alert" style={{ color: 'var(--warn)', marginBottom: 0 }}>⚠ Reverse flow reaches {res.reverse[a.key].pct.toFixed(1)} % of the transformer rating at {String(res.reverse[a.key].hour).padStart(2, '0')}:00 — not counted under the import-only rule; consider applying the limit both ways.</p>
                )}
              </div>
            ))}
          </div>
          {res.example && (
            <div className="note" style={{ marginTop: 12 }}>
              <b>Why capacities interact.</b> {res.example.pole} phase {res.example.phase} can take {res.example.aloneKva.toFixed(2)} kVA on its own, but {res.example.kva.toFixed(2)} kVA in the maximum-total allocation, where {res.example.neighbours.map(nb => `${nb.phase} hosts ${nb.kva.toFixed(2)}`).join(' and ')} kVA at the same pole. PV on one phase raises that phase but, through the shared neutral, lowers the other two; generation on all three phases at a pole largely cancels the neutral's voltage rise, so the pole hosts far more in total. A queue that locks in one phase first can't see this.
              {' '}The maximum total tends to concentrate PV near the transformer, which may not be realistic for individual customers — set a per-location cap to see the maximum under a per-customer limit.
            </div>
          )}
          <div className="tbl-wrap" style={{ marginTop: 10 }}><table>
            <thead><tr><th scope="col">Location</th><th scope="col">Queue (kVA)</th><th scope="col">Maximum total (kVA)</th><th scope="col">Fair share (kVA)</th></tr></thead>
            <tbody>{rows.map(r => <tr key={r.key}><td>{r.key}</td><td>{r.queue.toFixed(2)}</td><td>{r.slp.toFixed(2)}</td><td>{r.fair.toFixed(3)}</td></tr>)}</tbody>
            <tfoot><tr><td><b>Total</b></td><td><b>{totals.queue.toFixed(2)}</b></td><td><b>{totals.slp.toFixed(2)}</b></td><td><b>{totals.fair.toFixed(2)}</b></td></tr></tfoot>
          </table></div>
          <CsvButton name="PV hosting, three answers" columns={['Location', 'Queue kVA', 'Maximum total kVA', 'Fair share kVA']} rows={rows.map(r => [r.key, r.queue, r.slp, r.fair])} />
          {res.capKva != null && <p className="hint">The cap applies to the maximum total and the fair share; the queue shows the network's physical limits, as in the legacy method.</p>}
          <OptimiserCertificate result={res.slp} space={`${res.slp.locations.length} locations × ${res.slp.hours.length} test hours; ${res.slp.trace.length} linear programmes`}
            why={`the queue fixes each location in turn and assumes headroom is only used up; the optimiser moves every location together, so it can use the phase cancellation at a pole (here ${(res.slp.totalKva - res.queue.totalKva).toFixed(2)} kVA more).`} />
          <details style={{ marginTop: 6 }}>
            <summary style={{ cursor: 'pointer' }}>Optimiser steps</summary>
            <div className="tbl-wrap"><table>
              <thead><tr><th scope="col">Step</th><th scope="col">Trust region (kVA)</th><th scope="col">Margin (V)</th><th scope="col">Total after (kVA)</th><th scope="col">Outcome</th></tr></thead>
              <tbody>{res.slp.trace.map(t => <tr key={t.it}><td>{t.it + 1}</td><td>{t.delta.toFixed(2)}</td><td>{t.margin.toFixed(3)}</td><td>{t.total != null ? t.total.toFixed(2) : '—'}</td><td>{t.accepted ? 'verified, accepted' : t.why || t.status}</td></tr>)}</tbody>
            </table></div>
          </details>
        </div>
      )}
    </div>
  );
}
