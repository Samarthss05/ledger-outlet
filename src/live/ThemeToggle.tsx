import { useEffect, useState } from 'react';

type Theme = 'light' | 'dark';
const storedTheme = (): Theme | null => {
  const value = window.localStorage.getItem('ledger-theme');
  return value === 'light' || value === 'dark' ? value : null;
};

export function ThemeToggle() {
  const [theme, setTheme] = useState<Theme>(() => storedTheme() || (window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light'));
  useEffect(() => {
    document.documentElement.dataset.theme = theme;
    window.localStorage.setItem('ledger-theme', theme);
    document.querySelector('meta[name="theme-color"]')?.setAttribute('content', theme === 'dark' ? '#0D1711' : '#F7F5F0');
  }, [theme]);
  return <button className="theme-toggle" type="button" onClick={() => setTheme(current => current === 'dark' ? 'light' : 'dark')} aria-label={`Switch to ${theme === 'dark' ? 'light' : 'dark'} mode`} title={`Switch to ${theme === 'dark' ? 'light' : 'dark'} mode`}>
    <span aria-hidden="true">{theme === 'dark' ? '☀' : '☾'}</span><span>{theme === 'dark' ? 'Light' : 'Dark'}</span>
  </button>;
}
