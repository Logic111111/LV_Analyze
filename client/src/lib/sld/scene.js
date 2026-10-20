// Single-line diagram scene (P5.1): a pure description of what to draw, as plain geometric
// primitives with semantic colour tokens. The React view (components/SingleLineDiagram.jsx), the
// SVG/PNG/print export (svg.js) and the DXF export (dxf.js) all render this same scene, so they
// can't drift apart, and the layout is testable without a browser.
//
// Layout (extends the old tree layout, left to right):
//   HV source → transformer (two circles) → LV busbar → feeder fuse → spans → poles, column by
//   tree depth. A pole sits level with its first child, so each main line runs straight; further
//   children branch downwards from the pole. Each pole's service drops hang below and right of it
//   in three phase groups (A, B, C, plus "3φ" when there are three-phase connections). The groups
//   are also the drop zones for drag-to-rephase (P5.2). Every block reserves its own height before
//   the next branch starts, so drops, branch lines and labels never overlap. A long feeder only
//   makes the drawing wider; the view scrolls inside the diagram.
//
// Primitives: { k: 'line'|'polyline'|'polygon'|'rect'|'circle'|'arc'|'text', …geometry, color,
//   width?, dash?, fill? }. Colours are tokens ('line', 'text', 'muted', 'ok', 'warn', 'bad',
//   'phaseA', 'phaseB', 'phaseC', 'accent', 'bg'); each renderer maps them to its own palette (SVG
//   theme colours, DXF ACI numbers).
import { PHASES, children, isTransformerId, poleById, conductorParams } from '../loadflow.js';

// Columns are as wide as a pole's drop groups plus room for the next pole's label, so a parent's
// drops never reach its children (tested: no two labels overlap, fixture and 50-pole feeder).
export const SLD = Object.freeze({
  MARGIN: 24, SRC_X: 30, TX_X: 150, BUS_X: 210, FUSE_DX: 34,
  GROUP_W: 80, DROP_H: 15, HEAD_H: 34, GAP: 36, INFO_H: 11, TX_GAP: 60, DROP_FONT: 7.5
});
const colWidth = (groups) => groups * SLD.GROUP_W + 34;
// Longest drop label that fits its group (0.6 em per monospace character, after the marker).
const DROP_CHARS = Math.floor((SLD.GROUP_W - 15) / (SLD.DROP_FONT * 0.6));
const fit = (s) => (s.length > DROP_CHARS ? s.slice(0, DROP_CHARS - 1) + '…' : s);

const PHASE_TOKEN = { A: 'phaseA', B: 'phaseB', C: 'phaseC' };
const KIND_TAG = { load: '', pv: 'PV ', bess: 'BESS ' };

/** Connections at each pole, grouped by phase. */
function dropsByPole(design) {
  const out = {};
  const add = (kind, c) => {
    const pole = (out[c.pole] = out[c.pole] || { A: [], B: [], C: [], ABC: [] });
    (pole[c.phase] || pole.ABC).push({ kind, conn: c });
  };
  design.loads.forEach(l => add('load', l));
  design.pv.forEach(p => add('pv', p));
  design.bess.forEach(b => add('bess', b));
  return out;
}

// kVA as drawn; "*" marks an ADMD-substituted load (explained in the legend and the side panel).
const isAdmd = (kind, c) => kind === 'load' && (c.kva == null || c.kva === '');
const fmtKva = (design, kind, c) => (isAdmd(kind, c) ? `${Number(design.admd).toFixed(1)}*` : Number(c.kva).toFixed(1));
const statusToken = (s) => (s === 'fail' ? 'bad' : s === 'pass' ? 'ok' : 'warn');

/**
 * @param {any} design
 * @param {any} res        Snapshot of `design` (runSnapshot / runSnapshotAt), or null for a bare drawing.
 * @param {{ overlays?: { voltage?: boolean, loading?: boolean, flow?: boolean, vuf?: boolean, fault?: boolean, protection?: boolean },
 *   faults?: any, protection?: any, compareTo?: any }} [opts]
 *   faults: faultLevels(design); protection: protectionCheck(design, scan); compareTo: the design
 *   before a proposal, to mark what changed (before/after mode).
 */
export function buildSldScene(design, res, opts = {}) {
  const ov = { voltage: true, loading: true, flow: true, vuf: false, fault: false, protection: false, ...(opts.overlays || {}) };
  const before = opts.compareTo || null;
  const prByPole = new Map((res ? res.poleResults : []).map(p => [p.id, p]));
  const txRes = new Map((res ? res.transformers : []).map(t => [t.id, t]));
  const faultByPole = new Map(((opts.faults && opts.faults.poles) || []).map(f => [f.id, f]));
  const faultByTx = new Map(((opts.faults && opts.faults.transformers) || []).map(f => [f.id, f]));
  const protByKey = new Map(((opts.protection && opts.protection.devices) || []).map(d => [d.kind + '|' + d.key, d]));
  const drops = dropsByPole(design);
  const any3ph = Object.values(drops).some(g => g.ABC.length);
  const COL = colWidth(any3ph ? 4 : 3);
  const groupsOf = (id) => [...PHASES, ...(drops[id] && drops[id].ABC.length ? ['ABC'] : [])];
  const infoLines = (id) => (ov.vuf && prByPole.has(id) ? 1 : 0) + (ov.fault && faultByPole.has(id) ? 1 : 0);

  // Before/after: what changed relative to `before`.
  const beforePhase = new Map();
  const beforeCond = new Map(), beforeParent = new Map();
  if (before) {
    [['load', before.loads], ['pv', before.pv], ['bess', before.bess]].forEach(([k, list]) => list.forEach(c => beforePhase.set(k + '|' + c.id, c.phase)));
    before.poles.forEach(p => { beforeCond.set(p.id, p.cond); beforeParent.set(p.id, p.parent); });
  }
  // Ghost entries in the phase a moved connection left.
  const ghosts = {};
  if (before) {
    Object.entries(drops).forEach(([pole, g]) => [...PHASES, 'ABC'].forEach(ph => g[ph].forEach(d => {
      const was = beforePhase.get(d.kind + '|' + d.conn.id);
      if (was && was !== d.conn.phase) ((ghosts[pole] = ghosts[pole] || { A: [], B: [], C: [], ABC: [] })[was] || []).push(d);
    })));
  }
  const groupCount = (id, ph) => ((drops[id] && drops[id][ph].length) || 0) + ((ghosts[id] && ghosts[id][ph].length) || 0);
  const blockH = (id) => SLD.HEAD_H + Math.max(1, ...groupsOf(id).map(ph => groupCount(id, ph))) * SLD.DROP_H + infoLines(id) * SLD.INFO_H + 6;

  // ---- layout ----
  const x = {}, y = {}, depth = {};
  let cursor = SLD.MARGIN + 30;
  const txY = {};
  const assign = (id, d) => {
    depth[id] = d;
    x[id] = SLD.BUS_X + d * COL;
    const kids = children(design, id);
    if (!kids.length) { y[id] = cursor; cursor = y[id] + blockH(id) + SLD.GAP; return; }
    assign(kids[0], d + 1);
    y[id] = y[kids[0]];
    cursor = Math.max(cursor, y[id] + blockH(id) + SLD.GAP);
    kids.slice(1).forEach(k => assign(k, d + 1));
  };
  design.transformers.forEach((tx, i) => {
    if (i > 0) cursor += SLD.TX_GAP;
    const roots = design.poles.filter(p => p.parent === tx.id).map(p => p.id);
    // Room above the first line for the transformer's labels.
    cursor += 26;
    if (!roots.length) { txY[tx.id] = cursor; cursor += 70; return; }
    roots.forEach(r => assign(r, 1));
    txY[tx.id] = y[roots[0]];
    cursor = Math.max(cursor, txY[tx.id] + 70);
  });

  const elements = [];
  const el = (id, type, ref, prims, label) => { elements.push({ id, type, ref, prims, label }); return elements[elements.length - 1]; };

  // ---- transformers, sources, busbars, feeder fuses ----
  design.transformers.forEach(tx => {
    const ty = txY[tx.id];
    const tr = txRes.get(tx.id);
    const ft = faultByTx.get(tx.id);
    const isNew = before && !before.transformers.some(t => t.id === tx.id);
    const bt = before && before.transformers.find(t => t.id === tx.id);
    const fs = opts.faults ? opts.faults.settings : null;
    // HV source: circle with "~", and its fault level.
    el(`src:${tx.id}`, 'source', { kind: 'source', id: tx.id }, [
      { k: 'circle', cx: SLD.SRC_X, cy: ty, r: 13, color: 'line', width: 1.6 },
      { k: 'text', x: SLD.SRC_X, y: ty + 4, text: '~', size: 14, anchor: 'middle', color: 'text' },
      { k: 'line', x1: SLD.SRC_X + 13, y1: ty, x2: SLD.TX_X - 20, y2: ty, color: 'line', width: 1.6 },
      // Source labels stay left of x = TX_X − 20, where the transformer's own labels start.
      { k: 'text', x: SLD.SRC_X - 14, y: ty - 20, text: `HV ${(tx.hvActual || 11000) / 1000} kV`, size: 8.5, anchor: 'start', color: 'muted' },
      { k: 'text', x: SLD.SRC_X - 14, y: ty + 26, text: fs && fs.hvFaultMVA ? `S"k ${fs.hvFaultMVA} MVA` : 'S"k not set', size: 8, anchor: 'start', color: 'muted' }
    ], `HV source for ${tx.name || tx.id}${fs && fs.hvFaultMVA ? `, fault level ${fs.hvFaultMVA} MVA` : ', fault level not set (infinite bus assumed)'}`);
    // Transformer: two overlapping circles (IEC 60617 two-winding transformer). Its labels start at
    // the symbol's left edge (TXL), clear of the source's labels.
    const dash = isNew ? [5, 3] : undefined;
    const TXL = SLD.TX_X - 19;
    const loadTok = tr ? (tr.flowDirection === 'export' ? 'ok' : tr.txPct > 100 ? 'bad' : tr.txPct > 85 ? 'warn' : 'ok') : 'line';
    const txPrims = [
      { k: 'circle', cx: SLD.TX_X - 7, cy: ty, r: 12, color: ov.loading ? loadTok : 'line', width: 1.8, dash },
      { k: 'circle', cx: SLD.TX_X + 7, cy: ty, r: 12, color: ov.loading ? loadTok : 'line', width: 1.8, dash },
      { k: 'line', x1: SLD.TX_X + 19, y1: ty, x2: SLD.BUS_X, y2: ty, color: 'line', width: 1.6 },
      { k: 'text', x: TXL, y: ty - 18, text: `${tx.name || tx.id} · ${tx.txRating} kVA${isNew ? ' · NEW' : ''}`, size: 9, anchor: 'start', color: isNew ? 'accent' : 'text', weight: 600 },
      { k: 'text', x: TXL, y: ty + 24, text: `Dyn11 · tap ${tx.tap}`, size: 8, anchor: 'start', color: 'muted' }
    ];
    if (bt && bt.tap !== tx.tap) txPrims.push({ k: 'text', x: TXL, y: ty + 34, text: `tap ${bt.tap} → ${tx.tap}`, size: 8.5, anchor: 'start', color: 'accent', weight: 700 });
    if (tr && ov.loading) txPrims.push({ k: 'text', x: TXL, y: ty + (bt && bt.tap !== tx.tap ? 44 : 34), text: `${tr.txPct.toFixed(0)} % ${tr.flowDirection}`, size: 8, anchor: 'start', color: loadTok });
    if (ft && ov.fault) txPrims.push({ k: 'text', x: SLD.BUS_X + 4, y: ty - 26, text: `LV bus Ik3 ${(ft.ik3MaxA / 1000).toFixed(2)} kA`, size: 7.5, anchor: 'start', color: 'muted' });
    el(`tx:${tx.id}`, 'transformer', { kind: 'transformer', id: tx.id }, txPrims, `Transformer ${tx.name || tx.id}, ${tx.txRating} kVA, Dyn11, tap ${tx.tap}`);

    const roots = design.poles.filter(p => p.parent === tx.id);
    const ys = [ty, ...roots.map(r => y[r.id])];
    el(`bus:${tx.id}`, 'busbar', { kind: 'transformer', id: tx.id }, [
      { k: 'line', x1: SLD.BUS_X, y1: Math.min(...ys) - 14, x2: SLD.BUS_X, y2: Math.max(...ys) + 14, color: 'line', width: 5 },
      ...(tr && ov.voltage ? [{ k: 'text', x: SLD.BUS_X - 4, y: Math.max(...ys) + 26, text: `LV bus A ${tr.busVoltPct.A.toFixed(1)} B ${tr.busVoltPct.B.toFixed(1)} C ${tr.busVoltPct.C.toFixed(1)} V`, size: 7.5, anchor: 'start', color: 'muted' }] : [])
    ], `LV busbar of ${tx.name || tx.id}`);
    // One feeder fuse per feeder (on its first root line).
    const shown = new Set();
    roots.forEach(r => {
      if (shown.has(r.feeder)) return;
      shown.add(r.feeder);
      const fy = y[r.id], fx = SLD.BUS_X + SLD.FUSE_DX;
      const dev = protByKey.get('feeder|' + `${tx.id}|${r.feeder}`);
      const tok = ov.protection && dev ? statusToken(dev.overall) : 'line';
      el(`fuse:${tx.id}|${r.feeder}`, 'fuse', { kind: 'feederFuse', id: `${tx.id}|${r.feeder}`, txId: tx.id, feeder: r.feeder }, [
        { k: 'rect', x: fx - 9, y: fy - 4, w: 18, h: 8, color: tok, width: 1.5, fill: 'bg' },
        { k: 'line', x1: fx - 9, y1: fy, x2: fx + 9, y2: fy, color: tok, width: 1.5 },
        { k: 'text', x: fx, y: fy - 8, text: r.feeder, size: 8, anchor: 'middle', color: 'text', weight: 600 },
        ...(ov.protection && dev ? [{ k: 'text', x: fx, y: fy + 15, text: dev.overall === 'pass' ? '✓ pass' : dev.overall === 'fail' ? '✗ fail' : '? data', size: 7.5, anchor: 'middle', color: tok }] : [])
      ], `Feeder fuse ${r.feeder}${dev ? `, protection ${dev.overall}` : ''}`);
    });
  });

  // ---- spans, poles, drops ----
  const order = [];
  design.transformers.forEach(tx => {
    const walk = (id) => { order.push(id); children(design, id).forEach(walk); };
    design.poles.filter(p => p.parent === tx.id).forEach(p => walk(p.id));
  });
  order.forEach(id => {
    const p = poleById(design, id);
    const pr = prByPole.get(id);
    const parentIsTx = isTransformerId(design, p.parent);
    const px = parentIsTx ? SLD.BUS_X : x[p.parent], py = parentIsTx ? y[id] : y[p.parent];
    const cx = x[id], cy = y[id];
    const maxPct = pr ? Math.max(pr.condPct.A, pr.condPct.B, pr.condPct.C) : 0;
    const loadTok = maxPct > 100 ? 'bad' : maxPct > 85 ? 'warn' : 'ok';
    const upgraded = before && beforeCond.has(id) && beforeCond.get(id) !== p.cond;
    const refed = before && beforeParent.has(id) && beforeParent.get(id) !== p.parent;
    const isNewPole = before && !beforeCond.has(id);
    const color = upgraded || refed || isNewPole ? 'accent' : ov.loading && pr ? loadTok : 'line';
    const width = upgraded ? 5 : 2;
    const pts = parentIsTx ? [[px, cy], [cx, cy]] : (py === cy ? [[px, py], [cx, cy]] : [[px, py], [px, cy], [cx, cy]]);
    const mx = (Math.max(px, parentIsTx ? SLD.BUS_X + SLD.FUSE_DX + 12 : px) + cx) / 2;
    const spanPrims = [{ k: 'polyline', points: pts, color, width, dash: isNewPole ? [6, 3] : undefined }];
    const condText = upgraded ? `${beforeCond.get(id)}→${p.cond}` : p.cond;
    spanPrims.push({ k: 'text', x: mx, y: cy - 6, text: `${p.spanM} m · ${condText}${refed ? ' · re-fed' : ''}`, size: 8, anchor: 'middle', color: upgraded || refed ? 'accent' : 'muted' });
    if (pr && (ov.loading || ov.flow)) {
      const parts = [];
      if (ov.loading) parts.push(`${maxPct.toFixed(0)} %`);
      if (ov.flow) parts.push(`${Math.abs(pr.flowKW).toFixed(1)} kW`);
      spanPrims.push({ k: 'text', x: mx, y: cy - 16, text: parts.join(' · '), size: 7.5, anchor: 'middle', color: ov.loading ? loadTok : 'muted' });
    }
    // Flow direction: an arrowhead on the last segment (towards the pole on import, back on export).
    if (pr && ov.flow && Math.abs(pr.flowKW) > 1e-3) {
      const ax = (cx + Math.max(pts[pts.length - 2][0], cx - 40)) / 2 + 14, dir = pr.flowKW >= 0 ? 1 : -1;
      spanPrims.push({ k: 'polygon', points: [[ax + 5 * dir, cy], [ax - 4 * dir, cy - 4], [ax - 4 * dir, cy + 4]], color, fill: color });
    }
    // A section fuse into this pole (design.protection.poleFuses), drawn at the parent end.
    const poleFuse = design.protection && design.protection.poleFuses && design.protection.poleFuses[id];
    if (poleFuse) {
      const dev = protByKey.get('pole|' + id);
      const tok = ov.protection && dev ? statusToken(dev.overall) : 'line';
      const fx = pts.length === 3 ? px : px + 18, fy = pts.length === 3 ? (py + cy) / 2 : cy;
      const vertical = pts.length === 3;
      spanPrims.push(vertical
        ? { k: 'rect', x: fx - 4, y: fy - 9, w: 8, h: 18, color: tok, width: 1.5, fill: 'bg' }
        : { k: 'rect', x: fx - 9, y: fy - 4, w: 18, h: 8, color: tok, width: 1.5, fill: 'bg' });
      spanPrims.push(vertical ? { k: 'line', x1: fx, y1: fy - 9, x2: fx, y2: fy + 9, color: tok, width: 1.5 } : { k: 'line', x1: fx - 9, y1: fy, x2: fx + 9, y2: fy, color: tok, width: 1.5 });
      if (ov.protection && dev) spanPrims.push({ k: 'text', x: fx + 8, y: fy + (vertical ? 3 : 14), text: dev.overall === 'pass' ? '✓' : dev.overall === 'fail' ? '✗' : '?', size: 8, anchor: 'start', color: tok });
    }
    el(`span:${id}`, 'span', { kind: 'span', id }, spanPrims, `Span into ${id}: ${p.spanM} m ${p.cond}${pr ? `, ${maxPct.toFixed(0)} % loaded` : ''}`);

    // Pole: a node, its id, and the worst-voltage status as the outline.
    let worst = 0;
    if (pr) PHASES.forEach(ph => {
      const v = pr.volt[ph];
      if (v < res.vLimLow || v > res.vLimHigh) worst = 2;
      else if (worst < 1 && (v < res.vLimLow * 1.01 || v > res.vLimHigh * 0.99)) worst = 1;
    });
    const vTok = !pr ? 'line' : worst === 2 ? 'bad' : worst === 1 ? 'warn' : 'ok';
    const polePrims = [
      { k: 'circle', cx, cy, r: 6, color: ov.voltage ? vTok : 'line', width: 2.2, fill: 'bg' },
      { k: 'text', x: cx, y: cy - 10, text: id, size: 9.5, anchor: 'middle', color: 'text', weight: 700 }
    ];
    if (p.grounded) {
      // Earth electrode (IEC 60617): a stem and three shortening bars, below-left of the pole.
      const ex = cx - 11, ey = cy + 10;
      polePrims.push(
        { k: 'line', x1: cx - 4, y1: cy + 4, x2: ex, y2: ey, color: 'muted', width: 1.4 },
        { k: 'line', x1: ex - 7, y1: ey, x2: ex + 7, y2: ey, color: 'muted', width: 1.4 },
        { k: 'line', x1: ex - 4.5, y1: ey + 3, x2: ex + 4.5, y2: ey + 3, color: 'muted', width: 1.4 },
        { k: 'line', x1: ex - 2, y1: ey + 6, x2: ex + 2, y2: ey + 6, color: 'muted', width: 1.4 },
        { k: 'text', x: ex - 9, y: ey + 4, text: `${p.groundOhms}Ω`, size: 7, anchor: 'end', color: 'muted' }
      );
    }
    el(`pole:${id}`, 'pole', { kind: 'pole', id }, polePrims, `Pole ${id}${pr ? `: A ${pr.volt.A.toFixed(1)} V, B ${pr.volt.B.toFixed(1)} V, C ${pr.volt.C.toFixed(1)} V` : ''}`);

    // Drops: phase groups below-right of the pole. Group headers carry the phase letter (and the
    // phase voltage with the voltage overlay); every drop label starts with its phase letter too,
    // so nothing relies on colour.
    const groups = groupsOf(id);
    const gx0 = cx + 12, gy = cy + 14;
    const bh = blockH(id);
    // Feed line from the pole to the drop groups.
    el(`dropbus:${id}`, 'dropbus', { kind: 'pole', id }, [
      { k: 'line', x1: cx, y1: cy + 6, x2: cx, y2: gy + 4, color: 'muted', width: 1 },
      { k: 'line', x1: cx, y1: gy + 4, x2: gx0 + groups.length * SLD.GROUP_W - 8, y2: gy + 4, color: 'muted', width: 1 }
    ], `Service drops at ${id}`);
    groups.forEach((ph, gi) => {
      const gxl = gx0 + gi * SLD.GROUP_W;
      const tok = ph === 'ABC' ? 'text' : PHASE_TOKEN[ph];
      const vBad = pr && ph !== 'ABC' && (pr.volt[ph] < res.vLimLow || pr.volt[ph] > res.vLimHigh);
      const head = ph === 'ABC' ? '3φ' : ov.voltage && pr ? `${ph} ${pr.volt[ph].toFixed(1)}${vBad ? '!' : ''}` : ph;
      const list = (drops[id] && drops[id][ph]) || [];
      const ghostList = (ghosts[id] && ghosts[id][ph]) || [];
      el(`zone:${id}:${ph}`, 'zone', { kind: 'zone', pole: id, phase: ph }, [
        { k: 'line', x1: gxl + 4, y1: gy + 4, x2: gxl + 4, y2: gy + 10, color: 'muted', width: 1 },
        { k: 'text', x: gxl + 1, y: gy + 19, text: head, size: 8, anchor: 'start', color: tok, weight: vBad ? 800 : 700 }
      ], ph === 'ABC' ? `Three-phase connections at ${id}` : `Phase ${ph} at ${id}${pr ? `, ${pr.volt[ph].toFixed(1)} V` : ''}`).zone = { x: gxl, y: gy, w: SLD.GROUP_W - 4, h: bh - 14 };
      [...list.map(d => ({ d, ghost: false })), ...ghostList.map(d => ({ d, ghost: true }))].forEach(({ d, ghost }, i) => {
        const dy = gy + 22 + i * SLD.DROP_H + 6;
        const c = d.conn;
        const moved = !ghost && before && beforePhase.has(d.kind + '|' + c.id) && beforePhase.get(d.kind + '|' + c.id) !== c.phase;
        const t = ghost ? 'muted' : tok;
        const mark = markerPrims(d.kind === 'load' ? (c.type === 'ev' ? 'ev' : 'load') : d.kind, gxl + 4, dy - 3, t);
        const label = `${ph === 'ABC' ? '3φ' : ph} ${KIND_TAG[d.kind]}${d.kind === 'load' && c.type === 'ev' ? 'EV ' : ''}${c.id} ${fmtKva(design, d.kind, c)}`;
        const prims = [...mark, { k: 'text', x: gxl + 11, y: dy, text: fit(ghost ? `${ph} ${c.id} moved` : label), size: SLD.DROP_FONT, anchor: 'start', color: t, weight: moved ? 700 : 400 }];
        if (moved) prims.push({ k: 'rect', x: gxl - 1, y: dy - 9, w: SLD.GROUP_W - 4, h: 12, color: 'accent', width: 1.2 });
        if (ghost) prims.push({ k: 'rect', x: gxl - 1, y: dy - 9, w: SLD.GROUP_W - 4, h: 12, color: 'muted', width: 1, dash: [3, 2] });
        const e = el(`${ghost ? 'ghost' : 'conn'}:${d.kind}:${c.id}`, ghost ? 'ghost' : 'drop', { kind: d.kind, id: c.id, pole: id, phase: c.phase }, prims,
          ghost ? `${c.id} moved away from phase ${beforePhase.get(d.kind + '|' + c.id)}` : `${KIND_TAG[d.kind] || 'Load '}${c.id} on phase ${c.phase === 'ABC' ? 'ABC (three-phase)' : c.phase}, ${fmtKva(design, d.kind, c)} kVA`);
        e.box = { x: gxl - 1, y: dy - 9, w: SLD.GROUP_W - 4, h: 12 };
        if (!ghost) e.draggable = c.phase !== 'ABC';
      });
    });
    // Arrows from each ghost to the moved connection's new place.
    if (ghosts[id]) {
      const posOf = (ph, idx) => ({ x: gx0 + groups.indexOf(ph) * SLD.GROUP_W, y: gy + 22 + idx * SLD.DROP_H + 3 });
      [...PHASES, 'ABC'].forEach(was => (ghosts[id][was] || []).forEach((d, gi) => {
        const now = d.conn.phase;
        const from = posOf(was, ((drops[id] && drops[id][was]) || []).length + gi);
        const to = posOf(now, drops[id][now].indexOf(d));
        if (groups.indexOf(was) < 0 || groups.indexOf(now) < 0) return;
        const x1 = from.x + SLD.GROUP_W / 2, x2 = to.x + 2, dir = x2 >= x1 ? 1 : -1;
        el(`move:${d.kind}:${d.conn.id}`, 'move', { kind: d.kind, id: d.conn.id, pole: id, phase: now }, [
          { k: 'polyline', points: [[x1, from.y], [x1, from.y + 4], [x2, to.y + 4], [x2, to.y]], color: 'accent', width: 1.2 },
          { k: 'polygon', points: [[x2, to.y - 1], [x2 - 3, to.y + 4], [x2 + 3, to.y + 4]], color: 'accent', fill: 'accent' }
        ], `${d.conn.id} moved from ${was} to ${now}`).dir = dir;
      }));
    }
    // Pole info lines (VUF, fault level) under the drops.
    let iy = cy + bh - 6 - infoLines(id) * SLD.INFO_H + 8;
    const info = [];
    if (ov.vuf && pr) { info.push({ k: 'text', x: gx0, y: iy, text: `VUF ${pr.vufPct.toFixed(2)} %`, size: 7.5, anchor: 'start', color: res && pr.vufPct > res.vufLimitPct ? 'bad' : 'muted' }); iy += SLD.INFO_H; }
    const f = faultByPole.get(id);
    if (ov.fault && f) info.push({ k: 'text', x: gx0, y: iy, text: `Ik3 ${(f.ik3MaxA / 1000).toFixed(2)} kA · Ik1 ${(f.ik1MinA / 1000).toFixed(2)} kA`, size: 7.5, anchor: 'start', color: 'muted' });
    if (info.length) el(`info:${id}`, 'info', { kind: 'pole', id }, info, `Pole ${id} details`);
  });

  // ---- open points ----
  (design.openPoints || []).forEach(o => {
    if (x[o.poleA] == null || x[o.poleB] == null) return;
    const ax = x[o.poleA], ay = y[o.poleA], bx = x[o.poleB], by = y[o.poleB];
    el(`op:${o.id}`, 'openPoint', { kind: 'openPoint', id: o.id }, [
      { k: 'line', x1: ax, y1: ay, x2: bx, y2: by, color: 'muted', width: 1.5, dash: [6, 5] },
      { k: 'text', x: (ax + bx) / 2, y: (ay + by) / 2 - 4, text: `open point ${o.id} (${o.spanM} m ${o.cond})`, size: 8, anchor: 'middle', color: 'muted' }
    ], `Open point ${o.id} between ${o.poleA} and ${o.poleB}`);
  });

  const maxDepth = Math.max(1, ...Object.values(depth));
  const width = SLD.BUS_X + maxDepth * COL + 4 * SLD.GROUP_W + SLD.MARGIN;
  const height = cursor + SLD.MARGIN;
  return { width, height, elements, positions: { x, y }, col: COL };
}

/** Small IEC-style marker for a drop: load (arrowhead), EV (arrowhead + bar), PV (square with a diagonal), BESS (battery plates). */
function markerPrims(kind, x0, yc, color) {
  if (kind === 'pv') return [{ k: 'rect', x: x0 - 3.5, y: yc - 3.5, w: 7, h: 7, color, width: 1 }, { k: 'line', x1: x0 - 3.5, y1: yc + 3.5, x2: x0 + 3.5, y2: yc - 3.5, color, width: 1 }];
  if (kind === 'bess') return [{ k: 'line', x1: x0 - 4, y1: yc - 2, x2: x0 + 4, y2: yc - 2, color, width: 1.6 }, { k: 'line', x1: x0 - 2, y1: yc + 2, x2: x0 + 2, y2: yc + 2, color, width: 1.6 }];
  const tri = { k: 'polygon', points: [[x0 - 3.5, yc - 3], [x0 + 3.5, yc - 3], [x0, yc + 3.5]], color, fill: color };
  return kind === 'ev' ? [tri, { k: 'line', x1: x0 - 4, y1: yc + 5, x2: x0 + 4, y2: yc + 5, color, width: 1 }] : [tri];
}

/** Every text and box an element draws, for hit-testing and label-overlap checks. */
export function elementBounds(e) {
  const xs = [], ys = [];
  e.prims.forEach(p => {
    if (p.k === 'line') { xs.push(p.x1, p.x2); ys.push(p.y1, p.y2); }
    else if (p.k === 'polyline' || p.k === 'polygon') p.points.forEach(([a, b]) => { xs.push(a); ys.push(b); });
    else if (p.k === 'rect') { xs.push(p.x, p.x + p.w); ys.push(p.y, p.y + p.h); }
    else if (p.k === 'circle' || p.k === 'arc') { xs.push(p.cx - p.r, p.cx + p.r); ys.push(p.cy - p.r, p.cy + p.r); }
    else if (p.k === 'text') { const w = textWidth(p); const x0 = p.anchor === 'middle' ? p.x - w / 2 : p.anchor === 'end' ? p.x - w : p.x; xs.push(x0, x0 + w); ys.push(p.y - p.size, p.y + 2); }
  });
  return { x: Math.min(...xs), y: Math.min(...ys), w: Math.max(...xs) - Math.min(...xs), h: Math.max(...ys) - Math.min(...ys) };
}

/** Approximate rendered width of a text primitive in the monospace diagram font (0.6 em per char). */
export function textWidth(p) { return String(p.text).length * p.size * 0.6; }

/** Conductor parameters for the side panel (kept here so the view needs only this module). */
export function spanDetails(design, poleId) {
  const p = poleById(design, poleId);
  return p ? { ...p, params: conductorParams(design, p.cond) } : null;
}
