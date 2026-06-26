import {
  flexRender,
  getCoreRowModel,
  getPaginationRowModel,
  useReactTable,
  type ColumnDef,
  type PaginationState,
  type Row,
} from '@tanstack/react-table';
import { AlertTriangle, RefreshCw } from 'lucide-react';
import { useEffect, useMemo, useState, type HTMLAttributes } from 'react';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import {
  Pagination,
  PaginationButton,
  PaginationContent,
  PaginationEllipsis,
  PaginationItem,
  PaginationNext,
  PaginationPrevious,
} from '@/components/ui/pagination';
import { Button } from '@/components/ui/button';
import { EmptyState } from '@/components/empty-state';
import { Skeleton } from '@/components/ui/skeleton';
import { cn } from '@/lib/utils';

declare module '@tanstack/react-table' {
  interface ColumnMeta<TData, TValue> {
    cellClassName?: string;
    dataType?: TData;
    headerClassName?: string;
    valueType?: TValue;
  }
}

interface DataTableProps<TData> {
  columns: ColumnDef<TData>[];
  data: TData[];
  emptyText?: string;
  errorText?: string;
  getRowClassName?: (row: Row<TData>) => string | undefined;
  getRowProps?: (row: Row<TData>) => HTMLAttributes<HTMLTableRowElement>;
  loading?: boolean;
  loadingText?: string;
  minWidthClassName?: string;
  onRetry?: () => void;
  pageSize?: number;
  retryText?: string;
  tableClassName?: string;
}

function getPaginationItems(currentPage: number, pageCount: number) {
  if (pageCount <= 7) {
    return Array.from({ length: pageCount }, (_, index) => index + 1);
  }

  const pages = new Set([1, pageCount, currentPage]);
  if (currentPage > 2) pages.add(currentPage - 1);
  if (currentPage < pageCount - 1) pages.add(currentPage + 1);

  const sorted = Array.from(pages).sort((a, b) => a - b);
  const items: Array<number | 'ellipsis'> = [];

  sorted.forEach((page, index) => {
    const previous = sorted[index - 1];
    if (previous && page - previous > 1) {
      items.push('ellipsis');
    }
    items.push(page);
  });

  return items;
}

export function DataTable<TData>({
  columns,
  data,
  emptyText = 'Записей пока нет.',
  errorText,
  getRowClassName,
  getRowProps,
  loading = false,
  loadingText = 'Загрузка...',
  minWidthClassName,
  onRetry,
  pageSize,
  retryText = 'Повторить',
  tableClassName,
}: DataTableProps<TData>) {
  const [pagination, setPagination] = useState<PaginationState>({
    pageIndex: 0,
    pageSize: pageSize || 10,
  });

  useEffect(() => {
    if (!pageSize) return;
    setPagination({
      pageIndex: 0,
      pageSize,
    });
  }, [data.length, pageSize]);

  // TanStack Table intentionally returns non-memoizable helpers.
  // eslint-disable-next-line react-hooks/incompatible-library
  const table = useReactTable({
    columns,
    data,
    getCoreRowModel: getCoreRowModel(),
    getPaginationRowModel: pageSize ? getPaginationRowModel() : undefined,
    onPaginationChange: setPagination,
    state: {
      pagination,
    },
  });
  const pageCount = pageSize ? table.getPageCount() : 1;
  const currentPage = table.getState().pagination.pageIndex + 1;
  const paginationItems = useMemo(
    () => getPaginationItems(currentPage, pageCount),
    [currentPage, pageCount],
  );
  const firstRowNumber =
    pageSize && data.length > 0
      ? table.getState().pagination.pageIndex * pageSize + 1
      : 0;
  const lastRowNumber =
    pageSize && data.length > 0
      ? Math.min(data.length, table.getState().pagination.pageIndex * pageSize + pageSize)
      : 0;
  const errorMessage = errorText?.trim();
  const showError = Boolean(errorMessage) && !loading && data.length === 0;
  const showInlineError = Boolean(errorMessage) && !loading && data.length > 0;
  const showEmpty = !showError && !loading && table.getRowModel().rows.length === 0;
  const visibleColumns = table.getVisibleLeafColumns();
  const showSkeletonRows = loading && data.length === 0;
  const skeletonRows = Array.from({
    length: pageSize ? Math.min(pageSize, 6) : 5,
  });

  return (
    <div>
      {showInlineError && (
        <div className="mb-3 rounded-md border border-destructive/40 bg-destructive/10 p-3 text-sm text-destructive">
          <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
            <div className="flex min-w-0 gap-2">
              <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
              <div className="min-w-0">
                <div className="font-medium">Не удалось обновить данные</div>
                <div className="mt-1 text-destructive/85">{errorMessage}</div>
              </div>
            </div>
            {onRetry && (
              <Button type="button" variant="outline" size="sm" onClick={onRetry}>
                <RefreshCw className="mr-2 h-4 w-4" />
                {retryText}
              </Button>
            )}
          </div>
        </div>
      )}
      {showSkeletonRows && (
        <span className="sr-only" role="status">
          {loadingText}
        </span>
      )}
      <div className="w-full overflow-x-auto" aria-busy={loading || undefined}>
        <Table className={cn(minWidthClassName, tableClassName)}>
          <TableHeader>
            {table.getHeaderGroups().map((headerGroup) => (
              <TableRow key={headerGroup.id}>
                {headerGroup.headers.map((header) => (
                  <TableHead
                    key={header.id}
                    className={cn(
                      'whitespace-normal align-top',
                      header.column.columnDef.meta?.headerClassName,
                    )}
                    style={{ width: header.column.columnDef.size }}
                  >
                    {header.isPlaceholder
                      ? null
                      : flexRender(
                          header.column.columnDef.header,
                          header.getContext(),
                        )}
                  </TableHead>
                ))}
              </TableRow>
            ))}
          </TableHeader>
          <TableBody
            key={pageSize ? currentPage : 'all-rows'}
            className={pageSize ? 'crm-table-page' : undefined}
          >
            {showSkeletonRows ? (
              skeletonRows.map((_, rowIndex) => (
                <TableRow key={`skeleton-${rowIndex}`} className="h-16">
                  {visibleColumns.map((column, columnIndex) => {
                    const isLast = columnIndex === visibleColumns.length - 1;
                    const widthClassName =
                      columnIndex === 0
                        ? 'w-2/3'
                        : isLast
                          ? 'ml-auto w-14'
                          : columnIndex % 2 === 0
                            ? 'w-24'
                            : 'w-32';

                    return (
                      <TableCell
                        key={`${column.id}-${rowIndex}`}
                        className={cn(
                          'whitespace-normal align-top',
                          column.columnDef.meta?.cellClassName,
                        )}
                        style={{ width: column.columnDef.size }}
                      >
                        {columnIndex === 0 ? (
                          <div className="flex min-w-0 flex-col gap-2">
                            <Skeleton className={cn('h-4 max-w-full', widthClassName)} />
                            <Skeleton className="h-3 w-1/2 max-w-full" />
                          </div>
                        ) : (
                          <Skeleton className={cn('h-4 max-w-full', widthClassName)} />
                        )}
                      </TableCell>
                    );
                  })}
                </TableRow>
              ))
            ) : (
              table.getRowModel().rows.map((row) => {
                const rowProps = getRowProps?.(row) ?? {};

                return (
                  <TableRow
                    {...rowProps}
                    key={row.id}
                    className={cn(rowProps.className, getRowClassName?.(row))}
                  >
                    {row.getVisibleCells().map((cell) => (
                      <TableCell
                        key={cell.id}
                        className={cn(
                          'whitespace-normal align-top',
                          cell.column.columnDef.meta?.cellClassName,
                        )}
                        style={{ width: cell.column.columnDef.size }}
                      >
                        {flexRender(cell.column.columnDef.cell, cell.getContext())}
                      </TableCell>
                    ))}
                  </TableRow>
                );
              })
            )}
          </TableBody>
        </Table>
      </div>
      {showError && (
        <div className="border-t px-4 py-8">
          <div className="mx-auto flex max-w-[560px] flex-col items-center gap-3 text-center text-destructive">
            <AlertTriangle className="h-5 w-5" />
            <div className="min-w-0">
              <div className="font-medium">Не удалось загрузить данные</div>
              <div className="mt-1 break-words text-sm text-destructive/85">
                {errorMessage}
              </div>
            </div>
            {onRetry && (
              <Button type="button" variant="outline" size="sm" onClick={onRetry}>
                <RefreshCw className="mr-2 h-4 w-4" />
                {retryText}
              </Button>
            )}
          </div>
        </div>
      )}
      {showEmpty && (
        <div className="border-t px-4">
          <EmptyState compact title={emptyText} />
        </div>
      )}

      {pageSize && pageCount > 1 && (
        <div className="flex flex-col gap-3 border-t px-3 py-3 text-sm sm:flex-row sm:items-center sm:justify-between">
          <div className="text-muted-foreground">
            Показано {firstRowNumber}-{lastRowNumber} из {data.length}
          </div>
          <Pagination className="justify-end sm:w-auto">
            <PaginationContent>
              <PaginationItem>
                <PaginationPrevious
                  disabled={!table.getCanPreviousPage()}
                  onClick={() => table.previousPage()}
                />
              </PaginationItem>
              {paginationItems.map((item, index) => (
                <PaginationItem key={`${item}-${index}`}>
                  {item === 'ellipsis' ? (
                    <PaginationEllipsis />
                  ) : (
                    <PaginationButton
                      isActive={item === currentPage}
                      onClick={() => table.setPageIndex(item - 1)}
                    >
                      {item}
                    </PaginationButton>
                  )}
                </PaginationItem>
              ))}
              <PaginationItem>
                <PaginationNext
                  disabled={!table.getCanNextPage()}
                  onClick={() => table.nextPage()}
                />
              </PaginationItem>
            </PaginationContent>
          </Pagination>
        </div>
      )}
    </div>
  );
}
