import { poleById, conductorParams, getTransformerType, faultSettings } from '../lib/loadflow.js';

// Side panel for the single-line diagram (P5.1): full details of the selected element. For a
// single-phase connection it also offers "Move to phase …" buttons, the keyboard equivalent of
// dragging the drop (P5.2). `onExplain(kind, id)` opens the "Explain this number" drawer (P5.6).
const v1 = (x) => (Number.isFinite(x) ? x.toFixed(1) : '—');
const v2 = (x) => (Number.isFinite(x) ? x.toFixed(2) : '—');

function Row({ k, v }) { return <><dt>{k}</dt><dd>{v}</dd></>; }

function connsAt(design, poleId) {
  return [
    ...design.loads.filter(c => c.pole === poleId).map(c => ({ kind: 'load', c })),
    ...design.pv.filter(c => c.pole === poleId).map(c => ({ kind: 'pv', c })),
    ...design.bess.filter(c => c.pole === poleId).map(c => ({ kind: 'bess', c }))
  ];
}
const connLabel = (design, kind, c) => `${kind === 'load' ? (c.type === 'ev' ? 'EV' : c.type) : kind.toUpperCase()} ${c.id} — ${kind === 'load' && (c.kva == null || c.kva === '') ? `ADMD ${design.admd} kVA` : `${c.kva} kVA`}`;

function MoveButtons({ kind, c, onMove, preview }) {
  if (!onMove || c.phase === 'ABC') return null;
  return (
    <span style={{ display: 'inline-flex', gap: 4, marginLeft: 6 }}>
      {['A', 'B', 'C'].filter(ph => ph !== c.phase).map(ph => (
        <button key={ph} type="button" className="mini" onClick={() => onMove({ kind, id: c.id, pole: c.pole, phase: c.phase }, ph)}
          onMouseEnter={() => preview && preview({ kind, id: c.id, pole: c.pole, phase: c.phase }, ph)}
          onMouseLeave={() => preview && preview(null, null)}
          onFocus={() => preview && preview({ kind, id: c.id, pole: c.pole, phase: c.phase }, ph)}
          onBlur={() => preview && preview(null, null)}
          aria-label={`Move ${c.id} from phase ${c.phase} to phase ${ph}`}>→ {ph}</button>
      ))}
    </span>
  );
}

export default function SldDetails({ design, res, faults, protection, element, onMove, onPreviewMove, onExplain }) {
  if (!element) return <p className="hint" style={{ margin: 0 }}>Select an element in the diagram (click it, or Tab to it and press Enter) to see its details here.</p>;
  const ref = element.ref;
  const prOf = (id) => res && res.poleResults.find(p => p.id === id);
  const faultOf = (id) => faults && faults.poles.find(f => f.id === id);
  const explain = (kind, id, label) => onExplain && <button type="button" className="mini" onClick={() => onExplain(kind, id)} style={{ marginLeft: 6 }} aria-label={`Explain ${label}`}>Explain</button>;

  if (ref.kind === 'pole' || ref.kind === 'span' || ref.kind === 'zone') {
    const id = ref.kind === 'zone' ? ref.pole : ref.id;
    const p = poleById(design, id);
    if (!p) return null;
    const pr = prOf(id);
    const cp = conductorParams(design, p.cond);
    const f = faultOf(id);
    return (
      <div>
        <h3>{ref.kind === 'span' ? `Span into ${id}` : `Pole ${id}`}</h3>
        <dl>
          <Row k="Feeder / parent" v={`${p.feeder} / ${p.parent}`} />
          <Row k="Span" v={`${p.spanM} m, ${p.cond} (R ${v2(cp.R)}, X ${v2(cp.X)}, Rn ${v2(cp.Rn)} Ω/km, ${cp.I} A)`} />
          {pr && ['A', 'B', 'C'].map(ph => (
            <Row key={ph} k={`Phase ${ph}`} v={<>{v1(pr.volt[ph])} V{pr.volt[ph] < res.vLimLow || pr.volt[ph] > res.vLimHigh ? ' ⚠ outside band' : ''} · {v1(pr.cur[ph])} A ({v1(pr.condPct[ph])} %){explain('poleVoltage', `${id}|${ph}`, `the phase ${ph} voltage at ${id}`)}</>} />
          ))}
          {pr && <Row k="Neutral current" v={`${v1(pr.In)} A`} />}
          {pr && <Row k="VUF" v={<>{v2(pr.vufPct)} % (limit {res.vufLimitPct} %){explain('vuf', id, `the VUF at ${id}`)}</>} />}
          {pr && <Row k="Span flow" v={`${v2(pr.flowKW)} kW, ${v2(pr.flowKVAR)} kvar ${pr.flowKW < 0 ? '(towards the transformer)' : ''}`} />}
          {res && res.lossByPole && <Row k="Span loss" v={<>{v1(res.lossByPole[id])} W{explain('spanLoss', id, `the loss in the span into ${id}`)}</>} />}
          {pr && <Row k="Span loading" v={<>{v1(Math.max(pr.condPct.A, pr.condPct.B, pr.condPct.C))} %{explain('spanLoading', id, `the loading of the span into ${id}`)}</>} />}
          {f && <Row k="Fault level" v={<>Ik3max {(f.ik3MaxA / 1000).toFixed(2)} kA · Ik1min {(f.ik1MinA / 1000).toFixed(2)} kA{explain('fault', id, `the fault current at ${id}`)}</>} />}
          {p.grounded && <Row k="Earth electrode" v={`Rg ${p.groundOhms} Ω`} />}
        </dl>
        <div className="section-title" style={{ marginTop: 10 }}>Connections</div>
        <ul style={{ margin: 0, paddingLeft: 18, fontSize: 12 }}>
          {connsAt(design, id).map(({ kind, c }) => (
            <li key={kind + c.id} style={{ marginBottom: 3 }}>
              <span className={'phase' + (c.phase === 'ABC' ? '' : c.phase)} style={{ fontWeight: 700 }}>{c.phase}</span> {connLabel(design, kind, c)}
              <MoveButtons kind={kind} c={c} onMove={onMove} preview={onPreviewMove} />
            </li>
          ))}
          {!connsAt(design, id).length && <li>none</li>}
        </ul>
      </div>
    );
  }

  if (['load', 'pv', 'bess'].includes(ref.kind)) {
    const list = ref.kind === 'load' ? design.loads : ref.kind === 'pv' ? design.pv : design.bess;
    const c = list.find(x => x.id === ref.id);
    if (!c) return null;
    const pr = prOf(c.pole);
    return (
      <div>
        <h3>{connLabel(design, ref.kind, c)}</h3>
        <dl>
          <Row k="Pole / phase" v={`${c.pole} / ${c.phase}`} />
          {ref.kind === 'load' && <Row k="Type" v={c.type} />}
          {ref.kind === 'pv' && <Row k="Inverter mode" v={c.inverterMode || 'design default'} />}
          {ref.kind === 'bess' && <Row k="Mode" v={c.mode || 'schedule'} />}
          {pr && c.phase !== 'ABC' && <Row k="Voltage here" v={`${v1(pr.volt[c.phase])} V`} />}
        </dl>
        {c.phase !== 'ABC' && onMove && <p style={{ marginTop: 10, fontSize: 12 }}>Move to another phase: <MoveButtons kind={ref.kind} c={c} onMove={onMove} preview={onPreviewMove} /></p>}
      </div>
    );
  }

  if (ref.kind === 'transformer' || ref.kind === 'source') {
    const tx = design.transformers.find(t => t.id === ref.id);
    const tr = res && res.transformers.find(t => t.id === ref.id);
    const ft = faults && faults.transformers.find(t => t.id === ref.id);
    const fs = faultSettings(design);
    if (ref.kind === 'source') {
      return (
        <div>
          <h3>HV source ({tx.name || tx.id})</h3>
          <dl>
            <Row k="HV voltage" v={`${tx.hvActual} V`} />
            <Row k="Fault level" v={fs.hvFaultMVA ? `${fs.hvFaultMVA} MVA, X/R ${fs.hvXR}` : 'not set — treated as an infinite bus'} />
            <Row k="c max / c min" v={`${fs.cMax} / ${fs.cMin}`} />
          </dl>
        </div>
      );
    }
    const tt = getTransformerType(design, tx.txRating);
    return (
      <div>
        <h3>Transformer {tx.name || tx.id}</h3>
        <dl>
          <Row k="Rating / vector group" v={`${tx.txRating} kVA, Dyn11`} />
          <Row k="Tap / HV" v={`tap ${tx.tap}, ${tx.hvActual} V`} />
          {tt && <Row k="Impedance / X/R" v={`${(Number(tt.z) * 100).toFixed(1)} %, X/R ${tx.txXR}`} />}
          <Row k="Neutral earth" v={`Rg ${tx.txGroundOhms} Ω`} />
          {tr && <Row k="Loading" v={<>{v1(tr.txPct)} % ({tr.flowDirection}), net {v1(tr.netKW)} kW{explain('txLoading', tx.id, 'the transformer loading')}</>} />}
          {tr && <Row k="LV bus" v={`A ${v1(tr.busVoltPct.A)} · B ${v1(tr.busVoltPct.B)} · C ${v1(tr.busVoltPct.C)} V`} />}
          {tr && <Row k="Phase currents" v={`A ${v1(tr.phaseCurrentA.A)} · B ${v1(tr.phaseCurrentA.B)} · C ${v1(tr.phaseCurrentA.C)} A`} />}
          {ft && <Row k="LV bus fault" v={`Ik3max ${(ft.ik3MaxA / 1000).toFixed(2)} kA, Ik1min ${(ft.ik1MinA / 1000).toFixed(2)} kA`} />}
        </dl>
      </div>
    );
  }

  if (ref.kind === 'feederFuse') {
    const dev = protection && protection.devices.find(d => d.kind === 'feeder' && d.key === ref.id);
    return (
      <div>
        <h3>Feeder fuse — {ref.feeder}</h3>
        {!dev ? <p className="hint">Turn on the protection overlay to run the protection check for this fuse.</p> : (
          <>
            <dl>
              <Row k="Fuse" v={dev.fuse ? `${dev.fuse.id} (${dev.fuse.ratingA} A${dev.fuse.type ? ', ' + dev.fuse.type : ''})` : 'none selected (data missing)'} />
              <Row k="Overall" v={dev.overall} />
            </dl>
            <ul style={{ margin: '8px 0 0', paddingLeft: 18, fontSize: 12 }}>
              {Object.entries(dev.checks).map(([k, ch]) => <li key={k}><b>{k}</b>: {ch.status} — {ch.detail}</li>)}
            </ul>
          </>
        )}
      </div>
    );
  }

  if (ref.kind === 'openPoint') {
    const o = design.openPoints.find(x => x.id === ref.id);
    return o ? <div><h3>Open point {o.id}</h3><dl><Row k="Between" v={`${o.poleA} and ${o.poleB}`} /><Row k="Tie" v={`${o.spanM} m ${o.cond} (normally open)`} /></dl></div> : null;
  }
  return null;
}
