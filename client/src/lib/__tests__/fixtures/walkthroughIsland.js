import { defaultDesign } from '../../loadflow.js';

// The "Walkthrough Island" design reproduced by the hand-calculation workbook — the golden fixture
// every Phase 0 test is pinned to. Built from defaultDesign() rather than stored as JSON so it
// tracks the same defaults the app ships with. Connection order matters: load-balance ties follow
// list order, so the appended loads must stay in exactly this sequence (L7–L11 on P2, L12–L17 on
// P3, L18 the 7 kVA EV on P3).
export function walkthroughIsland() {
  const d = defaultDesign();
  d.name = 'Walkthrough Island';
  d.transformers = [{ ...d.transformers[0], txRating: 100, hvActual: 10800 }];
  d.poles = d.poles.map(p => (p.id === 'P2' || p.id === 'P3') ? { ...p, spanM: 60 } : p);
  let n = d.loads.length;
  for (let i = 0; i < 5; i++) d.loads.push({ id: 'L' + (++n), pole: 'P2', type: 'general', phase: 'A', kva: null });
  for (let i = 0; i < 6; i++) d.loads.push({ id: 'L' + (++n), pole: 'P3', type: 'general', phase: 'A', kva: null });
  d.loads.push({ id: 'L' + (++n), pole: 'P3', type: 'ev', phase: 'A', kva: 7 });
  return d;
}
// "Balanced" = applyPhaseBalance(d, proposePhaseBalance(d, 'TX').changed)
