import { useState, useRef, useEffect, useCallback } from 'react';
import { usePopover, FloatingPortal } from '../../hooks/usePopover';
import { cn } from '../../lib/cn';

interface AutocompleteOption {
  value: string;
  label: string;
}

interface AutocompleteProps {
  id?: string;
  label?: string;
  options: AutocompleteOption[];
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  autoFocus?: boolean;
}

export function Autocomplete({
  id,
  label,
  options,
  value,
  onChange,
  placeholder,
  autoFocus,
}: AutocompleteProps) {
  const [query, setQuery] = useState('');
  const [isOpen, setIsOpen] = useState(false);
  const [highlightedIndex, setHighlightedIndex] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLUListElement>(null);

  const { refs, floatingStyles, getFloatingProps } = usePopover({
    placement: 'bottom-start',
    role: 'listbox',
    enableClick: false,
    open: isOpen,
    onOpenChange: setIsOpen,
  });

  const selectedLabel = options.find((o) => o.value === value)?.label ?? '';

  const filtered = options.filter(
    (o) =>
      o.value !== '' &&
      o.label.toLowerCase().includes(query.toLowerCase())
  );

  useEffect(() => {
    setHighlightedIndex(0);
  }, [query]);

  useEffect(() => {
    if (!autoFocus || !inputRef.current) return;
    // Small delay to let modal animation settle
    const timer = setTimeout(() => inputRef.current?.focus(), 50);
    return () => clearTimeout(timer);
  }, [autoFocus]);

  // Outside-click / Escape dismissal is handled by usePopover via onOpenChange.
  // The input's own onKeyDown keeps handling Escape (with preventDefault/
  // stopPropagation) so it is intentionally left in place.

  // Scroll highlighted item into view
  useEffect(() => {
    if (!isOpen || !listRef.current) return;
    const item = listRef.current.children[highlightedIndex] as HTMLElement | undefined;
    item?.scrollIntoView({ block: 'nearest' });
  }, [highlightedIndex, isOpen]);

  const selectOption = useCallback(
    (option: AutocompleteOption) => {
      onChange(option.value);
      setQuery('');
      setIsOpen(false);
      inputRef.current?.blur();
    },
    [onChange]
  );

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (!isOpen) {
      if (e.key === 'ArrowDown' || e.key === 'Enter') {
        setIsOpen(true);
        e.preventDefault();
      }
      return;
    }

    switch (e.key) {
      case 'ArrowDown':
        e.preventDefault();
        setHighlightedIndex((i) => (i + 1) % filtered.length);
        break;
      case 'ArrowUp':
        e.preventDefault();
        setHighlightedIndex((i) => (i - 1 + filtered.length) % filtered.length);
        break;
      case 'Enter':
        e.preventDefault();
        if (filtered[highlightedIndex]) {
          selectOption(filtered[highlightedIndex]);
        }
        break;
      case 'Escape':
        e.preventDefault();
        e.stopPropagation();
        setIsOpen(false);
        break;
    }
  };

  const handleFocus = () => {
    setIsOpen(true);
    setQuery('');
  };

  const displayValue = isOpen ? query : selectedLabel;

  // Match the dropdown width to the input. Read at render so it tracks resize
  // across re-renders (open toggle, typing).
  const referenceWidth = refs.reference.current?.getBoundingClientRect?.().width;
  const listStyles = { ...floatingStyles, width: referenceWidth };

  return (
    <div ref={refs.setReference} className="relative flex flex-col gap-1">
      {label && (
        <label htmlFor={id} className="text-xs font-medium text-[var(--theme-text-secondary)]">
          {label}
        </label>
      )}
      <input
        ref={inputRef}
        id={id}
        type="text"
        className={cn(
          'rounded-md border border-[var(--theme-border-input)] bg-[var(--theme-bg-surface)] px-3 py-1.5 text-sm text-[var(--theme-text-primary)]',
          'placeholder:text-[var(--theme-text-muted)]',
          'focus:border-[var(--theme-accent)] focus:outline-none focus:ring-1 focus:ring-[var(--theme-accent)]'
        )}
        placeholder={placeholder}
        value={displayValue}
        onChange={(e) => {
          setQuery(e.target.value);
          if (!isOpen) setIsOpen(true);
        }}
        onFocus={handleFocus}
        onKeyDown={handleKeyDown}
        autoComplete="off"
      />
      {isOpen && filtered.length > 0 && (
        <FloatingPortal>
        <ul
          ref={(node) => { refs.setFloating(node); listRef.current = node; }}
          style={listStyles}
          {...getFloatingProps()}
          className="z-50 overflow-auto rounded-md border border-[var(--theme-border-input)] bg-[var(--theme-bg-surface)] py-1 shadow-lg"
        >
          {filtered.map((option, index) => (
            <li
              key={option.value}
              className={cn(
                'cursor-pointer px-3 py-1.5 text-sm',
                index === highlightedIndex
                  ? 'bg-[var(--theme-accent-muted)] text-[var(--theme-accent)]'
                  : 'text-[var(--theme-text-secondary)] hover:bg-[var(--theme-bg-overlay)]'
              )}
              onMouseEnter={() => setHighlightedIndex(index)}
              onMouseDown={(e) => {
                e.preventDefault(); // prevent blur before click
                selectOption(option);
              }}
            >
              {option.label}
            </li>
          ))}
        </ul>
        </FloatingPortal>
      )}
      {isOpen && filtered.length === 0 && query && (
        <FloatingPortal>
        <div
          ref={refs.setFloating}
          style={listStyles}
          {...getFloatingProps()}
          className="z-50 rounded-md border border-[var(--theme-border-input)] bg-[var(--theme-bg-surface)] px-3 py-2 text-sm text-[var(--theme-text-muted)]"
        >
          No matches
        </div>
        </FloatingPortal>
      )}
    </div>
  );
}
