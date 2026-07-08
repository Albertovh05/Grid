import { execFile, spawn } from 'child_process';
import fs from 'fs';
import os from 'os';
import path from 'path';

export interface TailscaleStartResult {
  attempted: boolean;
  ok: boolean;
  state?: string;
  tailnetIp?: string;
  error?: string;
}

interface TailscaleStatus {
  BackendState?: string;
}

function exec(command: string, args: string[], timeout = 5000): Promise<{ stdout: string; stderr: string }> {
  return new Promise((resolve, reject) => {
    execFile(command, args, { timeout, windowsHide: true }, (err, stdout, stderr) => {
      if (err) {
        reject(Object.assign(err, { stdout, stderr }));
        return;
      }
      resolve({ stdout: String(stdout), stderr: String(stderr) });
    });
  });
}

function errorText(err: unknown, fallback: string): string {
  if (!err || typeof err !== 'object') return err instanceof Error ? err.message : fallback;
  const e = err as Error & { stdout?: string; stderr?: string };
  const output = [e.message, e.stderr, e.stdout]
    .map((part) => String(part ?? '').trim())
    .filter(Boolean)
    .join(': ');
  return output || fallback;
}

async function commandExists(command: string): Promise<boolean> {
  try {
    await exec(command, ['version'], 3000);
    return true;
  } catch {
    return false;
  }
}

function windowsTailscaleCandidates(binary: string): string[] {
  if (os.platform() !== 'win32') return [];
  return [
    process.env['ProgramFiles'] ? path.join(process.env['ProgramFiles'], 'Tailscale', binary) : null,
    process.env['ProgramFiles(x86)'] ? path.join(process.env['ProgramFiles(x86)'], 'Tailscale', binary) : null,
    process.env['LOCALAPPDATA'] ? path.join(process.env['LOCALAPPDATA'], 'Tailscale', binary) : null,
  ].filter(Boolean) as string[];
}

async function findTailscaleCommand(): Promise<string | null> {
  if (await commandExists('tailscale')) return 'tailscale';

  const candidates = windowsTailscaleCandidates('tailscale.exe');
  return candidates.find((candidate) => fs.existsSync(candidate)) ?? null;
}

function findTailscaleClientCommand(): string | null {
  return windowsTailscaleCandidates('tailscale-ipn.exe').find((candidate) => fs.existsSync(candidate)) ?? null;
}

function startWindowsClient(): boolean {
  const command = findTailscaleClientCommand();
  if (!command) return false;
  try {
    const child = spawn(command, [], {
      detached: true,
      stdio: 'ignore',
      windowsHide: true,
    });
    child.unref();
    return true;
  } catch {
    return false;
  }
}

async function startWindowsService(): Promise<void> {
  if (os.platform() !== 'win32') return;
  try {
    await exec('net', ['start', 'Tailscale'], 8000);
  } catch {
    // The service may already be running, disabled, or require elevation.
  }
}

async function readStatus(command: string): Promise<TailscaleStatus> {
  const { stdout } = await exec(command, ['status', '--json'], 5000);
  return JSON.parse(stdout) as TailscaleStatus;
}

function isTailscaleIp(host: string): boolean {
  const m = host.match(/^(\d{1,3})\.(\d{1,3})\.\d{1,3}\.\d{1,3}$/);
  if (!m) return false;
  const a = Number(m[1]);
  const b = Number(m[2]);
  return a === 100 && b >= 64 && b <= 127;
}

export function findTailnetIpv4(): string | null {
  for (const interfaces of Object.values(os.networkInterfaces())) {
    for (const item of interfaces ?? []) {
      if (item.family === 'IPv4' && !item.internal && isTailscaleIp(item.address)) return item.address;
    }
  }
  return null;
}

async function waitForTailnetIpv4(timeoutMs = 10_000): Promise<string | null> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const ip = findTailnetIpv4();
    if (ip) return ip;
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
  return findTailnetIpv4();
}

export async function ensureTailscaleUp(): Promise<TailscaleStartResult> {
  const command = await findTailscaleCommand();
  const clientStarted = startWindowsClient();
  if (!command && !clientStarted) return { attempted: false, ok: false, error: 'Tailscale is not installed' };

  await startWindowsService();

  let state: string | undefined;
  let statusError: string | undefined;
  if (command) {
    try {
      state = (await readStatus(command)).BackendState;
    } catch (err) {
      statusError = errorText(err, 'Unable to read Tailscale status');
    }
  }

  let tailnetIp = await waitForTailnetIpv4(state === 'Running' ? 3000 : 7000);
  if (tailnetIp) return { attempted: clientStarted, ok: true, state, tailnetIp };

  if (state && !['Stopped', 'Starting', 'NeedsMachineAuth', 'NoState'].includes(state)) {
    return { attempted: clientStarted, ok: false, state, error: `Tailscale is ${state}` };
  }

  if (command) {
    try {
      await exec(command, ['up'], 15_000);
      state = (await readStatus(command).catch(() => ({ BackendState: state }))).BackendState;
    } catch (err) {
      statusError = errorText(err, 'Unable to start Tailscale');
    }
  }

  tailnetIp = await waitForTailnetIpv4(10_000);
  return {
    attempted: true,
    ok: Boolean(tailnetIp),
    state,
    tailnetIp: tailnetIp ?? undefined,
    error: tailnetIp
      ? undefined
      : statusError ?? 'Tailscale started, but this computer does not have a tailnet IP yet. Sign in to Tailscale on this computer.',
  };
}
