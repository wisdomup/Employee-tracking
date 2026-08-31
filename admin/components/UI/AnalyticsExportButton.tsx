import React, { useCallback } from 'react';
import ExportMenu from './ExportMenu';
import { useAuth } from '../../contexts/AuthContext';
import {
  exportAnalyticsToCsv,
  exportAnalyticsToPdf,
  type AnalyticsExportPayload,
} from '../../utils/analyticsExport';

interface AnalyticsExportButtonProps {
  /**
   * Built at click time, not render time — the PDF snapshots the live chart canvases, so the
   * payload must be read after the charts have drawn.
   */
  buildPayload: () => AnalyticsExportPayload;
  disabled?: boolean;
  label?: string;
  ariaLabel?: string;
  className?: string;
}

/**
 * Page-level "Export" control for analytics/report views: KPI cards, trend charts and report
 * tables in one CSV or PDF. Admin-only, matching the per-table export control.
 */
const AnalyticsExportButton: React.FC<AnalyticsExportButtonProps> = ({
  buildPayload,
  disabled = false,
  label = 'Export',
  ariaLabel = 'Export report',
  className,
}) => {
  const { user } = useAuth();

  const onCsv = useCallback(() => {
    exportAnalyticsToCsv(buildPayload());
  }, [buildPayload]);

  const onPdf = useCallback(async () => {
    await exportAnalyticsToPdf(buildPayload());
  }, [buildPayload]);

  if (user?.role !== 'admin') return null;

  return (
    <ExportMenu
      disabled={disabled}
      onExportCsv={onCsv}
      onExportPdf={onPdf}
      label={label}
      ariaLabel={ariaLabel}
      className={className}
    />
  );
};

export default AnalyticsExportButton;
