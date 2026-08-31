import React, { useCallback, useEffect, useRef, useState } from 'react';
import { CaretDown } from '@phosphor-icons/react';
import { toast } from 'react-toastify';
import type { TableExportFormat } from '../../utils/tableExport';
import styles from './GlobalDataTable.module.scss';

/**
 * Export control shared by list tables (`Table`) and the analytics/report page headers.
 * Renders a plain button for a single format and a CSV/PDF menu when both are offered.
 */
interface ExportMenuProps {
  disabled?: boolean;
  formats?: TableExportFormat[];
  onExportCsv: () => void | Promise<void>;
  onExportPdf: () => void | Promise<void>;
  /** Button text when both formats are offered. */
  label?: string;
  ariaLabel?: string;
  className?: string;
}

const ExportMenu: React.FC<ExportMenuProps> = ({
  disabled = false,
  formats = ['csv', 'pdf'],
  onExportCsv,
  onExportPdf,
  label = 'Export',
  ariaLabel = 'Export',
  className,
}) => {
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const wrapRef = useRef<HTMLDivElement>(null);

  const hasCsv = formats.includes('csv');
  const hasPdf = formats.includes('pdf');
  const multi = hasCsv && hasPdf;

  useEffect(() => {
    if (!open) return;
    const onDocMouseDown = (e: MouseEvent) => {
      if (wrapRef.current && !wrapRef.current.contains(e.target as Node)) setOpen(false);
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

  const run = useCallback(
    async (fn: () => void | Promise<void>, kind: 'CSV' | 'PDF') => {
      setBusy(true);
      try {
        await fn();
        setOpen(false);
      } catch (err) {
        console.error(err);
        toast.error(
          kind === 'PDF'
            ? 'Could not generate PDF. Try again or use CSV.'
            : 'Could not generate CSV. Try again.',
        );
      } finally {
        setBusy(false);
      }
    },
    [],
  );

  const buttonClass = className ? `${styles.exportButton} ${className}` : styles.exportButton;

  if (hasCsv && !hasPdf) {
    return (
      <button
        type="button"
        className={buttonClass}
        onClick={() => void run(onExportCsv, 'CSV')}
        disabled={disabled || busy}
        aria-label={`${ariaLabel} as CSV`}
      >
        Export CSV
      </button>
    );
  }

  if (!hasCsv && hasPdf) {
    return (
      <button
        type="button"
        className={buttonClass}
        onClick={() => void run(onExportPdf, 'PDF')}
        disabled={disabled || busy}
        aria-label={`${ariaLabel} as PDF`}
      >
        {busy ? 'Generating…' : 'Export PDF'}
      </button>
    );
  }

  return (
    <div className={styles.exportWrap} ref={wrapRef}>
      <button
        type="button"
        className={buttonClass}
        onClick={() => setOpen((v) => !v)}
        disabled={disabled || busy}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-label={ariaLabel}
      >
        {busy ? 'Generating…' : label}
        <CaretDown className={styles.exportCaret} size={14} weight="bold" aria-hidden />
      </button>
      {open && multi && (
        <ul className={styles.exportMenu} role="menu">
          <li role="none">
            <button
              type="button"
              role="menuitem"
              className={styles.exportMenuItem}
              onClick={() => void run(onExportCsv, 'CSV')}
              disabled={disabled || busy}
            >
              Export as CSV
            </button>
          </li>
          <li role="none">
            <button
              type="button"
              role="menuitem"
              className={styles.exportMenuItem}
              onClick={() => void run(onExportPdf, 'PDF')}
              disabled={disabled || busy}
            >
              {busy ? 'Generating PDF…' : 'Export as PDF'}
            </button>
          </li>
        </ul>
      )}
    </div>
  );
};

export default ExportMenu;
