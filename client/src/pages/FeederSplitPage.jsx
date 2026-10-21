import { useMemo, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { useDesign } from '../context/DesignContext.jsx';
import {
  feederTrees, poleById, transformerOfPole, nextTransformerId, conductorCodes, transformerRatings,
  buildSplitCandidate, runSnapshotAt, feederConnectedTotals, DAILY_HOURS
} from '../lib/loadflow.js';
import SldPreview from '../components/SldPreview.jsx';
import { ConvergenceWarning } from '../components/Convergence.jsx';
import { txCurrentSummary } from '../lib/format.js';
import TaskProgress from '../components/TaskProgress.jsx';
import OptimiserCertificate from '../components/OptimiserCertificate.jsx';
import { useEngineTask } from '../hooks/useEngineTask.js';
import MultiCriteriaView from '../components/MultiCriteriaView.jsx';

const DUAL_SHORTLIST_K = 8;
const candidateKey = (mode, c) => (mode === 'single' ? c.poleId : c.poleA + '-' + c.poleB);

function openPointLabel(design, o) {
  const a = poleById(design, o.poleA), b = poleById(design, o.poleB);
  return `${o.poleA} (${a.feeder} / ${transformerOfPole(design, o.poleA)}) ↔ ${o.poleB} (${b.feeder} / ${transformerOfPole(design, o.poleB)})`;
}

// Whether open point pole `poleId` belongs to feeder tree `tree` ({rootPoleId, feederName, txId}
// from feederTrees) — scoped by the exact transformer, not just a feeder-name match, so two
// different transformers sharing a feeder name (e.g. both called "F1") can never be confused.
function poleOnTree(design, poleId, tree) {
  return transformerOfPole(design, poleId) === tree.txId && poleById(design, poleId).feeder === tree.feederName;
}

// Which side of open point `openPointId` actually corresponds to the currently-selected feeder
// tree — resolved with the same poleOnTree criterion the page uses to decide which open points
// even show up as options for this feeder, rather than guessed from a bare name deeper in
// loadflow.js.
function openPointAnchorFor(design, tree, openPointId) {
  const o = design.openPoints.find(x => x.id === openPointId);
  return poleOnTree(design, o.poleA, tree) ? o.poleA : o.poleB;
}

// Which hours/solar-multiplier a chosen "test conditions" mode resolves to, plus how the results
// table should label violations/loss for it — the same representative hours DiagramPage's own
// "Quick snapshot" presets use, for consistency.
// Compact "TX1 62% / TX2 58% / TX3 71%"-style summary of one metric across every transformer in a
// candidate's result — the per-transformer detail (loading, current, voltage, loss) that's
// reported alongside the violations+loss ranking without being part of it.
function txSummary(transformers, key, unit, decimals = 0) {
  if (!transformers || !transformers.length) return '—';
  return transformers.map(t => `${t.name || t.id} ${t[key].toFixed(decimals)}${unit}`).join(' / ');
}
function txVoltageBand(transformers) {
  if (!transformers || !transformers.length) return '—';
  return transformers.map(t => `${t.name || t.id} ${t.minVPct.toFixed(0)}–${t.maxVPct.toFixed(0)}V`).join(' / ');
}

function testOptsFor(testMode) {
  if (testMode === 'solarPeak') return { hours: [12], solarMult: 1, periodLabel: 'at 12:00 (solar peak)', lossLabel: 'Loss at 12:00 (kW)' };
  if (testMode === 'nightPeak') return { hours: [20], solarMult: 0, periodLabel: 'at 20:00 (night peak)', lossLabel: 'Loss at 20:00 (kW)' };
  return { hours: DAILY_HOURS, solarMult: 1, periodLabel: 'across 24h', lossLabel: 'Daily loss (kWh)' };
}

export default function FeederSplitPage() {
  const { design, setDesign } = useDesign();
  const trees = feederTrees(design);
  const base = design.transformers[0];
  const openPoints = design.openPoints;

  const [mode, setMode] = useState('single');
  // ?root=<pole> (from the issues panel) preselects that feeder.
  const [searchParams] = useSearchParams();
  const [feederRootId, setFeederRootId] = useState(() => { const q = searchParams.get('root'); return q && trees.some(t => t.rootPoleId === q) ? q : trees[0]?.rootPoleId || ''; });
  const selectedTree = trees.find(t => t.rootPoleId === feederRootId) || null;
  const [txSpec, setTxSpec] = useState({
    name: '', txRating: base?.txRating ?? 250, tap: base?.tap ?? 2,
    hvActual: base?.hvActual ?? 11000, txXR: base?.txXR ?? 3, txGroundOhms: base?.txGroundOhms ?? 7.5
  });
  const [testMode, setTestMode] = useState('daily');

  // single-feeder mode's "New transformer site" — four methods, see siteSpanM in loadflow.js
  const [siteMethod, setSiteMethod] = useState('atSplit');
  const [anchorPoleId, setAnchorPoleId] = useState('');
  const [anchorCond, setAnchorCond] = useState('70ABC');
  const [manualConnector, setManualConnector] = useState({ spanM: 30, cond: '70ABC' });
  const [singleOpenPointId, setSingleOpenPointId] = useState('');
  const [singleDerivedCond, setSingleDerivedCond] = useState('70ABC');

  const [dualOpenPointId, setDualOpenPointId] = useState(openPoints[0]?.id || '');
  const [dualCond, setDualCond] = useState('70ABC');
  const [dualSearch, setDualSearch] = useState('shortlist'); // 'shortlist' (legacy, default) | 'optimised' (O5)
  const dualOpenPointObj = openPoints.find(o => o.id === dualOpenPointId) || null;

  const [results, setResults] = useState(null); // { ...computed, mode: 'single'|'dual', cond, testMode }
  const [quickResult, setQuickResult] = useState(null); // dual mode's instant "place at this open point" result
  const task = useEngineTask();
  const [preview, setPreview] = useState(null); // { design, label, reparents }
  const [applied, setApplied] = useState(null);

  const feederOpenPoints = selectedTree ? openPoints.filter(o => poleOnTree(design, o.poleA, selectedTree) || poleOnTree(design, o.poleB, selectedTree)) : [];
  // "At a specific pole" is only meaningful scoped to the feeder's own transformer — polePathDistanceM
  // can't resolve a distance across two different transformers' trees.
  const anchorPoleOptions = selectedTree ? design.poles.filter(p => transformerOfPole(design, p.id) === selectedTree.txId).map(p => p.id) : [];

  function buildNewTx(id) {
    return {
      id, name: txSpec.name || id, txRating: txSpec.txRating, tap: txSpec.tap,
      hvActual: txSpec.hvActual, txXR: txSpec.txXR, txGroundOhms: txSpec.txGroundOhms
    };
  }

  // Same open-point-becomes-stale reasoning as applyPreview below — the preview should look
  // exactly like what Apply will actually produce, so the tie is dropped here too, not just when
  // committed. Otherwise the preview diagram shows a redundant dashed "open point" line straight
  // through a connection the very same preview already shows as closed.
  function openPreview(reparents, newTx, label, usedOpenPointId = null) {
    const previewDesign = buildSplitCandidate(design, newTx, reparents);
    const finalDesign = usedOpenPointId
      ? { ...previewDesign, openPoints: previewDesign.openPoints.filter(o => o.id !== usedOpenPointId) }
      : previewDesign;
    setPreview({ design: finalDesign, label, reparents, usedOpenPointId });
  }

  // Every search runs in the engine worker (a dual-feeder search can take tens of seconds on long
  // feeders), with progress and Cancel; the page stays responsive throughout.
  async function runSingle() {
    if (!selectedTree) { alert('This design has no feeders yet — add poles on the Network page first.'); return; }
    if (siteMethod === 'openPoint' && !singleOpenPointId) { alert('Pick a common open point, or choose a different site method.'); return; }
    if (siteMethod === 'anchor' && !anchorPoleId) { alert('Pick the pole the new transformer will sit at, or choose a different site method.'); return; }
    const siteSpec = siteMethod === 'atSplit' ? { mode: 'atSplit', cond: '70ABC' }
      : siteMethod === 'anchor' ? { mode: 'anchor', anchor: anchorPoleId, cond: anchorCond }
      : siteMethod === 'openPoint' ? { mode: 'anchor', anchor: openPointAnchorFor(design, selectedTree, singleOpenPointId), cond: singleDerivedCond }
      : { mode: 'manual', spanM: manualConnector.spanM, cond: manualConnector.cond };
    const { hours, solarMult, periodLabel, lossLabel } = testOptsFor(testMode);
    setPreview(null); setApplied(null); setQuickResult(null);
    const r = await task.run('feederSplitSingle', { design, rootPoleId: feederRootId, txSpec, siteSpec, hours, solarMult }, 'Finding the best cut point');
    if (!r.ok) return;
    setResults({ ...r.result, mode: 'single', cond: siteSpec.cond, testMode, periodLabel, lossLabel, usedOpenPointId: siteMethod === 'openPoint' ? singleOpenPointId : null });
  }

  // Staged search (see searchDualFeederSplit in engine/advisors/feederSplit.js): each side's
  // candidates are shortlisted independently first, then only the shortlisted pairs are jointly
  // and exactly scored.
  async function runDual() {
    if (!dualOpenPointId) { alert('Add a common open point on the Network page first.'); return; }
    setPreview(null); setApplied(null); setQuickResult(null);
    const { hours, solarMult, periodLabel, lossLabel } = testOptsFor(testMode);
    const r = dualSearch === 'optimised'
      ? await task.run('feederSplitDualOptimised', { design, openPointId: dualOpenPointId, txSpec, cond: dualCond, hours, solarMult }, 'Searching every pair of cut points (or as many as the cap allows)')
      : await task.run('feederSplitDual', { design, openPointId: dualOpenPointId, txSpec, cond: dualCond, hours, solarMult, shortlistK: DUAL_SHORTLIST_K }, 'Searching cut points near the open point');
    if (!r.ok) return;
    setResults({ ...r.result, mode: 'dual', cond: dualCond, testMode, periodLabel, lossLabel, usedOpenPointId: dualOpenPointId });
  }

  // No search needed — the two cuts are fixed at the open point's own poles, so this is one
  // exact evaluation (scoreDualFeederCandidate naturally derives 0-length connectors when the
  // candidate pole *is* the anchor pole), independent of the broader ranked search.
  async function placeAtOpenPoint() {
    if (!dualOpenPointId) { alert('Add a common open point on the Network page first.'); return; }
    setPreview(null); setApplied(null); setResults(null);
    const { hours, solarMult, periodLabel, lossLabel } = testOptsFor(testMode);
    const r = await task.run('feederSplitAtOpenPoint', { design, openPointId: dualOpenPointId, txSpec, cond: dualCond, hours, solarMult }, 'Evaluating a transformer at the open point');
    if (!r.ok) return;
    setQuickResult({ candidate: r.result.candidate, newTx: r.result.newTx, cond: dualCond, periodLabel, lossLabel });
  }

  // Reuses the exact reparent plan the search/quick-action already resolved (rather than
  // re-deriving one from summary fields like connectorM) — that plan may have more than one entry
  // per side when the site turned out to be downstream of the split point (see
  // resolveSiteReparentPlan in loadflow.js), which connectorM alone can't reconstruct.
  function previewCandidate(c) {
    const label = results.mode === 'single'
      ? `Cut ${c.poleId} → new transformer`
      : `Cut ${c.poleA} & ${c.poleB} → shared new transformer`;
    openPreview(c.reparentPlan, results.newTx, label, results.usedOpenPointId);
  }

  function previewQuick() {
    const c = quickResult.candidate;
    openPreview(c.reparentPlan, quickResult.newTx, `New transformer placed directly at the open point (cuts ${c.poleA} & ${c.poleB})`, dualOpenPointId);
  }

  // Once a common open point has actually been used to place a new transformer, it's no longer a
  // meaningful open tie — that pole pair is now a real, closed connection — so it's removed from
  // the applied design rather than left behind as stale metadata pointing at a location that's
  // been electrically resolved.
  function applyPreview() {
    setDesign(d => {
      const id = nextTransformerId(d);
      const newTx = buildNewTx(id);
      const next = buildSplitCandidate(d, newTx, preview.reparents);
      if (!preview.usedOpenPointId) return next;
      return { ...next, openPoints: next.openPoints.filter(o => o.id !== preview.usedOpenPointId) };
    });
    setApplied(preview.label);
    setPreview(null);
    setResults(null);
    setQuickResult(null);
  }

  const previewSnapshot = useMemo(() => (preview ? runSnapshotAt(preview.design, { year: 0, hour: 20, loadMult: 1, solarMult: 1 }) : null), [preview]);
  const previewNewTxId = preview ? preview.design.transformers[preview.design.transformers.length - 1].id : null;
  const previewFeeders = preview
    ? feederConnectedTotals(preview.design).map(g => ({ ...g, txName: preview.design.transformers.find(t => t.id === g.txId)?.name || g.txId }))
    : [];

  return (
    <div>
      <div className="card">
        <h2>Feeder split advisor</h2>
        <p className="hint">Finds where to cut an overloaded feeder — or two feeders that meet at a common open point — and feed the tail from a new transformer, joined by a dedicated connector cable that may sit at a different physical location than the cut point itself. Ranked by fewest statutory voltage violations first, then lowest network loss as a tie-breaker.</p>

        <div className="grid g2">
          <label className="chk"><input type="radio" name="mode" checked={mode === 'single'} onChange={() => setMode('single')} /> Single feeder</label>
          <label className="chk"><input type="radio" name="mode" checked={mode === 'dual'} onChange={() => setMode('dual')} disabled={openPoints.length === 0} /> Two feeders via a common open point{openPoints.length === 0 ? ' (add one on the Network page first)' : ''}</label>
        </div>

        {mode === 'single' ? (
          <>
            <div className="grid g3" style={{ marginTop: 10 }}>
              <label className="field"><span>Feeder to split</span>
                <select value={feederRootId} onChange={e => setFeederRootId(e.target.value)}>
                  {trees.map(t => <option key={t.rootPoleId} value={t.rootPoleId}>{t.feederName} — {t.txId}</option>)}
                </select>
              </label>
            </div>

            <div className="section-title" style={{ marginTop: 14 }}>New transformer site</div>
            <div className="grid g2">
              <label className="chk"><input type="radio" name="site" checked={siteMethod === 'atSplit'} onChange={() => setSiteMethod('atSplit')} /> At the split point</label>
              <label className="chk"><input type="radio" name="site" checked={siteMethod === 'anchor'} onChange={() => setSiteMethod('anchor')} /> At a specific pole</label>
              <label className="chk"><input type="radio" name="site" checked={siteMethod === 'openPoint'} onChange={() => setSiteMethod('openPoint')} disabled={feederOpenPoints.length === 0} /> At a common open point{feederOpenPoints.length === 0 ? ' (none touch this feeder)' : ''}</label>
              <label className="chk"><input type="radio" name="site" checked={siteMethod === 'manual'} onChange={() => setSiteMethod('manual')} /> Manual connector</label>
            </div>
            {siteMethod === 'atSplit' && (
              <p className="hint">The new transformer is bolted directly onto whichever pole the search finds best — no separate connector cable.</p>
            )}
            {siteMethod === 'anchor' && (
              <div className="grid g3">
                <label className="field"><span>Site pole (fixed)</span>
                  <select value={anchorPoleId} onChange={e => setAnchorPoleId(e.target.value)}>
                    <option value="">— choose —</option>
                    {anchorPoleOptions.map(id => <option key={id} value={id}>{id}</option>)}
                  </select>
                </label>
                <label className="field"><span>Connector conductor</span>
                  <select value={anchorCond} onChange={e => setAnchorCond(e.target.value)}>
                    {conductorCodes(design).map(c => <option key={c} value={c}>{c}</option>)}
                  </select>
                </label>
                <p className="hint" style={{ alignSelf: 'end', marginBottom: 8 }}>Pick e.g. the last pole of the feeder to fix the site "at the end", or any other pole to fix it somewhere in between — connector length to each candidate cut point is derived automatically from the real distance to this pole.</p>
              </div>
            )}
            {siteMethod === 'openPoint' && (
              <div className="grid g3">
                <label className="field"><span>Common open point</span>
                  <select value={singleOpenPointId} onChange={e => setSingleOpenPointId(e.target.value)}>
                    <option value="">— choose —</option>
                    {feederOpenPoints.map(o => <option key={o.id} value={o.id}>{openPointLabel(design, o)}</option>)}
                  </select>
                </label>
                <label className="field"><span>Connector conductor</span>
                  <select value={singleDerivedCond} onChange={e => setSingleDerivedCond(e.target.value)}>
                    {conductorCodes(design).map(c => <option key={c} value={c}>{c}</option>)}
                  </select>
                </label>
                <p className="hint" style={{ alignSelf: 'end', marginBottom: 8 }}>Connector length is derived per candidate — the real distance along this feeder from the open point out to wherever it's cut.</p>
              </div>
            )}
            {siteMethod === 'manual' && (
              <div className="grid g3">
                <label className="field"><span>Length (m)</span>
                  <input type="number" value={manualConnector.spanM} step={5} min={0} onChange={e => setManualConnector({ ...manualConnector, spanM: e.target.value })} />
                </label>
                <label className="field"><span>Conductor</span>
                  <select value={manualConnector.cond} onChange={e => setManualConnector({ ...manualConnector, cond: e.target.value })}>
                    {conductorCodes(design).map(c => <option key={c} value={c}>{c}</option>)}
                  </select>
                </label>
              </div>
            )}
          </>
        ) : (
          <>
            <div className="grid g3" style={{ marginTop: 10 }}>
              <label className="field"><span>Common open point</span>
                <select value={dualOpenPointId} onChange={e => setDualOpenPointId(e.target.value)}>
                  {openPoints.map(o => <option key={o.id} value={o.id}>{openPointLabel(design, o)}</option>)}
                </select>
              </label>
              <label className="field"><span>Connector conductor</span>
                <select value={dualCond} onChange={e => setDualCond(e.target.value)}>
                  {conductorCodes(design).map(c => <option key={c} value={c}>{c}</option>)}
                </select>
              </label>
              <p className="hint" style={{ alignSelf: 'end', marginBottom: 8 }}>Used both for placing the new transformer directly at the open point (zero-length, since it sits right there) and, if you search instead below, for its derived connector legs.</p>
            </div>
          </>
        )}

        <div className="section-title" style={{ marginTop: 14 }}>Test conditions</div>
        <div className="grid g3">
          <label className="chk"><input type="radio" name="testMode" checked={testMode === 'daily'} onChange={() => setTestMode('daily')} /> Full 24-hour scan</label>
          <label className="chk"><input type="radio" name="testMode" checked={testMode === 'solarPeak'} onChange={() => setTestMode('solarPeak')} /> Solar peak only (12:00)</label>
          <label className="chk"><input type="radio" name="testMode" checked={testMode === 'nightPeak'} onChange={() => setTestMode('nightPeak')} /> Night peak only (20:00)</label>
        </div>

        <div className="section-title" style={{ marginTop: 14 }}>New transformer</div>
        <div className="grid g3">
          <label className="field"><span>Name</span>
            <input type="text" placeholder={nextTransformerId(design)} value={txSpec.name} onChange={e => setTxSpec({ ...txSpec, name: e.target.value })} />
          </label>
          <label className="field"><span>Rated capacity</span>
            <select value={txSpec.txRating} onChange={e => setTxSpec({ ...txSpec, txRating: Number(e.target.value) })}>
              {transformerRatings(design).map(k => <option key={k} value={k}>{k} kVA</option>)}
            </select>
          </label>
          <label className="field"><span>Tap position</span>
            <select value={txSpec.tap} onChange={e => setTxSpec({ ...txSpec, tap: Number(e.target.value) })}>
              <option value={1}>Tap 1 — 11275 : 415</option>
              <option value={2}>Tap 2 — 11000 : 415 (nominal)</option>
              <option value={3}>Tap 3 — 10725 : 415</option>
              <option value={4}>Tap 4 — 10450 : 415</option>
            </select>
          </label>
          <label className="field"><span>Assumed constant HV supply</span>
            <input type="number" value={txSpec.hvActual} step={10} onChange={e => setTxSpec({ ...txSpec, hvActual: Number(e.target.value) })} />
          </label>
          <label className="field"><span>Transformer X/R ratio</span>
            <input type="number" value={txSpec.txXR} step={0.1} min={0.5} onChange={e => setTxSpec({ ...txSpec, txXR: Number(e.target.value) })} />
          </label>
          <label className="field"><span>Star point ground resistance (Ω)</span>
            <input type="number" value={txSpec.txGroundOhms} step={0.5} min={0.1} onChange={e => setTxSpec({ ...txSpec, txGroundOhms: Number(e.target.value) })} />
          </label>
        </div>

        {mode === 'single' ? (
          <button className="primary" onClick={runSingle} disabled={task.running} style={{ marginTop: 8 }}>Find best cut point</button>
        ) : (
          <>
            <button className="primary" onClick={placeAtOpenPoint} disabled={task.running} style={{ marginTop: 8 }}>
              Place new transformer at {dualOpenPointObj ? `${dualOpenPointObj.poleA} & ${dualOpenPointObj.poleB}` : 'this open point'} (0m connectors, no search)
            </button>{' '}
            <button className="ghost" onClick={runDual} disabled={task.running} style={{ marginTop: 8 }}>Or search nearby cut points instead</button>
            <div className="grid g3" style={{ marginTop: 8 }}>
              <label className="chk"><input type="radio" name="dualSearch" checked={dualSearch === 'shortlist'} onChange={() => setDualSearch('shortlist')} /> Search: shortlist {DUAL_SHORTLIST_K} per side (legacy)</label>
              <label className="chk"><input type="radio" name="dualSearch" checked={dualSearch === 'optimised'} onChange={() => setDualSearch('optimised')} /> Search: every pair, or shortlist + local improvement above 400 pairs</label>
            </div>
          </>
        )}
        <TaskProgress task={task} />
        {mode === 'dual' && <p className="hint" style={{ marginTop: 8 }}>"Place new transformer at..." always cuts exactly at the open point's own two poles — no searching. "Search nearby cut points instead" may find a better-scoring pair near the open point (shortlisting each feeder's candidates independently first — top {DUAL_SHORTLIST_K} each — then jointly testing those {DUAL_SHORTLIST_K}×{DUAL_SHORTLIST_K} combinations exactly), but won't necessarily land exactly on the open point's poles.</p>}
      </div>

      {applied && (
        <div className="note" style={{ marginTop: 14 }}>Applied — {applied}. Review and fine-tune it on Setup, Network or Diagram.</div>
      )}

      {quickResult && !preview && (
        <div className="card" style={{ marginTop: 18 }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 8 }}>
            <span style={{ fontWeight: 600 }}>New transformer placed directly at the open point</span>
            <span className={'pill ' + (quickResult.candidate.voltageViolationCount ? 'bad' : 'ok')}>{quickResult.candidate.voltageViolationCount} voltage violation{quickResult.candidate.voltageViolationCount === 1 ? '' : 's'} {quickResult.periodLabel}</span>
          </div>
          <p className="hint" style={{ marginBottom: 8 }}>
            Cuts {quickResult.candidate.poleA} &amp; {quickResult.candidate.poleB} exactly at the open point (0m connectors both legs) ·
            {' '}{quickResult.candidate.thermalViolationCount} thermal · {quickResult.candidate.txOverloadViolationCount} transformer-overload violation(s) ·
            {' '}{quickResult.lossLabel.toLowerCase()}: {quickResult.candidate.lossKwh.toFixed(2)}
          </p>
          <p className="hint" style={{ marginBottom: 8 }}>
            Tx loading: {txSummary(quickResult.candidate.transformers, 'peakPct', '%')} · Tx max phase current: {txCurrentSummary(quickResult.candidate.transformers)} · Tx bus voltage: {txVoltageBand(quickResult.candidate.transformers)}
          </p>
          <ConvergenceWarning show={!quickResult.candidate.converged}>One or more scanned hours of this evaluation did not converge — treat its figures with caution.</ConvergenceWarning>
          <button className="mini" onClick={previewQuick}>Preview</button>
        </div>
      )}

      {results && !preview && (
        <div style={{ marginTop: 18 }}>
          <div className="card">
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 8 }}>
              <span style={{ fontWeight: 600 }}>Current design (no new transformer)</span>
              <span className={'pill ' + (results.baseline.voltageViolationCount ? 'bad' : 'ok')}>{results.baseline.voltageViolationCount} voltage violation{results.baseline.voltageViolationCount === 1 ? '' : 's'} {results.periodLabel}</span>
            </div>
            <p className="hint" style={{ marginBottom: 0 }}>
              {results.baseline.thermalViolationCount} thermal · {results.baseline.txOverloadViolationCount} transformer-overload violation(s) {results.periodLabel} ·
              {' '}{results.lossLabel.toLowerCase()}: {results.baseline.lossKwh.toFixed(2)}
              {!results.baseline.converged && <span style={{ color: 'var(--bad)' }}> — one or more hours did not fully converge</span>}
            </p>
            <p className="hint" style={{ marginBottom: 0 }}>
              Tx loading: {txSummary(results.baseline.transformers, 'peakPct', '%')} · Tx max phase current: {txCurrentSummary(results.baseline.transformers)} · Tx bus voltage: {txVoltageBand(results.baseline.transformers)}
            </p>
          </div>

          <div className="card" style={{ marginTop: 14 }}>
            {results.certificate && <OptimiserCertificate result={results} space={`${results.totalPairs} cut-point pairs (${results.coveragePct.toFixed(1)} % scored with full load flows)`} why="the legacy search shortlists each feeder's cuts on their own, then pairs them; a cut that is mediocre alone can be the best partner for the other side, so the best pair can be missed." />}
            <p className="hint">Ranked best-to-worst{results.mode === 'single' ? <> for feeder <b>{results.feederName}</b></> : <> for feeders <b>{results.feederA}</b> &amp; <b>{results.feederB}</b></>}, tested {results.periodLabel}. Voltage violations drive the ranking, network loss is the tie-breaker; the per-transformer columns (every transformer in the resulting design, not just the new one) are reported for context and don't affect the ranking. Transformer current is the true worst phase current from the load flow; the balanced-equivalent figure (peak kVA ÷ (√3 × 415 V)) beside it understates an unbalanced transformer. Click Preview to see the resulting network before applying anything.</p>
            <ConvergenceWarning show={results.candidates.some(c => !c.converged)}>
              {results.candidates.filter(c => !c.converged).length} candidate(s) had one or more scanned hours that did not converge — marked “not converged” below; their figures are unreliable.
            </ConvergenceWarning>
            <div className="tbl-wrap"><table>
              <thead>
                {results.mode === 'single' ? (
                  <tr><th>Rank</th><th>Cut pole</th><th>Connector (m)</th><th>Poles moved</th><th>Voltage violations</th><th>{results.lossLabel}</th><th>Thermal</th><th>Tx overload</th><th>Tx loading (peak)</th><th>Tx max phase current (balanced-equivalent)</th><th>Tx bus voltage</th><th></th></tr>
                ) : (
                  <tr><th>Rank</th><th>Cut A</th><th>Connector A (m)</th><th>Cut B</th><th>Connector B (m)</th><th>Voltage violations</th><th>{results.lossLabel}</th><th>Thermal</th><th>Tx overload</th><th>Tx loading (peak)</th><th>Tx max phase current (balanced-equivalent)</th><th>Tx bus voltage</th><th></th></tr>
                )}
              </thead>
              <tbody>
                {results.candidates.map((c, i) => (
                  <tr key={results.mode === 'single' ? c.poleId : c.poleA + '-' + c.poleB}>
                    <td>{i + 1}</td>
                    {results.mode === 'single' ? (
                      <>
                        <td>{c.poleId}</td><td>{c.connectorM.toFixed(0)}</td><td>{c.movedPoleCount}</td>
                      </>
                    ) : (
                      <>
                        <td>{c.poleA}</td><td>{c.connectorAM.toFixed(0)}</td>
                        <td>{c.poleB}</td><td>{c.connectorBM.toFixed(0)}</td>
                      </>
                    )}
                    <td><span className={'pill ' + (c.voltageViolationCount ? 'bad' : 'ok')}>{c.voltageViolationCount}</span>{!c.converged && <> <span className="pill bad" title="One or more scanned hours did not converge">not converged</span></>}</td>
                    <td>{c.lossKwh.toFixed(2)}</td>
                    <td>{c.thermalViolationCount}</td>
                    <td>{c.txOverloadViolationCount}</td>
                    <td style={{ whiteSpace: 'nowrap' }}>{txSummary(c.transformers, 'peakPct', '%')}</td>
                    <td style={{ whiteSpace: 'nowrap' }}>{txCurrentSummary(c.transformers)}</td>
                    <td style={{ whiteSpace: 'nowrap' }}>{txVoltageBand(c.transformers)}</td>
                    <td><button className="mini" onClick={() => previewCandidate(c)}>Preview</button></td>
                  </tr>
                ))}
              </tbody>
            </table></div>
          </div>
          <MultiCriteriaView
            title="Compare split options by criteria"
            items={results.candidates.map(c => ({
              id: candidateKey(results.mode, c),
              label: results.mode === 'single' ? `Cut at ${c.poleId}` : `Cuts ${c.poleA} + ${c.poleB}`,
              values: { violations: c.voltageViolationCount, kwh: c.lossKwh, capex: null, vuf: c.worstVuf ? c.worstVuf.value : null }
            }))}
            criteria={[
              { key: 'violations', label: 'Voltage violations', digits: 0 },
              { key: 'kwh', label: results.lossLabel, digits: 2 },
              { key: 'capex', label: 'Capex LKR', digits: 0, missing: 'not available yet — transformer and cable unit costs come with Economics (P6.1); until then options are compared without it.' },
              { key: 'vuf', label: 'Worst VUF %', digits: 2 }
            ]}
            onPreview={(id) => { const c = results.candidates.find(x => candidateKey(results.mode, x) === id); if (c) previewCandidate(c); }}
          />
        </div>
      )}

      {preview && (
        <div className="card" style={{ marginTop: 18 }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 8 }}>
            <h2 style={{ margin: 0 }}>Preview — {preview.label}</h2>
            <span>
              <button className="primary" onClick={applyPreview}>Apply this design</button>{' '}
              <button className="mini" onClick={() => setPreview(null)}>Discard preview</button>
            </span>
          </div>
          <p className="hint">Shown at night-peak conditions (20:00, nominal load, no solar) — after applying, use the Diagram page for full hour-by-hour and scenario control.</p>
          {previewSnapshot && (
            <p><span className={'pill ' + (previewSnapshot.violations.length ? 'bad' : 'ok')}>{previewSnapshot.violations.length} violation{previewSnapshot.violations.length === 1 ? '' : 's'} at 20:00</span></p>
          )}
          <ConvergenceWarning show={!!previewSnapshot && !previewSnapshot.converged}>
            The preview load flow at 20:00 did not converge ({previewSnapshot?.iterUsed} iterations) — the diagram below may be inaccurate.
          </ConvergenceWarning>
          {previewSnapshot && <SldPreview design={preview.design} before={design} res={previewSnapshot} label="Feeder split preview, 20:00" />}
          <div className="section-title" style={{ marginTop: 14 }}>Feeders after the split — connected load &amp; solar PV (kVA per phase)</div>
          <p className="hint" style={{ marginTop: 0 }}>Every feeder in the resulting design, so you can see what moved to the new transformer and what stayed. Load is ADMD-substituted where unspecified; PV is installed (nameplate) kVA.</p>
          <div className="tbl-wrap"><table>
            <thead><tr><th>Transformer</th><th>Feeder</th><th>Poles</th><th>Load A</th><th>Load B</th><th>Load C</th><th>PV A</th><th>PV B</th><th>PV C</th></tr></thead>
            <tbody>
              {previewFeeders.map(g => {
                const isNew = g.txId === previewNewTxId;
                return (
                  <tr key={g.key}>
                    <td>{g.txName}{isNew && <> <span className="pill ok" style={{ fontSize: 10 }}>new</span></>}</td>
                    <td>{g.feederName}</td><td>{g.poleIds.length}</td>
                    <td>{g.load.A.toFixed(1)}</td><td>{g.load.B.toFixed(1)}</td><td>{g.load.C.toFixed(1)}</td>
                    <td>{g.pv.A.toFixed(1)}</td><td>{g.pv.B.toFixed(1)}</td><td>{g.pv.C.toFixed(1)}</td>
                  </tr>
                );
              })}
            </tbody>
          </table></div>
        </div>
      )}
    </div>
  );
}
