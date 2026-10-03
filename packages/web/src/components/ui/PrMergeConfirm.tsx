import type { PrCiDetail, PrMergeMethod } from '@fleex/shared';
import { mergeMethodLabel } from '../../lib/prCi';
import { tintText } from '../../lib/tints';
import { ConfirmModal } from './ConfirmModal';

interface Props {
  /** The method being confirmed; null keeps the dialog closed. */
  method: PrMergeMethod | null;
  /** "agentic-dmc-2#39" */
  label: string;
  detail: PrCiDetail;
  busy: boolean;
  error: string | null;
  onConfirm: () => void;
  onCancel: () => void;
}

/** Every merge from a chip goes through this: no one-click merges. */
export function PrMergeConfirm({ method, label, detail, busy, error, onConfirm, onCancel }: Props) {
  if (!method) return null;
  const methodLabel = mergeMethodLabel(method);
  const warning = detail.ciStatus === 'failed'
    ? 'CI is failing — merge anyway?'
    : detail.ciStatus === 'running'
      ? 'CI is still running'
      : null;

  return (
    <ConfirmModal
      open
      title={`${methodLabel} ${label}?`}
      confirmLabel={busy ? 'Merging…' : methodLabel}
      danger={detail.ciStatus === 'failed'}
      busy={busy}
      onConfirm={onConfirm}
      onCancel={onCancel}
      message={
        <div className="space-y-1.5">
          <p>
            <span className="text-[var(--theme-text-primary)]">{detail.title}</span>
            {' '}into <span className="font-mono">{detail.baseRefName}</span>
          </p>
          {warning && <p className={tintText(detail.ciStatus === 'failed' ? 'red' : 'yellow')}>{warning}</p>}
          {error && (
            <p role="alert" className={tintText('red')}>
              {error}
            </p>
          )}
        </div>
      }
    />
  );
}
