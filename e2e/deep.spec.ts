import { test, expect, _electron as electron } from '@playwright/test';
import { launchApp, shot, newTerminalViaButton } from './helpers';
import path from 'path';
import fs from 'fs';
import os from 'os';

async function readXtermText(window: any): Promise<string> {
  return await window.evaluate((idx?: number) => {
    const panes = document.querySelectorAll('.xterm-rows');
    const target = idx == null ? panes[0] : panes[idx];
    if (!target) return '';
    return Array.from(target.children).map((c) => (c as HTMLElement).textContent || '').join('\n');
  });
}

test('shell prompt is visible after pane mount', async () => {
  const { app, window } = await launchApp();
  await newTerminalViaButton(window);
  await expect(window.locator('.xterm')).toBeVisible();

  // Give shell a generous beat to print prompt
  await window.waitForTimeout(1500);
  const text = await readXtermText(window);
  await shot(window, 'deep-01-prompt');

  // Most shells emit either a $ , #, %, or a path-like prefix
  expect(text.length, `xterm appears blank. content: ${JSON.stringify(text)}`).toBeGreaterThan(0);
  expect(text, `no visible prompt char. content: ${JSON.stringify(text)}`).toMatch(/[\$#%>➜❯λ]/);

  await app.close();
});

test('rename via double-click on pane title', async () => {
  const { app, window } = await launchApp();
  await newTerminalViaButton(window);
  const title = window.locator('.pane-header .title').first();
  await title.dblclick();
  const input = title.locator('input');
  await expect(input).toBeVisible();
  await input.fill('my-renamed-term');
  await input.press('Enter');
  await expect(title).toHaveText('my-renamed-term');
  // Sidebar should reflect rename
  await expect(window.locator('.term-item.active .name')).toContainText('my-renamed-term');
  await shot(window, 'deep-02-rename');
  await app.close();
});

test('zoom ⌘E hides other panes and fills grid', async () => {
  const { app, window } = await launchApp();
  await newTerminalViaButton(window);
  await window.locator('.xterm-helper-textarea').first().focus();
  await window.keyboard.press('Meta+t');
  await window.keyboard.press('Meta+t');
  await expect(window.locator('.pane')).toHaveCount(3);
  await window.keyboard.press('Meta+e');
  // Only one pane should be visible (others display:none)
  await expect(window.locator('.pane.zoomed')).toHaveCount(1);
  const visible = await window.locator('.pane:visible').count();
  expect(visible).toBe(1);
  await shot(window, 'deep-03-zoom');
  // Unzoom
  await window.keyboard.press('Meta+e');
  await expect(window.locator('.pane:visible')).toHaveCount(3);
  await app.close();
});

test('close last terminal returns to empty state', async () => {
  const { app, window } = await launchApp();
  await newTerminalViaButton(window);
  await window.locator('.xterm-helper-textarea').first().focus();
  await window.keyboard.press('Meta+w');
  await expect(window.locator('.empty')).toBeVisible();
  await expect(window.locator('.pane')).toHaveCount(0);
  await app.close();
});

test('layout persists across restart with same userData', async () => {
  const userData = fs.mkdtempSync(path.join(os.tmpdir(), 'tg-persist-'));
  const argsBase = [path.join(process.cwd(), 'out/main/index.js'), `--user-data-dir=${userData}`];

  // Session 1: open two terminals, rename one
  const app1 = await electron.launch({ args: argsBase, env: { ...process.env, NODE_ENV: 'test' } });
  const w1 = await app1.firstWindow();
  await w1.waitForLoadState('domcontentloaded');
  await w1.getByRole('button', { name: /Open a new terminal|\+ New/i }).first().click();
  await w1.waitForTimeout(300);
  await w1.locator('.xterm-helper-textarea').first().focus();
  await w1.keyboard.press('Meta+t');
  await expect(w1.locator('.pane')).toHaveCount(2);
  const firstTitle = w1.locator('.pane-header .title').first();
  await firstTitle.dblclick();
  await firstTitle.locator('input').fill('persisted-tab');
  await firstTitle.locator('input').press('Enter');
  await w1.waitForTimeout(200); // let layout.set IPC flush
  await app1.close();

  // Session 2: relaunch and verify
  const app2 = await electron.launch({ args: argsBase, env: { ...process.env, NODE_ENV: 'test' } });
  const w2 = await app2.firstWindow();
  await w2.waitForLoadState('domcontentloaded');
  await expect(w2.locator('.pane')).toHaveCount(2, { timeout: 5000 });
  // The renamed one should still be present in sidebar list
  await expect(w2.locator('.term-item').filter({ hasText: 'persisted-tab' })).toHaveCount(1);
  await shot(w2, 'deep-04-persisted');
  await app2.close();
});

test('data from one terminal does not leak into another', async () => {
  const { app, window } = await launchApp();
  await newTerminalViaButton(window);
  await window.locator('.xterm-helper-textarea').first().focus();
  await window.keyboard.press('Meta+t');
  await expect(window.locator('.pane')).toHaveCount(2);

  // Focus first pane, type unique string
  const panes = window.locator('.pane');
  await panes.nth(0).locator('.xterm-helper-textarea').focus();
  await window.keyboard.type('echo PANE_ONE_MARK');
  await window.keyboard.press('Enter');
  await window.waitForTimeout(800);

  // Focus second pane, type a different unique string
  await panes.nth(1).locator('.xterm-helper-textarea').focus();
  await window.keyboard.type('echo PANE_TWO_MARK');
  await window.keyboard.press('Enter');
  await window.waitForTimeout(800);

  const t0 = await readXtermText(window);
  const t1 = await window.evaluate(() => {
    const r = document.querySelectorAll('.xterm-rows')[1];
    return r ? Array.from(r.children).map((c) => (c as HTMLElement).textContent || '').join('\n') : '';
  });

  expect(t0).toContain('PANE_ONE_MARK');
  expect(t0).not.toContain('PANE_TWO_MARK');
  expect(t1).toContain('PANE_TWO_MARK');
  expect(t1).not.toContain('PANE_ONE_MARK');
  await app.close();
});

test('command palette opens then runs new-terminal command', async () => {
  const { app, window } = await launchApp();
  await window.keyboard.press('Meta+Shift+p');
  await expect(window.locator('.palette')).toBeVisible();
  await window.locator('.palette input').fill('new');
  await window.keyboard.press('Enter');
  await expect(window.locator('.pane')).toHaveCount(1);
  await app.close();
});
