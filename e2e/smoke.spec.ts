import { test, expect } from '@playwright/test';
import { launchApp, shot, newTerminalViaButton } from './helpers';

test('app boots with empty state', async () => {
  const { app, window } = await launchApp();
  await expect(window.locator('.app')).toBeVisible();
  await expect(window.locator('.empty')).toBeVisible();
  await shot(window, '01-empty');
  await app.close();
});

test('opens a new terminal and shows xterm', async () => {
  const { app, window } = await launchApp();
  await newTerminalViaButton(window);
  await expect(window.locator('.pane')).toBeVisible({ timeout: 5000 });
  await expect(window.locator('.xterm')).toBeVisible({ timeout: 5000 });
  await shot(window, '02-one-terminal');
  await app.close();
});

test('shortcuts work even when xterm has focus (Cmd+T, Cmd+W)', async () => {
  const { app, window } = await launchApp();
  await newTerminalViaButton(window);
  await expect(window.locator('.pane')).toHaveCount(1);

  // Focus the xterm explicitly
  await window.locator('.xterm-helper-textarea').first().focus();

  // Cmd+T should open a new terminal even though xterm is focused
  await window.keyboard.press('Meta+t');
  await expect(window.locator('.pane')).toHaveCount(2, { timeout: 3000 });

  await window.keyboard.press('Meta+t');
  await expect(window.locator('.pane')).toHaveCount(3, { timeout: 3000 });

  await shot(window, '03-three-terminals');

  // Cmd+W closes the focused one
  await window.keyboard.press('Meta+w');
  await expect(window.locator('.pane')).toHaveCount(2, { timeout: 3000 });

  await app.close();
});

test('shell output reaches xterm', async () => {
  const { app, window } = await launchApp();
  await newTerminalViaButton(window);
  await expect(window.locator('.xterm')).toBeVisible();
  await window.locator('.xterm-helper-textarea').first().focus();

  // Type a command and press enter
  await window.keyboard.type('echo HELLO_FROM_E2E_TEST');
  await window.keyboard.press('Enter');

  // Wait until xterm screen contains the expected string
  await expect.poll(
    async () => {
      const text = await window.evaluate(() => {
        const lines = document.querySelectorAll('.xterm-rows > div');
        return Array.from(lines).map((l) => l.textContent || '').join('\n');
      });
      return text;
    },
    { timeout: 8000, intervals: [200, 400, 800, 1500] }
  ).toMatch(/HELLO_FROM_E2E_TEST/);

  await shot(window, '04-shell-output');
  await app.close();
});

test('sidebar toggles, command palette opens', async () => {
  const { app, window } = await launchApp();
  await newTerminalViaButton(window);

  await expect(window.locator('.sidebar')).toBeVisible();
  await window.keyboard.press('Meta+b');
  await expect(window.locator('.sidebar.hidden')).toBeAttached();

  // Open palette
  await window.keyboard.press('Meta+Shift+p');
  await expect(window.locator('.palette')).toBeVisible({ timeout: 3000 });
  await shot(window, '05-palette');
  await window.keyboard.press('Escape');
  await expect(window.locator('.palette')).toHaveCount(0);

  await app.close();
});

test('Cmd+1..N focuses terminals', async () => {
  const { app, window } = await launchApp();
  await newTerminalViaButton(window);
  await window.locator('.xterm-helper-textarea').first().focus();
  await window.keyboard.press('Meta+t');
  await window.keyboard.press('Meta+t');
  await expect(window.locator('.pane')).toHaveCount(3);

  await window.keyboard.press('Meta+1');
  await expect(window.locator('.pane.focused').first()).toBeVisible();

  // 1st sidebar item should be active
  const activeText = await window.locator('.term-item.active .name').innerText();
  expect(activeText).toMatch(/^1\./);

  await app.close();
});
