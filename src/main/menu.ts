import { app, Menu, MenuItemConstructorOptions, BrowserWindow } from 'electron';
import type { ShortcutAction } from '../shared/types.js';

function sendShortcut(action: ShortcutAction) {
  const w = BrowserWindow.getFocusedWindow() ?? BrowserWindow.getAllWindows()[0];
  w?.webContents.send('app:shortcut', action);
}

export function installAppMenu(): void {
  const isMac = process.platform === 'darwin';

  const template: MenuItemConstructorOptions[] = [];

  if (isMac) {
    template.push({
      label: app.name,
      submenu: [
        { role: 'about' },
        { type: 'separator' },
        { role: 'services' },
        { type: 'separator' },
        { role: 'hide' },
        { role: 'hideOthers' },
        { role: 'unhide' },
        { type: 'separator' },
        { role: 'quit' },
      ],
    });
  }

  template.push({
    label: 'File',
    submenu: [
      { label: 'New Terminal', accelerator: 'CmdOrCtrl+T', click: () => sendShortcut('new-terminal') },
      { label: 'Close Terminal', accelerator: 'CmdOrCtrl+W', click: () => sendShortcut('close-terminal') },
      { type: 'separator' },
      isMac ? { role: 'close' } : { role: 'quit' },
    ],
  });

  template.push({
    label: 'Edit',
    submenu: [
      { role: 'undo' },
      { role: 'redo' },
      { type: 'separator' },
      { role: 'cut' },
      { role: 'copy' },
      { role: 'paste' },
      { role: 'selectAll' },
    ],
  });

  template.push({
    label: 'View',
    submenu: [
      { label: 'Toggle Zoom Pane', accelerator: 'CmdOrCtrl+E', click: () => sendShortcut('toggle-zoom') },
      { label: 'Toggle Sidebar', accelerator: 'CmdOrCtrl+B', click: () => sendShortcut('toggle-sidebar') },
      { label: 'Clear Active Terminal', accelerator: 'CmdOrCtrl+K', click: () => sendShortcut('clear-terminal') },
      { type: 'separator' },
      { label: 'Command Palette…', accelerator: 'CmdOrCtrl+Shift+P', click: () => sendShortcut('toggle-palette') },
      { type: 'separator' },
      { role: 'togglefullscreen' },
      { role: 'toggleDevTools' },
    ],
  });

  template.push({
    label: 'Window',
    role: 'windowMenu',
  });

  Menu.setApplicationMenu(Menu.buildFromTemplate(template));
}
