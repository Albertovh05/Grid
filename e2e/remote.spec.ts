import { test, expect, _electron as electron, type Page } from '@playwright/test';
import fs from 'fs';
import net from 'net';
import http from 'http';
import os from 'os';
import path from 'path';
import { launchApp, newTerminalViaButton } from './helpers';

function rawRequest(
  port: number,
  opts: { method?: string; pathName?: string; host?: string; body?: string }
): Promise<{ status: number }> {
  return new Promise((resolve, reject) => {
    const req = http.request(
      {
        host: '127.0.0.1',
        port,
        method: opts.method ?? 'GET',
        path: opts.pathName ?? '/remote',
        headers: {
          host: opts.host ?? `127.0.0.1:${port}`,
          ...(opts.body ? { 'content-type': 'application/json', 'content-length': Buffer.byteLength(opts.body) } : {}),
        },
      },
      (res) => {
        res.resume();
        res.on('end', () => resolve({ status: res.statusCode ?? 0 }));
      }
    );
    req.on('error', reject);
    if (opts.body) req.write(opts.body);
    req.end();
  });
}

async function freePort(): Promise<number> {
  return await new Promise((resolve, reject) => {
    const server = net.createServer();
    server.listen(0, '127.0.0.1', () => {
      const address = server.address();
      server.close(() => {
        if (address && typeof address === 'object') resolve(address.port);
        else reject(new Error('failed to resolve test port'));
      });
    });
    server.on('error', reject);
  });
}

async function inputFrames(page: Page): Promise<string[]> {
  return await page.evaluate(() => {
    const frames = ((window as unknown as { __remoteFrames?: string[] }).__remoteFrames ?? [])
      .map((raw) => {
        try {
          return JSON.parse(raw) as { type?: string; data?: string };
        } catch {
          return null;
        }
      })
      .filter((msg): msg is { type: string; data: string } => msg?.type === 'input' && typeof msg.data === 'string')
      .map((msg) => msg.data);
    return frames;
  });
}

test('remote shortcut bar sends Ctrl+U and phone scroll input', async () => {
  const { app, window } = await launchApp();
  await newTerminalViaButton(window);

  const port = await freePort();
  const status = await window.evaluate((remotePort) => {
    return (window as unknown as { api: { remote: { enable: (opts: { port: number; bindHost: '127.0.0.1' }) => Promise<{ pairingCode: string | null }> } } }).api.remote.enable({
      port: remotePort,
      bindHost: '127.0.0.1',
    });
  }, port);
  expect(status.pairingCode).toBeTruthy();

  await window.addInitScript(() => {
    (window as unknown as { __remoteFrames: string[] }).__remoteFrames = [];
    const originalSend = WebSocket.prototype.send;
    WebSocket.prototype.send = function patchedSend(data: string | ArrayBufferLike | Blob | ArrayBufferView) {
      if (typeof data === 'string') (window as unknown as { __remoteFrames: string[] }).__remoteFrames.push(data);
      return originalSend.call(this, data);
    };
  });

  await window.goto(`http://127.0.0.1:${port}/remote?pair=${encodeURIComponent(status.pairingCode!)}`);
  await expect(window.locator('#terminal .xterm')).toBeVisible({ timeout: 5000 });

  const shiftTab = window.locator('button[data-key="shift-tab"]');
  const ctrlU = window.locator('button[data-key="ctrl-u"]');
  await expect(ctrlU).toHaveClass(await shiftTab.getAttribute('class'));

  await ctrlU.click();
  await window.locator('button[data-scroll="up"]').click();
  await window.locator('button[data-scroll="down"]').click();
  await window.locator('#terminal').dispatchEvent('wheel', { deltaY: 120 });

  await window.evaluate(() => {
    const terminal = document.getElementById('terminal');
    const xterm = terminal?.querySelector('.xterm') as HTMLElement | null;
    if (terminal) terminal.scrollLeft = 0;
    if (xterm) xterm.style.width = '2400px';
  });
  await window.locator('button[data-pan="right"]').click();
  await expect.poll(() => window.evaluate(() => document.getElementById('terminal')?.scrollLeft ?? 0)).toBeGreaterThan(0);
  const afterRight = await window.evaluate(() => document.getElementById('terminal')?.scrollLeft ?? 0);
  await window.locator('button[data-pan="left"]').click();
  await expect.poll(() => window.evaluate(() => document.getElementById('terminal')?.scrollLeft ?? 0)).toBeLessThan(afterRight);

  await expect.poll(() => inputFrames(window), { timeout: 5000 }).toEqual(
    expect.arrayContaining([
      String.fromCharCode(21),
      expect.stringMatching(/\x1b\[<64;\d+;\d+M/),
      expect.stringMatching(/\x1b\[<65;\d+;\d+M/),
    ])
  );

  await app.close();
});

test('remote server rejects rebinding hosts and locks out pairing brute force', async () => {
  const { app, window } = await launchApp();
  const port = await freePort();
  await window.evaluate((remotePort) => {
    return (window as unknown as { api: { remote: { enable: (opts: { port: number; bindHost: '127.0.0.1' }) => Promise<unknown> } } }).api.remote.enable({
      port: remotePort,
      bindHost: '127.0.0.1',
    });
  }, port);

  // DNS-rebinding guard: an attacker-controlled domain in the Host header is refused.
  expect((await rawRequest(port, { host: 'evil.example.com' })).status).toBe(403);
  // A legitimate IP-literal host is served.
  expect((await rawRequest(port, { host: `127.0.0.1:${port}` })).status).toBe(200);

  // Brute-force lockout: repeated bad pairing codes get throttled with 429.
  const statuses: number[] = [];
  for (let i = 0; i < 7; i++) {
    statuses.push(
      (await rawRequest(port, { method: 'POST', pathName: '/api/pair', body: JSON.stringify({ pairingToken: 'zzzzzzzz' }) })).status
    );
  }
  expect(statuses).toContain(429);

  await app.close();
});

test('remote server auto-starts on relaunch when it was enabled', async () => {
  const userData = fs.mkdtempSync(path.join(os.tmpdir(), 'tg-remote-autostart-'));
  const port = await freePort();
  const args = [path.join(process.cwd(), 'out/main/index.js'), `--user-data-dir=${userData}`];

  const app1 = await electron.launch({ args, env: { ...process.env, NODE_ENV: 'test' } });
  const window1 = await app1.firstWindow();
  await window1.waitForLoadState('domcontentloaded');
  await window1.evaluate((remotePort) => {
    return (window as unknown as { api: { remote: { enable: (opts: { port: number; bindHost: '127.0.0.1' }) => Promise<unknown> } } }).api.remote.enable({
      port: remotePort,
      bindHost: '127.0.0.1',
    });
  }, port);
  await app1.close();

  const app2 = await electron.launch({ args, env: { ...process.env, NODE_ENV: 'test' } });
  const window2 = await app2.firstWindow();
  await window2.waitForLoadState('domcontentloaded');

  await expect
    .poll(
      () =>
        window2.evaluate(() =>
          (window as unknown as { api: { remote: { getStatus: () => Promise<{ running: boolean; port: number }> } } }).api.remote.getStatus()
        ),
      { timeout: 8000 }
    )
    .toMatchObject({ running: true, port });

  await app2.close();
});
