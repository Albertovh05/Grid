import { useEffect, useMemo, useRef, useState } from 'react';
import { useLayout } from './useLayout';
import { useSettings } from './useSettings';
import { TerminalPane } from './TerminalPane';
import { SidebarItem } from './SidebarItem';
import { RemoteControl } from './RemoteControl';
import { ContextMenu, type MenuItem } from './ContextMenu';
import { getAllTerminals } from './termRegistry';
import { CommandPalette, type PaletteCommand } from './CommandPalette';
import type { PresetLayout } from '../../shared/types';

function gridCols(n: number, mode: string | undefined): string {
  if (mode === 'tabs') return 'cols-1 tabs-mode';
  if (mode === '1col') return 'cols-1';
  if (mode === '2col') return 'cols-2';
  if (mode === '3col') return 'cols-3';
  // auto
  if (n <= 1) return 'cols-1';
  if (n <= 4) return 'cols-2';
  if (n <= 9) return 'cols-3';
  return 'cols-4';
}

export function App() {
  const layout = useLayout();
  const settings = useSettings();
  const themeMode: 'dark' | 'light' =
    settings.settings.theme === 'system'
      ? window.matchMedia('(prefers-color-scheme: light)').matches
        ? 'light'
        : 'dark'
      : settings.settings.theme;
  const [paletteOpen, setPaletteOpen] = useState(false);
  const [ctxMenu, setCtxMenu] = useState<{ x: number; y: number; items: MenuItem[] } | null>(null);
  const [showArchived, setShowArchived] = useState(false);
  const [presets, setPresets] = useState<PresetLayout[]>([]);

  useEffect(() => {
    window.api.presets.list().then(setPresets);
  }, []);

  const openTerminalMenu = (id: string, x: number, y: number) => {
    const items: MenuItem[] = [
      { label: 'Rename…', onClick: () => {
        const cur = layout.layout.terminals.find((t) => t.id === id);
        const name = window.prompt('Rename terminal', cur?.title);
        if (name && name.trim()) layout.renameTerminal(id, name.trim());
      } },
      { label: 'Duplicate (same cwd)', shortcut: '⌘D', onClick: () => layout.duplicateTerminal(id) },
      { label: 'Restart shell', shortcut: '⌘R', onClick: () => {
        // Trigger restart by disposing + the pane's effect will re-spawn on next interaction.
        // Simpler: send a message to pane via custom event.
        document.dispatchEvent(new CustomEvent('tg:restart', { detail: { id } }));
      } },
      { label: 'Clear', shortcut: '⌘K', onClick: () => {
        document.dispatchEvent(new CustomEvent('tg:clear', { detail: { id } }));
      } },
      { label: 'Zoom', shortcut: '⌘E', onClick: () => layout.toggleZoom(id) },
      { separator: true, label: '' },
      { label: 'Archive', onClick: () => layout.archiveTerminal(id) },
      { label: 'Close', shortcut: '⌘W', danger: true, onClick: () => void requestRemove(id) },
    ];
    setCtxMenu({ x, y, items });
  };

  const openArchivedMenu = (id: string, x: number, y: number) => {
    const items: MenuItem[] = [
      { label: 'Restore', onClick: () => layout.unarchive(id) },
      { separator: true, label: '' },
      { label: 'Delete from archive', danger: true, onClick: () => layout.deleteArchived(id) },
    ];
    setCtxMenu({ x, y, items });
  };

  const requestRemove = async (id: string) => {
    try {
      const hasChild = await window.api.pty.hasRunningChild(id);
      if (hasChild) {
        const ok = window.confirm('A process is running in this terminal. Close anyway?');
        if (!ok) return;
      }
    } catch {
      /* ignore — fall through to close */
    }
    layout.removeTerminal(id);
  };

  // Restore: if loaded but no terminals, do nothing — user starts with empty state and adds first one.
  useEffect(() => {
    if (!layout.loaded) return;
    if (layout.layout.terminals.length === 0) return; // empty state shown
    // Otherwise terminals were restored from store; panes will (re)create their pty sessions.
  }, [layout.loaded, layout.layout.terminals.length]);

  // Keyboard shortcuts
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      const mod = e.metaKey || e.ctrlKey;
      if (!mod) return;
      const key = e.key.toLowerCase();
      if (key === 't') {
        e.preventDefault();
        layout.addTerminal();
      } else if (key === 'w') {
        e.preventDefault();
        if (layout.layout.focusedId) void requestRemove(layout.layout.focusedId);
      } else if (key === 'k' && !e.shiftKey) {
        // Clear is handled inside xterm — we let xterm process it normally too.
        // But also explicit clear via palette is supported.
      } else if (key === 'e') {
        e.preventDefault();
        layout.toggleZoom();
      } else if (key === 'b') {
        e.preventDefault();
        layout.toggleSidebar();
      } else if (key === 'p' && e.shiftKey) {
        e.preventDefault();
        setPaletteOpen((v) => !v);
      } else if (key === 'd' && !e.shiftKey) {
        e.preventDefault();
        if (layout.layout.focusedId) void layout.duplicateTerminal(layout.layout.focusedId);
      } else if (key === '=' || key === '+') {
        e.preventDefault();
        settings.setFontSize(settings.settings.fontSize + 1);
      } else if (key === '-' || key === '_') {
        e.preventDefault();
        settings.setFontSize(settings.settings.fontSize - 1);
      } else if (key === '0' && !e.shiftKey) {
        e.preventDefault();
        settings.setFontSize(13);
      } else if (e.altKey && (e.key === 'ArrowLeft' || e.key === 'ArrowRight')) {
        const idx = layout.layout.terminals.findIndex((t) => t.id === layout.layout.focusedId);
        if (idx >= 0) {
          const dst = e.key === 'ArrowLeft' ? idx - 1 : idx + 1;
          if (dst >= 0 && dst < layout.layout.terminals.length) {
            e.preventDefault();
            layout.reorder(idx, dst);
          }
        }
      } else if (/^[1-9]$/.test(e.key)) {
        const idx = parseInt(e.key, 10) - 1;
        const term = layout.layout.terminals[idx];
        if (term) {
          e.preventDefault();
          layout.focusTerminal(term.id);
        }
      }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [layout]);

  // Listen for shortcut events from main (future-proof)
  useEffect(() => {
    const off = window.api.onShortcut((action) => {
      if (action === 'new-terminal') layout.addTerminal();
      else if (action === 'close-terminal' && layout.layout.focusedId)
        void requestRemove(layout.layout.focusedId);
      else if (action === 'toggle-zoom') layout.toggleZoom();
      else if (action === 'toggle-sidebar') layout.toggleSidebar();
      else if (action === 'toggle-palette') setPaletteOpen((v) => !v);
      else if (action === 'clear-terminal') {
        const focused = layout.layout.focusedId;
        if (focused) {
          const found = getAllTerminals().find((t) => t.id === focused);
          found?.term.clear();
        }
      }
    });
    return () => {
      off();
    };
  }, [layout]);

  const commands: PaletteCommand[] = useMemo(() => {
    const base: PaletteCommand[] = [
      { id: 'new', label: 'New Terminal', shortcut: '⌘T', run: () => layout.addTerminal() },
      {
        id: 'close',
        label: 'Close Focused Terminal',
        shortcut: '⌘W',
        run: () => layout.layout.focusedId && void requestRemove(layout.layout.focusedId),
      },
      { id: 'zoom', label: 'Toggle Zoom on Focused', shortcut: '⌘E', run: () => layout.toggleZoom() },
      { id: 'sidebar', label: 'Toggle Sidebar', shortcut: '⌘B', run: () => layout.toggleSidebar() },
      { id: 'layout-auto', label: 'Layout: Auto', run: () => layout.setGridMode('auto') },
      { id: 'layout-1col', label: 'Layout: 1 column', run: () => layout.setGridMode('1col') },
      { id: 'layout-2col', label: 'Layout: 2 columns', run: () => layout.setGridMode('2col') },
      { id: 'layout-3col', label: 'Layout: 3 columns', run: () => layout.setGridMode('3col') },
      { id: 'layout-tabs', label: 'Layout: Tabs only (focused pane fills space)', run: () => layout.setGridMode('tabs') },
      { id: 'theme-dark', label: 'Theme: Dark', run: () => settings.setTheme('dark') },
      { id: 'theme-light', label: 'Theme: Light', run: () => settings.setTheme('light') },
      { id: 'theme-system', label: 'Theme: System', run: () => settings.setTheme('system') },
      { id: 'font-bigger', label: 'Font size +', shortcut: '⌘+', run: () => settings.setFontSize(settings.settings.fontSize + 1) },
      { id: 'font-smaller', label: 'Font size −', shortcut: '⌘−', run: () => settings.setFontSize(settings.settings.fontSize - 1) },
      { id: 'font-reset', label: 'Font size: reset (13)', run: () => settings.setFontSize(13) },
      {
        id: 'save-preset',
        label: 'Save Current Layout as Preset…',
        run: async () => {
          const name = window.prompt('Preset name?');
          if (!name) return;
          const preset: PresetLayout = {
            id: crypto.randomUUID(),
            name,
            state: layout.layout,
            savedAt: Date.now(),
          };
          const list = await window.api.presets.save(preset);
          setPresets(list);
        },
      },
    ];
    for (const p of presets) {
      base.push({
        id: `load-${p.id}`,
        label: `Load Preset: ${p.name}`,
        run: () => layout.replaceTerminals(p.state.terminals),
      });
      base.push({
        id: `delete-${p.id}`,
        label: `Delete Preset: ${p.name}`,
        run: async () => {
          const list = await window.api.presets.delete(p.id);
          setPresets(list);
        },
      });
    }
    return base;
  }, [layout, presets]);

  const { terminals, focusedId, zoomedId, sidebarVisible, sidebarWidth, gridMode } = layout.layout;
  const resizingRef = useRef(false);
  const dragRef = useRef<{ id: string; startX: number; startY: number } | null>(null);

  const startHeaderDrag = (id: string) => (e: React.PointerEvent) => {
    if (terminals.length < 2) return;
    dragRef.current = { id, startX: e.clientX, startY: e.clientY };
  };

  useEffect(() => {
    const onMove = (e: PointerEvent) => {
      if (!dragRef.current) return;
      const dx = e.clientX - dragRef.current.startX;
      const dy = e.clientY - dragRef.current.startY;
      if (dx * dx + dy * dy < 36) return; // 6px threshold
      const el = document.elementFromPoint(e.clientX, e.clientY);
      const targetPane = el?.closest('[data-pane-id]') as HTMLElement | null;
      if (!targetPane) return;
      const targetId = targetPane.dataset['paneId'];
      if (!targetId || targetId === dragRef.current.id) return;
      const fromIdx = terminals.findIndex((t) => t.id === dragRef.current!.id);
      const toIdx = terminals.findIndex((t) => t.id === targetId);
      if (fromIdx < 0 || toIdx < 0 || fromIdx === toIdx) return;
      layout.reorder(fromIdx, toIdx);
      // update start so we don't thrash
      dragRef.current = { id: dragRef.current.id, startX: e.clientX, startY: e.clientY };
    };
    const onUp = () => (dragRef.current = null);
    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
    window.addEventListener('pointercancel', onUp);
    return () => {
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
      window.removeEventListener('pointercancel', onUp);
    };
  }, [terminals, layout]);
  useEffect(() => {
    const onMove = (e: MouseEvent) => {
      if (!resizingRef.current) return;
      layout.setSidebarWidth(e.clientX);
    };
    const onUp = () => (resizingRef.current = false);
    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onUp);
    return () => {
      window.removeEventListener('mousemove', onMove);
      window.removeEventListener('mouseup', onUp);
    };
  }, [layout]);

  return (
    <div className="app">
      <div className="titlebar">
        <button
          className="sidebar-toggle"
          onClick={() => layout.toggleSidebar()}
          title={sidebarVisible ? 'Hide sidebar (⌘B)' : 'Show sidebar (⌘B)'}
          aria-label="Toggle sidebar"
        >
          {sidebarVisible ? '⊣' : '⊢'}
        </button>
        <span className="spacer" />
        <span>
          Terminal Grid · {terminals.length} session{terminals.length === 1 ? '' : 's'}
        </span>
        <span className="spacer" />
        <button onClick={() => setPaletteOpen(true)} title="Command Palette (⌘⇧P)">
          ⌘⇧P
        </button>
      </div>
      <div className="body">
        <aside
          className={`sidebar ${sidebarVisible ? '' : 'hidden'}`}
          style={{ width: sidebarWidth ?? 240 }}
        >
          <h3>Sessions</h3>
          <div className="sidebar-list">
            {terminals.map((t, i) => (
              <SidebarItem
                key={t.id}
                spec={t}
                index={i}
                active={t.id === focusedId}
                onClick={() => layout.focusTerminal(t.id)}
                onClose={() => requestRemove(t.id)}
                onContextMenu={(e) => openTerminalMenu(t.id, e.clientX, e.clientY)}
              />
            ))}
            {terminals.length === 0 && (
              <div style={{ padding: 12, color: 'var(--fg-dim)', fontSize: 12 }}>No sessions yet.</div>
            )}
          </div>
          {(layout.layout.archived?.length ?? 0) > 0 && (
            <div className="sidebar-archived">
              <button className="sidebar-archived-header" onClick={() => setShowArchived((v) => !v)}>
                <span className="chev">{showArchived ? '▾' : '▸'}</span>
                Archived ({layout.layout.archived!.length})
              </button>
              {showArchived && (
                <div className="archived-list">
                  {layout.layout.archived!.map((a) => (
                    <div
                      key={a.id}
                      className="term-item archived"
                      onClick={() => layout.unarchive(a.id)}
                      onContextMenu={(e) => {
                        e.preventDefault();
                        openArchivedMenu(a.id, e.clientX, e.clientY);
                      }}
                      title="Click to restore · right-click for options"
                    >
                      <span className="dot" />
                      <span className="name">{a.title}</span>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}
          <div className="sidebar-actions">
            <button style={{ flex: 1 }} onClick={() => layout.addTerminal()}>
              + New (⌘T)
            </button>
          </div>
          <RemoteControl />
        </aside>
        {sidebarVisible && (
          <div
            className="sidebar-resizer"
            onMouseDown={(e) => {
              e.preventDefault();
              resizingRef.current = true;
            }}
          />
        )}

        {terminals.length === 0 ? (
          <div className="empty">
            <div className="empty-title">Terminal Grid</div>
            <div className="empty-sub">No sessions yet — start one or load a saved layout.</div>
            <button className="empty-primary" onClick={() => layout.addTerminal()}>
              Open a new terminal · ⌘T
            </button>
            {presets.length > 0 && (
              <div className="empty-presets">
                <div className="empty-preset-label">Recent layouts</div>
                {presets.slice(0, 5).map((p) => (
                  <button key={p.id} onClick={() => layout.replaceTerminals(p.state.terminals)}>
                    {p.name}
                  </button>
                ))}
              </div>
            )}
            <div className="empty-shortcuts">
              <div><kbd>⌘⇧P</kbd> Command palette</div>
              <div><kbd>⌘B</kbd> Toggle sidebar</div>
              <div><kbd>⌘F</kbd> Find in buffer</div>
              <div><kbd>⌘1..9</kbd> Focus terminal N</div>
            </div>
          </div>
        ) : (
          <div
            className={`grid ${gridCols(terminals.length, gridMode)} ${zoomedId ? 'zoom' : ''} ${
              gridMode === 'tabs' ? 'tabs-only' : ''
            }`}
          >
            {terminals.map((t, i) => (
              <TerminalPane
                key={t.id}
                spec={t}
                focused={t.id === focusedId}
                zoomed={t.id === zoomedId}
                fontSize={settings.settings.fontSize}
                fontFamily={settings.settings.fontFamily}
                themeMode={themeMode}
                onFocus={() => layout.focusTerminal(t.id)}
                onClose={() => requestRemove(t.id)}
                onZoom={() => layout.toggleZoom(t.id)}
                onRename={(name) => layout.renameTerminal(t.id, name)}
                onCwdChanged={(cwd) => layout.updateTerminalCwd(t.id, cwd)}
                onHeaderPointerDown={startHeaderDrag(t.id)}
                onContextMenu={(e) => openTerminalMenu(t.id, e.clientX, e.clientY)}
              />
            ))}
          </div>
        )}
      </div>
      {paletteOpen && <CommandPalette commands={commands} onClose={() => setPaletteOpen(false)} />}
      {ctxMenu && (
        <ContextMenu x={ctxMenu.x} y={ctxMenu.y} items={ctxMenu.items} onClose={() => setCtxMenu(null)} />
      )}
    </div>
  );
}
