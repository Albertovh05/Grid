import { useEffect, useState } from 'react';

export type Activity = { unread: boolean; bell: boolean };

const listeners = new Set<() => void>();
const state = new Map<string, Activity>();

function notify() {
  for (const l of listeners) l();
}

export function markActivity(id: string, kind: 'data' | 'bell'): void {
  const cur = state.get(id) ?? { unread: false, bell: false };
  const next = kind === 'bell' ? { ...cur, bell: true, unread: true } : { ...cur, unread: true };
  if (cur.unread !== next.unread || cur.bell !== next.bell) {
    state.set(id, next);
    notify();
  }
}

export function clearActivity(id: string): void {
  if (!state.has(id)) return;
  const cur = state.get(id)!;
  if (!cur.unread && !cur.bell) return;
  state.set(id, { unread: false, bell: false });
  notify();
}

export function useActivity(id: string): Activity {
  const [, force] = useState(0);
  useEffect(() => {
    const l = () => force((n) => n + 1);
    listeners.add(l);
    return () => {
      listeners.delete(l);
    };
  }, []);
  return state.get(id) ?? { unread: false, bell: false };
}
