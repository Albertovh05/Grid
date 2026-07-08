import { useEffect, useRef, useState } from 'react';
import type { ArchivedSpec, GridMode, LayoutState, TerminalSpec } from '../../shared/types';

const defaultLayout: LayoutState = {
  terminals: [],
  focusedId: null,
  zoomedId: null,
  sidebarVisible: true,
  sidebarWidth: 240,
  gridMode: 'auto',
  archived: [],
};

export function useLayout() {
  const [layout, setLayoutState] = useState<LayoutState>(defaultLayout);
  const [loaded, setLoaded] = useState(false);
  const skipPersist = useRef(true);

  useEffect(() => {
    window.api.layout.get().then((l) => {
      setLayoutState(l ?? defaultLayout);
      setLoaded(true);
    });
    const off = window.api.layout.onChanged((l) => {
      skipPersist.current = true;
      setLayoutState(l ?? defaultLayout);
    });
    return off;
  }, []);

  useEffect(() => {
    if (!loaded) return;
    if (skipPersist.current) {
      skipPersist.current = false;
      return;
    }
    window.api.layout.set(layout);
  }, [layout, loaded]);

  const update = (fn: (prev: LayoutState) => LayoutState) => setLayoutState(fn);

  const basename = (p?: string) => (p ? p.split('/').filter(Boolean).slice(-1)[0] || '/' : '~');

  const smartTitle = (cwd?: string, shell?: string): string => {
    const sh = shell ? shell.split('/').filter(Boolean).slice(-1)[0] : 'shell';
    return `${sh} · ${basename(cwd)}`;
  };

  const addTerminal = async (spec?: Partial<TerminalSpec>): Promise<TerminalSpec> => {
    let inheritedCwd = spec?.cwd;
    if (!inheritedCwd && layout.focusedId) {
      try {
        const cwd = await window.api.pty.getCwd(layout.focusedId);
        if (cwd) inheritedCwd = cwd;
      } catch {
        /* ignore */
      }
    }
    const id = crypto.randomUUID();
    const t: TerminalSpec = {
      id,
      title: spec?.title ?? smartTitle(inheritedCwd, spec?.shell),
      cwd: inheritedCwd,
      shell: spec?.shell,
      createdAt: Date.now(),
    };
    update((p) => ({ ...p, terminals: [...p.terminals, t], focusedId: t.id }));
    return t;
  };

  const removeTerminal = (id: string) => {
    update((p) => {
      const terminals = p.terminals.filter((t) => t.id !== id);
      const focusedId =
        p.focusedId === id ? terminals[terminals.length - 1]?.id ?? null : p.focusedId;
      const zoomedId = p.zoomedId === id ? null : p.zoomedId;
      return { ...p, terminals, focusedId, zoomedId };
    });
  };

  const archiveTerminal = (id: string) => {
    update((p) => {
      const t = p.terminals.find((x) => x.id === id);
      if (!t) return p;
      const archived: ArchivedSpec = {
        id: t.id,
        title: t.title,
        cwd: t.cwd,
        shell: t.shell,
        archivedAt: Date.now(),
      };
      const terminals = p.terminals.filter((x) => x.id !== id);
      const focusedId =
        p.focusedId === id ? terminals[terminals.length - 1]?.id ?? null : p.focusedId;
      const zoomedId = p.zoomedId === id ? null : p.zoomedId;
      return {
        ...p,
        terminals,
        focusedId,
        zoomedId,
        archived: [archived, ...(p.archived ?? [])].slice(0, 50),
      };
    });
  };

  const unarchive = (archivedId: string) => {
    update((p) => {
      const a = (p.archived ?? []).find((x) => x.id === archivedId);
      if (!a) return p;
      const t: TerminalSpec = {
        id: crypto.randomUUID(),
        title: a.title,
        userTitle: a.title,
        cwd: a.cwd,
        shell: a.shell,
        createdAt: Date.now(),
      };
      return {
        ...p,
        terminals: [...p.terminals, t],
        focusedId: t.id,
        archived: (p.archived ?? []).filter((x) => x.id !== archivedId),
      };
    });
  };

  const deleteArchived = (archivedId: string) => {
    update((p) => ({ ...p, archived: (p.archived ?? []).filter((x) => x.id !== archivedId) }));
  };

  const duplicateTerminal = async (id: string) => {
    const src = layout.terminals.find((t) => t.id === id);
    if (!src) return;
    let cwd = src.cwd;
    try {
      const live = await window.api.pty.getCwd(id);
      if (live) cwd = live;
    } catch {
      /* ignore */
    }
    await addTerminal({ cwd, shell: src.shell });
  };

  const renameTerminal = (id: string, title: string) => {
    update((p) => ({
      ...p,
      terminals: p.terminals.map((t) => (t.id === id ? { ...t, title, userTitle: title } : t)),
    }));
  };

  const updateTerminalCwd = (id: string, cwd: string) => {
    update((p) => ({
      ...p,
      terminals: p.terminals.map((t) =>
        t.id === id ? { ...t, cwd, title: t.userTitle ?? smartTitle(cwd, t.shell) } : t
      ),
    }));
  };

  const focusTerminal = (id: string | null) => update((p) => ({ ...p, focusedId: id }));

  const toggleZoom = (id?: string) =>
    update((p) => {
      const target = id ?? p.focusedId;
      if (!target) return p;
      return { ...p, zoomedId: p.zoomedId === target ? null : target };
    });

  const toggleSidebar = () => update((p) => ({ ...p, sidebarVisible: !p.sidebarVisible }));

  const setSidebarWidth = (w: number) =>
    update((p) => ({ ...p, sidebarWidth: Math.max(160, Math.min(480, Math.round(w))) }));

  const setGridMode = (mode: GridMode) => update((p) => ({ ...p, gridMode: mode }));

  const reorder = (fromIdx: number, toIdx: number) =>
    update((p) => {
      if (fromIdx === toIdx) return p;
      const arr = [...p.terminals];
      const [m] = arr.splice(fromIdx, 1);
      arr.splice(toIdx, 0, m);
      return { ...p, terminals: arr };
    });

  const replaceTerminals = (terminals: TerminalSpec[]) =>
    update((p) => ({ ...p, terminals, focusedId: terminals[0]?.id ?? null, zoomedId: null }));

  return {
    layout,
    loaded,
    addTerminal,
    removeTerminal,
    renameTerminal,
    archiveTerminal,
    unarchive,
    deleteArchived,
    duplicateTerminal,
    updateTerminalCwd,
    focusTerminal,
    toggleZoom,
    toggleSidebar,
    setSidebarWidth,
    setGridMode,
    reorder,
    replaceTerminals,
  };
}
