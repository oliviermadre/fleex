import { useClaudeConfigStore } from '../../stores/claudeConfigStore';
import { Modal } from '../ui/Modal';

export function DeleteConfirmModal() {
  const deleteConfirm = useClaudeConfigStore((s) => s.deleteConfirm);
  const cancelDelete = useClaudeConfigStore((s) => s.cancelDelete);
  const confirmDelete = useClaudeConfigStore((s) => s.confirmDelete);

  if (!deleteConfirm) return null;

  const { name, isDirectory } = deleteConfirm;
  const kind = isDirectory ? 'folder' : 'file';

  return (
    <Modal open onClose={cancelDelete} maxWidth="max-w-sm">
      <h3 className="text-sm font-semibold text-[var(--theme-text-primary)]">
        Delete {kind}
      </h3>
      <p className="mt-2 text-xs text-[var(--theme-text-secondary)]">
        Are you sure you want to delete{' '}
        <span className="font-medium text-[var(--theme-text-primary)]">{name}</span>
        {isDirectory ? ' and all its contents' : ''}? This cannot be undone.
      </p>
      <div className="mt-4 flex justify-end gap-2">
        <button
          className="rounded-md px-3 py-1.5 text-xs text-[var(--theme-text-secondary)] transition-colors hover:bg-[var(--theme-bg-hover)]"
          onClick={cancelDelete}
        >
          Cancel
        </button>
        <button
          className="rounded-md bg-red-600 px-3 py-1.5 text-xs text-white transition-colors hover:bg-red-700"
          onClick={confirmDelete}
        >
          Delete
        </button>
      </div>
    </Modal>
  );
}
