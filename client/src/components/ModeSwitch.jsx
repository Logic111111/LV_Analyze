import { useMode } from '../context/ModeContext.jsx';
import { useI18n } from '../i18n/i18n.jsx';

// Basic | Advanced. Shown in the top bar on desktop and at the top of the menu drawer on phones,
// where the top bar has no room for it (styles.css).
export default function ModeSwitch() {
  const { mode, setMode } = useMode();
  const { t } = useI18n();
  return (
    <div className="segmented mode-switch" role="group" aria-label={t('Mode')}>
      {['basic', 'advanced'].map(m => (
        <button key={m} type="button" className={mode === m ? 'on' : ''} aria-pressed={mode === m} onClick={() => setMode(m)}>
          {t(m === 'basic' ? 'Basic' : 'Advanced')}
        </button>
      ))}
    </div>
  );
}
