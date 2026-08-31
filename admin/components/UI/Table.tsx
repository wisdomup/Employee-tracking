import React, { useCallback, useMemo } from 'react';
import GlobalDataTable, { TableColumn } from './GlobalDataTable';
import ExportMenu from './ExportMenu';
import {
  exportTableToCsv,
  exportTableToPdf,
  getExportColumns,
  type TableExportColumn,
  type TableExportFormat,
} from '../../utils/tableExport';
import {
  buildGrandTotalExportRow,
  computeGrandTotals,
  type GrandTotalEntry,
} from '../../utils/tableGrandTotal';
import { useAuth } from '../../contexts/AuthContext';
import styles from './GlobalDataTable.module.scss';

/** Table export UI (CSV/PDF sub-header). Set to `false` to hide the Export button. */
const ENABLE_TABLE_EXPORT_UI = true;

export interface TableColumnConfig {
  key: string;
  title: string;
  render?: (value: any, row: any) => React.ReactNode;
  /** Skip this column in CSV (e.g. custom columns without a stable `key`). */
  omitFromExport?: boolean;
  /** Override CSV cell text (defaults to formatted `row[key]`). */
  exportValue?: (row: any) => string;
  /**
   * Force this column into or out of the grand total. Omit to let `computeGrandTotals`
   * decide — it sums a column when every non-empty value in it is a number.
   */
  total?: 'sum' | 'none';
  /** Format the summed figure (currency, units). Defaults to a plain grouped number. */
  totalFormat?: (total: number) => string;
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
  /** Show export control when `ENABLE_TABLE_EXPORT_UI` is true. Default: true. */
  exportable?: boolean;
  /** Base download name (extension added per format). Default: `export`. */
  exportFileName?: string;
  /** Which formats appear in the export menu. Default: CSV and PDF. */
  exportFormats?: TableExportFormat[];
  /** Optional title line at the top of exported PDFs. */
  exportPdfTitle?: string;
  /**
   * Show a grand-total bar under the table summing every numeric column, and carry the same
   * figures into CSV/PDF exports. On for reports; off for plain list tables, where summing
   * an id or a quantity column would be noise.
   */
  showGrandTotal?: boolean;
  /** Label on the total bar. Defaults to "Grand Total". */
  grandTotalLabel?: string;
}

/** The bar under the table: one figure per summable column, over the whole dataset. */
function GrandTotalBar({ totals, label }: { totals: GrandTotalEntry[]; label: string }) {
  if (totals.length === 0) return null;

  return (
    <div className={styles.grandTotalBar} role="group" aria-label={label}>
      <span className={styles.grandTotalLabel}>{label}</span>
      <div className={styles.grandTotalItems}>
        {totals.map((entry) => (
          <div key={entry.key} className={styles.grandTotalItem}>
            <span className={styles.grandTotalItemTitle}>{entry.title}</span>
            <strong className={styles.grandTotalItemValue}>{entry.text}</strong>
          </div>
        ))}
      </div>
    </div>
  );
}

function TableExportControl({
  disabled,
  columns,
  data,
  exportFileName,
  exportFormats,
  exportPdfTitle,
  grandTotalRow,
}: {
  disabled: boolean;
  columns: TableExportColumn[];
  data: unknown[];
  exportFileName: string;
  exportFormats: TableExportFormat[];
  exportPdfTitle?: string;
  grandTotalRow?: string[] | null;
}) {
  const runCsv = useCallback(() => {
    exportTableToCsv({ filename: exportFileName, columns, data, grandTotalRow });
  }, [columns, data, exportFileName, grandTotalRow]);

  const runPdf = useCallback(
    () =>
      exportTableToPdf({
        filename: exportFileName,
        columns,
        data,
        title: exportPdfTitle,
        grandTotalRow,
      }),
    [columns, data, exportFileName, exportPdfTitle, grandTotalRow],
  );

  return (
    <ExportMenu
      disabled={disabled}
      formats={exportFormats}
      onExportCsv={runCsv}
      onExportPdf={runPdf}
      ariaLabel="Export table"
    />
  );
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
  exportable = true,
  exportFileName = 'export',
  exportFormats = ['csv', 'pdf'],
  exportPdfTitle,
  showGrandTotal = false,
  grandTotalLabel = 'Grand Total',
}) => {
  const { user } = useAuth();
  const isAdmin = user?.role === 'admin';
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

  const formats = useMemo<TableExportFormat[]>(() => {
    const allowed = new Set<TableExportFormat>(['csv', 'pdf']);
    const list = exportFormats.filter((f) => allowed.has(f));
    return list.length ? [...list] : ['csv', 'pdf'];
  }, [exportFormats]);

  // Over the whole dataset, not the visible page — a total that changed on paging would be
  // worse than no total at all.
  const grandTotals = useMemo(
    () => (showGrandTotal ? computeGrandTotals(columns, data) : []),
    [showGrandTotal, columns, data],
  );

  const grandTotalRow = useMemo(
    () =>
      grandTotals.length
        ? buildGrandTotalExportRow(getExportColumns(columns as TableExportColumn[]), grandTotals)
        : null,
    [columns, grandTotals],
  );

  const subHeaderComponent =
    ENABLE_TABLE_EXPORT_UI && exportable && isAdmin ? (
      <TableExportControl
        disabled={loading || data.length === 0}
        columns={columns as TableExportColumn[]}
        data={data}
        exportFileName={exportFileName}
        exportFormats={formats}
        exportPdfTitle={exportPdfTitle}
        grandTotalRow={grandTotalRow}
      />
    ) : undefined;

  return (
    <>
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
      />
      {!loading && <GrandTotalBar totals={grandTotals} label={grandTotalLabel} />}
    </>
  );
};

export default Table;
