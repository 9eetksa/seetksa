import { useEffect, useState } from 'react';
import { subscribePortfolioChanged } from '../data/portfolio-updates.js';

export function portfolioSlots(works, index = 0) {
  const start = works.length ? index % works.length : 0;
  const rotated = [...works.slice(start), ...works.slice(0, start)].slice(0, 4);
  return Array.from({ length: 4 }, (_, slot) => rotated[slot] || null);
}

export default function usePublicPortfolio() {
  const [works, setWorks] = useState([]);
  const [error, setError] = useState(false);
  const [loading, setLoading] = useState(true);
  const [retry, setRetry] = useState(0);
  useEffect(() => {
    let live = true, controller;
    async function refresh() {
      controller?.abort();
      const active = new AbortController();
      controller = active;
      const timeout = setTimeout(() => active.abort(), 10000);
      try {
        const response = await fetch('/api/portfolio', { cache: 'no-store', signal: active.signal });
        if (!response.ok) throw new Error('portfolio_unavailable');
        const body = await response.json();
        if (!Array.isArray(body.data)) throw new Error('portfolio_invalid');
        if (live && controller === active) { setWorks(body.data); setError(false); }
      } catch {
        if (live && controller === active) { setWorks([]); setError(true); }
      } finally {
        clearTimeout(timeout);
        if (live && controller === active) setLoading(false);
      }
    }
    const visibleRefresh = () => { if (!document.hidden) refresh(); };
    const unsubscribe = subscribePortfolioChanged(refresh);
    // Same-device edits refresh immediately; other visitors pick up changes while viewing.
    const interval = setInterval(visibleRefresh, 15000);
    window.addEventListener('focus', visibleRefresh);
    window.addEventListener('online', visibleRefresh);
    document.addEventListener('visibilitychange', visibleRefresh);
    refresh();
    return () => {
      live = false; controller?.abort(); unsubscribe(); clearInterval(interval);
      window.removeEventListener('focus', visibleRefresh);
      window.removeEventListener('online', visibleRefresh);
      document.removeEventListener('visibilitychange', visibleRefresh);
    };
  }, [retry]);
  return { works, loading, error, retry: () => setRetry(value => value + 1) };
}
