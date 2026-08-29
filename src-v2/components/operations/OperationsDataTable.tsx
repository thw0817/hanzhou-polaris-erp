import {
  flexRender,
  tableFeatures,
  type ColumnDef,
  type RowData,
  useTable,
} from "@tanstack/react-table";
import { useVirtualizer } from "@tanstack/react-virtual";
import { useRef, type CSSProperties, type ReactNode } from "react";
import { cn } from "../../lib/cn";

const features = tableFeatures({});

export interface OperationsDataTableProps<TData extends RowData> {
  data: TData[];
  columns: Array<{ id: string; header: ReactNode }>;
  getRowId?: (row: TData, index: number) => string;
  ariaLabel: string;
  estimateRowHeight?: number;
  className?: string;
  renderEmpty?: () => ReactNode;
  renderRow?: (row: TData, index: number, rowId: string, style: CSSProperties) => ReactNode;
  renderHeader?: (columnId: string, header: ReactNode) => ReactNode;
}

/**
 * Shared dense table primitive. TanStack Table owns row/cell semantics while
 * TanStack Virtual limits DOM work for long operational lists. The shell keeps
 * horizontal scrolling available for SHEIN's wide data contract.
 */
export function OperationsDataTable<TData extends RowData>({
  data,
  columns,
  getRowId,
  ariaLabel,
  estimateRowHeight = 72,
  className,
  renderEmpty,
  renderRow,
  renderHeader,
}: OperationsDataTableProps<TData>) {
  const scrollRef = useRef<HTMLDivElement>(null);
  const table = useTable({
    data,
    columns: columns as ColumnDef<typeof features, TData, unknown>[],
    getRowId,
    features,
  });
  const rows = table.getRowModel().rows;
  // Keep short lists as native tables for perfect column geometry, but switch
  // earlier for review/draft lists where rich cells and thumbnails make a
  // 40-row DOM noticeably expensive during route transitions.
  const shouldVirtualize = rows.length > 40;
  const virtualizer = useVirtualizer({
    count: rows.length,
    getScrollElement: () => scrollRef.current,
    estimateSize: () => estimateRowHeight,
    overscan: 8,
  });

  if (!rows.length) return renderEmpty ? <>{renderEmpty()}</> : null;

  return (
    <div ref={scrollRef} className={cn("ops-table-scroll", className)} role="region" aria-label={ariaLabel}>
      <table className={cn("ops-data-table", shouldVirtualize && "ops-data-table--virtualized")}>
        <thead>
          {table.getHeaderGroups().map((headerGroup) => (
            <tr key={headerGroup.id}>
              {headerGroup.headers.map((header) => (
                <th key={header.id} scope="col">
                  {header.isPlaceholder ? null : renderHeader?.(header.column.id, header.column.columnDef.header as ReactNode) ?? flexRender(header.column.columnDef.header, header.getContext())}
                </th>
              ))}
            </tr>
          ))}
        </thead>
        <tbody
          className={shouldVirtualize ? "ops-data-table__virtual-body" : undefined}
          style={shouldVirtualize ? { height: `${virtualizer.getTotalSize()}px` } : undefined}
        >
          {(shouldVirtualize ? virtualizer.getVirtualItems().map((virtualRow) => ({
            index: virtualRow.index,
            row: rows[virtualRow.index],
            style: { transform: `translateY(${virtualRow.start}px)`, position: "absolute", insetInline: 0 } as CSSProperties,
            measure: virtualizer.measureElement,
          })) : rows.map((row, index) => ({
            index,
            row,
            style: {} as CSSProperties,
            measure: undefined,
          }))).map(({ index, row, style, measure }) => {
            if (renderRow) return renderRow(row.original, index, row.id, style);
            return (
              <tr key={row.id} data-index={index} ref={measure} style={style}>
                {row.getAllCells().map((cell) => (
                  <td key={cell.id}>{flexRender(cell.column.columnDef.cell, cell.getContext())}</td>
                ))}
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
