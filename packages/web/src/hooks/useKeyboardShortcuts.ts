import { useEffect } from 'react';
import { useUIStore } from '../stores/uiStore';
import { useSettingsStore } from '../stores/settingsStore';
import { useClaudeConfigStore } from '../stores/claudeConfigStore';
import { useScratchpadStore } from '../stores/scratchpadStore';
import { openSystemShell } from '../lib/systemShell';
import { floatingPositionRegistry } from '../components/main-panel/FloatingSessionOverlay';

export function useKeyboardShortcuts() {
  const toggleNav = useUIStore((s) => s.toggleNav);
  const openCreateModal = useUIStore((s) => s.openCreateModal);
  const openCommandPalette = useUIStore((s) => s.openCommandPalette);
  const toggleScratchpad = useUIStore((s) => s.toggleScratchpad);
  const activePanel = useUIStore((s) => s.activePanel);
  const focusedFloatingPanelId = useUIStore((s) => s.focusedFloatingPanelId);
  const floatingSessionIds = useUIStore((s) => s.floatingSessionIds);
  const bringToFront = useUIStore((s) => s.bringToFront);
  const claudeConfigSaveFile = useClaudeConfigStore((s) => s.saveFile);
  const scratchpadOpen = useUIStore((s) => s.scratchpadOpen);
  const cycleMarkdownMode = useScratchpadStore((s) => s.cycleMarkdownMode);
  const basePath = useSettingsStore((s) => s.settings.basePath);

  useEffect(() => {
    function handleKeyDown(e: KeyboardEvent) {
      // Alt+Shift+P: toggle scratchpad panel
      if (e.altKey && e.shiftKey && !e.metaKey && !e.ctrlKey && e.code === 'KeyP') {
        e.preventDefault();
        toggleScratchpad();
        return;
      }

      // Alt+Shift+V: cycle the scratchpad view mode (when panel is open).
      // Kept as an alias of the editor's own ⌘⇧P for existing muscle memory.
      if (e.altKey && e.shiftKey && !e.metaKey && !e.ctrlKey && e.code === 'KeyV') {
        e.preventDefault();
        if (scratchpadOpen) cycleMarkdownMode();
        return;
      }

      // Alt-only combos (uses e.code for macOS Option key compatibility)
      if (e.altKey && !e.metaKey && !e.ctrlKey && !e.shiftKey) {
        // Alt+T: new system shell, opened as a floating terminal
        if (e.code === 'KeyT') {
          e.preventDefault();
          void openSystemShell(basePath);
          return;
        }
      }

      const meta = e.metaKey || e.ctrlKey;

      // Cmd+K: open command palette
      if (meta && e.key === 'k') {
        e.preventDefault();
        openCommandPalette();
        return;
      }

      // Cmd+S: save file in claude-config panel
      if (meta && e.key === 's') {
        if (activePanel === 'claude-config') {
          e.preventDefault();
          claudeConfigSaveFile();
          return;
        }
      }

      // Cmd+B: toggle nav sidebar
      if (meta && e.key === 'b') {
        e.preventDefault();
        toggleNav();
        return;
      }

      // Cmd+Shift+N: open "New Session" modal
      if (meta && e.shiftKey && e.code === 'KeyN') {
        e.preventDefault();
        openCreateModal();
        return;
      }

      // Cmd+Shift+Arrow: spatial navigation between floating overlays
      if (meta && e.shiftKey && ['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown'].includes(e.key) && focusedFloatingPanelId) {
        if (floatingSessionIds.length > 1) {
          const currentRect = floatingPositionRegistry.get(focusedFloatingPanelId);
          if (currentRect) {
            const currentCenterX = currentRect.x + currentRect.width / 2;
            const currentCenterY = currentRect.y + currentRect.height / 2;

            const isHorizontal = e.key === 'ArrowLeft' || e.key === 'ArrowRight';
            let bestId: string | null = null;
            let bestDist = Infinity;

            for (const otherId of floatingSessionIds) {
              if (otherId === focusedFloatingPanelId) continue;
              const rect = floatingPositionRegistry.get(otherId);
              if (!rect) continue;

              const cx = rect.x + rect.width / 2;
              const cy = rect.y + rect.height / 2;

              // Filter by direction
              const inDirection =
                (e.key === 'ArrowUp' && cy < currentCenterY) ||
                (e.key === 'ArrowDown' && cy > currentCenterY) ||
                (e.key === 'ArrowLeft' && cx < currentCenterX) ||
                (e.key === 'ArrowRight' && cx > currentCenterX);

              if (!inDirection) continue;

              // Weighted distance: heavily penalize off-axis deviation so
              // left/right prefers same row, up/down prefers same column
              const dx = cx - currentCenterX;
              const dy = cy - currentCenterY;
              const dist = isHorizontal
                ? Math.abs(dx) + Math.abs(dy) * 3
                : Math.abs(dy) + Math.abs(dx) * 3;
              if (dist < bestDist) {
                bestDist = dist;
                bestId = otherId;
              }
            }

            if (bestId) {
              e.preventDefault();
              bringToFront(bestId);
              return;
            }
          }
        }
        // Always block fallthrough when floating window is focused
        e.preventDefault();
        return;
      }
    }

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [toggleNav, openCreateModal, openCommandPalette, toggleScratchpad, scratchpadOpen, cycleMarkdownMode, activePanel, claudeConfigSaveFile, basePath, focusedFloatingPanelId, floatingSessionIds, bringToFront]);
}
