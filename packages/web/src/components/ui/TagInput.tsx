import { useState, useRef, useCallback } from 'react';
import { cn } from '../../lib/cn';

interface TagInputProps {
  label?: string;
  tags: string[];
  onChange: (tags: string[]) => void;
  placeholder?: string;
  helperText?: React.ReactNode;
  /** `compact` matches the dense side-panel inputs (11px, same height as a one-line text input). */
  size?: 'default' | 'compact';
}

export function TagInput({ label, tags, onChange, placeholder, helperText, size = 'default' }: TagInputProps) {
  const compact = size === 'compact';
  const [input, setInput] = useState('');
  const inputRef = useRef<HTMLInputElement>(null);

  const addTags = useCallback((raw: string) => {
    const entries = raw.split(/[\n,\s]+/).map((s) => s.trim()).filter(Boolean);
    const unique = entries.filter((e) => !tags.includes(e));
    if (unique.length > 0) onChange([...tags, ...unique]);
  }, [tags, onChange]);

  const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    const isCommit = e.key === 'Enter' || e.key === ' ' || e.key === ','
      || (e.key === 'Tab' && input.trim() !== '');
    if (isCommit) {
      e.preventDefault();
      if (input.trim()) {
        addTags(input);
        setInput('');
      }
    } else if (e.key === 'Backspace' && input === '' && tags.length > 0) {
      onChange(tags.slice(0, -1));
    }
  };

  const handlePaste = (e: React.ClipboardEvent<HTMLInputElement>) => {
    e.preventDefault();
    const text = e.clipboardData.getData('text');
    addTags(text);
    setInput('');
  };

  const removeTag = (index: number) => {
    onChange(tags.filter((_, i) => i !== index));
  };

  return (
    <div className="flex flex-col gap-1">
      {label && (
        <label className="text-xs font-medium text-[var(--theme-text-secondary)]">
          {label}
        </label>
      )}
      <div
        className={cn(
          'flex flex-wrap rounded-md border border-[var(--theme-border-input)] bg-[var(--theme-bg-surface)]',
          'focus-within:border-[var(--theme-accent)]',
          compact ? 'gap-1 px-2 py-1' : 'gap-1.5 px-3 py-2 focus-within:ring-1 focus-within:ring-[var(--theme-accent)]',
          'cursor-text'
        )}
        onClick={() => inputRef.current?.focus()}
      >
        {tags.map((tag, i) => (
          <span
            key={tag}
            className={cn(
              'inline-flex items-center gap-1 rounded font-medium bg-[var(--theme-accent-muted)] text-[var(--theme-accent)]',
              compact ? 'px-1.5 text-[11px]' : 'px-2 py-0.5 text-xs',
            )}
          >
            {tag}
            <button
              type="button"
              className="text-current hover:text-[var(--theme-text-primary)] leading-none"
              onClick={(e) => { e.stopPropagation(); removeTag(i); }}
            >
              ×
            </button>
          </span>
        ))}
        <input
          ref={inputRef}
          className={cn(
            'flex-1 border-none bg-transparent text-[var(--theme-text-primary)] outline-none',
            compact
              ? 'min-w-[80px] p-0 text-[11px] placeholder:text-[var(--theme-text-faint)]'
              : 'min-w-[120px] text-sm placeholder:text-[var(--theme-text-muted)]',
          )}
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={handleKeyDown}
          onPaste={handlePaste}
          placeholder={tags.length === 0 ? placeholder : undefined}
        />
      </div>
      {helperText && (
        <div className="text-xs text-[var(--theme-text-muted)]">{helperText}</div>
      )}
    </div>
  );
}
