import React, { useMemo } from 'react';
import GlobalDataTable, { TableColumn } from './GlobalDataTable';
import {
  aggregateColumn,
  formatTotalForDisplay,
  type TableExportColumn,
  type TableExportFormat,
} from '../../utils/tableExport';

/**
 * Reports are view-only across the product: no export, no print, no download, for any role
 * including Admin.
 *
 * The CSV/PDF control that used to live in this table's sub-header has been **removed**
 * rather than hidden behind a flag, so it cannot be switched back on by accident. The four
 * `export*` props survive as accepted-and-ignored because roughly twenty pages still pass
 * them, and deleting them all in this change would have buried the actual removal in noise.
 *
 * Operational documents are NOT reports and keep their print path: order invoices, warehouse
 * stock-in / transfer / damage slips, and the product catalog download. Riders and warehouse
 * staff hand those to customers on paper.
 *
 * The honest limit: this removes the button, not the data. The report APIs still return JSON
 * to anyone with a valid token and browser dev tools. Closing that means removing the
 * server-side export endpoints, which is a separate decision.
 */

export interface TableColumnConfig {
  key: string;
  title: string;
  render?: (value: any, row: any) => React.ReactNode;
  /** Skip this column in CSV (e.g. custom columns without a stable `key`). */
  omitFromExport?: boolean;
  /** Override CSV cell text (defaults to formatted `row[key]`). */
  exportValue?: (row: any) => string;
  /**
   * Grand-total treatment for the footer row. Opt-in per column, because summing is only
   * meaningful for additive figures — a total of unit prices, percentages, rates or invoice
   * numbers is noise. `avg` suits rates; `count` counts rows where the value is truthy.
   */
  total?: 'sum' | 'avg' | 'count' | 'none';
  /** Value to aggregate for a row, when `row[key]` is not the raw number (formatted, nested, …). */
  totalValue?: (row: any) => number;
  /** Formats the aggregate; defaults to a locale-grouped number. */
  totalRender?: (value: number) => React.ReactNode;
  /** Backward-compatible alias for pages that still provide string formatting via `totalFormat`. */
  totalFormat?: (value: number) => string;
}

interface TableProps {
  columns: TableColumnConfig[];
  data: any[];
  loading?: boolean;
  onRowClick?: (row: any) => void;
  paginate?: boolean;
  pageSize?: number;
  noDataText?: string;
  fixedHeader?: boolean;
  fixedHeaderHeight?: string;
  /** @deprecated Accepted and ignored — reports are view-only. See the note above. */
  exportable?: boolean;
  /** @deprecated Accepted and ignored — reports are view-only. */
  exportFileName?: string;
  /** @deprecated Accepted and ignored — reports are view-only. */
  exportFormats?: TableExportFormat[];
  /** @deprecated Accepted and ignored — reports are view-only. */
  exportPdfTitle?: string;
  /** Backward-compatible alias for `showTotals`; older pages still pass this prop. */
  showGrandTotal?: boolean;
  /** Backward-compatible prop retained so older callers compile; the current footer row ignores it. */
  grandTotalLabel?: string;
  /** Hide the grand-total row even when columns declare a `total`. Default: shown. */
  showTotals?: boolean;
}



const Table: React.FC<TableProps> = ({
  columns,
  data,
  loading = false,
  onRowClick,
  paginate = true,
  pageSize = 10,
  noDataText,
  fixedHeader = false,
  fixedHeaderHeight,
  // `exportable`, `exportFileName`, `exportFormats` and `exportPdfTitle` are intentionally
  // NOT destructured. They stay in `TableProps` so the ~20 pages still passing them keep
  // compiling, but nothing here reads them — reports are view-only.
  showGrandTotal,
  grandTotalLabel: _grandTotalLabel = 'Grand Total',
  showTotals = true,
}) => {
  const normalizedColumns = useMemo<TableColumn<any>[]>(
    () =>
      columns.map((column) => ({
        name: column.title,
        selector: (row: any) => row[column.key],
        cell: column.render
          ? (row: any) => column.render?.(row[column.key], row)
          : undefined,
        sortable: true,
      })),
    [columns],
  );

  const totalsEnabled = showGrandTotal ?? showTotals;

  /** One cell per column; the first labels the row and states how many entries it covers. */
  const footerCells = useMemo<(React.ReactNode | null)[] | undefined>(() => {
    if (!totalsEnabled || data.length === 0) return undefined;
    if (!columns.some((column) => column.total && column.total !== 'none')) return undefined;

    return columns.map((column, index) => {
      if (column.total && column.total !== 'none') {
        const value = aggregateColumn(column as TableExportColumn, data);
        const formatted = column.totalRender
          ? column.totalRender(value)
          : column.totalFormat
            ? column.totalFormat(value)
          : formatTotalForDisplay(value);
        return column.total === 'avg' ? <span>Avg {formatted}</span> : formatted;
      }
      if (index === 0) {
        return <span>{`TOTAL · ${data.length.toLocaleString()} entries`}</span>;
      }
      return null;
    });
  }, [columns, data, totalsEnabled]);

  // No sub-header: the export control that lived here has been removed. See the note at the
  // top of this file.
  const subHeaderComponent = undefined;

  return (
    <GlobalDataTable
      columns={normalizedColumns}
      data={data}
      loading={loading}
      onRowClick={onRowClick}
      paginate={paginate}
      pageSize={pageSize}
      noDataText={noDataText}
      fixedHeader={fixedHeader}
      fixedHeaderHeight={fixedHeaderHeight}
      subHeaderComponent={subHeaderComponent}
      footerCells={footerCells}
    />
  );
};

export default Table;
