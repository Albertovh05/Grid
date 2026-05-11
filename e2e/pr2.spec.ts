import { test, expect, _electron as electron } from '@playwright/test';
import { launchApp, shot, newTerminalViaButton } from './helpers';
import path from 'path';
import fs from 'fs';
import os from 'os';

const bufferAt = (window: any, idx: number) =>
  window.evaluate((i: number) => (window as any).__tg?.bufferAt(i) ?? '', idx);

test('PR2-A1: default title looks like "<shell> · <cwd-basename>"', async () => {
  const { app, window } = await launchApp();
  await newTerminalViaButton(window);
  // Wait for cwd poll to populate
  await window.waitForTimeout(1500);
  const title = await window.locator('.pane-header .title').first().innerText();
  expect(title).toMatch(/\S+ · \S+/);
  await app.close();
});

test('PR2-A1: rename sticks as userTitle and survives cd', async () => {
  const { app, window } = await launchApp();
  await newTerminalViaButton(window);
  const title = window.locator('.pane-header .title').first();
  await title.dblclick();
  await title.locator('input').fill('keep-me');
  await title.locator('input').press('Enter');
  await expect(title).toHaveText('keep-me');
  await window.locator('.xterm-helper-textarea').first().focus();
  await window.keyboard.type('cd /tmp');
  await window.keyboard.press('Enter');
  await window.waitForTimeout(3500);
  // Title should still be the user-set one
  await expect(title).toHaveText('keep-me');
  await app.close();
});

test('PR2-A2: new terminal inherits cwd of focused via cd', async () => {
  const { app, window } = await launchApp();
  await newTerminalViaButton(window);
  await window.locator('.xterm-helper-textarea').first().focus();
  await window.waitForTimeout(500);
  await window.keyboard.type('cd /tmp');
  await window.keyboard.press('Enter');
  await window.waitForTimeout(3500);

  // Open a new terminal — should inherit /tmp
  await window.keyboard.press('Meta+t');
  await expect(window.locator('.pane')).toHaveCount(2);
  await window.waitForTimeout(2000);
  await window.locator('.pane').nth(1).locator('.xterm-helper-textarea').focus();
  await window.keyboard.type('pwd');
  await window.keyboard.press('Enter');
  await window.waitForTimeout(800);
  const buf = await bufferAt(window, 1);
  expect(buf).toMatch(/\/private\/tmp|\/tmp/);
  await app.close();
});

test('PR2-A6: single click on already-focused title enters rename', async () => {
  const { app, window } = await launchApp();
  await newTerminalViaButton(window);
  // Already focused; single click should switch to input
  await window.locator('.pane-header .title').first().click();
  await expect(window.locator('.pane-header .title input')).toBeVisible();
  await app.close();
});

test('PR2-A7: window bounds persist across restart', async () => {
  const userData = fs.mkdtempSync(path.join(os.tmpdir(), 'tg-bounds-'));
  const args = [path.join(process.cwd(), 'out/main/index.js'), `--user-data-dir=${userData}`];

  const app1 = await electron.launch({ args, env: { ...process.env, NODE_ENV: 'test' } });
  const w1 = await app1.firstWindow();
  await w1.waitForLoadState('domcontentloaded');
  await app1.evaluate(({ BrowserWindow }) => {
    const win = BrowserWindow.getAllWindows()[0];
    win.setBounds({ x: 100, y: 80, width: 1100, height: 700 });
  });
  await w1.waitForTimeout(500);
  await app1.close();

  const app2 = await electron.launch({ args, env: { ...process.env, NODE_ENV: 'test' } });
  const w2 = await app2.firstWindow();
  await w2.waitForLoadState('domcontentloaded');
  const bounds = await app2.evaluate(({ BrowserWindow }) => {
    return BrowserWindow.getAllWindows()[0].getBounds();
  });
  expect(bounds.width).toBe(1100);
  expect(bounds.height).toBe(700);
  await app2.close();
});

test('PR2-A8: sidebar resizer drag widens the sidebar and persists', async () => {
  const userData = fs.mkdtempSync(path.join(os.tmpdir(), 'tg-sb-'));
  const args = [path.join(process.cwd(), 'out/main/index.js'), `--user-data-dir=${userData}`];

  const app1 = await electron.launch({ args, env: { ...process.env, NODE_ENV: 'test' } });
  const w = await app1.firstWindow();
  await w.waitForLoadState('domcontentloaded');
  await w.getByRole('button', { name: /Open a new terminal|\+ New/i }).first().click();

  const initialWidth = await w.locator('.sidebar').evaluate((el) => (el as HTMLElement).offsetWidth);
  const resizer = w.locator('.sidebar-resizer');
  const rb = await resizer.boundingBox();
  if (!rb) throw new Error('no resizer');
  await w.mouse.move(rb.x + 2, rb.y + rb.height / 2);
  await w.mouse.down();
  await w.mouse.move(rb.x + 120, rb.y + rb.height / 2, { steps: 10 });
  await w.mouse.up();
  await w.waitForTimeout(400);

  const newWidth = await w.locator('.sidebar').evaluate((el) => (el as HTMLElement).offsetWidth);
  expect(newWidth).toBeGreaterThan(initialWidth + 50);
  await shot(w, 'pr2-01-sidebar-wider');
  await app1.close();

  // Reopen and verify width persisted
  const app2 = await electron.launch({ args, env: { ...process.env, NODE_ENV: 'test' } });
  const w2 = await app2.firstWindow();
  await w2.waitForLoadState('domcontentloaded');
  const restoredWidth = await w2.locator('.sidebar').evaluate((el) => (el as HTMLElement).offsetWidth);
  expect(restoredWidth).toBe(newWidth);
  await app2.close();
});

test('PR2-C6: ⌘C copies selection to clipboard', async () => {
  const { app, window } = await launchApp();
  await newTerminalViaButton(window);
  await window.locator('.xterm-helper-textarea').first().focus();
  await window.waitForTimeout(500);
  await window.keyboard.type('echo COPY_ME_PLEASE');
  await window.keyboard.press('Enter');
  await window.waitForTimeout(700);

  // Select via xterm API
  await window.evaluate(() => {
    const t = (window as any).__tg;
    // pick the terminal and selectAll via xterm API
    const arr: Array<{ id: string; term: any }> = (window as any).__tgEntries || [];
    // fallback: use registered terminal via __tg accessors? We don't expose Terminal directly.
    return null;
  });

  // Use mouse selection: triple-click a line that contains COPY_ME_PLEASE
  const screen = window.locator('.xterm-screen').first();
  const sb = await screen.boundingBox();
  if (!sb) throw new Error('no screen');
  // Triple click roughly where the echoed line lives (line 2 from top, approx)
  const y = sb.y + 35;
  await window.mouse.click(sb.x + 100, y, { clickCount: 3 });
  await window.waitForTimeout(150);

  // Read clipboard via Electron main
  await window.keyboard.press('Meta+c');
  await window.waitForTimeout(200);
  const clip = await app.evaluate(({ clipboard }) => clipboard.readText());
  expect(clip).toMatch(/COPY_ME_PLEASE/);
  await app.close();
});

test('PR2-A4: app menu installed with key items', async () => {
  const { app } = await launchApp();
  const items = await app.evaluate(({ Menu }) => {
    const m = Menu.getApplicationMenu();
    if (!m) return [];
    const collect = (menu: any): string[] =>
      menu.items.flatMap((it: any) => [it.label || it.role || '', ...(it.submenu ? collect(it.submenu) : [])]);
    return collect(m);
  });
  expect(items.join('|')).toMatch(/New Terminal/);
  expect(items.join('|')).toMatch(/Toggle Sidebar/);
  expect(items.join('|')).toMatch(/Command Palette/);
  await app.close();
});
