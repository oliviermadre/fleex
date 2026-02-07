import { cn } from '../../lib/cn';

export interface Column<T> {
  key: string;
  header: string;
  width?: string;
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

function SkeletonRows({ columns, count }: { columns: { width?: string }[]; count: number }) {
  return (
    <>
      {Array.from({ length: count }, (_, i) => (
        <tr key={i} className="border-b border-zinc-800/50">
          {columns.map((col, j) => (
            <td key={j} className="px-3 py-2" style={col.width ? { width: col.width } : undefined}>
              <div className="h-4 animate-pulse rounded bg-zinc-700/50" />
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

  return (
    <div className={cn('overflow-auto rounded-md border border-zinc-800', maxHeight)}>
      <table className="w-full table-fixed text-sm">
        <thead className="sticky top-0 z-10 bg-zinc-800">
          <tr>
            {columns.map((col) => (
              <th
                key={col.key}
                className={cn(
                  'px-3 py-2 text-xs font-medium text-zinc-400',
                  alignClass(col.align)
                )}
                style={col.width ? { width: col.width } : undefined}
              >
                {col.header}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {loading ? (
            <SkeletonRows columns={columns} count={5} />
          ) : data.length === 0 ? (
            <tr>
              <td
                colSpan={columns.length}
                className="px-3 py-8 text-center text-sm text-zinc-500"
              >
                {emptyMessage}
              </td>
            </tr>
          ) : (
            data.map((row, i) => (
              <tr
                key={i}
                className={cn(
                  'cursor-pointer border-b border-zinc-800/50 transition-colors',
                  selectedIndex === i
                    ? 'bg-emerald-500/15 text-emerald-300'
                    : 'text-zinc-300 hover:bg-zinc-800/50'
                )}
                onClick={() => onSelect(i)}
              >
                {columns.map((col) => (
                  <td
                    key={col.key}
                    className={cn(
                      'px-3 py-2',
                      alignClass(col.align),
                      !col.width && 'overflow-hidden'
                    )}
                    style={col.width ? { width: col.width } : undefined}
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
