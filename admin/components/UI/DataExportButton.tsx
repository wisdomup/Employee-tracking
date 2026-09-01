import React, { useCallback } from 'react';
import ExportMenu from './ExportMenu';
import { useAuth } from '../../contexts/AuthContext';
import { can } from '../../utils/permissions';
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
   * Require the `exports:view` matrix cell, matching `Table`'s export. Default for saved
   * records. Pass `false` on the draft/entry forms: there the rows are what the person in front
   * of the screen just typed, so hiding their own working copy from them buys nothing.
   *
   * Named `adminOnly` from when the gate was a role check; it is now the cell, which Admin and
   * both manager roles hold as seeded. Kept as-is because eleven call sites pass it and the
   * meaning — "the restricted one" — is unchanged.
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
  // `access` rather than `user`: it is what changes when the grants arrive, and `can()` has no
  // subscription of its own. See the note in Table.tsx.
  const { access } = useAuth();

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

  if (adminOnly && !(access && can(undefined, 'exports:view'))) return null;

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
