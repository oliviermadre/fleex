import { useState } from 'react';

import type { OverlayFileStatus, OverlaySyncNode, OverlaySyncRepoScan } from '@fleex/shared';

import { cn } from '../../lib/cn';
import { tintText } from '../../lib/tints';

import { fileRelPaths, hasVisibleFiles, itemKey, nodeState } from './overlaySyncModel';

import type { TintHue } from '../../lib/tints';

export interface CheckboxTreeProps {
  group: OverlaySyncRepoScan;
  selected: Set<string>;
  onToggle: (org: string, name: string, relPaths: string[], checked: boolean) => void;
  showIdentical: boolean;
  previewKey: string | null;
  onPreview: (org: string, name: string, relPath: string) => void;
}

const STATUS_META: Record<OverlayFileStatus, { label: string; symbol: string; hue: TintHue }> = {
  new: { label: 'nouveau', symbol: '✚', hue: 'green' },
  modified: { label: 'modifié', symbol: '±', hue: 'yellow' },
  identical: { label: 'identique', symbol: '=', hue: 'gray' },
};

function formatBytes(size: number): string {
  if (size < 1024) return `${size} B`;
  if (size < 1024 * 1024) return `${(size / 1024).toFixed(0)} KB`;
  return `${(size / (1024 * 1024)).toFixed(1)} MB`;
}

function TriCheckbox({
  state,
  disabled,
}: {
  state: 'checked' | 'unchecked' | 'indeterminate';
  disabled?: boolean;
}) {
  return (
    <span
      className={cn(
        'flex h-3.5 w-3.5 shrink-0 items-center justify-center rounded-sm border text-[9px] leading-none',
        disabled
          ? 'border-[var(--theme-border)] opacity-40'
          : state === 'unchecked'
            ? 'border-[var(--theme-border)]'
            : 'border-[var(--theme-accent)] bg-[var(--theme-accent)] text-[var(--theme-accent-fg,#fff)]',
      )}
    >
      {state === 'checked' ? '✓' : state === 'indeterminate' ? '–' : ''}
    </span>
  );
}

export function CheckboxTree({
  group,
  selected,
  onToggle,
  showIdentical,
  previewKey,
  onPreview,
}: CheckboxTreeProps) {
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());
  const { org, name } = group;

  const renderNodes = (nodes: OverlaySyncNode[], depth: number) =>
    nodes
      .filter((node) => hasVisibleFiles(node, showIdentical))
      .map((node) => {
        const indent = { paddingLeft: `${depth * 14 + 4}px` };

        if (node.type === 'dir') {
          const heavy = node.denylisted || node.truncated;
          const isCollapsed = collapsed.has(node.relPath) || Boolean(node.denylisted);
          const state = nodeState(node, org, name, selected);
          const rels = fileRelPaths(node);
          return (
            <div key={`d:${node.relPath}`}>
              <div
                className="flex items-center gap-1.5 py-0.5 pr-2 text-xs text-[var(--theme-text-secondary)] hover:bg-[var(--theme-accent-muted)]"
                style={indent}
              >
                {!heavy ? (
                  <button
                    type="button"
                    className="shrink-0"
                    onClick={() => onToggle(org, name, rels, state !== 'checked')}
                    title="Cocher / décocher le dossier"
                  >
                    <TriCheckbox state={state} />
                  </button>
                ) : (
                  <TriCheckbox state="unchecked" disabled />
                )}
                <button
                  type="button"
                  className="flex min-w-0 flex-1 items-center gap-1 text-left"
                  onClick={() =>
                    !node.denylisted &&
                    setCollapsed((prev) => {
                      const next = new Set(prev);
                      if (next.has(node.relPath)) next.delete(node.relPath);
                      else next.add(node.relPath);
                      return next;
                    })
                  }
                >
                  <span className="w-3 shrink-0 text-[var(--theme-text-faint)]">
                    {node.denylisted ? '' : isCollapsed ? '▸' : '▾'}
                  </span>
                  <span className="truncate font-medium">{node.name}/</span>
                  {node.denylisted && (
                    <span className={cn('ml-1 shrink-0 text-[10px]', tintText('gray'))}>
                      ⛔ volumineux
                    </span>
                  )}
                  {node.truncated && (
                    <span className={cn('ml-1 shrink-0 text-[10px]', tintText('yellow'))}>
                      ⚠ tronqué
                    </span>
                  )}
                </button>
              </div>
              {!isCollapsed && node.children.length > 0 && renderNodes(node.children, depth + 1)}
            </div>
          );
        }

        // File node
        const key = itemKey(org, name, node.relPath);
        const isSelected = selected.has(key);
        const meta = STATUS_META[node.status];
        const isPreview = previewKey === key;
        return (
          <div
            key={`f:${node.relPath}`}
            className={cn(
              'flex items-center gap-1.5 py-0.5 pr-2 text-xs hover:bg-[var(--theme-accent-muted)]',
              isPreview && 'bg-[var(--theme-accent-muted)]',
            )}
            style={indent}
          >
            <button
              type="button"
              className="shrink-0"
              onClick={() => onToggle(org, name, [node.relPath], !isSelected)}
            >
              <TriCheckbox state={isSelected ? 'checked' : 'unchecked'} />
            </button>
            <button
              type="button"
              className="flex min-w-0 flex-1 items-center gap-1.5 text-left"
              onClick={() => onPreview(org, name, node.relPath)}
              title="Aperçu"
            >
              <span className="w-3 shrink-0" />
              <span className="truncate text-[var(--theme-text-primary)]">{node.name}</span>
              <span className={cn('shrink-0 text-[10px]', tintText(meta.hue))} title={meta.label}>
                {meta.symbol} {meta.label}
              </span>
              <span className="ml-auto shrink-0 text-[10px] text-[var(--theme-text-faint)]">
                {formatBytes(node.size)}
              </span>
            </button>
          </div>
        );
      });

  return <div>{renderNodes(group.tree, 0)}</div>;
}
