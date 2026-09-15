/**
 * Code editor — the full-width "Code mode" center surface (Phase 2b). Left: the
 * ticket's file tree(s) with new-file / delete actions. Right: tabs of open files
 * backed by Monaco (syntax highlighting, ⌘S save writing back to the worktree, a
 * gutter on lines changed vs base). Open tabs + content live in codeEditorStore
 * so they survive switching to chat/shell and back. The tree polls every 5s.
 */
import { Suspense, lazy, useCallback, useEffect, useRef, useState } from 'react';
import type { WorktreeTree } from '@fleex/shared';
import * as api from '../../../services/api';
import { useWorkStore } from '../../../stores/workStore';
import { useToastStore } from '../../../stores/toastStore';
import { useCodeEditorStore, tabKey } from '../../../stores/codeEditorStore';
import { cn } from '../../../lib/cn';
import { FileTree } from './FileTree';
import { useCodeTreeWidth } from './useCodeTreeWidth';

const WorktreeMonaco = lazy(() => import('./WorktreeMonaco'));
const WorktreeDiffEditor = lazy(() => import('./WorktreeDiffEditor'));

const POLL_MS = 5000;

// Stable empty defaults so per-ticket selectors keep a constant reference until
// the store actually has data for the ticket (avoids effect/render churn).
const EMPTY_TABS: { repo: string; path: string }[] = [];
const EMPTY_FILES: Record<string, import('../../../stores/codeEditorStore').EditorFile> = {};

export function CodeEditor({ ticketId }: { ticketId: string }) {
  const addToast = useToastStore((s) => s.addToast);

  const tabs = useCodeEditorStore((s) => s.tabsByTicket[ticketId]) ?? EMPTY_TABS;
  const activeKey = useCodeEditorStore((s) => s.activeByTicket[ticketId]) ?? null;
  const filesMap = useCodeEditorStore((s) => s.filesByTicket[ticketId]) ?? EMPTY_FILES;
  const openTab = useCodeEditorStore((s) => s.openTab);
  const setActive = useCodeEditorStore((s) => s.setActive);
  const closeTabStore = useCodeEditorStore((s) => s.closeTab);
  const setFile = useCodeEditorStore((s) => s.setFile);
  const patchFile = useCodeEditorStore((s) => s.patchFile);

  const [tree, setTree] = useState<WorktreeTree | null>(null);
  const { width: treeWidth, resizing: treeResizing, startResize: startTreeResize, nudge: nudgeTree } = useCodeTreeWidth();
  const [showDiff, setShowDiff] = useState(false);
  const [baseByKey, setBaseByKey] = useState<Record<string, { loading: boolean; content: string }>>({});
  const inflight = useRef<Set<string>>(new Set());

  const loadTree = useCallback(async () => {
    try {
      setTree(await api.fetchWorktreeTree(ticketId));
    } catch {
      /* toast surfaced by request helper */
    }
  }, [ticketId]);

  useEffect(() => {
    setTree(null);
    void loadTree();
    const timer = window.setInterval(() => void loadTree(), POLL_MS);
    return () => window.clearInterval(timer);
  }, [loadTree]);

  // Load content for any open tab we don't have yet (fills after a reload too).
  useEffect(() => {
    for (const t of tabs) {
      const key = tabKey(t.repo, t.path);
      if (filesMap[key] || inflight.current.has(key)) continue;
      inflight.current.add(key);
      setFile(ticketId, key, { loading: true, content: '', original: '', changedLines: [], dirty: false });
      api
        .fetchWorktreeFile(ticketId, t.repo, t.path)
        .then((f) =>
          setFile(ticketId, key, {
            loading: false,
            content: f.content,
            original: f.content,
            changedLines: f.changedLines,
            dirty: false,
            binary: f.binary,
            truncated: f.truncated,
          }),
        )
        .catch(() =>
          setFile(ticketId, key, { loading: false, error: true, content: '', original: '', changedLines: [], dirty: false }),
        )
        .finally(() => inflight.current.delete(key));
    }
  }, [tabs, filesMap, ticketId, setFile]);

  const openFile = useCallback((repo: string, path: string) => openTab(ticketId, repo, path), [openTab, ticketId]);

  const onChange = useCallback(
    (key: string, value: string) => {
      const cur = useCodeEditorStore.getState().filesByTicket[ticketId]?.[key];
      patchFile(ticketId, key, { content: value, dirty: value !== (cur?.original ?? '') });
    },
    [ticketId, patchFile],
  );

  const save = useCallback(
    async (key: string, repo: string, path: string) => {
      const st = useCodeEditorStore.getState().filesByTicket[ticketId]?.[key];
      if (!st || st.saving || !st.dirty) return;
      patchFile(ticketId, key, { saving: true });
      try {
        await api.saveWorktreeFile(ticketId, repo, path, st.content);
        patchFile(ticketId, key, { original: st.content, dirty: false, saving: false });
        addToast('success', `Saved ${path.split('/').pop()}`);
        void loadTree();
      } catch {
        patchFile(ticketId, key, { saving: false });
      }
    },
    [ticketId, patchFile, addToast, loadTree],
  );

  const createFile = useCallback(
    async (repo: string, path: string) => {
      try {
        await api.createWorktreeFile(ticketId, repo, path, 'file');
        await loadTree();
        openTab(ticketId, repo, path);
      } catch {
        /* toast surfaced by request helper */
      }
    },
    [ticketId, loadTree, openTab],
  );

  const deleteFile = useCallback(
    async (repo: string, path: string) => {
      try {
        await api.deleteWorktreeFile(ticketId, repo, path);
        closeTabStore(ticketId, tabKey(repo, path));
        await loadTree();
        addToast('success', `Deleted ${path.split('/').pop()}`);
      } catch {
        /* toast surfaced by request helper */
      }
    },
    [ticketId, closeTabStore, loadTree, addToast],
  );

  // Reset to Edit view whenever the active file changes.
  useEffect(() => {
    setShowDiff(false);
  }, [activeKey]);

  const repos = tree?.repos ?? [];
  const active = activeKey ? filesMap[activeKey] : null;
  const activeTab = tabs.find((t) => tabKey(t.repo, t.path) === activeKey) ?? null;
  const activeBranch = activeTab ? repos.find((r) => r.repo === activeTab.repo)?.branch ?? '' : '';
  const base = activeKey ? baseByKey[activeKey] : undefined;

  const toggleDiff = useCallback(() => {
    const next = !showDiff;
    setShowDiff(next);
    if (next && activeKey && activeTab && !baseByKey[activeKey]) {
      const key = activeKey;
      setBaseByKey((p) => ({ ...p, [key]: { loading: true, content: '' } }));
      api
        .fetchWorktreeFileBase(ticketId, activeTab.repo, activeTab.path)
        .then((r) => setBaseByKey((p) => ({ ...p, [key]: { loading: false, content: r.content } })))
        .catch(() => setBaseByKey((p) => ({ ...p, [key]: { loading: false, content: '' } })));
    }
  }, [showDiff, activeKey, activeTab, baseByKey, ticketId]);

  return (
    <div className="flex min-h-0 flex-1 flex-col bg-[var(--theme-bg-base)]">
      {/* Full-width action bar: branch (left); view toggle, save, refresh (right). */}
      <div className="flex h-9 shrink-0 items-center gap-2 border-b border-[var(--theme-border)] bg-[var(--theme-bg-surface)] px-3 text-[11px]">
        {activeTab ? (
          activeBranch && (
            <span className="min-w-0 truncate font-mono text-[var(--theme-text-secondary)]" title={activeBranch}>
              ⎇ {activeBranch}
            </span>
          )
        ) : (
          <span className="text-[var(--theme-text-faint)]">Code</span>
        )}
        <div className="ml-auto flex shrink-0 items-center gap-2">
          {activeTab && active && !active.loading && !active.error && !active.binary && (
            <div className="flex items-center gap-0.5 rounded-md border border-[var(--theme-border)] p-0.5">
              <button
                type="button"
                onClick={() => setShowDiff(false)}
                className={cn('rounded px-2 py-0.5', !showDiff ? 'bg-[var(--theme-accent-muted)] text-[var(--theme-accent)]' : 'text-[var(--theme-text-muted)] hover:bg-[var(--theme-bg-hover)]')}
              >
                Edit
              </button>
              <button
                type="button"
                onClick={() => { if (!showDiff) toggleDiff(); }}
                className={cn('rounded px-2 py-0.5', showDiff ? 'bg-[var(--theme-accent-muted)] text-[var(--theme-accent)]' : 'text-[var(--theme-text-muted)] hover:bg-[var(--theme-bg-hover)]')}
              >
                Diff
              </button>
            </div>
          )}
          {activeTab && active && !active.loading && !active.error && !active.binary && !showDiff && (
            <button
              type="button"
              disabled={!active.dirty || active.saving}
              onClick={() => void save(activeKey!, activeTab.repo, activeTab.path)}
              title="Save (⌘S)"
              className={cn(
                'rounded px-2 py-0.5',
                active.dirty && !active.saving
                  ? 'bg-[var(--theme-accent)] text-[var(--theme-accent-fg)] hover:opacity-90'
                  : 'text-[var(--theme-text-faint)]',
              )}
            >
              {active.saving ? 'Saving…' : 'Save ⌘S'}
            </button>
          )}
          <button
            type="button"
            onClick={() => void loadTree()}
            title="Refresh tree"
            className="rounded p-1 text-[var(--theme-text-faint)] hover:bg-[var(--theme-bg-hover)] hover:text-[var(--theme-text-primary)]"
          >
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M21 12a9 9 0 1 1-2.64-6.36M21 3v6h-6" />
            </svg>
          </button>
        </div>
      </div>

      {/* Body row: full-height tree + editor column. */}
      <div className="flex min-h-0 flex-1">
      {/* Left: full-height file tree, drag-resizable. */}
      <div className="relative flex shrink-0" style={{ width: treeWidth }}>
        <div className="min-h-0 w-full overflow-auto border-r border-[var(--theme-border)] bg-[var(--theme-bg-surface)]">
          {repos.length === 0 ? (
            <div className="p-4 text-center text-[12px] text-[var(--theme-text-faint)]">No files to show yet.</div>
          ) : (
            <FileTree repos={repos} activeKey={activeKey} onOpenFile={openFile} onCreateFile={createFile} onDeleteFile={deleteFile} />
          )}
        </div>
        <div
          role="separator"
          aria-orientation="vertical"
          aria-label="Resize file tree"
          tabIndex={0}
          onMouseDown={startTreeResize}
          onKeyDown={(e) => {
            if (e.key === 'ArrowLeft') { e.preventDefault(); nudgeTree(-16); }
            if (e.key === 'ArrowRight') { e.preventDefault(); nudgeTree(16); }
          }}
          className={cn(
            'absolute -right-[2px] top-0 z-10 h-full w-[4px] cursor-col-resize transition-colors',
            'hover:bg-[var(--theme-accent)]/40 focus:bg-[var(--theme-accent)]/40 focus:outline-none',
            treeResizing && 'bg-[var(--theme-accent)]/60',
          )}
        />
      </div>

      {/* Right: tabs above the editor. */}
      <div className="flex min-h-0 min-w-0 flex-1 flex-col">
        {/* Tabs. */}
        <div className="flex h-9 shrink-0 items-center gap-0.5 overflow-x-auto border-b border-[var(--theme-border)] bg-[var(--theme-bg-surface)] px-2">
          {tabs.length === 0 && (
            <span className="px-2 text-[11px] text-[var(--theme-text-faint)]">No file open</span>
          )}
        {tabs.map((t) => {
          const key = tabKey(t.repo, t.path);
          const st = filesMap[key];
          const isActive = key === activeKey;
          return (
            <div
              key={key}
              className={cn(
                'group flex shrink-0 items-center gap-1.5 rounded-t border-b-2 px-2 py-1 text-[11px]',
                isActive
                  ? 'border-[var(--theme-accent)] bg-[var(--theme-bg-base)] text-[var(--theme-text-primary)]'
                  : 'border-transparent text-[var(--theme-text-secondary)] hover:bg-[var(--theme-bg-hover)]',
              )}
            >
              <button type="button" onClick={() => setActive(ticketId, key)} className="max-w-[180px] truncate font-mono" title={`${t.repo}/${t.path}`}>
                {t.path.split('/').pop()}
              </button>
              {st?.dirty && <span className="h-1.5 w-1.5 shrink-0 rounded-full bg-[var(--tint-yellow-solid)]" title="Unsaved" />}
              <button
                type="button"
                onClick={() => closeTabStore(ticketId, key)}
                className="shrink-0 rounded text-[var(--theme-text-faint)] opacity-0 hover:text-[var(--theme-text-primary)] group-hover:opacity-100"
                aria-label="Close tab"
              >
                <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <path d="M18 6 6 18M6 6l12 12" />
                </svg>
              </button>
            </div>
          );
        })}
        </div>

        {/* Editor body. */}
        <div className="flex min-h-0 flex-1 flex-col">
          {!activeTab || !active ? (
            <div className="flex flex-1 items-center justify-center text-[12px] text-[var(--theme-text-faint)]">
              Select a file to open it.
            </div>
          ) : active.loading ? (
            <div className="flex flex-1 items-center justify-center text-[12px] text-[var(--theme-text-faint)]">Loading…</div>
          ) : active.error ? (
            <div className="flex flex-1 items-center justify-center text-[12px] text-[var(--theme-text-faint)]">Could not load this file.</div>
          ) : active.binary ? (
            <div className="flex flex-1 items-center justify-center text-[12px] italic text-[var(--theme-text-faint)]">Binary file — not shown.</div>
          ) : (
            <div className="min-h-0 flex-1">
              <Suspense fallback={<div className="flex h-full items-center justify-center text-[12px] text-[var(--theme-text-faint)]">Loading editor…</div>}>
                {showDiff ? (
                  base?.loading ? (
                    <div className="flex h-full items-center justify-center text-[12px] text-[var(--theme-text-faint)]">Loading diff…</div>
                  ) : (
                    <WorktreeDiffEditor
                      key={`${activeKey}:diff`}
                      original={base?.content ?? ''}
                      modified={active.content}
                      path={activeTab.path}
                    />
                  )
                ) : (
                  <WorktreeMonaco
                    key={activeKey}
                    value={active.content}
                    path={activeTab.path}
                    changedLines={active.changedLines}
                    onChange={(v) => onChange(activeKey!, v)}
                    onSave={() => void save(activeKey!, activeTab.repo, activeTab.path)}
                  />
                )}
              </Suspense>
            </div>
          )}

          {/* Footer: breadcrumb (left); read-only / truncated notes (right). */}
          {activeTab && active && !active.loading && !active.error && (
            <div className="flex shrink-0 items-center gap-3 border-t border-[var(--theme-border)] bg-[var(--theme-bg-surface)] px-3 py-1.5 text-[11px]">
              <div className="min-w-0 flex-1">
                <Breadcrumb repo={activeTab.repo} path={activeTab.path} />
              </div>
              {showDiff && <span className="shrink-0 text-[var(--theme-text-faint)]">Diff vs base (read-only)</span>}
              {active.truncated && <span className="shrink-0 text-[var(--tint-yellow-text)]">truncated</span>}
            </div>
          )}
        </div>
      </div>
      </div>
    </div>
  );
}

/** Active-file breadcrumb: repo chip + path segments (display-only for now). */
function Breadcrumb({ repo, path }: { repo: string; path: string }) {
  const segments = path.split('/').filter(Boolean);
  return (
    <div className="flex min-w-0 items-center gap-1 truncate">
      <span className="shrink-0 rounded bg-[var(--theme-bg-hover)] px-1.5 py-0.5 font-mono text-[10px] text-[var(--theme-text-secondary)]">
        {repo.split('/')[1] ?? repo}
      </span>
      {segments.map((seg, i) => {
        const isLast = i === segments.length - 1;
        return (
          <span key={i} className="flex min-w-0 shrink items-center gap-1">
            <span className="text-[var(--theme-text-faint)]">›</span>
            <span className={cn('truncate font-mono', isLast ? 'text-[var(--theme-text-primary)]' : 'text-[var(--theme-text-muted)]')}>
              {seg}
            </span>
          </span>
        );
      })}
    </div>
  );
}
