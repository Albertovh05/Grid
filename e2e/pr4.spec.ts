import { test, expect } from '@playwright/test';
import { launchApp, shot, newTerminalViaButton } from './helpers';

test('PR4: right-click on pane opens context menu with archive', async () => {
  const { app, window } = await launchApp();
  await newTerminalViaButton(window);
  const pane = window.locator('.pane').first();
  await pane.click({ button: 'right' });
  await expect(window.locator('.ctx-menu')).toBeVisible();
  await expect(window.locator('.ctx-item', { hasText: 'Archive' })).toBeVisible();
  await expect(window.locator('.ctx-item', { hasText: 'Close' })).toBeVisible();
  await expect(window.locator('.ctx-item', { hasText: 'Rename' })).toBeVisible();
  await shot(window, 'pr4-01-ctxmenu');
  // Escape closes menu
  await window.keyboard.press('Escape');
  await expect(window.locator('.ctx-menu')).toHaveCount(0);
  await app.close();
});

test('PR4: archive moves terminal to archived list and unarchive restores it', async () => {
  const { app, window } = await launchApp();
  await newTerminalViaButton(window);
  await window.locator('.xterm-helper-textarea').first().focus();
  await window.keyboard.press('Meta+t');
  await expect(window.locator('.pane')).toHaveCount(2);

  // Right-click first pane, choose Archive
  await window.locator('.pane').first().click({ button: 'right' });
  await window.locator('.ctx-item', { hasText: 'Archive' }).click();
  await expect(window.locator('.pane')).toHaveCount(1);

  // Archived section should appear in sidebar
  await window.locator('.sidebar-archived-header').click(); // expand
  await expect(window.locator('.term-item.archived')).toHaveCount(1);
  await shot(window, 'pr4-02-archived');

  // Click archived item → restored
  await window.locator('.term-item.archived').first().click();
  await expect(window.locator('.pane')).toHaveCount(2);
  await app.close();
});

test('PR4: duplicate creates a sibling in same cwd', async () => {
  const { app, window } = await launchApp();
  await newTerminalViaButton(window);
  await window.locator('.xterm-helper-textarea').first().focus();
  await window.waitForTimeout(500);
  await window.keyboard.type('cd /tmp');
  await window.keyboard.press('Enter');
  await window.waitForTimeout(3500);

  await window.locator('.pane').first().click({ button: 'right' });
  await window.locator('.ctx-item', { hasText: 'Duplicate' }).click();
  await expect(window.locator('.pane')).toHaveCount(2);

  await window.waitForTimeout(1500);
  await window.locator('.pane').nth(1).locator('.xterm-helper-textarea').focus();
  await window.keyboard.type('pwd');
  await window.keyboard.press('Enter');
  await window.waitForTimeout(800);
  const buf = await window.evaluate(() => (window as any).__tg?.bufferAt(1) ?? '');
  expect(buf).toMatch(/\/private\/tmp|\/tmp/);
  await app.close();
});

test('PR4: ⌘D duplicates focused terminal', async () => {
  const { app, window } = await launchApp();
  await newTerminalViaButton(window);
  await window.locator('.xterm-helper-textarea').first().focus();
  await window.waitForTimeout(300);
  await window.keyboard.press('Meta+d');
  await expect(window.locator('.pane')).toHaveCount(2);
  await app.close();
});

test('PR4: sidebar toggle button is visible and toggles', async () => {
  const { app, window } = await launchApp();
  const btn = window.locator('.sidebar-toggle');
  await expect(btn).toBeVisible();
  await expect(window.locator('.sidebar')).toBeVisible();

  await btn.click();
  await expect(window.locator('.sidebar.hidden')).toBeAttached();

  // Still visible even when sidebar is hidden — user can reopen
  await expect(btn).toBeVisible();
  await btn.click();
  await expect(window.locator('.sidebar.hidden')).toHaveCount(0);
  await app.close();
});

test('PR4: right-click on sidebar item opens menu too', async () => {
  const { app, window } = await launchApp();
  await newTerminalViaButton(window);
  await expect(window.locator('.term-item')).toHaveCount(1);
  await window.locator('.term-item').first().click({ button: 'right' });
  await expect(window.locator('.ctx-menu')).toBeVisible();
  await app.close();
});

test('PR4: clicking outside the context menu closes it', async () => {
  const { app, window } = await launchApp();
  await newTerminalViaButton(window);
  await window.locator('.pane').first().click({ button: 'right' });
  await expect(window.locator('.ctx-menu')).toBeVisible();
  await window.mouse.click(50, 50);
  await expect(window.locator('.ctx-menu')).toHaveCount(0);
  await app.close();
});
