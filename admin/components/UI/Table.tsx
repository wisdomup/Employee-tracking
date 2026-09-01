import React, { useCallback, useMemo } from 'react';
import GlobalDataTable, { TableColumn } from './GlobalDataTable';
import ExportMenu from './ExportMenu';
import { useAuth } from '../../contexts/AuthContext';
import {
  aggregateColumn,
  exportTableToCsv,
  exportTableToPdf,
  formatTotalForDisplay,
  type TableExportColumn,
  type TableExportFormat,
} from '../../utils/tableExport';

/**
 * ## Table export: who gets it, and why it is here at all
 *
 * Any table given an `exportFileName` renders a CSV/PDF control in its sub-header — but only
 * for Admin. Field and warehouse roles see no export control anywhere a list is displayed.
 * That is the same rule `DataExportButton` applies to the hand-rolled tables (order and
 * transfer line items, stock counts), so the two controls cannot disagree about who may
 * download a list. Pass `exportAdminOnly={false}` where the rows are the operator's own
 * unsaved working copy — hiding a draft from the person who just typed it buys nothing.
 *
 * This replaces a blanket removal ("no export for any role including Admin") that had already
 * stopped being true: the report and dashboard surfaces carry `AnalyticsExportButton`, so the
 * removal held only for `Table` while every page kept passing the props it ignored. One rule
 * in one place beats a comment that the rest of the app contradicts.
 *
 * Operational documents keep their own print path regardless: order invoices, warehouse
 * stock-in / transfer / damage slips, the product catalog download. Riders and warehouse staff
 * hand those to customers on paper.
 *
 * The honest limit, unchanged: this governs the button, not the data. The list APIs still
 * return JSON to anyone with a valid token and dev tools, and the export writes whatever rows
 * the page already fetched. Restricting the data itself means narrowing the endpoints — which
 * is what `GET /api/products/picker` does for the product list, and is a per-endpoint job.
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
  /** @deprecated Export is driven by `exportFileName`; this flag is accepted and ignored. */
  exportable?: boolean;
  /** Base download name (no extension). Providing it is what turns the control on. */
  exportFileName?: string;
  /** Which formats to offer. Both by default. */
  exportFormats?: TableExportFormat[];
  /** Title line at the top of the exported PDF. Defaults to the file name. */
  exportPdfTitle?: string;
  /** Admin-only by default — see the note at the top of this file. */
  exportAdminOnly?: boolean;
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
  exportFileName,
  exportFormats,
  exportPdfTitle,
  exportAdminOnly = true,
  showGrandTotal,
  grandTotalLabel: _grandTotalLabel = 'Grand Total',
  showTotals = true,
}) => {
  const { user } = useAuth();
  const role = user?.role;

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

  // The footer the user can see, rendered as export rows so a downloaded file carries the same
  // totals as the screen. `getExportTableData` appends its own totals row, so this is only for
  // the formats that take one separately.
  const exportColumns = columns as TableExportColumn[];

  const runCsv = useCallback(() => {
    exportTableToCsv({
      filename: exportFileName as string,
      columns: exportColumns,
      data,
    });
  }, [data, exportColumns, exportFileName]);

  const runPdf = useCallback(
    () =>
      exportTableToPdf({
        filename: exportFileName as string,
        columns: exportColumns,
        data,
        title: exportPdfTitle ?? exportFileName,
      }),
    [data, exportColumns, exportFileName, exportPdfTitle],
  );

  const mayExport = Boolean(exportFileName) && (!exportAdminOnly || role === 'admin');

  const subHeaderComponent = mayExport ? (
    <ExportMenu
      // An empty list has nothing to write; the control stays visible so its absence never
      // reads as "this role cannot export".
      disabled={loading || data.length === 0}
      formats={exportFormats}
      onExportCsv={runCsv}
      onExportPdf={runPdf}
      ariaLabel="Export table"
    />
  ) : undefined;

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
