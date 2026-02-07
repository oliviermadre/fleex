import { useState, useRef, useEffect, useCallback } from 'react';
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
  const containerRef = useRef<HTMLDivElement>(null);

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

  // Close on outside click
  useEffect(() => {
    function handleClick(e: MouseEvent) {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setIsOpen(false);
      }
    }
    document.addEventListener('mousedown', handleClick);
    return () => document.removeEventListener('mousedown', handleClick);
  }, []);

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

  return (
    <div ref={containerRef} className="relative flex flex-col gap-1">
      {label && (
        <label htmlFor={id} className="text-xs font-medium text-zinc-400">
          {label}
        </label>
      )}
      <input
        ref={inputRef}
        id={id}
        type="text"
        className={cn(
          'rounded-md border border-zinc-700 bg-zinc-900 px-3 py-1.5 text-sm text-zinc-100',
          'placeholder:text-zinc-500',
          'focus:border-[#D77655] focus:outline-none focus:ring-1 focus:ring-[#D77655]'
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
        <ul
          ref={listRef}
          className="absolute top-full left-0 z-50 mt-1 max-h-48 w-full overflow-auto rounded-md border border-zinc-700 bg-zinc-900 py-1 shadow-lg"
        >
          {filtered.map((option, index) => (
            <li
              key={option.value}
              className={cn(
                'cursor-pointer px-3 py-1.5 text-sm',
                index === highlightedIndex
                  ? 'bg-[#D77655]/20 text-[#D77655]'
                  : 'text-zinc-300 hover:bg-zinc-800'
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
      )}
      {isOpen && filtered.length === 0 && query && (
        <div className="absolute top-full left-0 z-50 mt-1 w-full rounded-md border border-zinc-700 bg-zinc-900 px-3 py-2 text-sm text-zinc-500">
          No matches
        </div>
      )}
    </div>
  );
}
