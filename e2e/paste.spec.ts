import { test, expect } from '@playwright/test';
import { launchApp, newTerminalViaButton } from './helpers';

const bufferAt = (window: any, idx: number) =>
  window.evaluate((i: number) => (window as any).__tg?.bufferAt(i) ?? '', idx);

// Regression: a single paste must insert the clipboard text exactly once.
// Previously a custom Ctrl+V/Cmd+V handler wrote the clipboard raw AND xterm's
// native paste (via the Edit-menu role) wrote it again, producing a double
// paste. webContents.paste() exercises that same native path platform-agnostically.
test('paste inserts clipboard text exactly once (no double paste)', async () => {
  const { app, window } = await launchApp();
  await newTerminalViaButton(window);
  await window.locator('.xterm-helper-textarea').first().focus();
  await window.waitForTimeout(800);

  const marker = 'PASTE_ONCE_GUARD';
  await app.evaluate(({ clipboard }, m) => clipboard.writeText(m), marker);
  await app.evaluate(({ BrowserWindow }) => {
    const w = BrowserWindow.getFocusedWindow() ?? BrowserWindow.getAllWindows()[0];
    w?.webContents.paste();
  });
  await window.waitForTimeout(600);

  const buf = await bufferAt(window, 0);
  const occurrences = (buf.match(/PASTE_ONCE_GUARD/g) ?? []).length;
  expect(occurrences).toBe(1);
  await app.close();
});
