export interface TerminalSpec {
  id: string;
  title: string;
  userTitle?: string;
  cwd?: string;
  shell?: string;
  createdAt: number;
}

export type GridMode = 'auto' | '1col' | '2col' | '3col' | 'tabs';
export type Theme = 'dark' | 'light' | 'system';

export interface AppSettings {
  theme: Theme;
  fontSize: number;
  fontFamily: string;
  remoteEnabled?: boolean;
  remotePort?: number;
  remoteBindHost?: '127.0.0.1' | 'tailscale';
}

export interface ArchivedSpec {
  id: string;
  title: string;
  cwd?: string;
  shell?: string;
  archivedAt: number;
}

export interface LayoutState {
  terminals: TerminalSpec[];
  focusedId: string | null;
  zoomedId: string | null;
  sidebarVisible: boolean;
  sidebarWidth?: number;
  gridMode?: GridMode;
  archived?: ArchivedSpec[];
}

export interface PresetLayout {
  id: string;
  name: string;
  state: LayoutState;
  savedAt: number;
}

export interface PtyDataEvent {
  id: string;
  data: string;
}

export interface PtyExitEvent {
  id: string;
  exitCode: number;
  signal?: number;
}

export interface RemoteStatus {
  enabled: boolean;
  running: boolean;
  port: number;
  bindHost: '127.0.0.1' | 'tailscale';
  urls: string[];
  tailscaleUrls: string[];
  tailscaleState?: string;
  tailscaleError?: string;
  pairingUrl: string | null;
  pairingCode: string | null;
  pairingQrDataUrl: string | null;
  clientCount: number;
  error?: string;
}

export const IPC = {
  // pty lifecycle
  PTY_CREATE: 'pty:create',
  PTY_WRITE: 'pty:write',
  PTY_RESIZE: 'pty:resize',
  PTY_DISPOSE: 'pty:dispose',
  PTY_CLEAR: 'pty:clear',
  PTY_GET_CWD: 'pty:getCwd',
  PTY_HAS_CHILD: 'pty:hasChild',
  SETTINGS_GET: 'settings:get',
  SETTINGS_SET: 'settings:set',
  REMOTE_STATUS_GET: 'remote:getStatus',
  REMOTE_ENABLE: 'remote:enable',
  REMOTE_DISABLE: 'remote:disable',
  REMOTE_RESET_CODE: 'remote:resetCode',
  REMOTE_STATUS_CHANGED: 'remote:statusChanged',
  // window state
  WINDOW_STATE_GET: 'window:getState',
  WINDOW_STATE_SET: 'window:setState',
  // events from main → renderer (per-terminal channels — append :<id>)
  PTY_DATA: 'pty:data',
  PTY_EXIT: 'pty:exit',
  PTY_DATA_PREFIX: 'pty:data:',
  PTY_EXIT_PREFIX: 'pty:exit:',
  // layout
  LAYOUT_GET: 'layout:get',
  LAYOUT_SET: 'layout:set',
  LAYOUT_CHANGED: 'layout:changed',
  PRESETS_LIST: 'presets:list',
  PRESETS_SAVE: 'presets:save',
  PRESETS_DELETE: 'presets:delete',
  PRESETS_LOAD: 'presets:load',
  // misc
  APP_QUIT: 'app:quit',
  SHORTCUT: 'app:shortcut',
} as const;

export type ShortcutAction =
  | 'new-terminal'
  | 'close-terminal'
  | 'clear-terminal'
  | 'toggle-zoom'
  | 'toggle-sidebar'
  | 'toggle-palette'
  | 'focus-1'
  | 'focus-2'
  | 'focus-3'
  | 'focus-4'
  | 'focus-5'
  | 'focus-6'
  | 'focus-7'
  | 'focus-8'
  | 'focus-9';
