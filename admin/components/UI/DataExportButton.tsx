import React, { useCallback } from 'react';
import ExportMenu from './ExportMenu';
import { useAuth } from '../../contexts/AuthContext';
import {
  exportTableToCsv,
  exportTableToPdf,
  type TableExportColumn,
  type TableExportFormat,
} from '../../utils/tableExport';

interface DataExportButtonProps {
  columns: TableExportColumn[];
  rows: unknown[];
  fileName: string;
  pdfTitle?: string;
  formats?: TableExportFormat[];
  grandTotalRow?: string[] | null;
  disabled?: boolean;
  className?: string;
  /**
   * Restrict the control to admins, matching `Table`'s export. Default for saved records.
   * Pass `false` on the draft/entry forms: there the rows are what the person in front of the
   * screen just typed, so hiding their own working copy from them buys nothing.
   */
  adminOnly?: boolean;
}

/**
 * Export control for tables rendered as plain markup rather than through `Table` — order and
 * transfer line items, stock counts, entry forms, and the like.
 */
const DataExportButton: React.FC<DataExportButtonProps> = ({
  columns,
  rows,
  fileName,
  pdfTitle,
  formats = ['csv', 'pdf'],
  grandTotalRow,
  disabled = false,
  className,
  adminOnly = true,
}) => {
  const { user } = useAuth();

  const onCsv = useCallback(() => {
    exportTableToCsv({ filename: fileName, columns, data: rows, grandTotalRow });
  }, [columns, fileName, grandTotalRow, rows]);

  const onPdf = useCallback(
    () =>
      exportTableToPdf({
        filename: fileName,
        columns,
        data: rows,
        title: pdfTitle,
        grandTotalRow,
      }),
    [columns, fileName, grandTotalRow, pdfTitle, rows],
  );

  if (adminOnly && user?.role !== 'admin') return null;

  return (
    <ExportMenu
      disabled={disabled || rows.length === 0}
      formats={formats}
      onExportCsv={onCsv}
      onExportPdf={onPdf}
      ariaLabel="Export table"
      className={className}
    />
  );
};

export default DataExportButton;
