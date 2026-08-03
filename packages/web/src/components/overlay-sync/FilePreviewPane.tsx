import { useMemo } from 'react';

import type {
  OverlayFileStatus,
  OverlaySyncFilePreview,
  OverlaySyncPreviewResponse,
} from '@fleex/shared';

import { cn } from '../../lib/cn';
import { tint, tintText } from '../../lib/tints';

import { computeLineDiff } from './lineDiff';

import type { TintHue } from '../../lib/tints';

export interface FilePreviewPaneProps {
  /** relPath currently selected for preview (null → empty state). */
  relPath: string | null;
  loading: boolean;
  preview: OverlaySyncPreviewResponse | null;
}

const STATUS_HUE: Record<OverlayFileStatus, TintHue> = {
  new: 'green',
  modified: 'yellow',
  identical: 'gray',
};

const STATUS_LABEL: Record<OverlayFileStatus, string> = {
  new: 'nouveau',
  modified: 'modifié',
  identical: 'identique',
};

/** Filenames that commonly hold secrets — surfaces a warning banner. */
function looksLikeSecret(relPath: string): boolean {
  const base = relPath.split('/').pop() ?? relPath;
  const lower = base.toLowerCase();
  return (
    lower.startsWith('.env') ||
    lower.endsWith('.pem') ||
    lower.endsWith('.key') ||
    lower.includes('secret') ||
    lower.includes('credential') ||
    lower.includes('.p12') ||
    lower.includes('id_rsa')
  );
}

function formatBytes(size: number): string {
  if (size < 1024) return `${size} B`;
  if (size < 1024 * 1024) return `${(size / 1024).toFixed(0)} KB`;
  return `${(size / (1024 * 1024)).toFixed(1)} MB`;
}

function formatMtime(ms: number | null): string {
  if (ms == null) return '—';
  try {
    return new Date(ms).toLocaleString();
  } catch {
    return '—';
  }
}

function SideMeta({ label, side }: { label: string; side: OverlaySyncFilePreview | null }) {
  return (
    <div className="flex items-baseline justify-between gap-2 px-2 py-1 text-[10px] text-[var(--theme-text-faint)]">
      <span className="font-medium uppercase tracking-wide text-[var(--theme-text-secondary)]">
        {label}
      </span>
      {side ? (
        <span className="truncate">
          {formatBytes(side.size)} · {formatMtime(side.mtimeMs)}
        </span>
      ) : (
        <span>absent</span>
      )}
    </div>
  );
}

export function FilePreviewPane({ relPath, loading, preview }: FilePreviewPaneProps) {
  const diff = useMemo(() => {
    if (!preview) return null;
    const overlayContent = preview.overlay?.content ?? '';
    const localContent = preview.local?.content ?? '';
    return computeLineDiff(overlayContent, localContent);
  }, [preview]);

  if (!relPath) {
    return (
      <div className="flex h-full items-center justify-center p-4 text-center text-xs text-[var(--theme-text-faint)]">
        Sélectionnez un fichier pour comparer le contenu local et celui de l'overlay.
      </div>
    );
  }

  if (loading || !preview) {
    return (
      <div className="flex h-full items-center justify-center p-4 text-xs text-[var(--theme-text-faint)]">
        <span className="animate-pulse">Chargement de l'aperçu…</span>
      </div>
    );
  }

  const secret = looksLikeSecret(relPath);
  const binary = Boolean(preview.local?.binary || preview.overlay?.binary);
  const truncated = Boolean(preview.local?.truncated || preview.overlay?.truncated);

  return (
    <div className="flex h-full min-h-0 flex-col">
      {/* Header: path + status */}
      <div className="flex items-center gap-2 border-b border-[var(--theme-border)] px-2 py-1.5">
        <span
          className="truncate font-mono text-xs text-[var(--theme-text-primary)]"
          title={relPath}
        >
          {relPath}
        </span>
        <span
          className={cn(
            'ml-auto shrink-0 rounded px-1.5 py-0.5 text-[10px] font-medium',
            tint(STATUS_HUE[preview.status]),
          )}
        >
          {STATUS_LABEL[preview.status]}
        </span>
      </div>

      {secret && (
        <div
          className={cn(
            'flex items-center gap-1.5 border-b border-[var(--theme-border)] px-2 py-1 text-[10px]',
            tintText('orange'),
          )}
        >
          <span>⚠</span>
          <span>
            Ce fichier ressemble à un secret. Vérifiez son contenu avant de le copier dans
            l'overlay.
          </span>
        </div>
      )}

      {binary ? (
        <div className="flex flex-1 items-center justify-center p-4 text-center text-xs text-[var(--theme-text-faint)]">
          Fichier binaire — aperçu indisponible.
        </div>
      ) : (
        <>
          <div className="grid grid-cols-2 border-b border-[var(--theme-border)]">
            <SideMeta label="overlay (actuel)" side={preview.overlay} />
            <div className="border-l border-[var(--theme-border)]">
              <SideMeta label="local (à copier)" side={preview.local} />
            </div>
          </div>

          {truncated && (
            <div
              className={cn(
                'border-b border-[var(--theme-border)] px-2 py-1 text-[10px]',
                tintText('yellow'),
              )}
            >
              ⚠ Contenu tronqué pour l'aperçu.
            </div>
          )}

          <div className="min-h-0 flex-1 overflow-auto font-mono text-[11px] leading-relaxed">
            {diff?.map((row, i) => (
              <div key={i} className="grid grid-cols-2">
                <div
                  className={cn(
                    'whitespace-pre-wrap break-all px-2',
                    row.type === 'del' && tintText('red'),
                  )}
                >
                  {row.left ?? ''}
                </div>
                <div
                  className={cn(
                    'whitespace-pre-wrap break-all border-l border-[var(--theme-border)] px-2',
                    row.type === 'add' && tintText('green'),
                  )}
                >
                  {row.right ?? ''}
                </div>
              </div>
            ))}
          </div>
        </>
      )}
    </div>
  );
}
