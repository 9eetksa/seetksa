const key = 'seet-portfolio-updated';
export function notifyPortfolioChanged() {
  window.dispatchEvent(new Event(key));
  // Cross-tab updates contain no account data or files.
  try { window.localStorage.setItem(key, crypto.randomUUID()); } catch {}
}
export function subscribePortfolioChanged(listener) {
  const storage = event => { if (event.key === key) listener(); };
  window.addEventListener(key, listener);
  window.addEventListener('storage', storage);
  return () => {
    window.removeEventListener(key, listener);
    window.removeEventListener('storage', storage);
  };
}
