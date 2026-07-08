import { useEffect, useRef, useState } from 'react';
import type { AppSettings, Theme } from '../../shared/types';

const defaults: AppSettings = {
  theme: 'dark',
  fontSize: 13,
  fontFamily: 'SF Mono, JetBrains Mono, Menlo, monospace',
  remoteEnabled: false,
  remotePort: 17321,
  remoteBindHost: '0.0.0.0',
};

function effectiveTheme(t: Theme): 'dark' | 'light' {
  if (t === 'system') return window.matchMedia('(prefers-color-scheme: light)').matches ? 'light' : 'dark';
  return t;
}

export function useSettings() {
  const [settings, setSettings] = useState<AppSettings>(defaults);
  const [loaded, setLoaded] = useState(false);
  const skip = useRef(true);

  useEffect(() => {
    window.api.settings.get().then((s) => {
      setSettings({ ...defaults, ...s });
      setLoaded(true);
    });
  }, []);

  useEffect(() => {
    if (!loaded) return;
    if (skip.current) {
      skip.current = false;
      return;
    }
    window.api.settings.set(settings);
  }, [settings, loaded]);

  // apply theme class
  useEffect(() => {
    const apply = () => {
      const eff = effectiveTheme(settings.theme);
      document.documentElement.dataset['theme'] = eff;
    };
    apply();
    if (settings.theme === 'system') {
      const mq = window.matchMedia('(prefers-color-scheme: light)');
      const listener = () => apply();
      mq.addEventListener('change', listener);
      return () => mq.removeEventListener('change', listener);
    }
    return undefined;
  }, [settings.theme]);

  const update = (patch: Partial<AppSettings>) => setSettings((s) => ({ ...s, ...patch }));

  return {
    settings,
    loaded,
    setTheme: (t: Theme) => update({ theme: t }),
    setFontSize: (n: number) => update({ fontSize: Math.max(9, Math.min(28, Math.round(n))) }),
    setFontFamily: (f: string) => update({ fontFamily: f }),
  };
}
