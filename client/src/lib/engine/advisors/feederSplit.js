// @ts-check
// Feeder split advisor: where to cut a feeder (or two feeders at a common open point) and feed
// the tail from a new transformer.
import { poleById, bfsOrderFrom, isTransformerId, transformerOfPole, nextTransformerId, polePathDistanceM } from '../model.js';
import { scanAndSummarize, DAILY_HOURS } from '../scan.js';
/** @import { Design, Transformer } from '../types.js' */
/**
 * One pole's new attachment in a split plan. `parent` null/undefined = the new transformer.
 * @typedef {{ poleId: string, parent?: string | null, spanM: number, cond: string, feeder: string }} ReparentEntry
 */
/**
 * Where the new transformer sits relative to the candidate cut pole (see siteReparentPlan).
 * @typedef {{ mode: 'atSplit' | 'anchor' | 'manual', cond: string, anchor?: string, spanM?: number }} SiteSpec
 */
/** @typedef {{ name?: string, txRating: number, tap: number, hvActual: number, txXR?: number, txGroundOhms?: number }} TxSpec */

/* ============================================================
   FEEDER SPLIT ADVISOR
============================================================ */
// Applies a reparent plan — `reparents` is [{poleId, parent, spanM, cond, feeder}, ...], one
// entry per pole that needs a new parent (see siteReparentPlan/resolveSiteReparentPlan below for
// how a plan is built; a plain single-feeder split has one entry, a dual-feeder split has at
// least two, and a *reversed* attachment — see resolveSiteReparentPlan — has one entry per pole
// along the reversed segment). `parent` is either an explicit existing pole id (a reversed
// segment's internal edges always point at a real pole) or `null`/`undefined`, meaning "attach to
// the new transformer being added here" — resolved to `newTx.id` at build time rather than baked
// into the plan when it was computed, so a plan built during a search (with one newTx id) can
// still be re-applied later at Apply time (with a possibly different, freshly-allocated id)
// without going stale. Reused by every search below (to score each candidate) and by the page's
// preview/Apply actions (to commit the chosen one), so none of them can ever drift apart. Never
// mutates `design` or any pole object in place — every pole *not* named in the plan keeps
// referencing whatever parent it already had, so whole subtrees (and any side-branches off a
// reversed segment) follow their own parent automatically, without needing to be listed.
/** @param {Design} design @param {Transformer} newTx @param {ReparentEntry[]} reparents @returns {Design} */
export function buildSplitCandidate(design, newTx, reparents) {
  const next = {
    ...design,
    transformers: [...design.transformers, newTx],
    poles: design.poles.map(p => {
      const r = reparents.find(r => r.poleId === p.id);
      return r ? { ...p, parent: r.parent ?? newTx.id, spanM: Number(r.spanM) || 0, cond: r.cond, feeder: r.feeder } : p;
    })
  };
  // Everything downstream of an attach point (a plan entry hanging straight off the new
  // transformer) is now part of that new feeder too — give the whole moved subtree its feeder
  // name, not just the one reparented pole, so the Network page and diagram show the real
  // "new transformer's F1 runs P9 … P7" picture instead of leaving the tail labelled with its old
  // feeder.
  reparents.filter(r => r.parent == null).forEach(r => {
    const moved = new Set(bfsOrderFrom(next, [r.poleId]));
    next.poles = next.poles.map(p => (moved.has(p.id) ? { ...p, feeder: r.feeder } : p));
  });
  return next;
}

// All poles belonging to the same feeder tree as `anchorPoleId` — its own root pole(s) under its
// own specific transformer, then everything downstream. Deliberately scoped by the *exact*
// transformer id (`p.parent === tx`), not just a feeder-name string match against the whole
// design — two different transformers can easily end up with identically-named feeders (e.g. both
// habitually called "F1"), and matching by name alone would wrongly combine both into one
// candidate pool. Every split search below (single- and dual-feeder alike) is scoped this way —
// by a specific anchor pole, never a bare name — so a feeder name can be reused freely across
// transformers (as buildSplitCandidate's new-transformer "F1"/"F2" naming above now does) without
// ever risking two different transformers' trees being combined into one candidate pool.
/** @param {Design} design @param {string} anchorPoleId @returns {string[]} */
function feederPolesAnchoredAt(design, anchorPoleId) {
  const tx = transformerOfPole(design, anchorPoleId);
  const feederName = poleById(design, anchorPoleId).feeder;
  const roots = design.poles.filter(p => p.parent === tx && p.feeder === feederName).map(p => p.id);
  return bfsOrderFrom(design, roots);
}

// One entry per distinct (transformer, feeder name) tree in the design — the root pole id
// unambiguously identifies it, unlike a bare feeder name which two different transformers could
// share. This is what the single-feeder page's "feeder to split" picker is built from, instead of
// feederRoots(design)'s bare names, so picking a feeder can never accidentally resolve to a
// different transformer's identically-named one.
/** @param {Design} design @returns {{ rootPoleId: string, feederName: string, txId: string }[]} */
export function feederTrees(design) {
  const seen = new Set();
  const trees = [];
  design.poles.filter(p => isTransformerId(design, p.parent)).forEach(p => {
    const key = p.parent + '|' + p.feeder;
    if (seen.has(key)) return;
    seen.add(key);
    trees.push({ rootPoleId: p.id, feederName: p.feeder, txId: p.parent });
  });
  return trees;
}

// The feeder split point (where the *electrical* cut happens) and the new transformer's physical
// *site* are two independent decisions — the site doesn't have to be the split point, and it
// doesn't have to be upstream of it either. When the site is a fixed anchor pole that turns out to
// be *downstream* of the chosen split point (e.g. siting the transformer right at a common open
// point, while the best split point the search finds is a pole or two further back up the same
// feeder), simply "reparent the split point, connector length = distance to the site" is wrong:
// the site pole would still be dangling off the split point through its own original span, so the
// transformer would end up that span's length away from the site it's supposed to be sitting on,
// not on top of it. What's actually needed is to walk the segment between split point and site and
// *reverse* it — the site pole becomes the new local root (0m from the transformer, since it's
// physically right there), and every pole between it and the split point gets its parent pointer
// flipped (keeping its real original span/conductor — it's the same physical cable, just now
// carrying power the other way), leaving the split point itself — and anything above it, or any
// side-branch off the reversed segment that isn't on the direct path — exactly as it was, still
// fed from the original transformer. This is what resolveSiteReparentPlan below detects and
// builds; it degrades to the simple single-entry case whenever the site is upstream of (or
// unrelated to, e.g. on a different branch or transformer entirely) the split point.
/** @param {Design} design @param {string} splitPoleId @param {string} anchorPoleId @param {string} cond @param {string} feederName @returns {ReparentEntry[]} */
function resolveSiteReparentPlan(design, splitPoleId, anchorPoleId, cond, feederName) {
  if (anchorPoleId === splitPoleId) {
    return [{ poleId: splitPoleId, parent: null, spanM: 0, cond, feeder: feederName }];
  }
  // Walk up from the anchor; if we reach splitPoleId, the anchor is downstream of it (reversal
  // needed) and `chain` is [anchor, ..., splitPoleId]. If we run out of tree without matching, the
  // anchor is upstream of (or unrelated to) the split point — the ordinary, already-correct case.
  const chain = [anchorPoleId];
  let cur = anchorPoleId, reachedSplit = false;
  while (!isTransformerId(design, cur)) {
    cur = poleById(design, cur).parent;
    chain.push(cur);
    if (cur === splitPoleId) { reachedSplit = true; break; }
  }
  if (!reachedSplit) {
    return [{ poleId: splitPoleId, parent: null, spanM: polePathDistanceM(design, anchorPoleId, splitPoleId) || 0, cond, feeder: feederName }];
  }
  // Reparent every pole from just above the anchor all the way up to and *including* the split
  // point itself — "cut at the split point" means the split point and everything from it onward
  // relieves to the new transformer, same as the forward case (where the split point's whole
  // original subtree moves); here that just happens via the reversed path instead.
  const plan = [{ poleId: chain[0], parent: null, spanM: 0, cond, feeder: feederName }];
  for (let j = 1; j < chain.length; j++) {
    const original = poleById(design, chain[j - 1]); // the real cable that used to run chain[j-1] -> chain[j]
    plan.push({ poleId: chain[j], parent: chain[j - 1], spanM: original.spanM, cond: original.cond, feeder: feederName });
  }
  return plan;
}

// Resolves the full reparent plan for candidate split point `poleId` given a site spec:
//   - {mode:'atSplit'}            — the transformer sits directly on whichever pole gets cut;
//                                    always 0m, regardless of which candidate this is.
//   - {mode:'anchor', anchor}     — the transformer's site is a specific, fixed pole — see
//                                    resolveSiteReparentPlan above for why this can take more than
//                                    one entry. Used both for "at a specific pole" and "at a
//                                    common open point" (the anchor is just resolved differently
//                                    by the caller — the pole picked directly, or one side of an
//                                    open point).
//   - {mode:'manual', spanM}      — a flat, user-guessed length, unrelated to any real pole.
// The anchor must be supplied by the caller rather than re-derived here from e.g. an open point
// id — it's the caller that actually knows which side corresponds to which feeder/candidate set,
// so there's nothing left to guess or get wrong here.
/** @param {Design} design @param {string} poleId @param {SiteSpec} siteSpec @param {string} feederName @returns {ReparentEntry[]} */
function siteReparentPlan(design, poleId, siteSpec, feederName) {
  if (siteSpec.mode === 'atSplit') return [{ poleId, parent: null, spanM: 0, cond: siteSpec.cond, feeder: feederName }];
  if (siteSpec.mode === 'anchor') return resolveSiteReparentPlan(design, poleId, siteSpec.anchor, siteSpec.cond, feederName);
  return [{ poleId, parent: null, spanM: Number(siteSpec.spanM) || 0, cond: siteSpec.cond, feeder: feederName }];
}

// The "connector length" shown to the user for a candidate — the real distance between the site
// and the split point, regardless of which direction the resulting topology actually runs (a
// path's length doesn't depend on which way it's walked). For a reversed attachment this is
// mostly *existing* conductor being reused, not new cable — see resolveSiteReparentPlan.
/** @param {Design} design @param {string} poleId @param {SiteSpec} siteSpec @returns {number} */
function siteConnectorDisplayM(design, poleId, siteSpec) {
  if (siteSpec.mode === 'atSplit') return 0;
  if (siteSpec.mode === 'anchor') return polePathDistanceM(design, siteSpec.anchor, poleId) || 0;
  return Number(siteSpec.spanM) || 0;
}

/** @param {string} id @param {TxSpec} txSpec @returns {Transformer} */
function makeTx(id, txSpec) {
  return {
    id, name: txSpec.name || id, txRating: txSpec.txRating, tap: txSpec.tap,
    hvActual: txSpec.hvActual, txXR: txSpec.txXR, txGroundOhms: txSpec.txGroundOhms
  };
}

// Exactly scores one candidate cut pole for a single-feeder split against new transformer `newTx`
// (an id already allocated by the caller, so repeated calls in a loop agree on it) — one scan over
// `hours` (default: the full day; pass a single representative hour, with a matching `solarMult`,
// to test solar-peak or night-peak conditions only instead). Exported (alongside the batch
// convenience wrapper below) so a caller scanning a long feeder can chunk the loop itself
// (yielding between calls) instead of blocking the main thread for the whole search, the same way
// scoreDualFeederCandidate is meant to be used.
/** @param {Design} design @param {string} poleId @param {Transformer} newTx @param {SiteSpec} siteSpec @param {number[]} [hours] @param {number} [solarMult] */
export function scoreFeederSplitCandidate(design, poleId, newTx, siteSpec, hours = DAILY_HOURS, solarMult = 1) {
  const plan = siteReparentPlan(design, poleId, siteSpec, 'F1');
  const candidateDesign = buildSplitCandidate(design, newTx, plan);
  const metrics = scanAndSummarize(candidateDesign, hours, solarMult);
  // The plan's first entry is whichever pole actually attaches to the new transformer — the split
  // point itself in the ordinary case, or the site anchor when the attachment was reversed (see
  // resolveSiteReparentPlan) — so counting from there, in the *built* design, correctly reflects
  // the real moved subtree either way (side-branches included, since they simply keep pointing at
  // whichever plan pole they were already a child of).
  const movedPoleCount = bfsOrderFrom(candidateDesign, [plan[0].poleId]).length;
  const connectorM = siteConnectorDisplayM(design, poleId, siteSpec);
  return { poleId, connectorM, movedPoleCount, reparentPlan: plan, ...metrics };
}

// Scans every pole on the feeder tree anchored at `rootPoleId` (see feederPolesAnchoredAt — any
// pole on that specific (transformer, feeder-name) tree works, not necessarily its actual root)
// as a candidate cut point for a new transformer (spec `txSpec`), joined to each candidate by a
// connector cable per `siteSpec` (`{mode:'atSplit'}` — zero length, bolted directly to the cut
// pole; `{mode:'anchor', anchor, cond}` — length derived as the real path distance from a fixed
// pole, typically a specific pole picked directly or one side of a common open point;
// `{mode:'manual', spanM, cond}` — a flat guessed length), and ranks them primarily by how many
// statutory voltage violations remain over `hours` (default: the full day — see
// scoreFeederSplitCandidate for testing solar/night peak only instead; fewest violations first —
// eliminate if possible, minimize otherwise), tie-broken by total network loss over the same
// hours. Thermal and transformer-overload violations are scored too but don't affect the ranking —
// only voltage does. A synchronous convenience wrapper around scoreFeederSplitCandidate for the
// common case (a single feeder, short enough not to need chunking — see its page for the measured
// cost).
/** @param {Design} design @param {string} rootPoleId @param {TxSpec} txSpec @param {SiteSpec} siteSpec @param {number[]} [hours] @param {number} [solarMult] */
export function computeFeederSplitCandidates(design, rootPoleId, txSpec, siteSpec, hours = DAILY_HOURS, solarMult = 1) {
  const feederName = poleById(design, rootPoleId).feeder;
  const feederPoleIds = feederPolesAnchoredAt(design, rootPoleId);
  const newTxId = nextTransformerId(design);
  const newTx = makeTx(newTxId, txSpec);
  const baseline = scanAndSummarize(design, hours, solarMult);
  const candidates = feederPoleIds.map(poleId => scoreFeederSplitCandidate(design, poleId, newTx, siteSpec, hours, solarMult));
  candidates.sort((a, b) => a.voltageViolationCount - b.voltageViolationCount || a.lossKwh - b.lossKwh);
  return { feederName, newTxId, newTx, baseline, candidates };
}

// Relieving two feeders that meet at a common open point with one shared new transformer means
// testing every pole on feeder A paired with every pole on feeder B — but that full cross product
// needs a fresh 24-hour scan per pair, and is too slow to run synchronously for realistically
// long feeders (measured: ~40s for a 23×20-pole pairing, which would freeze the tab). So the dual
// search is staged, and every stage is left for the caller (the page) to run in a loop it can
// yield between, rather than done synchronously in one call here:
//
//   1. dualFeederSetup() resolves which two feeders meet at the open point and each side's full
//      candidate pole list (correctly scoped to its own transformer — see feederPolesAnchoredAt).
//   2. The caller scores every pole on each side independently with scoreFeederSplitCandidate
//      (one call per pole, yielding between), keeping only the top `k` from each side.
//   3. The caller then calls scoreDualFeederCandidate() — one exact, full-24h-scan joint
//      evaluation per pair — only across those shortlisted pairs (k², yielding between).
//
// This is an approximation only in *which* pairs get jointly tested in step 3; every candidate
// that is scored (at every stage) is scored exactly, never approximated.
/** @param {Design} design @param {string} openPointId @param {TxSpec} txSpec @param {string} cond */
export function dualFeederSetup(design, openPointId, txSpec, cond) {
  const op = design.openPoints.find(o => o.id === openPointId);
  const feederA = poleById(design, op.poleA).feeder, feederB = poleById(design, op.poleB).feeder;
  return {
    feederA, feederB,
    poleIdsA: feederPolesAnchoredAt(design, op.poleA),
    poleIdsB: feederPolesAnchoredAt(design, op.poleB),
    shortlistTx: makeTx(nextTransformerId(design), txSpec),
    siteSpecA: { mode: 'anchor', anchor: op.poleA, cond },
    siteSpecB: { mode: 'anchor', anchor: op.poleB, cond }
  };
}

// Exactly scores one (poleA, poleB) joint candidate for a dual-feeder split: cut both feeders
// that meet at `openPointId` and feed both tails from one shared new transformer `newTx` (an id
// already allocated by the caller, so repeated calls in a loop agree on it), each leg attached via
// resolveSiteReparentPlan — a plain connector when the open point's own pole is upstream of (or
// unrelated to) the chosen candidate, or a reversed segment when it's downstream (see that
// function's comment) — both using conductor `cond`. Passing the open point's own two poles as
// `poleA`/`poleB` scores placing the new transformer directly at the open point itself — both
// legs resolve to a single 0m entry automatically (anchor === candidate) — no separate "place at
// open point" logic needed. `hours`/`solarMult` — see scoreFeederSplitCandidate — test the full
// day by default, or pass a single representative hour for solar/night-peak-only testing.
/** @param {Design} design @param {string} poleA @param {string} poleB @param {string} openPointId @param {Transformer} newTx @param {string} cond @param {number[]} [hours] @param {number} [solarMult] */
export function scoreDualFeederCandidate(design, poleA, poleB, openPointId, newTx, cond, hours = DAILY_HOURS, solarMult = 1) {
  const op = design.openPoints.find(o => o.id === openPointId);
  const connectorAM = polePathDistanceM(design, op.poleA, poleA) || 0;
  const connectorBM = polePathDistanceM(design, op.poleB, poleB) || 0;
  const planA = resolveSiteReparentPlan(design, poleA, op.poleA, cond, 'F1');
  const planB = resolveSiteReparentPlan(design, poleB, op.poleB, cond, 'F2');
  const reparentPlan = [...planA, ...planB];
  const candidateDesign = buildSplitCandidate(design, newTx, reparentPlan);
  const metrics = scanAndSummarize(candidateDesign, hours, solarMult);
  return {
    poleA, connectorAM, movedPoleCountA: bfsOrderFrom(candidateDesign, [planA[0].poleId]).length,
    poleB, connectorBM, movedPoleCountB: bfsOrderFrom(candidateDesign, [planB[0].poleId]).length,
    reparentPlan,
    ...metrics
  };
}
