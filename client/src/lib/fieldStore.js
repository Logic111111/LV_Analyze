// Field survey storage on the phone (P7.8): designs downloaded for offline use, and the outbox of
// survey records waiting to sync. Kept in localStorage under the signed-in user's id (a few
// designs of a few hundred kB fit comfortably), and never cleared on sign-out — an unsynced record
// is field work that would otherwise be lost. The state functions are pure (state in, state out),
// so they are tested without a browser.
//
// A record remembers the design version it was made on (baseVersion); the server compares that
// version with the current one to detect conflicts (engine fieldSurvey.js).

/** @typedef {{ designId: number, baseVersion: number, kind: 'load' | 'pv' | 'bess', id: string, observedPhase?: string | null, meterId?: string | null, note?: string | null, photoRef?: string | null, recordedAt: string, force?: boolean, conflict?: any }} OutboxRecord */
/** @typedef {{ designs: Record<string, { designId: number, name: string, version: number, design: any, downloadedAt: string }>, outbox: OutboxRecord[] }} FieldState */

const KEY = (userId) => `fi.field.${userId}`;
export const emptyFieldState = () => /** @type {FieldState} */ ({ designs: {}, outbox: [] });

/** @param {any} userId @param {Storage} [storage] @returns {FieldState} */
export function loadFieldState(userId, storage = globalThis.localStorage) {
  try {
    const v = JSON.parse(storage.getItem(KEY(userId)) || 'null');
    return v && typeof v === 'object' && v.designs && Array.isArray(v.outbox) ? v : emptyFieldState();
  } catch { return emptyFieldState(); }
}
/** @param {any} userId @param {FieldState} state @param {Storage} [storage] @returns {string | null} an error message if it couldn't be stored */
export function saveFieldState(userId, state, storage = globalThis.localStorage) {
  try { storage.setItem(KEY(userId), JSON.stringify(state)); return null; }
  catch (e) { return 'This device could not store the survey (storage full or blocked): ' + (e && e.message); }
}

/** @param {FieldState} s @param {number} designId @param {string} name @param {number} version @param {any} design @param {string} [at] */
export function withDesignCopy(s, designId, name, version, design, at = new Date().toISOString()) {
  return { ...s, designs: { ...s.designs, [designId]: { designId, name, version, design, downloadedAt: at } } };
}
/** Removes a design copy (its pending records stay unless `dropRecords`). @param {FieldState} s @param {number} designId */
export function withoutDesignCopy(s, designId, dropRecords = false) {
  const designs = { ...s.designs }; delete designs[designId];
  return { designs, outbox: dropRecords ? s.outbox.filter(r => r.designId !== designId) : s.outbox };
}

const same = (r, designId, kind, id) => r.designId === designId && r.kind === kind && r.id === id;

/** Adds or updates the record for one connection. @param {FieldState} s @param {OutboxRecord} rec */
export function withRecord(s, rec) {
  const rest = s.outbox.filter(r => !same(r, rec.designId, rec.kind, rec.id));
  const prev = s.outbox.find(r => same(r, rec.designId, rec.kind, rec.id));
  const merged = { ...(prev || {}), ...rec };
  delete merged.conflict; delete merged.force;
  return { ...s, outbox: [...rest, merged] };
}
/** @param {FieldState} s @param {number} designId @param {string} kind @param {string} id */
export function withoutRecord(s, designId, kind, id) { return { ...s, outbox: s.outbox.filter(r => !same(r, designId, kind, id)) }; }
/** Marks a conflicted record to be sent anyway. @param {FieldState} s @param {number} designId @param {string} kind @param {string} id */
export function withForced(s, designId, kind, id) {
  return { ...s, outbox: s.outbox.map(r => (same(r, designId, kind, id) ? { ...r, force: true, conflict: undefined } : r)) };
}

/** The design's pending records grouped by the version they were made on — one sync request each. @param {FieldState} s @param {number} designId */
export function syncGroups(s, designId) {
  const groups = new Map();
  s.outbox.filter(r => r.designId === designId && !r.conflict).forEach(r => {
    const g = groups.get(r.baseVersion) || [];
    g.push({ kind: r.kind, id: r.id, observedPhase: r.observedPhase ?? null, meterId: r.meterId ?? null, note: r.note ?? null, photoRef: r.photoRef ?? null, recordedAt: r.recordedAt, ...(r.force ? { force: true } : {}) });
    groups.set(r.baseVersion, g);
  });
  return [...groups.entries()].sort((a, b) => a[0] - b[0]).map(([baseVersion, records]) => ({ baseVersion, records }));
}

/** Applies a sync response: applied records leave the outbox, conflicts stay, marked. @param {FieldState} s @param {number} designId @param {{ applied: { kind: string, id: string }[], conflicts: any[] }} result */
export function afterSync(s, designId, result) {
  const applied = new Set(result.applied.map(a => `${a.kind}:${a.id}`));
  const conflicts = new Map(result.conflicts.map(c => [`${c.kind}:${c.id}`, c]));
  return {
    ...s,
    outbox: s.outbox.filter(r => !(r.designId === designId && applied.has(`${r.kind}:${r.id}`)))
      .map(r => (r.designId === designId && conflicts.has(`${r.kind}:${r.id}`) ? { ...r, conflict: conflicts.get(`${r.kind}:${r.id}`), force: false } : r))
  };
}
