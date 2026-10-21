import { useEffect, useState } from 'react';

// Whether the browser thinks it has a network (P7.8). navigator.onLine can say "online" on a
// network with no route to the server, so callers still treat a failed request as offline.
export function useOnline() {
  const [online, setOnline] = useState(() => (typeof navigator === 'undefined' ? true : navigator.onLine));
  useEffect(() => {
    const up = () => setOnline(true), down = () => setOnline(false);
    window.addEventListener('online', up); window.addEventListener('offline', down);
    return () => { window.removeEventListener('online', up); window.removeEventListener('offline', down); };
  }, []);
  return online;
}
