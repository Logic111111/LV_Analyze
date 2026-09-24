import { bfsOrder, children, poleById, isTransformerId, PHASES, feederConnectedTotals } from './loadflow.js';

function esc(v) { return String(v).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c])); }

export function layoutNetwork(design) {
  const order = bfsOrder(design);
  const depth = {}; order.forEach(id => { const par = poleById(design, id).parent; depth[id] = isTransformerId(design, par) ? 1 : depth[par] + 1; });
  const kids = {}; order.forEach(id => kids[id] = children(design, id));
  const y = {}; let slot = 0;
  const LEAF_GAP = 64;
  function assign(id) {
    const ch = kids[id];
    if (ch.length === 0) { y[id] = slot * LEAF_GAP; slot++; }
    else { ch.forEach(assign); const ys = ch.map(c => y[c]); y[id] = (Math.min(...ys) + Math.max(...ys)) / 2; }
  }
  const txPos = {};
  design.transformers.forEach((tx, ti) => {
    const roots = design.poles.filter(p => p.parent === tx.id).map(p => p.id);
    roots.forEach((r, i) => { assign(r); if (i < roots.length - 1) slot += 1; });
    const yTx = roots.length ? (Math.min(...roots.map(r => y[r])) + Math.max(...roots.map(r => y[r]))) / 2 : slot * LEAF_GAP;
    if (roots.length === 0) slot++;
    txPos[tx.id] = { x: 40, y: yTx + 40 };
    if (ti < design.transformers.length - 1) slot += 2;
  });
  const COL = 150;
  const x = {}; order.forEach(id => x[id] = 150 + depth[id] * COL);
  const maxDepth = Math.max(1, ...order.map(id => depth[id]));
  const width = 150 + (maxDepth + 1) * COL;
  const height = Math.max(200, slot * LEAF_GAP + 80);
  return { order, x, y, txPos, yOffset: 40, width, height, depth };
}

function statusColor(pr, res) {
  let worst = 0;
  PHASES.forEach(ph => {
    const v = pr.volt[ph];
    if (v < res.vLimLow || v > res.vLimHigh) worst = 2;
    else if (worst < 1 && (v < res.vLimLow * 1.01 || v > res.vLimHigh * 0.99)) worst = 1;
    if (pr.condPct[ph] > 100) worst = 2;
  });
  return worst === 2 ? '#DC2626' : worst === 1 ? '#D97706' : '#16A34A';
}
function loadingColor(pr) {
  const m = Math.max(pr.condPct.A, pr.condPct.B, pr.condPct.C);
  return m > 100 ? '#DC2626' : m > 85 ? '#D97706' : '#0D9488';
}

// The SVG is a plain string (not styled via CSS custom properties), so its panel/text colours
// are picked here to track the app's two themes explicitly.
const DIAGRAM_PALETTES = {
  light: { nodeFill: '#FFFFFF', text: '#17202E', muted: '#5B6B85', phase: { A: '#C2410C', B: '#2563EB', C: '#15803D' } },
  dark: { nodeFill: '#121B2E', text: '#DCE6F5', muted: '#7F94B5', phase: { A: '#FF9B71', B: '#4F8CFF', C: '#4FD98A' } }
};

export function buildDiagramSVG(design, res, theme = 'light') {
  const pal = DIAGRAM_PALETTES[theme] || DIAGRAM_PALETTES.light;
  const L = layoutNetwork(design);
  const poleMap = {}; res.poleResults.forEach(p => poleMap[p.id] = p);
  const txMap = {}; res.transformers.forEach(t => txMap[t.id] = t);
  const feederGroups = feederConnectedTotals(design);
  const groupOfRoot = {}; feederGroups.forEach(g => g.roots.forEach(r => { groupOfRoot[r] = g; }));
  const feederLabelShown = new Set(); // one label per feeder, even if it has multiple root poles

  let defs = `<defs>
    ${['ok', 'warn', 'bad'].map(k => {
      const c = k === 'ok' ? '#0D9488' : k === 'warn' ? '#D97706' : '#DC2626';
      return `<marker id="arrow-${k}" viewBox="0 0 10 10" refX="8" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse"><path d="M0,0 L10,5 L0,10 z" fill="${c}"/></marker>`;
    }).join('')}
  </defs>`;

  let edges = '', nodes = '';
  design.transformers.forEach(tx => {
    const tr = txMap[tx.id];
    const txExporting = tr.flowDirection === 'export';
    const txColor = txExporting ? '#0D9488' : (tr.txPct > 100 ? '#DC2626' : tr.txPct > 85 ? '#D97706' : '#0D9488');
    const txX = L.txPos[tx.id].x, txY = L.txPos[tx.id].y;
    nodes += `<g><rect x="${txX - 38}" y="${txY - 26}" width="76" height="52" rx="10" fill="${pal.nodeFill}" stroke="${txColor}" stroke-width="2"/>
      <text x="${txX}" y="${txY - 6}" text-anchor="middle" fill="${pal.text}" font-family="IBM Plex Mono, monospace" font-size="11" font-weight="600">${tx.name || tx.id}</text>
      <text x="${txX}" y="${txY + 9}" text-anchor="middle" fill="${txColor}" font-family="IBM Plex Mono, monospace" font-size="10">${tx.txRating}kVA</text>
      <text x="${txX}" y="${txY + 22}" text-anchor="middle" fill="${pal.muted}" font-family="IBM Plex Mono, monospace" font-size="9">${txExporting ? 'EXPORT' : 'IMPORT'} ${tr.txPct.toFixed(0)}%</text>
      <title>Transformer ${tx.name || tx.id}: ${tx.txRating} kVA, tap ${tx.tap}
Loading: ${tr.txPct.toFixed(1)}% (${tr.flowDirection})
Net: ${tr.netKW.toFixed(1)} kW
LV bus: A=${tr.busVoltPct.A.toFixed(1)}V B=${tr.busVoltPct.B.toFixed(1)}V C=${tr.busVoltPct.C.toFixed(1)}V</title>
    </g>`;
  });

  L.order.forEach(id => {
    const p = poleById(design, id); const pr = poleMap[id];
    const parentIsTx = isTransformerId(design, p.parent);
    const parentX = parentIsTx ? L.txPos[p.parent].x : L.x[p.parent];
    const parentY = parentIsTx ? L.txPos[p.parent].y : (L.y[p.parent] + L.yOffset);
    const cx = L.x[id], cy = L.y[id] + L.yOffset;
    const exportingSpan = pr.flowKW < 0;
    const lc = loadingColor(pr);
    const maxPct = Math.max(pr.condPct.A, pr.condPct.B, pr.condPct.C);
    const markerId = maxPct > 100 ? 'bad' : maxPct > 85 ? 'warn' : 'ok';
    const [ax1, ay1, ax2, ay2] = exportingSpan ? [cx, cy, parentX, parentY] : [parentX, parentY, cx, cy];
    edges += `<line x1="${ax1}" y1="${ay1}" x2="${ax2}" y2="${ay2}" stroke="${lc}" stroke-width="2.5" marker-end="url(#arrow-${markerId})"/>
      <text x="${(parentX + cx) / 2}" y="${(parentY + cy) / 2 - 6}" text-anchor="middle" fill="${pal.muted}" font-family="IBM Plex Mono, monospace" font-size="8.5">${Math.abs(pr.flowKW).toFixed(1)}kW · ${p.spanM}m ${p.cond}</text>`;
    // Feeder-wide connected load, per phase — shown once per feeder, on its first root span
    // (right where it leaves the transformer), so the phase imbalance driving everything
    // downstream is visible at a glance without having to add up every pole's own connections.
    // Grouped by the real feeder tree (transformer + feeder name + everything downstream), not the
    // bare name, so a split's new "F1" and the original transformer's "F1" each get their own label
    // with their own totals. Connected solar PV (nameplate kVA per phase) sits on the line above.
    const grp = parentIsTx ? groupOfRoot[id] : null;
    if (grp && !feederLabelShown.has(grp.key)) {
      feederLabelShown.add(grp.key);
      const line = (label, t, dy) => `<text x="${(parentX + cx) / 2}" y="${(parentY + cy) / 2 - dy}" text-anchor="middle" font-family="IBM Plex Mono, monospace" font-size="8.5" font-weight="600">` +
        `<tspan fill="${pal.text}">${esc(grp.feederName)} ${label}: </tspan>` +
        `<tspan fill="${pal.phase.A}">A ${t.A.toFixed(1)}</tspan><tspan fill="${pal.muted}"> / </tspan>` +
        `<tspan fill="${pal.phase.B}">B ${t.B.toFixed(1)}</tspan><tspan fill="${pal.muted}"> / </tspan>` +
        `<tspan fill="${pal.phase.C}">C ${t.C.toFixed(1)}</tspan><tspan fill="${pal.muted}"> kVA</tspan></text>`;
      edges += line('load', grp.load, 16) + line('PV', grp.pv, 26);
    }

    const sc = statusColor(pr, res);
    const loads = design.loads.filter(l => l.pole === id);
    const pvs = design.pv.filter(v => v.pole === id);
    const bessConns = design.bess.filter(b => b.pole === id);
    const loadBadge = loads.length ? `${loads.length}L` : '';
    const pvBadge = pvs.length ? `${pvs.length}PV` : '';
    const bessBadge = bessConns.length ? `${bessConns.length}BESS` : '';
    // Per-phase voltage, stacked directly under the pole number (not off to the side, which
    // collided with the span label and the load/PV/BESS badge) so an unbalanced network's worst
    // phase is identifiable at a glance without depending on the single worst-of-three figure
    // this used to show, and without overlapping the other per-pole data below it.
    const phaseLines = PHASES.map((ph, i) => {
      const bad = pr.volt[ph] < res.vLimLow || pr.volt[ph] > res.vLimHigh;
      return `<text x="${cx}" y="${cy - 5 + i * 9}" text-anchor="middle" fill="${pal.phase[ph]}" font-family="IBM Plex Mono, monospace" font-size="8" font-weight="${bad ? '700' : '400'}">${ph} ${pr.volt[ph].toFixed(1)}V</text>`;
    }).join('');
    // Standard schematic earth-ground symbol (stem + three descending bars), drawn in plain SVG
    // lines like the rest of this diagram — placed right of the circle, the one spot with
    // nothing else nearby (span labels sit to the left, badges/phase voltages stay centered).
    const groundMark = p.grounded ? `
      <line x1="${cx + 26}" y1="${cy - 8}" x2="${cx + 26}" y2="${cy}" stroke="${pal.muted}" stroke-width="1.5"/>
      <line x1="${cx + 20}" y1="${cy}" x2="${cx + 32}" y2="${cy}" stroke="${pal.muted}" stroke-width="1.5"/>
      <line x1="${cx + 22}" y1="${cy + 3}" x2="${cx + 30}" y2="${cy + 3}" stroke="${pal.muted}" stroke-width="1.5"/>
      <line x1="${cx + 24}" y1="${cy + 6}" x2="${cx + 28}" y2="${cy + 6}" stroke="${pal.muted}" stroke-width="1.5"/>` : '';
    nodes += `<g>
      <circle cx="${cx}" cy="${cy}" r="20" fill="${pal.nodeFill}" stroke="${sc}" stroke-width="2.5"/>
      <text x="${cx}" y="${cy - 16}" text-anchor="middle" fill="${pal.text}" font-family="IBM Plex Mono, monospace" font-size="10" font-weight="600">${id}</text>
      ${phaseLines}
      ${(loadBadge || pvBadge || bessBadge) ? `<text x="${cx}" y="${cy + 25}" text-anchor="middle" fill="${pal.muted}" font-family="IBM Plex Mono, monospace" font-size="8.5">${[loadBadge, pvBadge, bessBadge].filter(Boolean).join(' · ')}</text>` : ''}
      ${groundMark}
      <title>${id} (feeder ${p.feeder})
Voltage: A=${pr.volt.A.toFixed(1)}V  B=${pr.volt.B.toFixed(1)}V  C=${pr.volt.C.toFixed(1)}V
Current: A=${pr.cur.A.toFixed(1)}A  B=${pr.cur.B.toFixed(1)}A  C=${pr.cur.C.toFixed(1)}A  (rating ${pr.rating}A, ${p.cond})
Span power flow: ${pr.flowKW.toFixed(2)} kW ${exportingSpan ? '(reverse, toward TX)' : '(toward pole)'}
${p.grounded ? `Neutral grounded here: Rg=${p.groundOhms}Ω\n` : ''}Connections: ${loads.map(l => `${l.type} ${l.phase} ${l.kva == null ? 'ADMD' : l.kva + 'kVA'}`).join(', ') || 'none'}
Solar PV: ${pvs.map(v => `${v.phase} ${v.kva}kVA`).join(', ') || 'none'}
BESS: ${bessConns.map(b => `${b.phase} ${b.kva}kVA`).join(', ') || 'none'}</title>
    </g>`;
  });

  // Common open points: a normally-open tie between two poles, carrying no current and affecting
  // no result — drawn as a dashed line straight across the diagram (it may well cross other spans,
  // since the two poles it joins can be anywhere, even under different transformers) so it's
  // visible as a real, known reference point without being mistaken for a live, loaded span.
  design.openPoints.forEach(o => {
    const ax = L.x[o.poleA], ay = L.y[o.poleA] + L.yOffset;
    const bx = L.x[o.poleB], by = L.y[o.poleB] + L.yOffset;
    if (ax == null || bx == null) return;
    edges += `<line x1="${ax}" y1="${ay}" x2="${bx}" y2="${by}" stroke="${pal.muted}" stroke-width="1.5" stroke-dasharray="6,5"/>
      <text x="${(ax + bx) / 2}" y="${(ay + by) / 2 - 4}" text-anchor="middle" fill="${pal.muted}" font-family="IBM Plex Mono, monospace" font-size="8">⊟ open point (${o.spanM}m ${o.cond})</text>`;
  });

  const totalW = L.width, totalH = Math.max(L.height, 200);
  return `<svg viewBox="0 0 ${totalW} ${totalH}" width="100%" style="min-width:${Math.min(totalW, 900)}px" xmlns="http://www.w3.org/2000/svg">${defs}${edges}${nodes}</svg>`;
}
