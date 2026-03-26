import React, { useMemo } from 'react';
import GlobalDataTable, { TableColumn } from './GlobalDataTable';

interface Column {
  key: string;
  title: string;
  render?: (value: any, row: any) => React.ReactNode;
}

interface TableProps {
  columns: Column[];
  data: any[];
  loading?: boolean;
  onRowClick?: (row: any) => void;
  paginate?: boolean;
  pageSize?: number;
  noDataText?: string;
  fixedHeader?: boolean;
  fixedHeaderHeight?: string;
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
    />
  );
};

export default Table;
