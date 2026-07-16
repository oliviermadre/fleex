// Preload — desktop-only browser parity features injected into the web app.
//
// Two concerns live here, both mirroring what a real browser gives for free:
//   1. Find-in-page bar (Cmd/Ctrl+F) — a small UI driven by the main process's
//      native `webContents.findInPage`, so highlighting/scrolling/counter match
//      the browser. Opening is triggered from the app menu; Escape is handled in
//      the main process (see main.js) so it never leaks to the web app's other
//      Escape handlers (e.g. closing a split view).
//   2. Focus-sensitive history shortcuts `Cmd+←` / `Cmd+→` (macOS): when the
//      focus is in an editable field / terminal, these keep their edit meaning
//      (start/end of line); otherwise they navigate back/forward. The primary
//      shortcuts `Cmd+[` / `Cmd+]` (and `Alt+←/→` on Win/Linux) are wired as
//      global menu accelerators in the main process and always navigate.
//
// The find bar is appended to <body>, outside React's #root, so it survives SPA
// route changes. On a full reload (workspace switch) this preload re-runs and
// rebuilds it from scratch.

const { ipcRenderer } = require('electron');

const isMac = process.platform === 'darwin';
const TITLEBAR_HEIGHT = 38;
const FIND_DEBOUNCE_MS = 150;

let findBar = null;
let findInput = null;
let findCount = null;
let currentText = '';
let debounceTimer = null;

// ── Helpers ──────────────────────────────────────────────────────────────────

function isEditableTarget(el) {
  if (!el) return false;
  const tag = el.tagName;
  // Inputs, textareas, selects (xterm and Monaco both focus a hidden textarea).
  if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return true;
  if (el.isContentEditable) return true;
  return false;
}

function runFind(text, opts) {
  currentText = text;
  if (!text) {
    ipcRenderer.send('fleex:stop-find', 'clearSelection');
    updateCounter(0, 0);
    return;
  }
  ipcRenderer.send('fleex:find', text, opts || {});
}

function updateCounter(matches, active) {
  if (!findCount) return;
  if (!currentText) {
    findCount.textContent = '';
    findCount.classList.remove('no-results');
    return;
  }
  if (matches > 0) {
    findCount.textContent = `${active}/${matches}`;
    findCount.classList.remove('no-results');
  } else {
    findCount.textContent = '0/0';
    findCount.classList.add('no-results');
  }
}

// ── Find bar UI ───────────────────────────────────────────────────────────────

function injectStyles() {
  if (document.getElementById('fleex-find-style')) return;
  const style = document.createElement('style');
  style.id = 'fleex-find-style';
  style.textContent = `
    #fleex-find-bar {
      position: fixed;
      top: ${TITLEBAR_HEIGHT + 8}px;
      right: 16px;
      z-index: 100001;
      display: none;
      align-items: center;
      gap: 6px;
      padding: 6px 8px;
      background: var(--theme-bg-surface, #27273a);
      border: 1px solid var(--theme-border, #2a2a3e);
      border-radius: 8px;
      box-shadow: 0 6px 20px rgba(0, 0, 0, 0.4);
      font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
    }
    #fleex-find-bar.open { display: flex; }
    #fleex-find-input {
      background: var(--theme-bg-base, #1a1a2e);
      border: 1px solid var(--theme-border-input, #3f3f46);
      border-radius: 5px;
      color: var(--theme-text-primary, #e4e4e7);
      font-size: 13px;
      line-height: 1.2;
      padding: 4px 8px;
      width: 200px;
      outline: none;
    }
    #fleex-find-input:focus { border-color: var(--theme-accent, #6ee7b7); }
    #fleex-find-count {
      font-size: 12px;
      color: var(--theme-text-muted, #a1a1aa);
      min-width: 42px;
      text-align: center;
      font-variant-numeric: tabular-nums;
    }
    #fleex-find-count.no-results { color: var(--theme-danger, #ef4444); }
    #fleex-find-bar button {
      background: transparent;
      border: none;
      color: var(--theme-text-muted, #a1a1aa);
      cursor: pointer;
      font-size: 12px;
      line-height: 1;
      padding: 5px 7px;
      border-radius: 4px;
    }
    #fleex-find-bar button:hover {
      background: var(--theme-bg-overlay, #1a1a2e);
      color: var(--theme-text-primary, #e4e4e7);
    }
  `;
  (document.head || document.documentElement).appendChild(style);
}

function buildFindBar() {
  if (findBar) return;
  injectStyles();

  findBar = document.createElement('div');
  findBar.id = 'fleex-find-bar';
  findBar.innerHTML = `
    <input id="fleex-find-input" type="text" placeholder="Find" spellcheck="false" autocomplete="off" />
    <span id="fleex-find-count"></span>
    <button id="fleex-find-prev" title="Previous (Shift+Enter)" aria-label="Previous match">&#9650;</button>
    <button id="fleex-find-next" title="Next (Enter)" aria-label="Next match">&#9660;</button>
    <button id="fleex-find-close" title="Close (Esc)" aria-label="Close">&#10005;</button>
  `;
  document.body.appendChild(findBar);

  findInput = findBar.querySelector('#fleex-find-input');
  findCount = findBar.querySelector('#fleex-find-count');
  const prevBtn = findBar.querySelector('#fleex-find-prev');
  const nextBtn = findBar.querySelector('#fleex-find-next');
  const closeBtn = findBar.querySelector('#fleex-find-close');

  findInput.addEventListener('input', () => {
    const value = findInput.value;
    if (debounceTimer) clearTimeout(debounceTimer);
    debounceTimer = setTimeout(() => runFind(value, { findNext: false }), FIND_DEBOUNCE_MS);
  });

  findInput.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      if (currentText) runFind(currentText, { findNext: true, forward: !e.shiftKey });
    }
  });

  nextBtn.addEventListener('click', () => {
    if (currentText) runFind(currentText, { findNext: true, forward: true });
    findInput.focus();
  });
  prevBtn.addEventListener('click', () => {
    if (currentText) runFind(currentText, { findNext: true, forward: false });
    findInput.focus();
  });
  closeBtn.addEventListener('click', () => hideFindBar());
}

function showFindBar() {
  buildFindBar();
  findBar.classList.add('open');
  ipcRenderer.send('fleex:find-bar-state', true);
  findInput.focus();
  findInput.select();
  if (findInput.value) runFind(findInput.value, { findNext: false });
}

function hideFindBar() {
  if (!findBar) return;
  findBar.classList.remove('open');
  ipcRenderer.send('fleex:stop-find', 'clearSelection');
  ipcRenderer.send('fleex:find-bar-state', false);
}

// ── IPC from main process ───────────────────────────────────────────────────

ipcRenderer.on('fleex:show-find-bar', () => showFindBar());

// Main handles Escape (via before-input-event) and tells us to close; it has
// already stopped the native find, so just hide the UI without echoing state.
ipcRenderer.on('fleex:hide-find-bar', () => {
  if (findBar) findBar.classList.remove('open');
});

ipcRenderer.on('fleex:found-in-page', (_e, result) => {
  updateCounter(result.matches, result.active);
});

// Menu-driven Find Next / Find Previous.
ipcRenderer.on('fleex:find-nav', (_e, dir) => {
  showFindBar();
  if (currentText) runFind(currentText, { findNext: true, forward: dir === 'next' });
});

// Content changed under an open find bar: refresh highlights against new DOM.
ipcRenderer.on('fleex:refresh-find', () => {
  if (findBar && findBar.classList.contains('open') && currentText) {
    runFind(currentText, { findNext: false });
  }
});

// ── Focus-sensitive history shortcuts (macOS): Cmd+← / Cmd+→ ────────────────
// Primary Cmd+[ / Cmd+] (and Alt+←/→ elsewhere) are global menu accelerators.

if (isMac) {
  window.addEventListener(
    'keydown',
    (e) => {
      const metaOnly = e.metaKey && !e.ctrlKey && !e.altKey && !e.shiftKey;
      if (!metaOnly) return;
      if (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight') return;
      // In an editable context, keep the native start/end-of-line behaviour.
      if (isEditableTarget(document.activeElement)) return;
      e.preventDefault();
      ipcRenderer.send('fleex:navigate', e.key === 'ArrowLeft' ? 'back' : 'forward');
    },
    true,
  );
}

// Build the bar eagerly once the DOM is ready so first Cmd+F is instant.
if (document.readyState === 'loading') {
  window.addEventListener('DOMContentLoaded', buildFindBar);
} else {
  buildFindBar();
}
