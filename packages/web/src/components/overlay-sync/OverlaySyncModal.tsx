import { useCallback, useEffect, useMemo, useState } from 'react';

import type {
  OverlaySyncApplyItem,
  OverlaySyncApplyResponse,
  OverlaySyncPreviewResponse,
  OverlaySyncRepoScan,
} from '@fleex/shared';

import { cn } from '../../lib/cn';
import { tint, tintText } from '../../lib/tints';
import {
  overlaySyncApply,
  overlaySyncPreview,
  overlaySyncRemove,
  overlaySyncScan,
} from '../../services/api';
import { Button } from '../ui/Button';
import { Modal } from '../ui/Modal';

import { CheckboxTree } from './CheckboxTree';
import { FilePreviewPane } from './FilePreviewPane';
import { collectFiles, defaultSelection, itemKey } from './overlaySyncModel';

export interface OverlaySyncModalProps {
  open: boolean;
  onClose: () => void;
  /** Ticket workspace root (or a single repo checkout) the server walks for worktrees. */
  rootPath: string;
}

interface PreviewSel {
  org: string;
  name: string;
  relPath: string;
  key: string;
}

export function OverlaySyncModal({ open, onClose, rootPath }: OverlaySyncModalProps) {
  const [groups, setGroups] = useState<OverlaySyncRepoScan[] | null>(null);
  const [scanning, setScanning] = useState(false);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [showIdentical, setShowIdentical] = useState(false);

  const [previewSel, setPreviewSel] = useState<PreviewSel | null>(null);
  const [preview, setPreview] = useState<OverlaySyncPreviewResponse | null>(null);
  const [previewLoading, setPreviewLoading] = useState(false);

  const [applying, setApplying] = useState(false);
  const [applyResult, setApplyResult] = useState<OverlaySyncApplyResponse | null>(null);

  const [confirmCleanup, setConfirmCleanup] = useState(false);
  const [removing, setRemoving] = useState(false);

  // Scan every workspace repo when the modal opens; reset on close.
  useEffect(() => {
    if (!open) {
      setGroups(null);
      setSelected(new Set());
      setPreviewSel(null);
      setPreview(null);
      setApplyResult(null);
      setConfirmCleanup(false);
      return;
    }
    let cancelled = false;
    setScanning(true);
    setApplyResult(null);
    overlaySyncScan(rootPath)
      .then((res) => {
        if (cancelled) return;
        setGroups(res.groups);
        setSelected(defaultSelection(res.groups));
      })
      .catch(() => {
        if (!cancelled) setGroups([]);
      })
      .finally(() => {
        if (!cancelled) setScanning(false);
      });
    return () => {
      cancelled = true;
    };
  }, [open, rootPath]);

  const onToggle = useCallback(
    (org: string, name: string, relPaths: string[], checked: boolean) => {
      setSelected((prev) => {
        const next = new Set(prev);
        for (const rel of relPaths) {
          const k = itemKey(org, name, rel);
          if (checked) next.add(k);
          else next.delete(k);
        }
        return next;
      });
    },
    [],
  );

  const onPreview = useCallback(
    (org: string, name: string, relPath: string) => {
      const group = groups?.find((g) => g.org === org && g.name === name);
      if (!group) return;
      const key = itemKey(org, name, relPath);
      setPreviewSel({ org, name, relPath, key });
      setPreview(null);
      setPreviewLoading(true);
      overlaySyncPreview({ org, name, worktreePath: group.worktreePath, relPath })
        .then((res) => setPreview(res))
        .catch(() => setPreviewSel(null))
        .finally(() => setPreviewLoading(false));
    },
    [groups],
  );

  const applyItems = useMemo<OverlaySyncApplyItem[]>(() => {
    if (!groups) return [];
    const items: OverlaySyncApplyItem[] = [];
    for (const group of groups) {
      if (!group.available) continue;
      for (const file of collectFiles(group.tree)) {
        if (selected.has(itemKey(group.org, group.name, file.relPath))) {
          items.push({
            org: group.org,
            name: group.name,
            worktreePath: group.worktreePath,
            relPath: file.relPath,
          });
        }
      }
    }
    return items;
  }, [groups, selected]);

  const orphans = useMemo(() => {
    if (!groups) return [] as { org: string; name: string; relPath: string }[];
    const out: { org: string; name: string; relPath: string }[] = [];
    for (const group of groups) {
      for (const entry of group.overlayContents) {
        if (entry.orphan) out.push({ org: group.org, name: group.name, relPath: entry.relPath });
      }
    }
    return out;
  }, [groups]);

  const handleApply = useCallback(() => {
    if (applyItems.length === 0) return;
    setApplying(true);
    overlaySyncApply(applyItems)
      .then((res) => setApplyResult(res))
      .finally(() => setApplying(false));
  }, [applyItems]);

  const handleCleanup = useCallback(() => {
    if (orphans.length === 0) return;
    setRemoving(true);
    // Group orphans by repo for the remove endpoint.
    const byRepo = new Map<string, { org: string; name: string; relPaths: string[] }>();
    for (const o of orphans) {
      const k = `${o.org}/${o.name}`;
      const bucket = byRepo.get(k) ?? { org: o.org, name: o.name, relPaths: [] };
      bucket.relPaths.push(o.relPath);
      byRepo.set(k, bucket);
    }
    Promise.all([...byRepo.values()].map((b) => overlaySyncRemove(b)))
      .then(() => {
        // Drop removed orphans from local state so panel ③ reflects the change.
        setGroups((prev) =>
          prev
            ? prev.map((g) => ({
                ...g,
                overlayContents: g.overlayContents.filter((e) => !e.orphan),
              }))
            : prev,
        );
        setConfirmCleanup(false);
      })
      .finally(() => setRemoving(false));
  }, [orphans]);

  const visibleGroups = groups ?? [];
  const anySecret = applyItems.some((i) => {
    const base = i.relPath.split('/').pop() ?? i.relPath;
    return base.toLowerCase().startsWith('.env');
  });

  return (
    <Modal open={open} onClose={onClose} maxWidth="max-w-5xl" className="p-0">
      <div className="flex h-[80vh] flex-col">
        {/* Header */}
        <div className="flex items-center gap-2 border-b border-[var(--theme-border)] px-4 py-3">
          <h2 className="text-sm font-semibold text-[var(--theme-text-primary)]">Sync overlay</h2>
          <span className="text-xs text-[var(--theme-text-faint)]">
            Copie les fichiers gitignorés du workspace vers l'overlay des dépôts.
          </span>
          <label className="ml-auto flex items-center gap-1.5 text-xs text-[var(--theme-text-secondary)]">
            <input
              type="checkbox"
              checked={showIdentical}
              onChange={(e) => setShowIdentical(e.target.checked)}
            />
            Afficher les identiques
          </label>
          <button
            type="button"
            className="rounded p-1 text-[var(--theme-text-faint)] hover:bg-[var(--theme-accent-muted)] hover:text-[var(--theme-text-primary)]"
            onClick={onClose}
            title="Fermer"
          >
            ✕
          </button>
        </div>

        {anySecret && (
          <div
            className={cn(
              'flex items-center gap-1.5 border-b border-[var(--theme-border)] px-4 py-1.5 text-[11px]',
              tintText('orange'),
            )}
          >
            <span>⚠</span>
            <span>
              La sélection contient des fichiers <code>.env</code>. Ces fichiers seront versionnés
              dans l'overlay — vérifiez qu'aucun secret sensible ne fuite.
            </span>
          </div>
        )}

        {/* Body: tree | preview */}
        <div className="flex min-h-0 flex-1">
          <div className="flex w-1/2 min-w-0 flex-col overflow-auto border-r border-[var(--theme-border)]">
            {scanning ? (
              <div className="flex flex-1 items-center justify-center p-4 text-xs text-[var(--theme-text-faint)]">
                <span className="animate-pulse">Analyse des dépôts…</span>
              </div>
            ) : visibleGroups.length === 0 ? (
              <div className="flex flex-1 items-center justify-center p-4 text-center text-xs text-[var(--theme-text-faint)]">
                Aucun dépôt à synchroniser.
              </div>
            ) : (
              visibleGroups.map((group) => (
                <div
                  key={`${group.org}/${group.name}`}
                  className="border-b border-[var(--theme-border)]"
                >
                  <div className="flex items-center gap-2 bg-[var(--theme-bg-overlay)] px-2 py-1">
                    <span className="truncate font-mono text-xs font-semibold text-[var(--theme-text-primary)]">
                      {group.org}/{group.name}
                    </span>
                    {!group.available && (
                      <span
                        className={cn('ml-auto shrink-0 text-[10px]', tintText('red'))}
                        title={group.message}
                      >
                        indisponible
                      </span>
                    )}
                  </div>
                  {group.available && (
                    <CheckboxTree
                      group={group}
                      selected={selected}
                      onToggle={onToggle}
                      showIdentical={showIdentical}
                      previewKey={previewSel?.key ?? null}
                      onPreview={onPreview}
                    />
                  )}
                </div>
              ))
            )}
          </div>

          <div className="w-1/2 min-w-0">
            <FilePreviewPane
              relPath={previewSel?.relPath ?? null}
              loading={previewLoading}
              preview={preview}
            />
          </div>
        </div>

        {/* Cleanup panel ③ */}
        {orphans.length > 0 && (
          <div className="border-t border-[var(--theme-border)] px-4 py-2">
            <div className="flex items-center gap-2 text-xs">
              <span className={cn('font-medium', tintText('orange'))}>
                {orphans.length} orphelin{orphans.length > 1 ? 's' : ''} dans l'overlay
              </span>
              <span className="truncate text-[10px] text-[var(--theme-text-faint)]">
                {orphans.map((o) => o.relPath).join(', ')}
              </span>
              {confirmCleanup ? (
                <div className="ml-auto flex items-center gap-1.5">
                  <span className="text-[10px] text-[var(--theme-text-secondary)]">
                    Supprimer définitivement ?
                  </span>
                  <Button variant="danger" size="sm" onClick={handleCleanup} disabled={removing}>
                    {removing ? 'Suppression…' : 'Confirmer'}
                  </Button>
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => setConfirmCleanup(false)}
                    disabled={removing}
                  >
                    Annuler
                  </Button>
                </div>
              ) : (
                <Button
                  variant="ghost"
                  size="sm"
                  className="ml-auto"
                  onClick={() => setConfirmCleanup(true)}
                >
                  Nettoyer
                </Button>
              )}
            </div>
          </div>
        )}

        {/* Footer: recap + apply */}
        <div className="flex items-center gap-3 border-t border-[var(--theme-border)] px-4 py-3">
          {applyResult ? (
            <div className="flex min-w-0 flex-1 flex-col gap-0.5 text-xs">
              <span className={cn('font-medium', tintText('green'))}>
                {applyResult.copied.length} fichier{applyResult.copied.length > 1 ? 's' : ''} copié
                {applyResult.copied.length > 1 ? 's' : ''}
                {applyResult.errors.length > 0 && (
                  <span className={cn('ml-2', tintText('red'))}>
                    · {applyResult.errors.length} erreur{applyResult.errors.length > 1 ? 's' : ''}
                  </span>
                )}
              </span>
              <span className="truncate text-[10px] text-[var(--theme-text-faint)]">
                {applyResult.copied.map((c) => c.target).join(', ')}
              </span>
            </div>
          ) : (
            <span className="flex-1 text-xs text-[var(--theme-text-secondary)]">
              {applyItems.length} fichier{applyItems.length > 1 ? 's' : ''} sélectionné
              {applyItems.length > 1 ? 's' : ''}
            </span>
          )}
          <Button variant="ghost" size="sm" onClick={onClose}>
            {applyResult ? 'Fermer' : 'Annuler'}
          </Button>
          <Button
            variant="primary"
            size="sm"
            onClick={handleApply}
            disabled={applying || applyItems.length === 0 || Boolean(applyResult)}
          >
            {applying
              ? 'Copie…'
              : `Copier ${applyItems.length} fichier${applyItems.length > 1 ? 's' : ''}`}
          </Button>
        </div>
      </div>
    </Modal>
  );
}
