import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { CaretDown } from '@phosphor-icons/react';
import GlobalDataTable, { TableColumn } from './GlobalDataTable';
import {
  aggregateColumn,
  exportTableToCsv,
  exportTableToPdf,
  formatTotalForDisplay,
  type TableExportColumn,
  type TableExportFormat,
} from '../../utils/tableExport';
import { useAuth } from '../../contexts/AuthContext';
import styles from './GlobalDataTable.module.scss';
import { toast } from 'react-toastify';

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
  /** Show export control when `ENABLE_TABLE_EXPORT_UI` is true. Default: true. */
  exportable?: boolean;
  /** Base download name (extension added per format). Default: `export`. */
  exportFileName?: string;
  /** Which formats appear in the export menu. Default: CSV and PDF. */
  exportFormats?: TableExportFormat[];
  /** Optional title line at the top of exported PDFs. */
  exportPdfTitle?: string;
  /** Backward-compatible alias for `showTotals`; older pages still pass this prop. */
  showGrandTotal?: boolean;
  /** Backward-compatible prop retained so older callers compile; the current footer row ignores it. */
  grandTotalLabel?: string;
  /** Hide the grand-total row even when columns declare a `total`. Default: shown. */
  showTotals?: boolean;
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
  const [open, setOpen] = useState(false);
  const [pdfBusy, setPdfBusy] = useState(false);
  const wrapRef = useRef<HTMLDivElement>(null);

  const hasCsv = exportFormats.includes('csv');
  const hasPdf = exportFormats.includes('pdf');
  const multi = hasCsv && hasPdf;

  useEffect(() => {
    if (!open) return;
    const onDocMouseDown = (e: MouseEvent) => {
      if (wrapRef.current && !wrapRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false);
    };
    document.addEventListener('mousedown', onDocMouseDown);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDocMouseDown);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);

  const runCsv = useCallback(() => {
    exportTableToCsv({ filename: exportFileName, columns, data, grandTotalRow });
    setOpen(false);
  }, [columns, data, exportFileName, grandTotalRow]);

  const runPdf = useCallback(async () => {
    setPdfBusy(true);
    try {
      await exportTableToPdf({
        filename: exportFileName,
        columns,
        data,
        title: exportPdfTitle,
        grandTotalRow,
      });
      setOpen(false);
    } catch (err) {
      console.error(err);
      toast.error('Could not generate PDF. Try again or use CSV.');
    } finally {
      setPdfBusy(false);
    }
  }, [columns, data, exportFileName, exportPdfTitle, grandTotalRow]);

  if (hasCsv && !hasPdf) {
    return (
      <button
        type="button"
        className={styles.exportButton}
        onClick={runCsv}
        disabled={disabled}
        aria-label="Export table as CSV"
      >
        Export CSV
      </button>
    );
  }

  if (!hasCsv && hasPdf) {
    return (
      <button
        type="button"
        className={styles.exportButton}
        onClick={() => void runPdf()}
        disabled={disabled || pdfBusy}
        aria-label="Export table as PDF"
      >
        {pdfBusy ? 'Generating…' : 'Export PDF'}
      </button>
    );
  }

  return (
    <div className={styles.exportWrap} ref={wrapRef}>
      <button
        type="button"
        className={styles.exportButton}
        onClick={() => setOpen((v) => !v)}
        disabled={disabled || pdfBusy}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-label="Export table"
      >
        Export
        <CaretDown className={styles.exportCaret} size={14} weight="bold" aria-hidden />
      </button>
      {open && multi && (
        <ul className={styles.exportMenu} role="menu">
          <li role="none">
            <button
              type="button"
              role="menuitem"
              className={styles.exportMenuItem}
              onClick={runCsv}
              disabled={disabled}
            >
              Export as CSV
            </button>
          </li>
          <li role="none">
            <button
              type="button"
              role="menuitem"
              className={styles.exportMenuItem}
              onClick={() => void runPdf()}
              disabled={disabled || pdfBusy}
            >
              {pdfBusy ? 'Generating PDF…' : 'Export as PDF'}
            </button>
          </li>
        </ul>
      )}
    </div>
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
  showGrandTotal,
  grandTotalLabel: _grandTotalLabel = 'Grand Total',
  showTotals = true,
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

  const subHeaderComponent =
    ENABLE_TABLE_EXPORT_UI && exportable && isAdmin ? (
      <TableExportControl
        disabled={loading || data.length === 0}
        columns={columns as TableExportColumn[]}
        data={data}
        exportFileName={exportFileName}
        exportFormats={formats}
        exportPdfTitle={exportPdfTitle}
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
