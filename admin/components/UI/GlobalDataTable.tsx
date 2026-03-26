import React, { useMemo } from 'react';
import DataTable, { TableColumn } from 'react-data-table-component';
import Loader from './Loader';

interface GlobalDataTableProps<T> {
  columns: TableColumn<T>[];
  data: T[];
  loading?: boolean;
  onRowClick?: (row: T) => void;
  paginate?: boolean;
  pageSize?: number;
  noDataText?: string;
  fixedHeader?: boolean;
  fixedHeaderHeight?: string;
}

function GlobalDataTable<T>({
  columns,
  data,
  loading = false,
  onRowClick,
  paginate = false,
  pageSize = 10,
  noDataText = 'No data available',
  fixedHeader = false,
  fixedHeaderHeight = '420px',
}: GlobalDataTableProps<T>) {
  const tableStyles = useMemo(
    () => ({
      table: {
        style: {
          border: '1px solid #d1d5db',
          borderRadius: '10px',
          overflow: 'visible',
          backgroundColor: '#ffffff',
          width: 'max-content',
          minWidth: '100%',
        },
      },
      tableWrapper: {
        style: {
          display: 'block',
          width: 'max-content',
          minWidth: '100%',
        },
      },
      headRow: {
        style: {
          backgroundColor: '#f3f4f6',
          borderBottom: '1px solid #d1d5db',
          minHeight: '48px',
        },
      },
      headCells: {
        style: {
          color: '#111827',
          fontSize: '14px',
          fontWeight: 700,
          paddingTop: '12px',
          paddingBottom: '12px',
          whiteSpace: 'nowrap',
          borderRight: '1px solid #e5e7eb',
          '&:last-of-type': {
            borderRight: 'none',
          },
        },
      },
      rows: {
        style: {
          color: '#1f2937',
          fontSize: '14px',
          minHeight: '46px',
        },
        highlightOnHoverStyle: {
          backgroundColor: '#eff6ff',
          cursor: onRowClick ? 'pointer' : 'default',
        },
      },
      cells: {
        style: {
          color: '#1f2937',
          paddingTop: '12px',
          paddingBottom: '12px',
          whiteSpace: 'nowrap',
          overflow: 'visible',
          textOverflow: 'clip',
          borderRight: '1px solid #f3f4f6',
          '&:last-of-type': {
            borderRight: 'none',
          },
        },
      },
      pagination: {
        style: {
          color: '#374151',
          fontSize: '13px',
          minHeight: '52px',
          backgroundColor: '#f9fafb',
          borderTopStyle: 'none',
          borderTopWidth: '0',
          borderTopColor: 'transparent',
        },
      },
      noData: {
        style: {
          color: '#4b5563',
          fontSize: '14px',
          padding: '16px',
          backgroundColor: '#ffffff',
        },
      },
    }),
    [onRowClick],
  );

  return (
    <div style={{ width: '100%', overflowX: 'auto', overflowY: 'hidden', WebkitOverflowScrolling: 'touch' }}>
      <DataTable
        columns={columns}
        data={data}
        progressPending={loading}
        progressComponent={<Loader />}
        pagination={paginate}
        paginationPerPage={pageSize}
        paginationRowsPerPageOptions={[10, 25, 50]}
        striped
        highlightOnHover={Boolean(onRowClick)}
        pointerOnHover={Boolean(onRowClick)}
        onRowClicked={onRowClick}
        noDataComponent={<div style={{ padding: '1rem', color: '#4b5563' }}>{noDataText}</div>}
        customStyles={tableStyles}
        fixedHeader={fixedHeader}
        fixedHeaderScrollHeight={fixedHeaderHeight}
      />
    </div>
  );
}

export type { TableColumn };
export default GlobalDataTable;
