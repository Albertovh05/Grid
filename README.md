# Terminal Grid v2

A dynamic grid of terminal emulators backed by persistent user sessions.

## Stack
- Electron + electron-vite
- React + TypeScript
- xterm.js (renderer) + node-pty (main)
- electron-store for layout/preset persistence
- electron-builder for macOS packaging

## Develop
```bash
npm install
npm run rebuild   # rebuild node-pty for Electron's Node ABI
npm run dev
```

## Package
```bash
npm run package
# → release/Terminal Grid-2.0.0-arm64.dmg
```

## Shortcuts
- ⌘T new terminal
- ⌘W close focused
- ⌘1..⌘9 focus terminal N
- ⌘E zoom focused
- ⌘B toggle sidebar
- ⌘⇧P command palette
- Double-click pane title to rename
- Drag pane header to reorder
