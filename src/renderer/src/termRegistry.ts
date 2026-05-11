import type { Terminal } from '@xterm/xterm';

const registry = new Map<string, Terminal>();

export function registerTerminal(id: string, t: Terminal): void {
  registry.set(id, t);
  refreshDebugApi();
}

export function unregisterTerminal(id: string): void {
  registry.delete(id);
  refreshDebugApi();
}

export function getAllTerminals(): Array<{ id: string; term: Terminal }> {
  return [...registry.entries()].map(([id, term]) => ({ id, term }));
}

function readBufferText(t: Terminal): string {
  const buf = t.buffer.active;
  const out: string[] = [];
  for (let i = 0; i < buf.length; i++) {
    const line = buf.getLine(i);
    if (line) out.push(line.translateToString(true));
  }
  return out.join('\n');
}

function refreshDebugApi(): void {
  (window as unknown as { __tg?: unknown }).__tg = {
    paneCount: () => registry.size,
    bufferAt: (idx: number) => {
      const arr = [...registry.values()];
      return arr[idx] ? readBufferText(arr[idx]) : null;
    },
    bufferById: (id: string) => {
      const t = registry.get(id);
      return t ? readBufferText(t) : null;
    },
  };
}

refreshDebugApi();
