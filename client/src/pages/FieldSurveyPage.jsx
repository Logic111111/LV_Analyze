import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useAuth } from '../context/AuthContext.jsx';
import { useDesign } from '../context/DesignContext.jsx';
import { useOnline } from '../hooks/useOnline.js';
import { api } from '../api.js';
import { connectionsAtPole, withDefaults, FIELD_PHASES } from '../lib/loadflow.js';
import { loadFieldState, saveFieldState, withDesignCopy, withoutDesignCopy, withRecord, withoutRecord, withForced, syncGroups, afterSync } from '../lib/fieldStore.js';

// Field survey (P7.8), for a phone on site: download a saved design, then — online or not — pick
// a pole and record each customer connection's observed phase and meter ID, with a note or a photo
// reference. Records wait on the phone and sync when there is a network; the server applies those
// whose connection hasn't changed since the downloaded version and returns the rest as conflicts,
// which the surveyor sends anyway or drops.
const KIND_LABEL = { load: 'Load', pv: 'PV', bess: 'BESS' };
const field = { width: '100%', background: 'var(--panel-2)', color: 'var(--text)', border: '1px solid var(--line)', borderRadius: 8, padding: 8, fontSize: 15 };

function ConnectionForm({ c, pending, onSave, onDrop }) {
  const [phase, setPhase] = useState(pending?.observedPhase || '');
  const [meterId, setMeterId] = useState(pending?.meterId ?? c.meterId ?? '');
  const [note, setNote] = useState(pending?.note ?? c.fieldNote ?? '');
  const [photoRef, setPhotoRef] = useState(pending?.photoRef ?? c.photoRef ?? '');
  const name = `ph-${c.kind}-${c.id}`;
  const fileRef = useRef(null);
  const dirty = phase !== (pending?.observedPhase || '') || meterId !== (pending?.meterId ?? c.meterId ?? '') || note !== (pending?.note ?? c.fieldNote ?? '') || photoRef !== (pending?.photoRef ?? c.photoRef ?? '');
  return (
    <div className="card" style={{ marginTop: 10, padding: 12 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8, flexWrap: 'wrap' }}>
        <b>{KIND_LABEL[c.kind]} {c.id}</b>
        <span className="hint">{c.type}{c.kva != null ? ` · ${c.kva} kVA` : ''} · design phase <b>{c.phase}</b>{c.surveyedAt ? ` · surveyed ${new Date(c.surveyedAt).toLocaleDateString()}` : ''}</span>
      </div>
      <fieldset style={{ border: 0, padding: 0, margin: '8px 0' }}>
        <legend className="hint" style={{ padding: 0 }}>Observed phase</legend>
        <div role="radiogroup" style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
          {[...FIELD_PHASES, ''].map(p => (
            <label key={p || 'none'} className="chk" style={{ border: '1px solid var(--line)', borderRadius: 8, padding: '6px 10px', minWidth: 44, justifyContent: 'center', background: phase === p ? 'var(--panel-2)' : 'transparent', fontWeight: phase === p ? 600 : 400 }}>
              <input type="radio" name={name} checked={phase === p} onChange={() => setPhase(p)} /> {p || 'Not checked'}
            </label>
          ))}
        </div>
      </fieldset>
      <div className="grid g2">
        <label className="field"><span>Meter ID</span><input value={meterId} maxLength={64} onChange={e => setMeterId(e.target.value)} style={field} autoComplete="off" /></label>
        <label className="field"><span>Photo reference</span>
          <div style={{ display: 'flex', gap: 6 }}>
            <input value={photoRef} maxLength={200} onChange={e => setPhotoRef(e.target.value)} style={field} placeholder="e.g. IMG_2041.jpg" />
            <button type="button" className="mini" style={{ whiteSpace: 'nowrap' }} onClick={() => fileRef.current && fileRef.current.click()} aria-label={`Pick a photo for ${c.id} (only its file name is kept)`}>Pick…</button>
            <input ref={fileRef} type="file" accept="image/*" capture="environment" hidden tabIndex={-1} onChange={e => { const f = e.target.files && e.target.files[0]; if (f) setPhotoRef(f.name); }} />
          </div></label>
      </div>
      <label className="field"><span>Note</span><input value={note} maxLength={200} onChange={e => setNote(e.target.value)} style={field} /></label>
      {pending?.conflict && (
        <p className="hint" role="alert"><span className="pill bad">conflict</span>{' '}
          {pending.conflict.reason === 'removed' ? 'This connection is no longer in the design.' : `Changed in the design since your copy: now phase ${pending.conflict.server.phase}${pending.conflict.server.meterId ? `, meter ${pending.conflict.server.meterId}` : ''}${pending.conflict.server.pole !== c.pole ? `, on pole ${pending.conflict.server.pole}` : ''}.`}</p>
      )}
      <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', alignItems: 'center' }}>
        <button className="primary" disabled={!dirty && !!pending} onClick={() => onSave({ observedPhase: phase || null, meterId: meterId.trim() || null, note: note.trim() || null, photoRef: photoRef.trim() || null })}>{pending ? 'Update record' : 'Save record'}</button>
        {pending && <button className="ghost" onClick={onDrop}>Discard record</button>}
        {pending && !pending.conflict && <span className="pill warn">on this phone — not synced</span>}
      </div>
    </div>
  );
}

export default function FieldSurveyPage() {
  const { user, offline } = useAuth();
  const { designId, designMeta, design: openDesign, loadDesign } = useDesign();
  const online = useOnline();
  const [state, setState] = useState(() => loadFieldState(user.id));
  const [selId, setSelId] = useState(null);
  const [poleId, setPoleId] = useState(null);
  const [q, setQ] = useState('');
  const [msg, setMsg] = useState('');
  const [behind, setBehind] = useState(null);
  const [syncing, setSyncing] = useState(false);
  const syncingRef = useRef(false);

  const persist = useCallback((next) => { setState(next); const err = saveFieldState(user.id, next); if (err) setMsg(err); }, [user.id]);
  const copies = Object.values(state.designs);
  const copy = selId != null ? state.designs[selId] : null;
  const pendingFor = (id) => state.outbox.filter(r => r.designId === id);

  async function download() {
    setMsg('');
    try {
      const r = await api.getDesign(designId);
      persist(withDesignCopy(state, designId, r.design.name, r.meta.currentVersion, withDefaults(r.design)));
      setSelId(designId);
      setMsg(`"${r.design.name}" version ${r.meta.currentVersion} is on this device — it works without a network.`);
    } catch (e) { setMsg('Download failed: ' + e.message); }
  }

  const sync = useCallback(async (id, base) => {
    if (syncingRef.current) return;
    syncingRef.current = true; setSyncing(true);
    let s = base, applied = 0, conflicts = 0, version = null;
    try {
      for (const g of syncGroups(s, id)) {
        let r;
        try { r = await api.fieldSync(id, g.baseVersion, g.records); }
        catch (e) { if (e.status === 409) r = await api.fieldSync(id, g.baseVersion, g.records); else throw e; }
        s = afterSync(s, id, r); applied += r.applied.length; conflicts += r.conflicts.length; version = r.version;
      }
      const fresh = await api.getDesign(id);
      s = withDesignCopy(s, id, fresh.design.name, fresh.meta.currentVersion, withDefaults(fresh.design));
      persist(s);
      setMsg(applied || conflicts ? `Synced: ${applied} applied${version ? ` (design now version ${version})` : ''}${conflicts ? `, ${conflicts} conflict${conflicts === 1 ? '' : 's'} to decide below` : ''}.` : `Up to date — your copy is version ${fresh.meta.currentVersion}.`);
      if (applied && id === designId) setBehind(fresh.meta.currentVersion);
    } catch (e) {
      persist(s);
      setMsg(e.status === undefined ? 'No connection to the server — records stay on this phone and sync when it is back.' : e.status === 401 ? 'Sign in again to sync (records are kept).' : 'Sync failed: ' + e.message);
    } finally { syncingRef.current = false; setSyncing(false); }
  }, [designId, persist]);

  // Sync on its own when the network comes back (and on opening the page) for the design in view.
  useEffect(() => {
    if (online && selId != null && syncGroups(state, selId).length) sync(selId, state);
  }, [online, selId]); // eslint-disable-line react-hooks/exhaustive-deps

  const poles = useMemo(() => {
    if (!copy) return [];
    const recorded = new Set(state.outbox.filter(r => r.designId === copy.designId).map(r => `${r.kind}:${r.id}`));
    return copy.design.poles.filter(p => !q.trim() || p.id.toLowerCase().includes(q.trim().toLowerCase())).map(p => {
      const conns = connectionsAtPole(copy.design, p.id);
      return { id: p.id, feeder: p.feeder, n: conns.length, surveyed: conns.filter(c => c.surveyedAt).length, pending: conns.filter(c => recorded.has(`${c.kind}:${c.id}`)).length };
    });
  }, [copy, q, state.outbox]);

  const save = (c, values) => persist(withRecord(state, { designId: copy.designId, baseVersion: copy.version, kind: c.kind, id: c.id, ...values, recordedAt: new Date().toISOString() }));
  const conflictsHere = copy ? pendingFor(copy.designId).filter(r => r.conflict) : [];

  return (
    <div className="card">
      <h2>Field survey</h2>
      <p className="hint">For a phone on site. Download a saved design while you have a network; then, even offline, pick a pole and record each connection's observed phase, meter ID, a note or a photo reference. Records stay on this phone until they sync — the server applies them as a new design version and flags any connection someone changed in the meantime.</p>
      <p>
        <span className={'pill ' + (online && !offline ? 'ok' : 'warn')} role="status">{online && !offline ? 'Online' : 'Offline — records are kept on this phone'}</span>{' '}
        <span className="hint">{state.outbox.length} record{state.outbox.length === 1 ? '' : 's'} waiting to sync</span>
      </p>
      {msg && <p className="hint" role="status">{msg}</p>}
      {behind && <p className="hint">The design open in the app is now behind (server version {behind}). <button className="mini" onClick={() => { if (window.confirm('Reload the design from the server? Unsaved changes in the app are replaced.')) { loadDesign(designId); setBehind(null); } }}>Reload it</button></p>}

      {!copy && (
        <>
          <div className="section-title">Designs on this phone</div>
          {!copies.length ? <p className="hint">None yet.</p> : (
            <ul style={{ listStyle: 'none', padding: 0, margin: 0 }}>
              {copies.map(c => (
                <li key={c.designId} style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap', marginBottom: 6 }}>
                  <button className="ghost" onClick={() => { setSelId(c.designId); setPoleId(null); }}>{c.name}</button>
                  <span className="hint">version {c.version} · {pendingFor(c.designId).length} waiting</span>
                  <button className="mini" onClick={() => { const n = pendingFor(c.designId).length; if (!n || window.confirm(`Remove "${c.name}" from this phone? ${n} unsynced record${n === 1 ? '' : 's'} will be lost.`)) persist(withoutDesignCopy(state, c.designId, true)); }} aria-label={`Remove ${c.name} from this phone`}>remove</button>
                </li>
              ))}
            </ul>
          )}
          <div className="section-title">Download</div>
          {designId ? (
            <button className="primary" onClick={download} disabled={!online || offline}>Make "{openDesign.name}" available offline (saved version {designMeta ? designMeta.currentVersion : '…'})</button>
          ) : <p className="hint">Open a saved design (Designs page) to download it. Unsaved designs can't be surveyed — records sync into a saved design.</p>}
        </>
      )}

      {copy && (
        <>
          <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap', marginTop: 8 }}>
            <button className="mini" onClick={() => { setSelId(null); setPoleId(null); }}>← Designs on this phone</button>
            <b>{copy.name}</b> <span className="hint">version {copy.version}</span>
            <button className="ghost" onClick={() => sync(copy.designId, state)} disabled={!online || syncing || !syncGroups(state, copy.designId).length}>{syncing ? 'Syncing…' : `Sync ${syncGroups(state, copy.designId).reduce((n, g) => n + g.records.length, 0)} record(s)`}</button>
          </div>
          {conflictsHere.length > 0 && (
            <div className="note" style={{ marginTop: 10 }} role="alert">
              <b>{conflictsHere.length} conflict{conflictsHere.length === 1 ? '' : 's'}.</b> These connections changed in the design after your copy was downloaded:
              <ul style={{ margin: '6px 0 0', paddingLeft: 18 }}>
                {conflictsHere.map(r => (
                  <li key={`${r.kind}:${r.id}`} style={{ marginBottom: 4 }}>
                    {KIND_LABEL[r.kind]} <b>{r.id}</b>: {r.conflict.reason === 'removed' ? 'removed from the design' : `design now says phase ${r.conflict.server.phase}`}; you recorded {r.observedPhase ? `phase ${r.observedPhase}` : 'no phase'}{r.meterId ? `, meter ${r.meterId}` : ''}.{' '}
                    {r.conflict.reason !== 'removed' && <button className="mini" onClick={() => { const s = withForced(state, copy.designId, r.kind, r.id); persist(s); sync(copy.designId, s); }} disabled={!online}>Send mine anyway</button>}{' '}
                    <button className="mini" onClick={() => persist(withoutRecord(state, copy.designId, r.kind, r.id))}>Drop mine</button>
                  </li>
                ))}
              </ul>
            </div>
          )}
          {!poleId ? (
            <>
              <label className="field" style={{ marginTop: 10 }}><span>Find a pole</span><input value={q} onChange={e => setQ(e.target.value)} style={field} placeholder="Pole id" /></label>
              <ul style={{ listStyle: 'none', padding: 0, margin: 0, display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(140px, 1fr))', gap: 8 }}>
                {poles.map(p => (
                  <li key={p.id}><button className="ghost" style={{ width: '100%', textAlign: 'left', padding: '10px 12px' }} onClick={() => setPoleId(p.id)}>
                    <b>{p.id}</b> <span className="hint">{p.feeder}</span><br />
                    <span className="hint">{p.n} connection{p.n === 1 ? '' : 's'}{p.surveyed ? ` · ${p.surveyed} surveyed` : ''}{p.pending ? ` · ${p.pending} waiting` : ''}</span>
                  </button></li>
                ))}
              </ul>
            </>
          ) : (
            <>
              <div style={{ display: 'flex', gap: 8, alignItems: 'center', marginTop: 10 }}>
                <button className="mini" onClick={() => setPoleId(null)}>← Poles</button><b>Pole {poleId}</b>
              </div>
              {connectionsAtPole(copy.design, poleId).map(c => {
                const pending = state.outbox.find(r => r.designId === copy.designId && r.kind === c.kind && r.id === c.id);
                return <ConnectionForm key={`${c.kind}:${c.id}:${pending ? pending.recordedAt : ''}`} c={c} pending={pending} onSave={(v) => save(c, v)} onDrop={() => persist(withoutRecord(state, copy.designId, c.kind, c.id))} />;
              })}
              {!connectionsAtPole(copy.design, poleId).length && <p className="hint">No customer connections on this pole.</p>}
            </>
          )}
        </>
      )}
    </div>
  );
}
