import { globalShortcut } from 'electron';
import type { ShortcutAction } from '../shared/types.js';

// We use local accelerators via the renderer's keyboard events for in-app shortcuts
// to avoid stealing system-wide focus. This stub exists to keep extensibility for
// the future (e.g. show/hide hotkey). Currently it's a no-op registry.

const registered: string[] = [];

export function registerShortcuts(_dispatch: (action: ShortcutAction) => void): void {
  // Intentionally left empty — all shortcuts handled in renderer.
  // Reserved for future global toggles.
}

export function unregisterShortcuts(): void {
  for (const acc of registered) {
    try {
      globalShortcut.unregister(acc);
    } catch {
      /* ignore */
    }
  }
  registered.length = 0;
}
