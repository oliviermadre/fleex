# Split Panel View — Implementation Plan

## Overview
Shift+click a session in the sidebar to open it side-by-side with the current session. Two tmux terminals visible simultaneously, with a glowing border on the active (focused) pane. Any normal session navigation exits the split.

## Architecture Changes

### 1. Session Store — Add split state
**File:** `packages/web/src/stores/sessionStore.ts`

Add to state:
- `splitSessionId: string | null` — session in the right pane (null = no split)
- `focusedPane: 'primary' | 'split'` — which pane has focus
- `openSplit(sessionId: string)` — enter split mode with given session in right pane
- `closeSplit()` — exit split mode, keep primary session
- `setFocusedPane(pane)` — switch focus between panes

Update `selectSession(id)` to also call `closeSplit()` (any normal selection exits split).
Update `removeSession(id)` to handle removal of the split session.

### 2. Terminal Manager — Remove singleton assumptions
**File:** `packages/web/src/services/terminalManager.ts`

- Remove `activeSessionId` field
- Remove `containerEl` field
- Remove `setContainer()` method
- Remove auto-detach in `attach()` (the "detach current if different" logic)
- `attach(sessionId, container)` now takes container as parameter
- Each terminal attaches to its own container element
- `getActive()` removed (no longer meaningful)

### 3. useTerminal Hook — Per-instance WebSocket
**File:** `packages/web/src/hooks/useTerminal.ts`

Major refactor:
- Create a **new `WebSocketManager` instance** inside the hook (not the singleton)
- Connect it on mount, disconnect on unmount
- Each hook instance is fully self-contained: own WS, own terminal, own container
- Remove `prevSessionRef` detach-previous logic (no longer needed)
- Accept container ref as before

### 4. WebSocket Singleton Cleanup
**File:** `packages/web/src/services/websocket.ts`

- Keep `dashboardWs` singleton (still needed globally)
- Remove `terminalWs` singleton export
- Terminal WS connections are now created per-hook instance

**File:** `packages/web/src/hooks/useWebSocket.ts`
- Remove `terminalWs.connect()` / `terminalWs.disconnect()`
- Only manage `dashboardWs`

### 5. MainPanel — Split-aware layout
**File:** `packages/web/src/components/main-panel/MainPanel.tsx`

New rendering logic:
```
if (splitSessionId) {
  // Two-pane layout
  <div className="flex flex-1 flex-row">
    <SessionPane sessionId={selectedSessionId} focused={focusedPane === 'primary'} />
    <div className="w-px bg-[var(--theme-border)]" />  // divider
    <SessionPane sessionId={splitSessionId} focused={focusedPane === 'split'} />
  </div>
} else {
  // Single pane (current behavior)
  <SessionPane sessionId={selectedSessionId} focused={true} />
}
```

### 6. New SessionPane Component
**File:** `packages/web/src/components/main-panel/SessionPane.tsx`

Extracted from MainPanel's current single-session view:
- Props: `sessionId`, `focused`, `onFocus`
- Contains: `SessionHeader` + `TerminalView` + `StatusBar`
- onClick → `setFocusedPane` for this pane
- When `focused`: glowing border via box-shadow
- CSS: `box-shadow: 0 0 0 2px var(--theme-accent), 0 0 12px rgba(accent, 0.3)` + `border-radius: 4px`

### 7. SessionItem — Shift+Click + dual highlighting
**File:** `packages/web/src/components/sidebar/SessionItem.tsx`

- onClick handler checks `e.shiftKey`:
  - If shift AND a session is already selected → `openSplit(session.id)`
  - Otherwise → `selectSession(session.id)` (exits split)
- Highlighting: `isSelected` OR `isSplit` → both get highlighted
  - Primary selected: current accent border style
  - Split session: slightly dimmer variant (e.g., accent-muted border)

### 8. Keyboard Shortcuts — Exit split on navigate
**File:** `packages/web/src/hooks/useKeyboardShortcuts.ts`

- Cmd+Shift+Up/Down already calls `selectSession()` which now calls `closeSplit()`
- Add Escape handler: if in split mode, `closeSplit()` and keep focused pane's session

## Implementation Order

1. Session store changes (split state)
2. Terminal manager refactor (remove singleton assumptions)
3. useTerminal hook refactor (per-instance WebSocket)
4. WebSocket singleton cleanup
5. SessionPane component (extract from MainPanel)
6. MainPanel split layout
7. SessionItem shift+click + dual highlighting
8. Keyboard shortcut updates
9. Visual polish (glow border, divider styling)

## Edge Cases

- Shift+click same session that's already open → no-op
- Shift+click when no session selected → normal select (no split)
- Session killed while in split → auto-exit split, remaining session goes full-width
- Settings panel active → split not applicable
- Resize: each pane's ResizeObserver handles its own terminal fitting
