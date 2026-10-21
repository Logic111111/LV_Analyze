import { useEffect, useState } from 'react';
import { onUpdateReady } from '../pwa/register.js';

// "A new version is ready" (P7.8): shown when an updated service worker is waiting.
export default function UpdateBanner() {
  const [activate, setActivate] = useState(null);
  useEffect(() => onUpdateReady((fn) => setActivate(() => fn)), []);
  if (!activate) return null;
  return (
    <div role="status" className="note" style={{ position: 'fixed', bottom: 12, left: 12, right: 12, zIndex: 50, display: 'flex', gap: 10, alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', boxShadow: '0 4px 18px rgba(0,0,0,.25)' }}>
      <span>A new version of Feeder Island is ready.</span>
      <span><button className="primary" onClick={() => activate()}>Reload</button> <button className="mini" onClick={() => setActivate(null)}>Later</button></span>
    </div>
  );
}
