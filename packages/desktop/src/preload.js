// Preload — desktop-only browser parity: focus-sensitive history shortcuts.
//
// `Cmd+←` / `Cmd+→` (macOS): when the focus is in an editable field / terminal,
// these keep their native edit meaning (start/end of line); otherwise they
// navigate back/forward. The primary shortcuts `Cmd+[` / `Cmd+]` (and `Alt+←/→`
// on Win/Linux) are wired as global menu accelerators in the main process and
// always navigate, regardless of focus.
//
// (Find-in-page / Cmd+F used to live here too but was removed — the native
// findInPage bar behaved poorly inside the SPA.)

const { ipcRenderer } = require('electron');

const isMac = process.platform === 'darwin';

// Inputs, textareas, selects (xterm and Monaco both focus a hidden textarea),
// and contenteditable regions are treated as editable so the arrow keys keep
// their start/end-of-line meaning there.
function isEditableTarget(el) {
  if (!el) return false;
  const tag = el.tagName;
  if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return true;
  if (el.isContentEditable) return true;
  return false;
}

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
