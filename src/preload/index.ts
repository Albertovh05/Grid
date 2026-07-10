import { contextBridge, ipcRenderer } from 'electron';
import { IPC } from '../shared/types.js';
import type { AppSettings, LayoutState, PresetLayout, RemoteStatus, ShortcutAction } from '../shared/types.js';

const api = {
  pty: {
    create: (opts: { id: string; cols: number; rows: number; cwd?: string; shell?: string }) =>
      ipcRenderer.invoke(IPC.PTY_CREATE, opts),
    write: (id: string, data: string) => ipcRenderer.send(IPC.PTY_WRITE, { id, data }),
    resize: (id: string, cols: number, rows: number) => ipcRenderer.send(IPC.PTY_RESIZE, { id, cols, rows }),
    dispose: (id: string) => ipcRenderer.send(IPC.PTY_DISPOSE, { id }),
    getCwd: (id: string): Promise<string | null> => ipcRenderer.invoke(IPC.PTY_GET_CWD, { id }),
    hasRunningChild: (id: string): Promise<boolean> => ipcRenderer.invoke(IPC.PTY_HAS_CHILD, { id }),
    onData: (id: string, cb: (data: string) => void) => {
      const channel = IPC.PTY_DATA_PREFIX + id;
      const listener = (_: unknown, data: string) => cb(data);
      ipcRenderer.on(channel, listener);
      return () => {
        ipcRenderer.off(channel, listener);
      };
    },
    onExit: (id: string, cb: (ev: { exitCode: number; signal?: number }) => void) => {
      const channel = IPC.PTY_EXIT_PREFIX + id;
      const listener = (_: unknown, ev: { exitCode: number; signal?: number }) => cb(ev);
      ipcRenderer.on(channel, listener);
      return () => {
        ipcRenderer.off(channel, listener);
      };
    },
  },
  layout: {
    get: (): Promise<LayoutState> => ipcRenderer.invoke(IPC.LAYOUT_GET),
    set: (layout: LayoutState) => ipcRenderer.send(IPC.LAYOUT_SET, layout),
    onChanged: (cb: (layout: LayoutState) => void) => {
      const listener = (_: unknown, layout: LayoutState) => cb(layout);
      ipcRenderer.on(IPC.LAYOUT_CHANGED, listener);
      return () => {
        ipcRenderer.off(IPC.LAYOUT_CHANGED, listener);
      };
    },
  },
  presets: {
    list: (): Promise<PresetLayout[]> => ipcRenderer.invoke(IPC.PRESETS_LIST),
    save: (preset: PresetLayout): Promise<PresetLayout[]> => ipcRenderer.invoke(IPC.PRESETS_SAVE, preset),
    delete: (id: string): Promise<PresetLayout[]> => ipcRenderer.invoke(IPC.PRESETS_DELETE, id),
  },
  settings: {
    get: (): Promise<AppSettings> => ipcRenderer.invoke(IPC.SETTINGS_GET),
    set: (s: AppSettings) => ipcRenderer.send(IPC.SETTINGS_SET, s),
  },
  remote: {
    getStatus: (): Promise<RemoteStatus> => ipcRenderer.invoke(IPC.REMOTE_STATUS_GET),
    enable: (opts?: { port?: number; bindHost?: '127.0.0.1' | 'tailscale' }): Promise<RemoteStatus> =>
      ipcRenderer.invoke(IPC.REMOTE_ENABLE, opts),
    disable: (): Promise<RemoteStatus> => ipcRenderer.invoke(IPC.REMOTE_DISABLE),
    resetCode: (): Promise<RemoteStatus> => ipcRenderer.invoke(IPC.REMOTE_RESET_CODE),
    onStatusChanged: (cb: (status: RemoteStatus) => void) => {
      const listener = (_: unknown, status: RemoteStatus) => cb(status);
      ipcRenderer.on(IPC.REMOTE_STATUS_CHANGED, listener);
      return () => {
        ipcRenderer.off(IPC.REMOTE_STATUS_CHANGED, listener);
      };
    },
  },
  onShortcut: (cb: (action: ShortcutAction) => void) => {
    const listener = (_: unknown, action: ShortcutAction) => cb(action);
    ipcRenderer.on(IPC.SHORTCUT, listener);
    return () => ipcRenderer.off(IPC.SHORTCUT, listener);
  },
};

contextBridge.exposeInMainWorld('api', api);

export type Api = typeof api;
