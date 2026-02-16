import { useState, useRef, useEffect } from 'react';
import type { TicketStatus } from '@asm/shared';
import { useTicketStore } from '../../stores/ticketStore';

export function InlineCardCreator({ boardId, status }: { boardId: string; status: TicketStatus }) {
  const [active, setActive] = useState(false);
  const [title, setTitle] = useState('');
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const createTicket = useTicketStore((s) => s.createTicket);

  useEffect(() => {
    if (active && inputRef.current) {
      inputRef.current.focus();
    }
  }, [active]);

  const handleSubmit = async () => {
    const trimmed = title.trim();
    if (!trimmed) {
      setActive(false);
      return;
    }
    await createTicket({ boardId, title: trimmed, status });
    setTitle('');
    setActive(false);
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSubmit();
    }
    if (e.key === 'Escape') {
      setTitle('');
      setActive(false);
    }
  };

  if (!active) {
    return (
      <button
        className="w-full rounded px-2 py-1.5 text-left text-xs text-[var(--theme-text-muted)] transition-colors hover:bg-[var(--theme-bg-hover)] hover:text-[var(--theme-text-secondary)]"
        onClick={() => setActive(true)}
      >
        + Add card
      </button>
    );
  }

  return (
    <div className="rounded-md border border-[var(--theme-border-input)] bg-[var(--theme-bg-surface)] p-2">
      <textarea
        ref={inputRef}
        className="w-full resize-none bg-transparent text-xs text-[var(--theme-text-primary)] placeholder:text-[var(--theme-text-muted)] focus:outline-none"
        rows={2}
        placeholder="Card title..."
        value={title}
        onChange={(e) => setTitle(e.target.value)}
        onKeyDown={handleKeyDown}
        onBlur={handleSubmit}
      />
    </div>
  );
}
