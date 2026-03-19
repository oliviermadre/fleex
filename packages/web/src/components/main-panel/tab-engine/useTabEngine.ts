import { useState, useCallback, useRef, useEffect, useMemo } from 'react';
import { useSettingsStore } from '../../../stores/settingsStore';
import { useUIStore } from '../../../stores/uiStore';
import { getTabKind } from './registry';
import type { TabDescriptor } from './types';

// ——— Drag state exposed to TabBar ———

export interface TabDragState {
  dragOverKey: string | null;
  dropEdge: 'left' | 'right';
  draggedKeyRef: React.RefObject<string | null>;
  handleDragStart: (key: string) => (e: React.DragEvent) => void;
  handleDragEnd: (e: React.DragEvent) => void;
  handleDragOver: (key: string) => (e: React.DragEvent) => void;
  handleDragLeave: (key: string) => (e: React.DragEvent) => void;
  handleDrop: (key: string) => (e: React.DragEvent) => void;
}

// ——— Hook return ———

export interface UseTabEngineReturn {
  /** Tabs sorted by persisted order */
  orderedTabs: TabDescriptor[];
  /** Currently active tab (null if none) */
  activeTab: TabDescriptor | null;
  /** Select a tab */
  setActiveTab: (tab: TabDescriptor | null) => void;
  /** Drag-to-reorder state + handlers for TabBar */
  drag: TabDragState;
  /** Close a tab (checks capabilities, delegates to kind.onClose) */
  closeTab: (tab: TabDescriptor) => Promise<void>;
  /** Rename a tab (checks capabilities, delegates to kind.onRename) */
  renameTab: (tab: TabDescriptor, newName: string) => Promise<void>;
}

const DND_MIME = 'application/x-panel-tab';

// ——— Hook ———

export function useTabEngine(groupId: string, tabs: TabDescriptor[]): UseTabEngineReturn {
  // — Ordering from persisted settings —
  const savedOrder = useSettingsStore((s) => s.settings.sessionOrder[groupId]);
  const setSessionOrder = useSettingsStore((s) => s.setSessionOrder);

  const orderedTabs = useMemo<TabDescriptor[]>(() => {
    if (!savedOrder || savedOrder.length === 0) return tabs;
    const orderMap = new Map(savedOrder.map((key, i) => [key, i]));
    return [...tabs].sort((a, b) => {
      const aOrder = orderMap.get(a.key) ?? Infinity;
      const bOrder = orderMap.get(b.key) ?? Infinity;
      return aOrder - bOrder;
    });
  }, [tabs, savedOrder]);

  // — Active tab state —
  const [activeTab, setActiveTabRaw] = useState<TabDescriptor | null>(null);

  // Persist last active tab per worktree (only if tab belongs to current group)
  const setLastActiveTab = useUIStore((s) => s.setLastActiveTab);
  useEffect(() => {
    if (!activeTab || !groupId) return;
    if (!orderedTabs.some((t) => t.key === activeTab.key)) return;
    setLastActiveTab(groupId, activeTab.key);
  }, [activeTab, groupId, setLastActiveTab, orderedTabs]);

  // Auto-restore or auto-select when tabs change
  const savedActiveKey = useUIStore((s) => groupId ? s.lastActiveTabByWorktree[groupId] : undefined);
  useEffect(() => {
    // If active tab was removed, reset
    if (activeTab && orderedTabs.length > 0 && !orderedTabs.some((t) => t.key === activeTab.key)) {
      setActiveTabRaw(null);
      return;
    }
    if (activeTab) return;

    // Try restore from persisted key (handle legacy un-prefixed IDs → treat as s:{id})
    if (savedActiveKey && orderedTabs.length > 0) {
      const normalizedKey = savedActiveKey.includes(':') ? savedActiveKey : `s:${savedActiveKey}`;
      const restored = orderedTabs.find((t) => t.key === normalizedKey);
      if (restored) {
        setActiveTabRaw(restored);
        return;
      }
    }

    // Fallback: first execution, then first session
    const firstExec = orderedTabs.find((t) => t.kind === 'execution');
    if (firstExec) {
      setActiveTabRaw(firstExec);
    } else if (orderedTabs.length > 0) {
      setActiveTabRaw(orderedTabs[0]!);
    }
  }, [orderedTabs, activeTab, savedActiveKey]);

  const setActiveTab = useCallback((tab: TabDescriptor | null) => {
    setActiveTabRaw(tab);
  }, []);

  // — Keyboard navigation: ⌘⇧←/→ —
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      const meta = e.metaKey || e.ctrlKey;
      if (!meta || !e.shiftKey || (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight')) return;
      if (useUIStore.getState().focusedFloatingPanelId) return;
      if (orderedTabs.length <= 1 || !activeTab) return;
      e.preventDefault();
      const idx = orderedTabs.findIndex((t) => t.key === activeTab.key);
      if (idx === -1) return;
      const next = e.key === 'ArrowLeft'
        ? (idx - 1 + orderedTabs.length) % orderedTabs.length
        : (idx + 1) % orderedTabs.length;
      setActiveTabRaw(orderedTabs[next]!);
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [orderedTabs, activeTab]);

  // — Drag-to-reorder —
  const [dragOverKey, setDragOverKey] = useState<string | null>(null);
  const [dropEdge, setDropEdge] = useState<'left' | 'right'>('right');
  const draggedKeyRef = useRef<string | null>(null);

  const handleDragStart = useCallback((key: string) => (e: React.DragEvent) => {
    draggedKeyRef.current = key;
    e.dataTransfer.effectAllowed = 'move';
    e.dataTransfer.setData(DND_MIME, key);
    (e.currentTarget as HTMLElement).style.opacity = '0.4';
  }, []);

  const handleDragEnd = useCallback((e: React.DragEvent) => {
    draggedKeyRef.current = null;
    setDragOverKey(null);
    (e.currentTarget as HTMLElement).style.opacity = '';
  }, []);

  const handleDragOver = useCallback((key: string) => (e: React.DragEvent) => {
    if (!e.dataTransfer.types.includes(DND_MIME)) return;
    e.preventDefault();
    e.dataTransfer.dropEffect = 'move';
    const rect = (e.currentTarget as HTMLElement).getBoundingClientRect();
    const midX = rect.left + rect.width / 2;
    setDropEdge(e.clientX < midX ? 'left' : 'right');
    setDragOverKey(key);
  }, []);

  const handleDragLeave = useCallback((key: string) => (e: React.DragEvent) => {
    if ((e.currentTarget as HTMLElement).contains(e.relatedTarget as Node)) return;
    if (dragOverKey === key) setDragOverKey(null);
  }, [dragOverKey]);

  const handleDrop = useCallback((targetKey: string) => (e: React.DragEvent) => {
    e.preventDefault();
    const sourceKey = e.dataTransfer.getData(DND_MIME);
    setDragOverKey(null);
    if (!sourceKey || sourceKey === targetKey || !groupId) return;

    const keys = orderedTabs.map((t) => t.key);
    const fromIdx = keys.indexOf(sourceKey);
    if (fromIdx === -1) return;
    keys.splice(fromIdx, 1);
    let toIdx = keys.indexOf(targetKey);
    if (toIdx === -1) return;
    if (dropEdge === 'right') toIdx += 1;
    keys.splice(toIdx, 0, sourceKey);

    setSessionOrder(groupId, keys);
  }, [orderedTabs, dropEdge, groupId, setSessionOrder]);

  const drag: TabDragState = {
    dragOverKey,
    dropEdge,
    draggedKeyRef,
    handleDragStart,
    handleDragEnd,
    handleDragOver,
    handleDragLeave,
    handleDrop,
  };

  // — Close / Rename (delegates to kind plugin) —

  const closeTab = useCallback(async (tab: TabDescriptor) => {
    if (!tab.capabilities.closable) return;
    const kind = getTabKind(tab.kind);
    if (!kind?.onClose) return;
    try {
      await kind.onClose(tab);
      // After close, if we just closed the active tab, select nearest neighbour
      if (activeTab?.key === tab.key) {
        const idx = orderedTabs.findIndex((t) => t.key === tab.key);
        const remaining = orderedTabs.filter((t) => t.key !== tab.key);
        if (remaining.length > 0) {
          const nextIdx = Math.min(idx, remaining.length - 1);
          setActiveTabRaw(remaining[nextIdx]!);
        } else {
          setActiveTabRaw(null);
        }
      }
    } catch {
      // silently fail
    }
  }, [activeTab, orderedTabs]);

  const renameTab = useCallback(async (tab: TabDescriptor, newName: string) => {
    if (!tab.capabilities.renamable) return;
    const kind = getTabKind(tab.kind);
    if (!kind?.onRename) return;
    try {
      await kind.onRename(tab, newName);
    } catch {
      // silently fail
    }
  }, []);

  // Always resolve activeTab from orderedTabs so meta stays fresh
  const resolvedActiveTab = activeTab
    ? orderedTabs.find((t) => t.key === activeTab.key) ?? activeTab
    : null;

  return { orderedTabs, activeTab: resolvedActiveTab, setActiveTab, drag, closeTab, renameTab };
}
