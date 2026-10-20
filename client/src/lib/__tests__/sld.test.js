import { describe, it, expect } from 'vitest';
import { runSnapshot, faultLevels, proposePhaseBalance, applyPhaseBalance, applyReconductor, buildSplitCandidate, computeFeederSplitCandidates } from '../loadflow.js';
import { buildSldScene, elementBounds, textWidth } from '../sld/scene.js';
import { sceneToSvg } from '../sld/svg.js';
import { sceneToDxf } from '../sld/dxf.js';
import { walkthroughIsland } from './fixtures/walkthroughIsland.js';
import { syntheticFeeder } from './fixtures/syntheticFeeder.js';

// P5.1 — single-line diagram scene, SVG and DXF.

const snap = (d) => runSnapshot(d, { year: 0, hour: 20, solarMult: 0 });
const ofType = (scene, t) => scene.elements.filter(e => e.type === t);

/** Pairs of text labels from different elements whose boxes overlap. */
function textCollisions(scene) {
  const boxes = [];
  scene.elements.forEach(e => e.prims.forEach(p => {
    if (p.k !== 'text') return;
    const w = textWidth(p), x0 = p.anchor === 'middle' ? p.x - w / 2 : p.anchor === 'end' ? p.x - w : p.x;
    boxes.push({ id: e.id, text: p.text, x0, x1: x0 + w, y0: p.y - p.size * 0.8, y1: p.y });
  }));
  const hits = [];
  for (let i = 0; i < boxes.length; i++) for (let j = i + 1; j < boxes.length; j++) {
    const a = boxes[i], b = boxes[j];
    if (a.id === b.id) continue;
    if (a.x0 < b.x1 - 0.5 && b.x0 < a.x1 - 0.5 && a.y0 < b.y1 - 0.5 && b.y0 < a.y1 - 0.5) hits.push(`${a.id} "${a.text}" × ${b.id} "${b.text}"`);
  }
  return hits;
}

describe('SLD scene', () => {
  const d = walkthroughIsland();
  const res = snap(d);
  const scene = buildSldScene(d, res);

  it('draws every element of the network once', () => {
    expect(ofType(scene, 'source')).toHaveLength(1);
    expect(ofType(scene, 'transformer')).toHaveLength(1);
    expect(ofType(scene, 'busbar')).toHaveLength(1);
    expect(ofType(scene, 'fuse')).toHaveLength(new Set(d.poles.filter(p => p.parent === 'TX').map(p => p.feeder)).size);
    expect(ofType(scene, 'span')).toHaveLength(d.poles.length);
    expect(ofType(scene, 'pole')).toHaveLength(d.poles.length);
    expect(ofType(scene, 'drop')).toHaveLength(d.loads.length + d.pv.length + d.bess.length);
    expect(ofType(scene, 'ghost')).toHaveLength(0);
  });

  it('labels every drop with its phase letter, and offers all three phases as drop zones', () => {
    ofType(scene, 'drop').forEach(e => {
      const t = e.prims.find(p => p.k === 'text').text;
      expect(t.startsWith(e.ref.phase === 'ABC' ? '3φ' : e.ref.phase)).toBe(true);
    });
    d.poles.forEach(p => ['A', 'B', 'C'].forEach(ph => expect(scene.elements.some(e => e.id === `zone:${p.id}:${ph}`)).toBe(true)));
  });

  it('marks statutory violations by status token and shows the transformer as Dyn11 with its tap', () => {
    const p3 = scene.elements.find(e => e.id === 'pole:P3');
    expect(p3.prims[0].color).toBe('bad'); // P3 A is 212.9 V at 20:00
    const tx = scene.elements.find(e => e.type === 'transformer');
    expect(tx.prims.filter(p => p.k === 'circle')).toHaveLength(2);
    expect(tx.prims.some(p => p.k === 'text' && p.text.includes('Dyn11') && p.text.includes('tap 2'))).toBe(true);
  });

  it.each([
    ['fixture', () => walkthroughIsland()],
    ['50-pole feeder', () => syntheticFeeder()]
  ])('%s: no two labels collide, with every overlay on', (_n, build) => {
    const dd = build();
    const s = buildSldScene(dd, snap(dd), { overlays: { voltage: true, loading: true, flow: true, vuf: true, fault: true }, faults: faultLevels(dd) });
    expect(textCollisions(s)).toEqual([]);
    s.elements.forEach(e => { const b = elementBounds(e); expect(b.x).toBeGreaterThanOrEqual(0); expect(b.x + b.w).toBeLessThanOrEqual(s.width + 1); });
  });

  it('fault and VUF overlays add per-pole lines', () => {
    const s = buildSldScene(d, res, { overlays: { vuf: true, fault: true }, faults: faultLevels(d) });
    const info = s.elements.find(e => e.id === 'info:P3');
    expect(info.prims.map(p => p.text).join(' ')).toMatch(/VUF 1\.\d\d %.*Ik3 .* kA · Ik1 .* kA/);
  });
});

describe('before/after mode', () => {
  it('phase balance: a ghost and an arrow for every moved connection', () => {
    const before = walkthroughIsland();
    const changed = proposePhaseBalance(before, 'TX').changed;
    const after = applyPhaseBalance(before, changed);
    const s = buildSldScene(after, snap(after), { compareTo: before });
    expect(ofType(s, 'ghost')).toHaveLength(changed.length);
    expect(ofType(s, 'move')).toHaveLength(changed.length);
    const moved = s.elements.find(e => e.id === `conn:${changed[0].kind}:${changed[0].id}`);
    expect(moved.prims.some(p => p.k === 'rect' && p.color === 'accent')).toBe(true);
  });

  it('tap change annotated; upgraded span drawn thicker with old→new conductor', () => {
    const before = walkthroughIsland();
    const after = applyReconductor({ ...before, transformers: before.transformers.map(t => ({ ...t, tap: 3 })) }, [{ pole: 'P3', to: '70ABC' }]);
    const s = buildSldScene(after, snap(after), { compareTo: before });
    const tx = s.elements.find(e => e.type === 'transformer');
    expect(tx.prims.some(p => p.k === 'text' && p.text === 'tap 2 → 3')).toBe(true);
    const span = s.elements.find(e => e.id === 'span:P3');
    expect(span.prims[0].width).toBe(5);
    expect(span.prims.some(p => p.k === 'text' && p.text.includes('50ABC→70ABC'))).toBe(true);
  });

  it('feeder split: the new transformer is dashed', () => {
    const before = walkthroughIsland();
    const r = computeFeederSplitCandidates(before, 'P1', { txRating: 100, tap: 2, hvActual: 10800, txXR: 3, txGroundOhms: 7.5 }, { mode: 'atSplit', cond: '70ABC' }, [20], 0);
    const after = buildSplitCandidate(before, r.newTx, r.candidates[0].reparentPlan);
    const s = buildSldScene(after, snap(after), { compareTo: before });
    const txs = ofType(s, 'transformer');
    expect(txs).toHaveLength(2);
    const added = txs.find(e => e.ref.id === r.newTx.id);
    expect(added.prims.filter(p => p.k === 'circle').every(p => Array.isArray(p.dash))).toBe(true);
  });
});

describe('exports', () => {
  const d = walkthroughIsland();
  const scene = buildSldScene(d, snap(d));

  it('SVG: one group per element, and the title block with sign-off fields', () => {
    const svg = sceneToSvg(scene, { titleBlock: { name: 'Walkthrough Island', date: '2026-10-20', snapshot: 'year 0, 20:00', prepared: 'A. Engineer' } });
    expect(svg.startsWith('<svg')).toBe(true);
    expect((svg.match(/<g data-id=/g) || []).length).toBe(scene.elements.length);
    ['DESIGN / SNAPSHOT', 'PREPARED / CHECKED', 'APPROVED', 'A. Engineer', '2026-10-20'].forEach(t => expect(svg).toContain(t));
  });

  it('DXF R12: valid section structure, one layer per element type, y flipped', () => {
    const dxf = sceneToDxf(scene);
    const codes = dxf.split('\r\n');
    expect(codes.slice(0, 4)).toEqual(['0', 'SECTION', '2', 'HEADER']);
    expect(dxf).toContain('$ACADVER\r\n1\r\nAC1009');
    expect(codes.slice(-3)).toEqual(['0', 'EOF', '']);
    expect(codes.length % 2).toBe(1); // code/value pairs plus the trailing empty line
    ['TRANSFORMER', 'LV_BUSBAR', 'SPAN', 'POLE', 'DROP_A', 'HV_SOURCE', 'FUSE'].forEach(l => expect(dxf).toContain(`LAYER\r\n2\r\n${l}\r\n`));
    const texts = scene.elements.reduce((n, e) => n + e.prims.filter(p => p.k === 'text').length, 0);
    let ents = 0; for (let i = 0; i < codes.length - 1; i += 2) if (codes[i] === '0' && codes[i + 1] === 'TEXT') ents++;
    expect(ents).toBe(texts);
    // The pole P1 label (top of the drawing, small y) lands near the top in DXF coordinates.
    const p1 = scene.elements.find(e => e.id === 'pole:P1').prims.find(p => p.k === 'text');
    const at = codes.findIndex((c, i) => c === '1' && codes[i + 1] === 'P1' && i % 2 === 0);
    expect(Number(codes[at - 5])).toBeCloseTo(scene.height - p1.y, 2);
    expect([...dxf].every(ch => ch.charCodeAt(0) < 128)).toBe(true); // ASCII only
  });
});

describe('report upgrade (P5.9)', () => {
  it('has a table of contents, the SLD, sign-off, scenarios and Monte Carlo sections, and print CSS', async () => {
    const { buildReportHtml } = await import('../report.js');
    const { monteCarloStudy, compareScenarios, CURRENT_DESIGN_SCENARIO } = await import('../loadflow.js');
    const d = { ...walkthroughIsland(), signOff: { prepared: 'A. Engineer', preparedDate: '2026-10-21', checked: '', approved: '' }, logo: 'data:image/png;base64,iVBORw0KGgo=' };
    const res = snap(d);
    const html = buildReportHtml(d, res, null, null, null, {
      scenarios: compareScenarios(d, [CURRENT_DESIGN_SCENARIO]),
      monteCarlo: monteCarloStudy(d, { evPct: 20, evSizes: [{ kva: 7, weight: 1 }], runs: 5, hours: [20] })
    });
    ['class="toc"', 'id="s-single-line-diagram"', '<svg', 'A. Engineer', 'Signature', 'id="s-scenarios-comparison"', 'Probability of any violation', '@page{size:A4', 'thead{display:table-header-group}', 'class="logo"', 'Economics not set'].forEach(t => expect(html).toContain(t));
    // A logo that isn't a plain base64 image data URL is dropped.
    expect(buildReportHtml({ ...d, logo: 'javascript:alert(1)' }, res, null, null, null)).not.toContain('class="logo"');
  });
});
