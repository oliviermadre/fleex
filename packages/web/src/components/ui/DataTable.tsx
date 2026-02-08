import { cn } from '../../lib/cn';

export interface Column<T> {
  key: string;
  header: string;
  /** Fixed pixel width (e.g. '55px'). */
  width?: string;
  /** When true, column shrinks to fit its content (whitespace-nowrap). */
  shrink?: boolean;
  align?: 'left' | 'center' | 'right';
  render: (row: T) => React.ReactNode;
}

interface DataTableProps<T> {
  columns: Column<T>[];
  data: T[];
  selectedIndex: number | null;
  onSelect: (index: number) => void;
  loading?: boolean;
  emptyMessage?: string;
  maxHeight?: string;
}

/** Flexible columns (no width, no shrink) get width:100% to fill remaining space. */
function colStyle(col: { width?: string; shrink?: boolean }): React.CSSProperties | undefined {
  if (col.width) return { width: col.width };
  if (col.shrink) return undefined; // sized by content via whitespace-nowrap
  return { width: '100%' };
}

function SkeletonRows({ columns, count }: { columns: Column<unknown>[]; count: number }) {
  return (
    <>
      {Array.from({ length: count }, (_, i) => (
        <tr key={i} className="border-b border-[var(--theme-border-subtle)]">
          {columns.map((col, j) => (
            <td
              key={j}
              className={cn('px-3 py-2', col.shrink && 'whitespace-nowrap')}
              style={colStyle(col)}
            >
              <div className="h-4 animate-pulse rounded bg-[var(--theme-border-input)]" style={{ opacity: 0.5 }} />
            </td>
          ))}
        </tr>
      ))}
    </>
  );
}

export function DataTable<T>({
  columns,
  data,
  selectedIndex,
  onSelect,
  loading = false,
  emptyMessage = 'No data',
  maxHeight = 'max-h-64',
}: DataTableProps<T>) {
  const alignClass = (align?: 'left' | 'center' | 'right') => {
    if (align === 'center') return 'text-center';
    if (align === 'right') return 'text-right';
    return 'text-left';
  };

  const isFlex = (col: Column<T>) => !col.width && !col.shrink;

  return (
    <div className={cn('overflow-auto rounded-md border border-[var(--theme-border)]', maxHeight)}>
      <table className="w-full text-sm" style={{ tableLayout: 'auto' }}>
        <thead className="sticky top-0 z-10 bg-[var(--theme-bg-overlay)]">
          <tr>
            {columns.map((col) => (
              <th
                key={col.key}
                className={cn(
                  'px-3 py-2 text-xs font-medium text-[var(--theme-text-secondary)]',
                  alignClass(col.align),
                  col.shrink && 'whitespace-nowrap'
                )}
                style={colStyle(col)}
              >
                {col.header}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {loading ? (
            <SkeletonRows columns={columns as Column<unknown>[]} count={5} />
          ) : data.length === 0 ? (
            <tr>
              <td
                colSpan={columns.length}
                className="px-3 py-8 text-center text-sm text-[var(--theme-text-muted)]"
              >
                {emptyMessage}
              </td>
            </tr>
          ) : (
            data.map((row, i) => (
              <tr
                key={i}
                className={cn(
                  'cursor-pointer border-b border-[var(--theme-border-subtle)] transition-colors',
                  selectedIndex === i
                    ? 'bg-emerald-500/15 text-emerald-300'
                    : 'text-[var(--theme-text-secondary)] hover:bg-[var(--theme-bg-hover)]'
                )}
                onClick={() => onSelect(i)}
              >
                {columns.map((col) => (
                  <td
                    key={col.key}
                    className={cn(
                      'px-3 py-2 overflow-hidden',
                      alignClass(col.align),
                      col.shrink && 'whitespace-nowrap',
                      isFlex(col) && 'max-w-0'
                    )}
                    style={colStyle(col)}
                  >
                    {col.render(row)}
                  </td>
                ))}
              </tr>
            ))
          )}
        </tbody>
      </table>
    </div>
  );
}
