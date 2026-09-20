import { useState } from 'react';
import { useDesign } from '../context/DesignContext.jsx';
import { api } from '../api.js';

export default function InsightsPage() {
  const { design, lastResults, lastHosting } = useDesign();
  const [text, setText] = useState('No insights generated yet — run a report, then click "Get AI insights".');
  const [busy, setBusy] = useState(false);

  async function getInsights() {
    if (!lastResults) { setText('Run a report on the "Run & Reports" tab first, so there is data to analyse.'); return; }
    setBusy(true); setText('');
    const res = lastResults;
    const summary = {
      transformers: res.transformers.map(t => ({
        id: t.id, name: t.name, rating: design.transformers.find(dt => dt.id === t.id)?.txRating,
        loadingPct: t.txPct.toFixed(1), flowDirection: t.flowDirection, netRealPowerKW: t.netKW.toFixed(1),
        lvBusVoltageV: { A: t.busVoltPct.A.toFixed(1), B: t.busVoltPct.B.toFixed(1), C: t.busVoltPct.C.toFixed(1) },
        lossesKW: { copper: (t.txLossW / 1000).toFixed(3), noLoad: (t.txNoLoadW / 1000).toFixed(3) }
      })),
      lineLossesKW: (res.totalLossW / 1000).toFixed(2),
      year: res.year, hour: res.hour,
      voltageBandV: [res.vLimLow.toFixed(1), res.vLimHigh.toFixed(1)],
      violations: res.violations.map(v => ({ pole: v.pole, phase: v.phase, type: v.type, value: Number(v.value.toFixed(1)) })),
      poleVoltages: res.poleResults.map(p => ({ pole: p.id, A: p.volt.A.toFixed(1), B: p.volt.B.toFixed(1), C: p.volt.C.toFixed(1) })),
      hostingCapacityTop: (lastHosting || []).slice(0, 5)
    };
    try {
      const d = await api.aiInsights(summary);
      setText(d.text || 'No response received.');
    } catch (e) {
      setText('AI request failed: ' + e.message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="card">
      <h2>AI engineering insights</h2>
      <p className="hint">Sends the latest computed report (voltages, currents, losses, transformer loading, hosting-capacity ranking) to Claude via this app's server and asks for practical mitigation measures. Run a report first.</p>
      <button className="primary" onClick={getInsights} disabled={busy}>Get AI insights</button>
      {busy && <span className="loading" style={{ marginLeft: 12 }}><span className="spinner"></span> thinking…</span>}
      <div className="note" style={{ marginTop: 16, whiteSpace: 'pre-wrap' }}>{text}</div>
    </div>
  );
}
