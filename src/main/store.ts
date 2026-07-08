import ElectronStore from 'electron-store';
import type { AppSettings, LayoutState, PresetLayout } from '../shared/types.js';

export interface WindowState {
  x?: number;
  y?: number;
  width: number;
  height: number;
  maximized?: boolean;
}

type Schema = {
  layout: LayoutState;
  presets: PresetLayout[];
  window: WindowState;
  settings: AppSettings;
};

const defaultWindow: WindowState = { width: 1400, height: 900 };
const defaultSettings: AppSettings = {
  theme: 'dark',
  fontSize: 13,
  fontFamily: 'SF Mono, JetBrains Mono, Menlo, monospace',
  remoteEnabled: false,
  remotePort: 17321,
  remoteBindHost: '0.0.0.0',
};

const defaultLayout: LayoutState = {
  terminals: [],
  focusedId: null,
  zoomedId: null,
  sidebarVisible: true,
};

export class Store {
  private store: ElectronStore<Schema>;

  constructor() {
    this.store = new ElectronStore<Schema>({
      name: 'terminal-grid',
      defaults: {
        layout: defaultLayout,
        presets: [],
        window: defaultWindow,
        settings: defaultSettings,
      },
    });
  }

  getSettings(): AppSettings {
    return this.store.get('settings', defaultSettings);
  }

  setSettings(s: AppSettings): void {
    this.store.set('settings', s);
  }

  getWindow(): WindowState {
    return this.store.get('window', defaultWindow);
  }

  setWindow(state: WindowState): void {
    this.store.set('window', state);
  }

  getLayout(): LayoutState {
    return this.store.get('layout', defaultLayout);
  }

  setLayout(layout: LayoutState): void {
    this.store.set('layout', layout);
  }

  listPresets(): PresetLayout[] {
    return this.store.get('presets', []);
  }

  savePreset(preset: PresetLayout): PresetLayout[] {
    const list = this.listPresets().filter((p) => p.id !== preset.id);
    list.push(preset);
    this.store.set('presets', list);
    return list;
  }

  deletePreset(id: string): PresetLayout[] {
    const list = this.listPresets().filter((p) => p.id !== id);
    this.store.set('presets', list);
    return list;
  }
}
