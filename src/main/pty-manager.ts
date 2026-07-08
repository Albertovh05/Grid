import { spawn, IPty } from 'node-pty';
import { EventEmitter } from 'events';
import { execFile } from 'child_process';
import os from 'os';
import fs from 'fs';

interface PtySession {
  id: string;
  proc: IPty;
  cols: number;
  rows: number;
}

const ELECTRON_ENV_PREFIXES = ['ELECTRON_', 'CHROME_', 'GOOGLE_API_KEY'];
const ELECTRON_ENV_KEYS = new Set([
  'ELECTRON_RUN_AS_NODE',
  'ELECTRON_NO_ATTACH_CONSOLE',
  'ORIGINAL_XDG_CURRENT_DESKTOP',
  'NODE_OPTIONS',
]);

function cleanEnv(src: NodeJS.ProcessEnv): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(src)) {
    if (v == null) continue;
    if (ELECTRON_ENV_KEYS.has(k)) continue;
    if (ELECTRON_ENV_PREFIXES.some((p) => k.startsWith(p))) continue;
    out[k] = v;
  }
  out['TERM'] = 'xterm-256color';
  out['COLORTERM'] = 'truecolor';
  out['TERM_PROGRAM'] = 'TerminalGrid';
  return out;
}

function pickShell(requested?: string): string {
  const candidates = [
    requested,
    process.env['SHELL'],
    (() => {
      try {
        const u = os.userInfo() as { shell?: string };
        return u.shell;
      } catch {
        return undefined;
      }
    })(),
    os.platform() === 'win32' ? 'powershell.exe' : '/bin/zsh',
    '/bin/bash',
    '/bin/sh',
  ].filter(Boolean) as string[];
  for (const c of candidates) {
    if (os.platform() === 'win32') return c; // can't easily stat shell.exe
    try {
      if (fs.existsSync(c)) return c;
    } catch {
      /* ignore */
    }
  }
  return '/bin/sh';
}

function safeDims(cols: number, rows: number): { cols: number; rows: number } {
  const c = Number.isFinite(cols) && cols > 0 ? Math.floor(cols) : 80;
  const r = Number.isFinite(rows) && rows > 0 ? Math.floor(rows) : 24;
  return { cols: Math.max(c, 10), rows: Math.max(r, 5) };
}

export interface PtyManager {
  on(event: 'data', listener: (id: string, data: string) => void): this;
  on(event: 'exit', listener: (id: string, exitCode: number, signal?: number) => void): this;
  on(event: 'resize', listener: (id: string, cols: number, rows: number) => void): this;
}

export class PtyManager extends EventEmitter {
  private sessions = new Map<string, PtySession>();
  private scrollback = new Map<string, string>();
  private readonly maxScrollbackBytes = 200_000;

  create(opts: { id: string; cols: number; rows: number; cwd?: string; shell?: string }): { id: string } {
    if (this.sessions.has(opts.id)) return { id: opts.id };

    const shell = pickShell(opts.shell);
    const cwd = opts.cwd && this.dirExists(opts.cwd) ? opts.cwd : os.homedir();
    const { cols, rows } = safeDims(opts.cols, opts.rows);

    const proc = spawn(shell, [], {
      name: 'xterm-256color',
      cols,
      rows,
      cwd,
      env: cleanEnv(process.env),
    });

    proc.onData((data) => {
      this.appendScrollback(opts.id, data);
      this.emit('data', opts.id, data);
    });

    proc.onExit(({ exitCode, signal }) => {
      this.emit('exit', opts.id, exitCode, signal);
      this.sessions.delete(opts.id);
    });

    this.sessions.set(opts.id, { id: opts.id, proc, cols, rows });
    return { id: opts.id };
  }

  write(id: string, data: string): void {
    const s = this.sessions.get(id);
    if (!s) return;
    s.proc.write(data);
  }

  hasSession(id: string): boolean {
    return this.sessions.has(id);
  }

  getRecentOutput(id: string): string {
    return this.scrollback.get(id) ?? '';
  }

  getDimensions(id: string): { cols: number; rows: number } | null {
    const s = this.sessions.get(id);
    return s ? { cols: s.cols, rows: s.rows } : null;
  }

  resize(id: string, cols: number, rows: number): void {
    const s = this.sessions.get(id);
    if (!s) return;
    const dims = safeDims(cols, rows);
    try {
      s.proc.resize(dims.cols, dims.rows);
      s.cols = dims.cols;
      s.rows = dims.rows;
      this.emit('resize', id, dims.cols, dims.rows);
    } catch {
      // ignore resize errors on closed sessions
    }
  }

  /** Returns true if the pty has a foreground child different from the shell. */
  async hasRunningChild(id: string): Promise<boolean> {
    const s = this.sessions.get(id);
    if (!s) return false;
    const shellPid = s.proc.pid;
    if (!shellPid) return false;
    try {
      if (os.platform() === 'linux') {
        // pgrep -P <shellPid> would list children
        return await new Promise<boolean>((resolve) => {
          execFile('pgrep', ['-P', String(shellPid)], (err, stdout) => {
            resolve(!err && String(stdout).trim().length > 0);
          });
        });
      }
      // macOS/BSD: pgrep with -P also works
      return await new Promise<boolean>((resolve) => {
        execFile('pgrep', ['-P', String(shellPid)], { timeout: 1000 }, (err, stdout) => {
          resolve(!err && String(stdout).trim().length > 0);
        });
      });
    } catch {
      return false;
    }
  }

  async getCwd(id: string): Promise<string | null> {
    const s = this.sessions.get(id);
    if (!s) return null;
    const pid = s.proc.pid;
    if (!pid) return null;
    try {
      if (os.platform() === 'linux') {
        return fs.readlinkSync(`/proc/${pid}/cwd`);
      }
      // macOS / BSD: use lsof
      return await new Promise<string | null>((resolve) => {
        execFile('lsof', ['-a', '-p', String(pid), '-d', 'cwd', '-Fn'], { timeout: 1500 }, (err, stdout) => {
          if (err) return resolve(null);
          // Output lines starting with 'n' contain the path
          for (const line of String(stdout).split('\n')) {
            if (line.startsWith('n')) return resolve(line.slice(1));
          }
          resolve(null);
        });
      });
    } catch {
      return null;
    }
  }

  private dirExists(p: string): boolean {
    try {
      return fs.statSync(p).isDirectory();
    } catch {
      return false;
    }
  }

  dispose(id: string): void {
    const s = this.sessions.get(id);
    if (!s) return;
    try {
      s.proc.kill();
    } catch {
      // ignore
    }
    this.sessions.delete(id);
    this.scrollback.delete(id);
  }

  disposeAll(): void {
    for (const id of [...this.sessions.keys()]) this.dispose(id);
  }

  private appendScrollback(id: string, data: string): void {
    const next = (this.scrollback.get(id) ?? '') + data;
    if (next.length <= this.maxScrollbackBytes) {
      this.scrollback.set(id, next);
      return;
    }
    this.scrollback.set(id, next.slice(next.length - this.maxScrollbackBytes));
  }
}
