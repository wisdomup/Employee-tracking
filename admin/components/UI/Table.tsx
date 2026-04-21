import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { CaretDown } from '@phosphor-icons/react';
import GlobalDataTable, { TableColumn } from './GlobalDataTable';
import {
  exportTableToCsv,
  exportTableToPdf,
  type TableExportColumn,
  type TableExportFormat,
} from '../../utils/tableExport';
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
}

function TableExportControl({
  disabled,
  columns,
  data,
  exportFileName,
  exportFormats,
  exportPdfTitle,
}: {
  disabled: boolean;
  columns: TableExportColumn[];
  data: unknown[];
  exportFileName: string;
  exportFormats: TableExportFormat[];
  exportPdfTitle?: string;
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
    exportTableToCsv({ filename: exportFileName, columns, data });
    setOpen(false);
  }, [columns, data, exportFileName]);

  const runPdf = useCallback(async () => {
    setPdfBusy(true);
    try {
      await exportTableToPdf({
        filename: exportFileName,
        columns,
        data,
        title: exportPdfTitle,
      });
      setOpen(false);
    } catch (err) {
      console.error(err);
      toast.error('Could not generate PDF. Try again or use CSV.');
    } finally {
      setPdfBusy(false);
    }
  }, [columns, data, exportFileName, exportPdfTitle]);

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

  const formats = useMemo<TableExportFormat[]>(() => {
    const allowed = new Set<TableExportFormat>(['csv', 'pdf']);
    const list = exportFormats.filter((f) => allowed.has(f));
    return list.length ? [...list] : ['csv', 'pdf'];
  }, [exportFormats]);

  const subHeaderComponent =
    ENABLE_TABLE_EXPORT_UI && exportable ? (
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
    />
  );
};

export default Table;
