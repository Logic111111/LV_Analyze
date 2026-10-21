// @ts-check
// Field survey (P7.8): what a surveyor records at a pole — each customer connection's observed
// phase and meter ID, with a note or a photo reference — and how those records are merged into the
// design when the phone is back online.
//
// Records are made against the version of the design the phone downloaded (the *base* version).
// By the time they sync, someone may have saved newer versions. A record is applied when its
// connection still exists and none of the fields a surveyor can change (pole, phase, meter ID)
// differ between the base version and the current one — the surveyor saw the same thing the
// designer has now. Otherwise it is a conflict, returned with the current values so the surveyor
// can resend it deliberately (`force`) or drop it. Pure: the server and the client run the same code.
/** @import { Design, Phase } from './types.js' */

/** Phases a surveyor can record ('ABC' for a three-phase connection). */
export const FIELD_PHASES = /** @type {const} */ (['A', 'B', 'C', 'ABC']);
const KINDS = /** @type {const} */ ({ load: 'loads', pv: 'pv', bess: 'bess' });
const TEXT_MAX = 200;
const COMPARED = ['pole', 'phase', 'meterId'];

/**
 * @typedef {object} FieldRecord
 * @property {'load' | 'pv' | 'bess'} kind
 * @property {string} id
 * @property {'A' | 'B' | 'C' | 'ABC' | null} [observedPhase] null/absent = not checked
 * @property {string | null} [meterId]
 * @property {string | null} [note]
 * @property {string | null} [photoRef] e.g. the photo's file name on the phone
 * @property {string} [recordedAt] ISO time on the phone
 * @property {boolean} [force] apply even if the connection changed since the base version
 */
/**
 * @typedef {{ kind: FieldRecord['kind'], id: string, reason: 'removed' | 'changed', server: { pole?: string, phase?: string, meterId?: string | null } | null }} FieldConflict
 */

/**
 * The customer connections at a pole, as the survey lists them.
 * @param {Design} design @param {string} poleId
 */
export function connectionsAtPole(design, poleId) {
  /** @type {{ kind: FieldRecord['kind'], id: string, type: string, phase: string, kva: number | null, meterId: string | null, fieldNote: string | null, photoRef: string | null, surveyedAt: string | null }[]} */
  const out = [];
  Object.entries(KINDS).forEach(([kind, key]) => {
    (/** @type {any[]} */ (/** @type {any} */ (design)[key]) || []).filter(c => c.pole === poleId).forEach(c => {
      out.push({
        kind: /** @type {FieldRecord['kind']} */ (kind), id: c.id, type: kind === 'load' ? c.type : kind.toUpperCase(), phase: c.phase,
        kva: c.kva == null ? null : Number(c.kva), meterId: c.meterId ?? null, fieldNote: c.fieldNote ?? null, photoRef: c.photoRef ?? null, surveyedAt: c.surveyedAt ?? null
      });
    });
  });
  return out;
}

/** Why a record can't be accepted, or null. @param {any} r */
export function fieldRecordError(r) {
  if (!r || typeof r !== 'object') return 'not an object';
  if (!Object.prototype.hasOwnProperty.call(KINDS, r.kind)) return 'kind must be load, pv or bess';
  if (typeof r.id !== 'string' || !r.id || r.id.length > 64) return 'id must be a short text';
  if (r.observedPhase != null && !FIELD_PHASES.includes(r.observedPhase)) return 'observedPhase must be A, B, C or ABC';
  for (const k of ['meterId', 'note', 'photoRef']) {
    if (r[k] != null && (typeof r[k] !== 'string' || r[k].length > TEXT_MAX)) return `${k} must be text of at most ${TEXT_MAX} characters`;
  }
  if (r.recordedAt != null && (typeof r.recordedAt !== 'string' || Number.isNaN(Date.parse(r.recordedAt)))) return 'recordedAt must be an ISO date';
  return null;
}

const find = (/** @type {any} */ d, /** @type {FieldRecord['kind']} */ kind, /** @type {string} */ id) => ((d && d[KINDS[kind]]) || []).find((/** @type {any} */ c) => c.id === id) || null;
const norm = (/** @type {any} */ v) => (v === undefined ? null : v);

/**
 * Merges survey records into the current design.
 * @param {Design | null} base the version the records were made against (null when it *is* the current one)
 * @param {Design} current the design as it is now
 * @param {FieldRecord[]} records
 * @returns {{ design: Design, applied: { kind: string, id: string }[], conflicts: FieldConflict[] }}
 */
export function mergeFieldRecords(base, current, records) {
  /** @type {any} */
  const design = { ...current, loads: [...(current.loads || [])], pv: [...(current.pv || [])], bess: [...(current.bess || [])] };
  const applied = [];
  /** @type {FieldConflict[]} */
  const conflicts = [];
  records.forEach(r => {
    const key = KINDS[r.kind];
    const idx = design[key].findIndex((/** @type {any} */ c) => c.id === r.id);
    if (idx < 0) { conflicts.push({ kind: r.kind, id: r.id, reason: 'removed', server: null }); return; }
    const now = design[key][idx];
    const then = base ? find(base, r.kind, r.id) : null;
    if (base && then && !r.force && COMPARED.some(f => norm(then[f]) !== norm(current[key][idx][f]))) {
      conflicts.push({ kind: r.kind, id: r.id, reason: 'changed', server: { pole: now.pole, phase: now.phase, meterId: norm(now.meterId) } });
      return;
    }
    const next = { ...now };
    if (r.observedPhase) next.phase = /** @type {Phase} */ (r.observedPhase);
    if (r.meterId != null) next.meterId = r.meterId.trim();
    if (r.note != null) next.fieldNote = r.note.trim();
    if (r.photoRef != null) next.photoRef = r.photoRef.trim();
    if (r.recordedAt) next.surveyedAt = r.recordedAt;
    design[key][idx] = next;
    applied.push({ kind: r.kind, id: r.id });
  });
  return { design, applied, conflicts };
}
