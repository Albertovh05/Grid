import http, { type IncomingMessage, type ServerResponse } from 'http';
import { createHash, randomBytes, randomUUID } from 'crypto';
import { createRequire } from 'module';
import type { Duplex } from 'stream';
import os from 'os';
import path from 'path';
import fs from 'fs';
import QRCode from 'qrcode';
import { WebSocketServer, type WebSocket } from 'ws';
import type { PtyManager } from './pty-manager.js';
import type { Store } from './store.js';
import type { LayoutState, RemoteStatus, TerminalSpec } from '../shared/types.js';

type BindHost = '127.0.0.1' | '0.0.0.0';

interface RemoteServerOptions {
  pty: PtyManager;
  store: Store;
  onLayoutChanged: (layout: LayoutState) => void;
  onStatusChanged: (status: RemoteStatus) => void;
}

const require = createRequire(import.meta.url);

function json(res: ServerResponse, status: number, data: unknown): void {
  const body = JSON.stringify(data);
  res.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'content-length': Buffer.byteLength(body),
  });
  res.end(body);
}

function text(res: ServerResponse, status: number, body: string, type = 'text/plain; charset=utf-8'): void {
  res.writeHead(status, {
    'content-type': type,
    'content-length': Buffer.byteLength(body),
  });
  res.end(body);
}

function readBody(req: IncomingMessage): Promise<unknown> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    req.on('data', (chunk) => {
      chunks.push(Buffer.from(chunk));
      if (Buffer.concat(chunks).length > 64_000) {
        req.destroy();
        reject(new Error('body too large'));
      }
    });
    req.on('end', () => {
      const raw = Buffer.concat(chunks).toString('utf8');
      if (!raw) return resolve({});
      try {
        resolve(JSON.parse(raw));
      } catch (err) {
        reject(err);
      }
    });
    req.on('error', reject);
  });
}

function basename(p?: string): string {
  if (!p) return '~';
  return p.split(/[\\/]/).filter(Boolean).slice(-1)[0] || p;
}

function smartTitle(cwd?: string, shell?: string): string {
  const sh = shell ? shell.split(/[\\/]/).filter(Boolean).slice(-1)[0] : 'shell';
  return `${sh} · ${basename(cwd)}`;
}

function hash(value: string): string {
  return createHash('sha256').update(value).digest('hex');
}

function safePort(value: number | undefined): number {
  return Number.isInteger(value) && value && value >= 1024 && value <= 65535 ? value : 17321;
}

function localUrls(port: number, bindHost: BindHost): string[] {
  const urls = new Set<string>();
  if (bindHost === '127.0.0.1') {
    urls.add(`http://127.0.0.1:${port}/remote`);
    return [...urls];
  }
  urls.add(`http://localhost:${port}/remote`);
  for (const interfaces of Object.values(os.networkInterfaces())) {
    for (const item of interfaces ?? []) {
      if (item.family === 'IPv4' && !item.internal) {
        urls.add(`http://${item.address}:${port}/remote`);
      }
    }
  }
  return [...urls];
}

function preferredRemoteUrl(urls: string[]): string | undefined {
  return urls.find((url) => !url.includes('localhost') && !url.includes('127.0.0.1')) ?? urls[0];
}

function tokenFromRequest(req: IncomingMessage, url: URL): string | null {
  const header = req.headers.authorization;
  if (header?.startsWith('Bearer ')) return header.slice('Bearer '.length).trim();
  return url.searchParams.get('token');
}

export class RemoteServer {
  private readonly pty: PtyManager;
  private readonly store: Store;
  private readonly onLayoutChanged: (layout: LayoutState) => void;
  private readonly onStatusChanged: (status: RemoteStatus) => void;
  private server: http.Server | null = null;
  private wss: WebSocketServer | null = null;
  private clients = new Set<WebSocket>();
  private sessionTokens = new Set<string>();
  private pairingCode: string | null = null;
  private pairingHash: string | null = null;
  private pairingQrDataUrl: string | null = null;
  private port = 17321;
  private bindHost: BindHost = '0.0.0.0';
  private error: string | undefined;

  constructor(options: RemoteServerOptions) {
    this.pty = options.pty;
    this.store = options.store;
    this.onLayoutChanged = options.onLayoutChanged;
    this.onStatusChanged = options.onStatusChanged;

    this.pty.on('data', (id, data) => this.broadcastPty(id, { type: 'data', data }));
    this.pty.on('exit', (id, exitCode, signal) => this.broadcastPty(id, { type: 'exit', exitCode, signal }));
    this.pty.on('resize', (id, cols, rows) => this.broadcastPty(id, { type: 'resize', cols, rows }));
  }

  async start(opts: { port?: number; bindHost?: BindHost }): Promise<RemoteStatus> {
    if (this.server) await this.stop();
    this.port = safePort(opts.port);
    this.bindHost = opts.bindHost ?? '0.0.0.0';
    this.error = undefined;
    const pairingCode = randomBytes(4).toString('hex');
    this.pairingCode = pairingCode;
    this.pairingHash = hash(pairingCode);
    const firstUrl = preferredRemoteUrl(localUrls(this.port, this.bindHost)) ?? `http://localhost:${this.port}/remote`;
    const pairingUrl = `${firstUrl}?pair=${encodeURIComponent(pairingCode)}`;
    this.pairingQrDataUrl = await QRCode.toDataURL(pairingUrl, { margin: 1, width: 240 });

    this.server = http.createServer((req, res) => {
      void this.handleHttp(req, res).catch(() => json(res, 500, { error: 'internal error' }));
    });
    this.wss = new WebSocketServer({ noServer: true });
    this.server.on('upgrade', (req, socket, head) => {
      void this.handleUpgrade(req, socket, head);
    });

    await new Promise<void>((resolve, reject) => {
      const onError = (err: Error) => {
        this.error = err.message;
        reject(err);
      };
      this.server?.once('error', onError);
      this.server?.listen(this.port, this.bindHost, () => {
        this.server?.off('error', onError);
        resolve();
      });
    }).catch((err) => {
      this.closeServerHandles();
      throw err;
    });

    this.emitStatus();
    return this.getStatus();
  }

  async stop(): Promise<RemoteStatus> {
    this.sessionTokens.clear();
    this.pairingCode = null;
    this.pairingHash = null;
    this.pairingQrDataUrl = null;
    for (const client of this.clients) client.close(1001, 'remote disabled');
    this.clients.clear();
    await new Promise<void>((resolve) => {
      if (!this.server) return resolve();
      this.server.close(() => resolve());
      this.closeServerHandles();
    });
    this.emitStatus();
    return this.getStatus();
  }

  getStatus(): RemoteStatus {
    const urls = localUrls(this.port, this.bindHost);
    const preferredUrl = preferredRemoteUrl(urls);
    return {
      enabled: Boolean(this.server),
      running: Boolean(this.server?.listening),
      port: this.port,
      bindHost: this.bindHost,
      urls,
      pairingUrl: this.pairingCode && preferredUrl ? `${preferredUrl}?pair=${encodeURIComponent(this.pairingCode)}` : null,
      pairingCode: this.pairingCode,
      pairingQrDataUrl: this.pairingQrDataUrl,
      clientCount: this.clients.size,
      error: this.error,
    };
  }

  private async handleHttp(req: IncomingMessage, res: ServerResponse): Promise<void> {
    const url = new URL(req.url ?? '/', `http://${req.headers.host ?? 'localhost'}`);
    if (req.method === 'GET' && (url.pathname === '/' || url.pathname === '/remote')) {
      text(res, 200, remoteHtml(), 'text/html; charset=utf-8');
      return;
    }
    if (req.method === 'GET' && url.pathname === '/vendor/xterm.css') {
      this.serveVendor(res, '@xterm/xterm/css/xterm.css', 'text/css; charset=utf-8');
      return;
    }
    if (req.method === 'GET' && url.pathname === '/vendor/xterm.js') {
      this.serveVendor(res, '@xterm/xterm/lib/xterm.js', 'application/javascript; charset=utf-8');
      return;
    }
    if (req.method === 'GET' && url.pathname === '/api/pair/status') {
      json(res, 200, { required: true });
      return;
    }
    if (req.method === 'POST' && url.pathname === '/api/pair') {
      const body = (await readBody(req)) as { pairingToken?: string };
      const incoming = String(body.pairingToken ?? '');
      if (!incoming || !this.pairingHash || hash(incoming) !== this.pairingHash) {
        json(res, 401, { error: 'invalid pairing token' });
        return;
      }
      const token = randomBytes(32).toString('hex');
      this.sessionTokens.add(token);
      json(res, 200, { token });
      return;
    }
    if (!this.isAuthorized(req, url)) {
      json(res, 401, { error: 'unauthorized' });
      return;
    }
    if (req.method === 'GET' && url.pathname === '/api/sessions') {
      json(res, 200, this.sessionPayload());
      return;
    }
    if (req.method === 'POST' && url.pathname === '/api/sessions') {
      const body = (await readBody(req)) as { cwd?: string; shell?: string; title?: string };
      const terminal = this.createTerminal(body);
      json(res, 201, { terminal, layout: this.store.getLayout() });
      return;
    }
    const sessionMatch = url.pathname.match(/^\/api\/sessions\/([^/]+)(?:\/([^/]+))?$/);
    if (sessionMatch) {
      const id = decodeURIComponent(sessionMatch[1]);
      const action = sessionMatch[2];
      if (req.method === 'PATCH' && !action) {
        const body = (await readBody(req)) as { title?: string; focused?: boolean };
        const layout = this.patchTerminal(id, body);
        json(res, 200, { layout });
        return;
      }
      if (req.method === 'DELETE' && !action) {
        const layout = this.closeTerminal(id);
        json(res, 200, { layout });
        return;
      }
      if (req.method === 'POST' && action === 'restart') {
        this.pty.dispose(id);
        const terminal = this.store.getLayout().terminals.find((t) => t.id === id);
        if (!terminal) {
          json(res, 404, { error: 'session not found' });
          return;
        }
        this.pty.create({ id, cols: 80, rows: 24, cwd: terminal.cwd, shell: terminal.shell });
        json(res, 200, { ok: true });
        return;
      }
    }
    json(res, 404, { error: 'not found' });
  }

  private handleUpgrade(req: IncomingMessage, socket: Duplex, head: Buffer): void {
    const url = new URL(req.url ?? '/', `http://${req.headers.host ?? 'localhost'}`);
    const match = url.pathname.match(/^\/api\/sessions\/([^/]+)\/pty$/);
    if (!match || !this.isAuthorized(req, url) || !this.wss) {
      socket.write('HTTP/1.1 401 Unauthorized\r\n\r\n');
      socket.destroy();
      return;
    }
    const id = decodeURIComponent(match[1]);
    this.wss.handleUpgrade(req, socket, head, (ws) => {
      this.attachPtySocket(id, ws);
    });
  }

  private attachPtySocket(id: string, ws: WebSocket): void {
    this.clients.add(ws);
    this.emitStatus();
    ws.send(JSON.stringify({ type: 'ready', sessions: this.sessionPayload() }));
    const recent = this.pty.getRecentOutput(id);
    if (recent) ws.send(JSON.stringify({ type: 'data', data: recent }));
    ws.on('message', (raw) => {
      try {
        const message = JSON.parse(String(raw)) as { type?: string; data?: string; cols?: number; rows?: number };
        if (message.type === 'input' && typeof message.data === 'string') {
          this.pty.write(id, message.data);
        } else if (message.type === 'resize') {
          // The PTY has one global size. Keep the desktop xterm authoritative so
          // mobile clients cannot make full-screen TUIs redraw for a phone-sized
          // viewport and hide their desktop input area.
        }
      } catch {
        // Ignore malformed client frames.
      }
    });
    ws.on('close', () => {
      this.clients.delete(ws);
      this.emitStatus();
    });
  }

  private isAuthorized(req: IncomingMessage, url: URL): boolean {
    const token = tokenFromRequest(req, url);
    return Boolean(token && this.sessionTokens.has(token));
  }

  private createTerminal(body: { cwd?: string; shell?: string; title?: string }): TerminalSpec {
    const layout = this.store.getLayout();
    const id = randomUUID();
    const cwd = body.cwd && fs.existsSync(body.cwd) ? body.cwd : os.homedir();
    const terminal: TerminalSpec = {
      id,
      title: body.title?.trim() || smartTitle(cwd, body.shell),
      userTitle: body.title?.trim() || undefined,
      cwd,
      shell: body.shell,
      createdAt: Date.now(),
    };
    const next: LayoutState = { ...layout, terminals: [...layout.terminals, terminal], focusedId: id };
    this.store.setLayout(next);
    this.pty.create({ id, cols: 80, rows: 24, cwd, shell: body.shell });
    this.onLayoutChanged(next);
    this.broadcastSessions();
    return terminal;
  }

  private patchTerminal(id: string, body: { title?: string; focused?: boolean }): LayoutState {
    const layout = this.store.getLayout();
    const next: LayoutState = {
      ...layout,
      focusedId: body.focused ? id : layout.focusedId,
      terminals: layout.terminals.map((terminal) => {
        if (terminal.id !== id) return terminal;
        const title = body.title?.trim();
        return title ? { ...terminal, title, userTitle: title } : terminal;
      }),
    };
    this.store.setLayout(next);
    this.onLayoutChanged(next);
    this.broadcastSessions();
    return next;
  }

  private closeTerminal(id: string): LayoutState {
    const layout = this.store.getLayout();
    const terminals = layout.terminals.filter((terminal) => terminal.id !== id);
    const next: LayoutState = {
      ...layout,
      terminals,
      focusedId: layout.focusedId === id ? terminals[terminals.length - 1]?.id ?? null : layout.focusedId,
      zoomedId: layout.zoomedId === id ? null : layout.zoomedId,
    };
    this.pty.dispose(id);
    this.store.setLayout(next);
    this.onLayoutChanged(next);
    this.broadcastSessions();
    return next;
  }

  private sessionPayload(): unknown {
    const layout = this.store.getLayout();
    return {
      layout,
      sessions: layout.terminals.map((terminal) => ({
        ...terminal,
        running: this.pty.hasSession(terminal.id),
        dimensions: this.pty.getDimensions(terminal.id) ?? { cols: 80, rows: 24 },
      })),
    };
  }

  private broadcastPty(id: string, payload: Record<string, unknown>): void {
    const frame = JSON.stringify({ id, ...payload });
    for (const client of this.clients) {
      if (client.readyState === client.OPEN) client.send(frame);
    }
  }

  private broadcastSessions(): void {
    const frame = JSON.stringify({ type: 'sessions', sessions: this.sessionPayload() });
    for (const client of this.clients) {
      if (client.readyState === client.OPEN) client.send(frame);
    }
  }

  private emitStatus(): void {
    this.onStatusChanged(this.getStatus());
  }

  private closeServerHandles(): void {
    this.wss?.close();
    this.wss = null;
    this.server = null;
  }

  private serveVendor(res: ServerResponse, specifier: string, type: string): void {
    try {
      const resolved = require.resolve(specifier);
      const body = fs.readFileSync(path.normalize(resolved));
      res.writeHead(200, { 'content-type': type, 'content-length': body.length });
      res.end(body);
    } catch {
      text(res, 404, 'not found');
    }
  }
}

function remoteHtml(): string {
  return String.raw`<!doctype html>
<html>
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover" />
  <title>Grid Remote</title>
  <link rel="stylesheet" href="/vendor/xterm.css" />
  <style>
    :root { color-scheme: dark; --bg:#0a0a0c; --panel:#14141a; --fg:#e6e6ec; --muted:#92929f; --border:#292934; --accent:#7c5cff; --danger:#ff5577; }
    * { box-sizing: border-box; }
    html, body { margin:0; height:100%; background:var(--bg); color:var(--fg); font-family:-apple-system,BlinkMacSystemFont,Segoe UI,sans-serif; }
    body { display:flex; flex-direction:column; overflow:hidden; }
    header { height:48px; display:flex; align-items:center; gap:8px; padding:8px 10px; border-bottom:1px solid var(--border); background:var(--panel); }
    select, input, button { font:inherit; color:var(--fg); background:#1c1c24; border:1px solid var(--border); border-radius:7px; padding:8px; }
    button { cursor:pointer; }
    button.primary { background:var(--accent); border-color:var(--accent); }
    button.danger { color:var(--danger); }
    #sessionSelect { flex:1; min-width:0; }
    #terminal { flex:1; min-height:0; padding:6px; overflow:auto; }
    #terminal .xterm { display:inline-block; min-width:100%; }
    #pair { position:fixed; inset:0; display:none; align-items:center; justify-content:center; padding:20px; background:var(--bg); z-index:10; }
    #pair form { width:min(420px,100%); display:grid; gap:12px; background:var(--panel); border:1px solid var(--border); border-radius:10px; padding:16px; }
    #pair h1 { font-size:20px; margin:0; }
    #pair p, #status { color:var(--muted); margin:0; font-size:13px; }
    #keys { display:grid; grid-template-columns:repeat(8,1fr); gap:5px; padding:6px; border-top:1px solid var(--border); background:var(--panel); }
    #keys button { padding:10px 2px; font-size:13px; }
    #keys button.accent { background:var(--accent); border-color:var(--accent); color:white; font-weight:600; }
    @media (max-width: 520px) { #keys { grid-template-columns:repeat(4,1fr); } }
  </style>
</head>
<body>
  <div id="pair">
    <form id="pairForm">
      <h1>Pair with Grid</h1>
      <p>Scan the QR code in Grid or enter the pairing code shown on the desktop.</p>
      <input id="pairInput" placeholder="Pairing code" autocomplete="one-time-code" />
      <button class="primary">Pair</button>
      <p id="pairError"></p>
    </form>
  </div>
  <header>
    <select id="sessionSelect"></select>
    <button id="newBtn" class="primary">New</button>
    <button id="restartBtn">Restart</button>
    <button id="closeBtn" class="danger">Close</button>
  </header>
  <div id="terminal"></div>
  <div id="keys">
    <button data-key="ctrl-c">Ctrl+C</button>
    <button class="accent" data-key="shift-tab">Shift+Tab</button>
    <button data-key="tab">Tab</button>
    <button data-key="enter">Enter</button>
    <button data-key="esc">Esc</button>
    <button data-key="up">↑</button>
    <button data-key="down">↓</button>
    <button data-key="left">←</button>
    <button data-key="right">→</button>
    <button data-send="1">1</button>
    <button data-send="2">2</button>
    <button data-send="3">3</button>
    <button data-send="4">4</button>
    <button data-send="5">5</button>
  </div>
  <script src="/vendor/xterm.js"></script>
  <script>
    const qs = new URLSearchParams(location.search);
    let token = localStorage.getItem('gridRemoteToken') || '';
    let sessions = [];
    let activeId = '';
    let socket = null;
    const helperKeys = {
      'ctrl-c': String.fromCharCode(3),
      'shift-tab': String.fromCharCode(27) + '[Z',
      tab: String.fromCharCode(9),
      enter: String.fromCharCode(13),
      esc: String.fromCharCode(27),
      up: String.fromCharCode(27) + '[A',
      down: String.fromCharCode(27) + '[B',
      left: String.fromCharCode(27) + '[D',
      right: String.fromCharCode(27) + '[C',
    };
    const term = new Terminal({ cursorBlink:true, fontSize:13, fontFamily:'SF Mono, Menlo, Consolas, monospace', scrollback: 5000, cols:80, rows:24, theme:{ background:'#0a0a0c', foreground:'#e6e6ec', cursor:'#7c5cff' } });
    term.open(document.getElementById('terminal'));
    term.onData((data) => {
      if (socket && socket.readyState === WebSocket.OPEN) socket.send(JSON.stringify({ type:'input', data }));
    });
    function authHeaders() { return { authorization: 'Bearer ' + token, 'content-type': 'application/json' }; }
    async function api(path, opts = {}) {
      const res = await fetch(path, { ...opts, headers: { ...authHeaders(), ...(opts.headers || {}) } });
      if (res.status === 401) throw new Error('unauthorized');
      if (!res.ok) throw new Error(await res.text());
      return res.json();
    }
    async function pair(code) {
      const res = await fetch('/api/pair', { method:'POST', headers:{ 'content-type':'application/json' }, body:JSON.stringify({ pairingToken: code }) });
      if (!res.ok) throw new Error('Invalid pairing code');
      const data = await res.json();
      token = data.token;
      localStorage.setItem('gridRemoteToken', token);
      document.getElementById('pair').style.display = 'none';
      await loadSessions();
    }
    async function ensurePaired() {
      const code = qs.get('pair');
      if (code) {
        await pair(code);
        history.replaceState(null, '', '/remote');
        return;
      }
      if (!token) document.getElementById('pair').style.display = 'flex';
      else await loadSessions().catch(() => { localStorage.removeItem('gridRemoteToken'); token=''; document.getElementById('pair').style.display='flex'; });
    }
    async function loadSessions() {
      const data = await api('/api/sessions');
      sessions = data.sessions || [];
      activeId = data.layout?.focusedId || sessions[0]?.id || '';
      renderSessions();
      if (activeId) connect(activeId);
      else term.writeln('No sessions. Tap New to create one.');
    }
    function dimensionsFor(id) {
      const session = sessions.find((s) => s.id === id);
      return session && session.dimensions ? session.dimensions : { cols:80, rows:24 };
    }
    function applyTerminalDimensions(id) {
      const dims = dimensionsFor(id);
      const cols = Math.max(10, Number(dims.cols) || 80);
      const rows = Math.max(5, Number(dims.rows) || 24);
      if (term.cols !== cols || term.rows !== rows) term.resize(cols, rows);
      term.scrollToBottom();
    }
    function renderSessions() {
      const select = document.getElementById('sessionSelect');
      select.innerHTML = '';
      for (const s of sessions) {
        const opt = document.createElement('option');
        opt.value = s.id;
        opt.textContent = s.title || s.id;
        select.appendChild(opt);
      }
      select.value = activeId;
    }
    function connect(id) {
      if (!id) return;
      activeId = id;
      renderSessions();
      applyTerminalDimensions(id);
      term.reset();
      if (socket) socket.close();
      const proto = location.protocol === 'https:' ? 'wss:' : 'ws:';
      socket = new WebSocket(proto + '//' + location.host + '/api/sessions/' + encodeURIComponent(id) + '/pty?token=' + encodeURIComponent(token));
      socket.onmessage = (ev) => {
        const msg = JSON.parse(ev.data);
        if (msg.type === 'ready') {
          sessions = msg.sessions.sessions || sessions;
          renderSessions();
          applyTerminalDimensions(activeId);
        }
        if (msg.type === 'data' && (!msg.id || msg.id === activeId)) {
          term.write(msg.data);
          queueMicrotask(() => term.scrollToBottom());
        }
        if (msg.type === 'sessions') {
          sessions = msg.sessions.sessions || [];
          renderSessions();
          applyTerminalDimensions(activeId);
        }
        if (msg.type === 'resize' && msg.id === activeId) {
          const session = sessions.find((s) => s.id === activeId);
          if (session) session.dimensions = { cols:msg.cols, rows:msg.rows };
          applyTerminalDimensions(activeId);
        }
        if (msg.type === 'exit' && msg.id === activeId) term.writeln('\r\n[process exited with code ' + msg.exitCode + ']');
      };
      socket.onopen = () => applyTerminalDimensions(activeId);
      socket.onclose = () => term.writeln('\r\n[disconnected]');
    }
    function keepBottomVisible() {
      term.scrollToBottom();
    }
    document.getElementById('pairForm').addEventListener('submit', async (e) => {
      e.preventDefault();
      try { await pair(document.getElementById('pairInput').value.trim()); }
      catch (err) { document.getElementById('pairError').textContent = err.message; }
    });
    document.getElementById('sessionSelect').addEventListener('change', (e) => connect(e.target.value));
    document.getElementById('newBtn').addEventListener('click', async () => {
      const data = await api('/api/sessions', { method:'POST', body:'{}' });
      sessions = data.layout.terminals || [];
      connect(data.terminal.id);
    });
    document.getElementById('restartBtn').addEventListener('click', async () => {
      if (activeId) await api('/api/sessions/' + encodeURIComponent(activeId) + '/restart', { method:'POST', body:'{}' });
    });
    document.getElementById('closeBtn').addEventListener('click', async () => {
      if (!activeId) return;
      await api('/api/sessions/' + encodeURIComponent(activeId), { method:'DELETE' });
      await loadSessions();
    });
    document.getElementById('keys').addEventListener('click', (e) => {
      const btn = e.target.closest('button[data-send], button[data-key]');
      const data = btn ? (btn.dataset.send || helperKeys[btn.dataset.key]) : '';
      if (data && socket && socket.readyState === WebSocket.OPEN) socket.send(JSON.stringify({ type:'input', data }));
    });
    window.addEventListener('resize', keepBottomVisible);
    window.addEventListener('orientationchange', () => setTimeout(keepBottomVisible, 250));
    setTimeout(keepBottomVisible, 0);
    ensurePaired().catch((err) => {
      document.getElementById('pair').style.display = 'flex';
      document.getElementById('pairError').textContent = err.message;
    });
  </script>
</body>
</html>`;
}
