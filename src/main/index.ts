import { app, BrowserWindow, ipcMain, shell } from 'electron';
import { join } from 'path';
import { fileURLToPath } from 'url';
import { dirname } from 'path';
import { PtyManager } from './pty-manager.js';
import { Store } from './store.js';
import { RemoteServer } from './remote-server.js';
import { ensureTailscaleUp } from './tailscale-manager.js';
import { registerShortcuts, unregisterShortcuts } from './shortcuts.js';
import { installAppMenu } from './menu.js';
import { IPC } from '../shared/types.js';
import type { AppSettings, LayoutState, PresetLayout, RemoteStatus } from '../shared/types.js';

const __dirname = dirname(fileURLToPath(import.meta.url));

let mainWindow: BrowserWindow | null = null;
const pty = new PtyManager();
const store = new Store();

function sendLayoutChanged(layout: LayoutState): void {
  mainWindow?.webContents.send(IPC.LAYOUT_CHANGED, layout);
}

function sendRemoteStatus(status: RemoteStatus): void {
  mainWindow?.webContents.send(IPC.REMOTE_STATUS_CHANGED, status);
}

const remote = new RemoteServer({
  pty,
  store,
  onLayoutChanged: sendLayoutChanged,
  onStatusChanged: sendRemoteStatus,
});

async function startRemoteFromSettings(settings: AppSettings): Promise<RemoteStatus> {
  const tailscale =
    settings.remoteBindHost !== '127.0.0.1'
      ? await ensureTailscaleUp()
      : undefined;
  return remote.start({
    port: settings.remotePort,
    bindHost: settings.remoteBindHost,
    tailscale: tailscale
      ? {
          tailscaleState: tailscale.state,
          tailscaleError: tailscale.ok ? undefined : tailscale.error,
          tailnetIp: tailscale.tailnetIp,
        }
      : undefined,
  });
}

function createWindow() {
  const ws = store.getWindow();
  mainWindow = new BrowserWindow({
    x: ws.x,
    y: ws.y,
    width: ws.width,
    height: ws.height,
    minWidth: 720,
    minHeight: 480,
    show: false,
    titleBarStyle: 'hiddenInset',
    backgroundColor: '#0a0a0c',
    vibrancy: 'under-window',
    visualEffectState: 'active',
    webPreferences: {
      preload: join(__dirname, '../preload/index.mjs'),
      sandbox: false,
      contextIsolation: true,
      nodeIntegration: false,
    },
  });

  if (ws.maximized) mainWindow.maximize();
  mainWindow.on('ready-to-show', () => mainWindow?.show());

  let saveTimer: NodeJS.Timeout | null = null;
  const saveBounds = () => {
    if (!mainWindow || mainWindow.isDestroyed()) return;
    if (saveTimer) clearTimeout(saveTimer);
    saveTimer = setTimeout(() => {
      if (!mainWindow || mainWindow.isDestroyed()) return;
      const b = mainWindow.getBounds();
      store.setWindow({ ...b, maximized: mainWindow.isMaximized() });
    }, 300);
  };
  mainWindow.on('resize', saveBounds);
  mainWindow.on('move', saveBounds);
  mainWindow.on('maximize', saveBounds);
  mainWindow.on('unmaximize', saveBounds);

  mainWindow.webContents.setWindowOpenHandler((details) => {
    shell.openExternal(details.url);
    return { action: 'deny' };
  });

  const devUrl = process.env['ELECTRON_RENDERER_URL'];
  if (devUrl) {
    mainWindow.loadURL(devUrl);
  } else {
    mainWindow.loadFile(join(__dirname, '../renderer/index.html'));
  }

  // forward pty data to renderer on per-terminal channels (avoid O(N²) fanout)
  pty.on('data', (id, data) => {
    mainWindow?.webContents.send(IPC.PTY_DATA_PREFIX + id, data);
  });
  pty.on('exit', (id, exitCode, signal) => {
    mainWindow?.webContents.send(IPC.PTY_EXIT_PREFIX + id, { exitCode, signal });
  });

  registerShortcuts((action) => {
    mainWindow?.webContents.send(IPC.SHORTCUT, action);
  });

  mainWindow.on('closed', () => {
    mainWindow = null;
  });
}

app.whenReady().then(() => {
  // IPC: pty
  ipcMain.handle(IPC.PTY_CREATE, (_e, opts: { id: string; cols: number; rows: number; cwd?: string; shell?: string }) => {
    return pty.create(opts);
  });
  ipcMain.on(IPC.PTY_WRITE, (_e, { id, data }: { id: string; data: string }) => {
    pty.write(id, data);
  });
  ipcMain.on(IPC.PTY_RESIZE, (_e, { id, cols, rows }: { id: string; cols: number; rows: number }) => {
    pty.resize(id, cols, rows);
  });
  ipcMain.on(IPC.PTY_DISPOSE, (_e, { id }: { id: string }) => {
    pty.dispose(id);
  });
  ipcMain.handle(IPC.PTY_GET_CWD, async (_e, { id }: { id: string }) => pty.getCwd(id));
  ipcMain.handle(IPC.PTY_HAS_CHILD, async (_e, { id }: { id: string }) => pty.hasRunningChild(id));

  // IPC: layout
  ipcMain.handle(IPC.LAYOUT_GET, () => store.getLayout());
  ipcMain.on(IPC.LAYOUT_SET, (_e, layout: LayoutState) => {
    store.setLayout(layout);
    sendLayoutChanged(layout);
  });

  // IPC: presets
  ipcMain.handle(IPC.PRESETS_LIST, () => store.listPresets());
  ipcMain.handle(IPC.PRESETS_SAVE, (_e, preset: PresetLayout) => store.savePreset(preset));
  ipcMain.handle(IPC.PRESETS_DELETE, (_e, id: string) => store.deletePreset(id));

  // settings
  ipcMain.handle(IPC.SETTINGS_GET, () => store.getSettings());
  ipcMain.on(IPC.SETTINGS_SET, (_e, s: AppSettings) => {
    const current = store.getSettings();
    store.setSettings(s);
    if (s.remoteEnabled && !current.remoteEnabled) {
      void startRemoteFromSettings(s).catch(() => store.setSettings({ ...store.getSettings(), remoteEnabled: false }));
    } else if (!s.remoteEnabled && current.remoteEnabled) {
      void remote.stop();
    }
  });

  ipcMain.handle(IPC.REMOTE_STATUS_GET, () => remote.getStatus());
  ipcMain.handle(IPC.REMOTE_ENABLE, async (_e, opts?: { port?: number; bindHost?: '127.0.0.1' | 'tailscale' }) => {
    const settings = store.getSettings();
    const requestedBindHost = opts?.bindHost ?? settings.remoteBindHost ?? 'tailscale';
    const next: AppSettings = {
      ...settings,
      remoteEnabled: true,
      remotePort: opts?.port ?? settings.remotePort ?? 17321,
      remoteBindHost: requestedBindHost === '127.0.0.1' ? '127.0.0.1' : 'tailscale',
    };
    store.setSettings(next);
    return startRemoteFromSettings(next);
  });
  ipcMain.handle(IPC.REMOTE_DISABLE, async () => {
    store.setSettings({ ...store.getSettings(), remoteEnabled: false });
    return remote.stop();
  });

  installAppMenu();
  createWindow();

  const settings = store.getSettings();
  if (settings.remoteEnabled) {
    void startRemoteFromSettings(settings).catch(() => {
      store.setSettings({ ...store.getSettings(), remoteEnabled: false });
    });
  }

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});

app.on('will-quit', () => {
  unregisterShortcuts();
  void remote.stop();
  pty.disposeAll();
});
