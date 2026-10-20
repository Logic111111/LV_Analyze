import { useEffect, useRef } from 'react';
import { rect, polar } from '../lib/loadflow.js';

// "Explain this number" drawer (P5.6): renders a trace from engine/explain.js — each step's
// formula, the values substituted and the result — like the hand-calculation workbook. A modal
// dialog: focus moves to Close, Escape closes, focus returns to where it was.
function fmtValue(v, unit) {
  if (v == null) return '—';
  if (typeof v === 'object') return <>{polar(v)} {unit}<div className="hint" style={{ margin: 0 }}>{rect(v)} {unit}</div></>;
  return `${Math.abs(v) >= 1000 ? v.toFixed(1) : v.toFixed(3)} ${unit}`;
}

export default function ExplainDrawer({ trace, onClose }) {
  const closeRef = useRef(null);
  const back = useRef(null);
  // Kept in a ref so a parent's inline onClose doesn't re-run the focus effect on every render.
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;
  useEffect(() => {
    if (!trace) return undefined;
    back.current = document.activeElement;
    closeRef.current?.focus();
    const onKey = (e) => { if (e.key === 'Escape') onCloseRef.current(); };
    window.addEventListener('keydown', onKey);
    return () => { window.removeEventListener('keydown', onKey); back.current?.focus?.(); };
  }, [trace]);
  if (!trace) return null;
  const hasInPhase = trace.steps.some(s => s.inPhaseV != null);
  const isHosting = trace.kind === 'hosting';
  return (
    <div className="explain-backdrop" onClick={onClose}>
      <div className="explain-drawer" role="dialog" aria-modal="true" aria-labelledby="explain-title" onClick={e => e.stopPropagation()}>
        <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8, alignItems: 'center' }}>
          <h2 id="explain-title" style={{ margin: 0 }}>{trace.title}</h2>
          <button ref={closeRef} type="button" className="mini" onClick={onClose}>Close</button>
        </div>
        <div className="tbl-wrap" style={{ marginTop: 10, maxHeight: 'none' }}><table>
          <thead><tr><th scope="col">Step</th>{!isHosting && <th scope="col">Formula</th>}<th scope="col">{isHosting ? 'Size' : 'Substituted'}</th><th scope="col">{isHosting ? 'Outcome' : 'Value'}</th>{hasInPhase && <th scope="col">In-phase part (V)</th>}</tr></thead>
          <tbody>
            {trace.steps.map((s, i) => (
              <tr key={i}>
                <td style={{ whiteSpace: 'normal', minWidth: 120 }}>{s.label}</td>
                {!isHosting && <td style={{ whiteSpace: 'normal', minWidth: 160 }}>{s.formula}</td>}
                <td style={{ whiteSpace: 'normal', minWidth: 140 }}>{s.substituted}</td>
                <td style={{ whiteSpace: 'nowrap' }}>{isHosting ? s.unit : fmtValue(s.value, s.unit)}</td>
                {hasInPhase && <td>{s.inPhaseV == null ? '' : s.inPhaseV.toFixed(3)}</td>}
              </tr>
            ))}
          </tbody>
        </table></div>
        <p style={{ fontSize: 14, margin: '10px 0 4px' }}><b>{trace.result.label}</b> → <b>{trace.result.value.toFixed(trace.result.unit === 'A' ? 1 : 3)} {trace.result.unit}</b></p>
        {trace.check && <p className="hint" style={{ margin: 0 }}>{trace.check.label}: {trace.check.value.toFixed(3)} {trace.check.unit}</p>}
        {trace.notes.length > 0 && <ul style={{ fontSize: 12, paddingLeft: 18, marginBottom: 0 }}>{trace.notes.map((n, i) => <li key={i}>{n}</li>)}</ul>}
      </div>
    </div>
  );
}
