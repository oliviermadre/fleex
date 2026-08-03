import { useState, useRef, useCallback } from 'react';

import { cn } from '../../lib/cn';

interface TagInputProps {
  label?: string;
  tags: string[];
  onChange: (tags: string[]) => void;
  placeholder?: string;
  helperText?: React.ReactNode;
}

export function TagInput({ label, tags, onChange, placeholder, helperText }: TagInputProps) {
  const [input, setInput] = useState('');
  const inputRef = useRef<HTMLInputElement>(null);

  const addTags = useCallback(
    (raw: string) => {
      const entries = raw
        .split(/[\n,\s]+/)
        .map((s) => s.trim())
        .filter(Boolean);
      const unique = entries.filter((e) => !tags.includes(e));
      if (unique.length > 0) onChange([...tags, ...unique]);
    },
    [tags, onChange],
  );

  const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    const isCommit =
      e.key === 'Enter' ||
      e.key === ' ' ||
      e.key === ',' ||
      (e.key === 'Tab' && input.trim() !== '');
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
        <label className="text-xs font-medium text-[var(--theme-text-secondary)]">{label}</label>
      )}
      <div
        className={cn(
          'flex flex-wrap gap-1.5 rounded-md border border-[var(--theme-border-input)] bg-[var(--theme-bg-surface)] px-3 py-2',
          'focus-within:border-[var(--theme-accent)] focus-within:ring-1 focus-within:ring-[var(--theme-accent)]',
          'cursor-text',
        )}
        onClick={() => inputRef.current?.focus()}
      >
        {tags.map((tag, i) => (
          <span
            key={tag}
            className="inline-flex items-center gap-1 rounded px-2 py-0.5 text-xs font-medium bg-[var(--theme-accent-muted)] text-[var(--theme-accent)]"
          >
            {tag}
            <button
              type="button"
              className="text-current hover:text-[var(--theme-text-primary)] leading-none"
              onClick={(e) => {
                e.stopPropagation();
                removeTag(i);
              }}
            >
              ×
            </button>
          </span>
        ))}
        <input
          ref={inputRef}
          className="flex-1 min-w-[120px] border-none bg-transparent text-sm text-[var(--theme-text-primary)] placeholder:text-[var(--theme-text-muted)] outline-none"
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={handleKeyDown}
          onPaste={handlePaste}
          placeholder={tags.length === 0 ? placeholder : undefined}
        />
      </div>
      {helperText && <div className="text-xs text-[var(--theme-text-muted)]">{helperText}</div>}
    </div>
  );
}
