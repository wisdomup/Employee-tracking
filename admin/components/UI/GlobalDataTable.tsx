import React, { useMemo } from 'react';
import DataTable, { Alignment, TableColumn, TableStyles } from 'react-data-table-component';
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
  /** Renders above the table via react-data-table-component `subHeader` / `subHeaderComponent` */
  subHeaderComponent?: React.ReactNode;
  /**
   * One entry per column, rendered as a grand-total row under the table. `null` leaves the cell
   * blank. Geometry mirrors the cells above (`flex: 1 0 0`, `min-width: 100px`, and the same
   * 12px side padding set in `cells`) so the totals line up with their columns.
   */
  footerCells?: (React.ReactNode | null)[];
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
  subHeaderComponent,
  footerCells,
}: GlobalDataTableProps<T>) {
  const tableStyles = useMemo<TableStyles>(
    () => ({
      subHeader: {
        style: {
          padding: '0 0 8px 0',
          backgroundColor: 'transparent',
        },
      },
      table: {
        style: {
          border: '1px solid #d1d5db',
          borderRadius: '10px',
          overflow: 'hidden',
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
          minHeight: '40px',
        },
      },
      headCells: {
        style: {
          color: 'var(--admin-primary)',
          fontSize: '13px',
          fontWeight: 700,
          paddingTop: '8px',
          paddingBottom: '8px',
          // react-data-table-component's own default is 16px a side. A list of short cells —
          // a phone number, a status, a city — spent more width on gutters than on data.
          paddingLeft: '12px',
          paddingRight: '12px',
          whiteSpace: 'normal',
          overflowWrap: 'anywhere',
          wordBreak: 'break-word',
          // react-data-table-component puts the label in a div of its own that is nowrap with an
          // ellipsis, which is how "Client Name" became "Client N…" once the columns narrowed.
          // Wrapping instead costs a second line on the few headings that need one. The div is a
          // grandchild on a sortable column, so this matches any depth rather than `& > div`.
          '& div': {
            whiteSpace: 'normal',
            overflow: 'visible',
            textOverflow: 'clip',
          },
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
          // Tall enough for one line of 14px text plus its padding and no more; a row with
          // wrapped text or a button still grows to fit its own content.
          minHeight: '38px',
        },
        highlightOnHoverStyle: {
          backgroundColor: '#eff6ff',
          cursor: onRowClick ? 'pointer' : 'default',
        },
      },
      cells: {
        style: {
          color: '#1f2937',
          paddingTop: '8px',
          paddingBottom: '8px',
          paddingLeft: '12px',
          paddingRight: '12px',
          whiteSpace: 'normal',
          overflow: 'hidden',
          textOverflow: 'ellipsis',
          overflowWrap: 'anywhere',
          wordBreak: 'break-word',
          // Centred, so a one-line cell sits level with the badges and buttons beside it
          // instead of riding at the top of a row some taller neighbour has stretched.
          alignItems: 'center',
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
          minHeight: '44px',
          marginTop: '8px',
          backgroundColor: 'transparent',
          borderTopStyle: 'none',
          borderTopWidth: '0',
          borderTopColor: 'transparent',
        },
      },
      noData: {
        style: {
          color: '#4b5563',
          fontSize: '14px',
          padding: '12px',
          backgroundColor: '#ffffff',
        },
      },
    }),
    [onRowClick],
  );

  const showSubHeader = Boolean(subHeaderComponent);

  return (
    <div style={{ width: '100%', overflowX: 'auto', overflowY: 'hidden', WebkitOverflowScrolling: 'touch' }}>
      <DataTable
        columns={columns}
        data={data}
        progressPending={loading}
        progressComponent={<Loader />}
        subHeader={showSubHeader}
        subHeaderComponent={subHeaderComponent}
        subHeaderAlign={Alignment.RIGHT}
        pagination={paginate}
        paginationPerPage={pageSize}
        paginationRowsPerPageOptions={[10, 25, 50]}
        striped
        highlightOnHover={Boolean(onRowClick)}
        pointerOnHover={Boolean(onRowClick)}
        onRowClicked={onRowClick}
        noDataComponent={<div style={{ padding: '0.75rem', color: '#4b5563' }}>{noDataText}</div>}
        customStyles={tableStyles}
        fixedHeader={fixedHeader}
        fixedHeaderScrollHeight={fixedHeaderHeight}
      />
      {footerCells && footerCells.length > 0 && (
        <div
          role="row"
          style={{
            display: 'flex',
            width: 'max-content',
            minWidth: '100%',
            backgroundColor: '#eef2ff',
            border: '1px solid #d1d5db',
            borderRadius: '10px',
            marginTop: '-1px',
            fontSize: '14px',
            fontWeight: 700,
            color: 'var(--admin-primary)',
          }}
        >
          {footerCells.map((cell, index) => (
            <div
              // Columns have no stable id here; position is what aligns a footer cell to its column.
              key={index}
              role="cell"
              style={{
                flexGrow: 1,
                flexShrink: 0,
                flexBasis: 0,
                minWidth: '100px',
                maxWidth: '100%',
                padding: '8px 12px',
                boxSizing: 'border-box',
                borderRight: index < footerCells.length - 1 ? '1px solid #dbe1ea' : 'none',
                whiteSpace: 'normal',
                overflowWrap: 'anywhere',
                wordBreak: 'break-word',
              }}
            >
              {cell}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

export type { TableColumn };
export default GlobalDataTable;
