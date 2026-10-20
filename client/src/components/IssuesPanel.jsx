import { useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useDesign } from '../context/DesignContext.jsx';
import { useEngineTask } from '../hooks/useEngineTask.js';
import { useT } from '../i18n/i18n.jsx';

// Issues panel (P5.5): on every page, a button with the current issue counts that opens a drawer
// listing all of them (load-flow violations, unbalance, solver trouble, protection, missing data)
// with severity, location and a "Suggest fix" that opens the relevant advisor pre-filtered. The
// list is rebuilt in the worker shortly after each design change. Severity is always written out
// (and given an icon), never shown by colour alone.
const SEV = { error: { icon: '✖', label: 'Error', plural: 'Errors', color: 'var(--bad)' }, warning: { icon: '⚠', label: 'Warning', plural: 'Warnings', color: 'var(--warn)' }, info: { icon: 'ℹ', label: 'Note', plural: 'Notes', color: 'var(--muted)' } };
const hh = (h) => String(h).padStart(2, '0') + ':00';

export default function IssuesPanel() {
  const { design } = useDesign();
  const t = useT();
  const navigate = useNavigate();
  const [issues, setIssues] = useState(null);
  const [open, setOpen] = useState(false);
  const [filter, setFilter] = useState('all');
  const task = useEngineTask();
  const closeRef = useRef(null);

  useEffect(() => {
    const t = setTimeout(async () => {
      const r = await task.run('issues', { design }, 'Checking the design');
      if (r.ok) setIssues(r.result);
    }, 800);
    return () => clearTimeout(t);
  }, [design]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (!open) return undefined;
    closeRef.current?.focus();
    const onKey = (e) => { if (e.key === 'Escape') setOpen(false); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open]);

  const counts = issues ? issues.reduce((c, i) => ({ ...c, [i.severity]: c[i.severity] + 1 }), { error: 0, warning: 0, info: 0 }) : null;
  const shown = (issues || []).filter(i => filter === 'all' || i.severity === filter);

  function go(fix) {
    const q = new URLSearchParams(fix.params || {}).toString();
    navigate(`/app/${fix.route}${q ? '?' + q : ''}`);
    setOpen(false);
  }

  return (
    <>
      <button type="button" className="issues-fab" onClick={() => setOpen(o => !o)} aria-expanded={open} aria-controls="issues-drawer">
        {!counts ? t('Checking…') : counts.error + counts.warning + counts.info === 0 ? '✔ ' + t('No issues') : (
          <>
            {counts.error > 0 && <span style={{ color: 'var(--bad)' }}>✖ {t(counts.error === 1 ? '{n} error' : '{n} errors', { n: counts.error })}</span>}
            {counts.warning > 0 && <span style={{ color: 'var(--warn)' }}> ⚠ {t(counts.warning === 1 ? '{n} warning' : '{n} warnings', { n: counts.warning })}</span>}
            {counts.info > 0 && <span style={{ color: 'var(--muted)' }}> ℹ {t(counts.info === 1 ? '{n} note' : '{n} notes', { n: counts.info })}</span>}
          </>
        )}
      </button>
      {open && (
        <aside id="issues-drawer" className="issues-drawer" role="complementary" aria-label={t('Issues')}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 8 }}>
            <h2 style={{ margin: 0 }}>{t('Issues')}</h2>
            <button ref={closeRef} type="button" className="mini" onClick={() => setOpen(false)}>{t('Close')}</button>
          </div>
          <p className="hint">From a 24 h scan of the design (year 0, nominal load and solar), the protection check and data checks. Updated after every change.{task.running ? ' Updating…' : ''}</p>
          <div role="radiogroup" aria-label="Show" style={{ display: 'flex', gap: 10, flexWrap: 'wrap', marginBottom: 8 }}>
            {['all', 'error', 'warning', 'info'].map(f => (
              <label key={f} className="chk"><input type="radio" name="issueFilter" checked={filter === f} onChange={() => setFilter(f)} /> {f === 'all' ? t('All') : t(SEV[f].plural)}{counts && f !== 'all' ? ` (${counts[f]})` : ''}</label>
            ))}
          </div>
          {!issues ? <p className="hint">{t('Checking…')}</p> : !shown.length ? <p className="hint">Nothing to show.</p> : (
            <ul className="issues-list">
              {shown.map(i => (
                <li key={i.id}>
                  <div style={{ fontWeight: 700, fontSize: 13 }}><span style={{ color: SEV[i.severity].color }} aria-hidden="true">{SEV[i.severity].icon}</span> <span className="sr-only">{t(SEV[i.severity].label)}: </span>{i.title}</div>
                  <div className="hint" style={{ margin: '2px 0' }}>
                    {t(SEV[i.severity].label)}{i.location.txId ? ` · ${i.location.txId}` : ''}{i.location.pole ? ` · ${i.location.pole}` : ''}{i.location.phase ? ` phase ${i.location.phase}` : ''}{i.location.hours && i.location.hours.length ? ` · ${i.location.hours.length <= 3 ? i.location.hours.map(hh).join(', ') : `${i.location.hours.length} h`}` : ''}
                  </div>
                  {i.detail && <div style={{ fontSize: 12 }}>{i.detail}</div>}
                  {i.fix && <button type="button" className="mini" style={{ marginTop: 4 }} onClick={() => go(i.fix)}>{t('Suggest fix')}: {i.fix.label}</button>}
                </li>
              ))}
            </ul>
          )}
        </aside>
      )}
    </>
  );
}
