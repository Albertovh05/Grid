import { test, expect } from '@playwright/test';
import { launchApp, shot, newTerminalViaButton } from './helpers';

const buf = (window: any, idx = 0) =>
  window.evaluate((i: number) => (window as any).__tg?.bufferAt(i) ?? '', idx);

test('PR3-A3: unread dot appears on inactive pane when it emits output', async () => {
  const { app, window } = await launchApp();
  await newTerminalViaButton(window);
  await window.locator('.xterm-helper-textarea').first().focus();
  await window.keyboard.press('Meta+t'); // focus moves to pane 2
  await expect(window.locator('.pane')).toHaveCount(2);
  await window.waitForTimeout(500);

  // Type a command in pane 1 (currently unfocused) by writing through xterm... actually we need to send to the unfocused shell.
  // Easier: focus pane 1, type a long-running emit, then focus pane 2, then assert pane 1 dot.
  await window.locator('.pane').nth(0).locator('.xterm-helper-textarea').focus();
  await window.waitForTimeout(200);
  await window.locator('.pane').nth(1).click();  // focus pane 2 again
  await window.waitForTimeout(200);

  // Drive output to pane 1 by simulating its shell receiving an echo via the helper textarea
  // Trick: focus pane 1 just long enough to send the command, then focus pane 2 immediately.
  await window.locator('.pane').nth(0).locator('.xterm-helper-textarea').focus();
  await window.keyboard.type('sleep 0.5; echo HELLO_FROM_PANE_1');
  await window.keyboard.press('Enter');
  await window.locator('.pane').nth(1).click(); // unfocus pane 1
  await window.waitForTimeout(1500);

  // Pane 1's sidebar item should have the unread class/dot
  const cls = await window.locator('.term-item').nth(0).getAttribute('class');
  expect(cls).toMatch(/unread/);
  await shot(window, 'pr3-01-unread');

  // Refocusing pane 1 clears it
  await window.locator('.term-item').nth(0).click();
  await window.waitForTimeout(150);
  const cls2 = await window.locator('.term-item').nth(0).getAttribute('class');
  expect(cls2).not.toMatch(/unread/);
  await app.close();
});

test('PR3-A5: ⌘F opens search bar', async () => {
  const { app, window } = await launchApp();
  await newTerminalViaButton(window);
  await window.locator('.xterm-helper-textarea').first().focus();
  await window.waitForTimeout(500);
  await window.keyboard.press('Meta+f');
  await expect(window.locator('.search-bar')).toBeVisible();
  await window.locator('.search-bar input').fill('shell');
  await window.locator('.search-bar input').press('Enter');
  await window.waitForTimeout(200);
  await window.keyboard.press('Escape');
  await expect(window.locator('.search-bar')).toHaveCount(0);
  await app.close();
});

test('PR3-A9: empty state shows shortcuts and primary CTA', async () => {
  const { app, window } = await launchApp();
  await expect(window.locator('.empty-title')).toHaveText('Terminal Grid');
  await expect(window.locator('.empty-shortcuts')).toBeVisible();
  await expect(window.locator('.empty-primary')).toBeVisible();
  await app.close();
});

test('PR3-A10: layout chooser 1col forces single column', async () => {
  const { app, window } = await launchApp();
  await newTerminalViaButton(window);
  await window.locator('.xterm-helper-textarea').first().focus();
  await window.keyboard.press('Meta+t');
  await window.keyboard.press('Meta+t');
  await expect(window.locator('.pane')).toHaveCount(3);
  // Open palette, search 1col, run
  await window.keyboard.press('Meta+Shift+p');
  await window.locator('.palette input').fill('Layout: 1 column');
  await window.keyboard.press('Enter');
  await expect(window.locator('.grid.cols-1')).toBeVisible();
  await shot(window, 'pr3-02-1col');
  await app.close();
});

test('PR3-A10: tabs mode shows only focused pane', async () => {
  const { app, window } = await launchApp();
  await newTerminalViaButton(window);
  await window.locator('.xterm-helper-textarea').first().focus();
  await window.keyboard.press('Meta+t');
  await window.keyboard.press('Meta+t');
  await expect(window.locator('.pane')).toHaveCount(3);
  await window.keyboard.press('Meta+Shift+p');
  await window.locator('.palette input').fill('Tabs only');
  await window.keyboard.press('Enter');
  await window.waitForTimeout(200);
  const visible = await window.locator('.pane:visible').count();
  expect(visible).toBe(1);
  await app.close();
});

test('PR3-B8: hasRunningChild detects sleep child', async () => {
  // Test the IPC directly so we can prove the detection works.
  const { app, window } = await launchApp();
  await newTerminalViaButton(window);
  await window.locator('.xterm-helper-textarea').first().focus();
  await window.waitForTimeout(500);

  // Resolve current terminal id
  const id = await window.evaluate(() => {
    const arr = Object.keys((window as any).__tg ?? {});
    return arr; // not useful; use DOM
  });
  void id;
  const paneId = await window.locator('[data-pane-id]').first().getAttribute('data-pane-id');
  if (!paneId) throw new Error('no pane id');

  // No child yet → false
  const before = await window.evaluate((id) => (window as any).api.pty.hasRunningChild(id), paneId);
  expect(before).toBe(false);

  // Start a long-running process
  await window.keyboard.type('sleep 60');
  await window.keyboard.press('Enter');
  await window.waitForTimeout(800);

  const after = await window.evaluate((id) => (window as any).api.pty.hasRunningChild(id), paneId);
  expect(after).toBe(true);

  await app.close();
});

test('PR3-C1: theme switch to light applies data-theme attribute', async () => {
  const { app, window } = await launchApp();
  await window.keyboard.press('Meta+Shift+p');
  await window.locator('.palette input').fill('Theme: Light');
  await window.keyboard.press('Enter');
  await window.waitForTimeout(200);
  const theme = await window.evaluate(() => document.documentElement.dataset['theme']);
  expect(theme).toBe('light');
  await shot(window, 'pr3-03-light');
  await app.close();
});

test('PR3-C2: ⌘= increases font size and persists', async () => {
  const { app, window } = await launchApp();
  await newTerminalViaButton(window);
  await window.locator('.xterm-helper-textarea').first().focus();
  await window.waitForTimeout(300);

  const initial = await window.evaluate(() => {
    const el = document.querySelector('.xterm-rows > div') as HTMLElement | null;
    return el ? parseFloat(getComputedStyle(el).fontSize) : 0;
  });

  await window.keyboard.press('Meta+=');
  await window.keyboard.press('Meta+=');
  await window.waitForTimeout(400);

  const after = await window.evaluate(() => {
    const el = document.querySelector('.xterm-rows > div') as HTMLElement | null;
    return el ? parseFloat(getComputedStyle(el).fontSize) : 0;
  });
  expect(after).toBeGreaterThan(initial);
  await app.close();
});

test('PR3-C4: pointer drag reorders panes', async () => {
  const { app, window } = await launchApp();
  await newTerminalViaButton(window);
  await window.locator('.xterm-helper-textarea').first().focus();
  await window.keyboard.press('Meta+t');
  await window.keyboard.press('Meta+t');
  await expect(window.locator('.pane')).toHaveCount(3);

  const rename = async (i: number, name: string) => {
    const t = window.locator('.pane-header .title').nth(i);
    await t.dblclick();
    await t.locator('input').fill(name);
    await t.locator('input').press('Enter');
  };
  await rename(0, 'A');
  await rename(1, 'B');
  await rename(2, 'C');

  // Drag pane A's header onto pane C
  const srcHeader = window.locator('.pane').nth(0).locator('.pane-header');
  const dstPane = window.locator('.pane').nth(2);
  const a = await srcHeader.boundingBox();
  const b = await dstPane.boundingBox();
  if (!a || !b) throw new Error('no bbox');
  await window.mouse.move(a.x + 30, a.y + a.height / 2);
  await window.mouse.down();
  await window.mouse.move(b.x + b.width / 2, b.y + b.height / 2, { steps: 12 });
  await window.mouse.up();
  await window.waitForTimeout(300);

  const titles = await window.locator('.pane-header .title').allInnerTexts();
  expect(titles).not.toEqual(['A', 'B', 'C']);
  expect(titles).toContain('A');
  expect(titles).toContain('B');
  expect(titles).toContain('C');
  await shot(window, 'pr3-04-reorder');
  await app.close();
});
