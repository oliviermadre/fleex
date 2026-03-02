import { useEffect, useRef, useState } from 'react';
import type { ClaudeConfigTreeEntry } from '@asm/shared';
import { useClaudeConfigStore } from '../../stores/claudeConfigStore';
import { useUIStore } from '../../stores/uiStore';
import { TreeContextMenu } from './TreeContextMenu';
import { DeleteConfirmModal } from './DeleteConfirmModal';
import { cn } from '../../lib/cn';

export function ClaudeConfigTree() {
  const tree = useClaudeConfigStore((s) => s.tree);
  const treeLoading = useClaudeConfigStore((s) => s.treeLoading);
  const loadTree = useClaudeConfigStore((s) => s.loadTree);
  const openContextMenu = useClaudeConfigStore((s) => s.openContextMenu);
  const toggleContentPanel = useUIStore((s) => s.toggleContentPanel);

  useEffect(() => {
    loadTree();
  }, [loadTree]);

  const handleTreeContextMenu = (e: React.MouseEvent) => {
    // Only trigger if right-clicking on the empty area (not on a node)
    if (e.target === e.currentTarget) {
      e.preventDefault();
      openContextMenu(e.clientX, e.clientY, '.claude', true);
    }
  };

  return (
    <div className="flex h-full flex-col">
      {/* Header — matches SidebarHeader height */}
      <div className="flex items-center justify-between border-b border-[var(--theme-border)] px-4" style={{ height: 'var(--header-height)' }}>
        <span className="text-xs font-bold uppercase tracking-wider text-[var(--theme-text-muted)]">Claude Config</span>
        <button
          onClick={toggleContentPanel}
          className="flex h-6 w-6 items-center justify-center rounded text-[var(--theme-text-muted)] transition-colors hover:bg-[var(--theme-bg-hover)] hover:text-[var(--theme-text-secondary)]"
          title="Collapse panel"
        >
          <svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
            <rect x="1.5" y="1.5" width="13" height="13" rx="2" />
            <line x1="6" y1="1.5" x2="6" y2="14.5" />
          </svg>
        </button>
      </div>

      {/* Tree content */}
      <div
        className="flex-1 overflow-y-auto py-1"
        onContextMenu={handleTreeContextMenu}
      >
        {treeLoading && tree.length === 0 ? (
          <div className="px-4 py-3 text-xs text-[var(--theme-text-muted)]">Loading...</div>
        ) : tree.length === 0 ? (
          <div className="px-4 py-3 text-xs text-[var(--theme-text-muted)]">No config files found</div>
        ) : (
          tree.map((entry) => (
            <TreeNode key={entry.relativePath} entry={entry} depth={0} />
          ))
        )}
      </div>

      <TreeContextMenu />
      <DeleteConfirmModal />
    </div>
  );
}

function TreeNode({ entry, depth }: { entry: ClaudeConfigTreeEntry; depth: number }) {
  const expandedDirs = useClaudeConfigStore((s) => s.expandedDirs);
  const toggleDir = useClaudeConfigStore((s) => s.toggleDir);
  const selectedFile = useClaudeConfigStore((s) => s.selectedFile);
  const selectFile = useClaudeConfigStore((s) => s.selectFile);
  const openContextMenu = useClaudeConfigStore((s) => s.openContextMenu);
  const creatingEntry = useClaudeConfigStore((s) => s.creatingEntry);

  const isExpanded = expandedDirs.has(entry.relativePath);
  const isSelected = selectedFile === entry.relativePath;

  const handleContextMenu = (e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    openContextMenu(e.clientX, e.clientY, entry.relativePath, entry.isDirectory);
  };

  if (entry.isDirectory) {
    const showInlineInput = creatingEntry && creatingEntry.parentPath === entry.relativePath;

    return (
      <>
        <button
          className={cn(
            'flex w-full items-center gap-1.5 py-1 pr-3 text-left text-xs transition-colors',
            'text-[var(--theme-text-secondary)] hover:bg-[var(--theme-bg-hover)]'
          )}
          style={{ paddingLeft: `${depth * 12 + 12}px` }}
          onClick={() => toggleDir(entry.relativePath)}
          onContextMenu={handleContextMenu}
        >
          {/* Chevron */}
          <svg
            width="12"
            height="12"
            viewBox="0 0 16 16"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
            className={cn('flex-shrink-0 transition-transform', isExpanded ? 'rotate-90' : '')}
          >
            <polyline points="6,4 10,8 6,12" />
          </svg>
          {/* Folder icon */}
          <svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round" className="flex-shrink-0 text-[var(--theme-text-muted)]">
            <path d="M2 4.5A1.5 1.5 0 0 1 3.5 3H6l1.5 2h5A1.5 1.5 0 0 1 14 6.5v5a1.5 1.5 0 0 1-1.5 1.5h-9A1.5 1.5 0 0 1 2 11.5v-7z" />
          </svg>
          <span className="truncate">{entry.name}</span>
        </button>
        {isExpanded && entry.children?.map((child) => (
          <TreeNode key={child.relativePath} entry={child} depth={depth + 1} />
        ))}
        {isExpanded && showInlineInput && (
          <InlineCreateInput
            depth={depth + 1}
            type={creatingEntry!.type}
          />
        )}
      </>
    );
  }

  return (
    <button
      className={cn(
        'flex w-full items-center gap-1.5 py-1 pr-3 text-left text-xs transition-colors',
        isSelected
          ? 'bg-[var(--theme-bg-hover)] text-[var(--theme-text-primary)]'
          : 'text-[var(--theme-text-secondary)] hover:bg-[var(--theme-bg-hover)]'
      )}
      style={{ paddingLeft: `${depth * 12 + 24}px` }}
      onClick={() => selectFile(entry.relativePath)}
      onContextMenu={handleContextMenu}
    >
      <FileIcon name={entry.name} />
      <span className="truncate">{entry.name}</span>
    </button>
  );
}

function InlineCreateInput({ depth, type }: { depth: number; type: 'file' | 'directory' }) {
  const confirmCreate = useClaudeConfigStore((s) => s.confirmCreate);
  const cancelCreate = useClaudeConfigStore((s) => s.cancelCreate);
  const [name, setName] = useState('');
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  const handleSubmit = () => {
    const trimmed = name.trim();
    if (!trimmed) {
      cancelCreate();
      return;
    }
    confirmCreate(trimmed);
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      handleSubmit();
    } else if (e.key === 'Escape') {
      e.preventDefault();
      cancelCreate();
    }
  };

  const icon = type === 'directory' ? (
    <svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round" className="flex-shrink-0 text-[var(--theme-text-muted)]">
      <path d="M2 4.5A1.5 1.5 0 0 1 3.5 3H6l1.5 2h5A1.5 1.5 0 0 1 14 6.5v5a1.5 1.5 0 0 1-1.5 1.5h-9A1.5 1.5 0 0 1 2 11.5v-7z" />
    </svg>
  ) : (
    <svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round" className="flex-shrink-0 text-[var(--theme-text-muted)]">
      <path d="M9 1.5H4.5A1.5 1.5 0 0 0 3 3v10a1.5 1.5 0 0 0 1.5 1.5h7A1.5 1.5 0 0 0 13 13V5.5L9 1.5z" />
      <polyline points="9,1.5 9,5.5 13,5.5" />
    </svg>
  );

  return (
    <div
      className="flex w-full items-center gap-1.5 py-0.5 pr-3"
      style={{ paddingLeft: `${type === 'directory' ? depth * 12 + 12 : depth * 12 + 24}px` }}
    >
      {type === 'directory' && (
        <svg width="12" height="12" viewBox="0 0 16 16" className="flex-shrink-0 opacity-0">
          <rect />
        </svg>
      )}
      {icon}
      <input
        ref={inputRef}
        className="min-w-0 flex-1 rounded border border-[var(--theme-border-focus)] bg-[var(--theme-bg-input,var(--theme-bg-surface))] px-1.5 py-0.5 text-xs text-[var(--theme-text-primary)] outline-none"
        placeholder={type === 'directory' ? 'folder name' : 'file name'}
        value={name}
        onChange={(e) => setName(e.target.value)}
        onKeyDown={handleKeyDown}
        onBlur={handleSubmit}
      />
    </div>
  );
}

function FileIcon({ name }: { name: string }) {
  const ext = name.split('.').pop()?.toLowerCase();

  if (ext === 'json') {
    return (
      <svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round" className="flex-shrink-0 text-yellow-500">
        <path d="M4 3c0-1 1-2 2-2s2 1 2 2v2c0 1-1 2-2 2" />
        <path d="M12 3c0-1-1-2-2-2s-2 1-2 2v2c0 1 1 2 2 2" />
        <path d="M4 13c0 1 1 2 2 2s2-1 2-2v-2c0-1-1-2-2-2" />
        <path d="M12 13c0 1-1 2-2 2s-2-1-2-2v-2c0-1 1-2 2-2" />
      </svg>
    );
  }

  if (ext === 'md') {
    return (
      <svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round" className="flex-shrink-0 text-blue-400">
        <rect x="1.5" y="3" width="13" height="10" rx="1" />
        <polyline points="4,9.5 5.5,7.5 7,9.5" />
        <polyline points="9,9.5 11,7.5" />
      </svg>
    );
  }

  // Generic file icon
  return (
    <svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round" className="flex-shrink-0 text-[var(--theme-text-muted)]">
      <path d="M9 1.5H4.5A1.5 1.5 0 0 0 3 3v10a1.5 1.5 0 0 0 1.5 1.5h7A1.5 1.5 0 0 0 13 13V5.5L9 1.5z" />
      <polyline points="9,1.5 9,5.5 13,5.5" />
    </svg>
  );
}
