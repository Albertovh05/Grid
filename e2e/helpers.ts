import { _electron as electron, ElectronApplication, Page } from '@playwright/test';
import path from 'path';
import fs from 'fs';
import os from 'os';

export async function launchApp(): Promise<{ app: ElectronApplication; window: Page; userData: string }> {
  // Use a clean temp userData dir per run so persistence tests are deterministic
  const userData = fs.mkdtempSync(path.join(os.tmpdir(), 'tg-e2e-'));

  const app = await electron.launch({
    args: [path.join(process.cwd(), 'out/main/index.js'), `--user-data-dir=${userData}`],
    env: { ...process.env, NODE_ENV: 'test', ELECTRON_ENABLE_LOGGING: '1' },
    timeout: 30_000,
  });

  const window = await app.firstWindow();
  await window.waitForLoadState('domcontentloaded');
  // Auto-accept any window.confirm dialogs (e.g. close-with-running-process)
  window.on('dialog', (d) => d.accept().catch(() => undefined));
  return { app, window, userData };
}

export async function shot(window: Page, name: string) {
  const dir = path.join(process.cwd(), 'e2e/_screens');
  fs.mkdirSync(dir, { recursive: true });
  await window.screenshot({ path: path.join(dir, `${name}.png`), fullPage: false });
}

export async function newTerminalViaButton(window: Page) {
  await window.getByRole('button', { name: /Open a new terminal|\+ New/i }).first().click();
}
