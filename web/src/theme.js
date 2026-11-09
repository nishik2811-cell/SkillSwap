import { useEffect, useState } from 'react';

const KEY = 'ss.theme';
const read = () => { try { return localStorage.getItem(KEY); } catch { return null; } };
export const initialTheme = () => (read() === 'light' ? 'light' : 'dark');

/* One theme for the whole app, stored in localStorage and mirrored on <html data-theme>. */
export function applyTheme(t) { document.documentElement.dataset.theme = t; }
applyTheme(initialTheme()); // before first paint, so there is no flash

export function useTheme() {
  const [theme, setTheme] = useState(initialTheme);
  useEffect(() => { applyTheme(theme); try { localStorage.setItem(KEY, theme); } catch { /* storage unavailable */ } }, [theme]);
  useEffect(() => { const f = (e) => { if (e.key === KEY) setTheme(e.newValue === 'light' ? 'light' : 'dark'); }; addEventListener('storage', f); return () => removeEventListener('storage', f); }, []);
  return [theme, () => setTheme((t) => (t === 'dark' ? 'light' : 'dark'))];
}
