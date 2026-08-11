/**
 * Drill-down behind each Reports KPI tile. The tiles on `/reports` are sums; this returns the rows
 * those sums were built from, so an admin can click `Sold Qty` and see the actual delivered order
 * lines instead of trusting a number.
 *
 * Each metric MIRRORS the filter its KPI uses in `dashboard.service.ts#getDashboardReports` — that
 * includes the inconsistencies. Stock and return KPIs are all-time snapshots (they come off the
 * product/return collections without a date match), while sales KPIs are range-bound. Applying the
 * date range uniformly here would make the detail total disagree with the tile it was opened from.
 */
import { OrderModel } from '../../models/order.model';
import { ProductModel } from '../../models/product.model';
import { ReturnModel } from '../../models/return.model';

export type ReportDetailMetric =
  | 'current-stock'
  | 'stock-hold'
  | 'returned-qty'
  | 'damaged-qty'
  | 'sold-qty'
  | 'earned'
  | 'paid-back'
  | 'net-after-returns'
  | 'booked-sales';

export const REPORT_DETAIL_METRICS: ReportDetailMetric[] = [
  'current-stock',
  'stock-hold',
  'returned-qty',
  'damaged-qty',
  'sold-qty',
  'earned',
  'paid-back',
  'net-after-returns',
  'booked-sales',
];

/** Orders whose stock has left the shelf but not the books — the `Stock Hold` / `Booked Sales` set. */
const OPEN_ORDER_STATUSES = ['pending', 'approved', 'packed', 'dispatched'];

/** Guard against a full-collection dump on a large tenant; the UI paginates client-side. */
const MAX_ROWS = 5000;

export type DetailColumnType = 'text' | 'number' | 'currency' | 'date';

export interface DetailColumn {
  key: string;
  title: string;
  type?: DetailColumnType;
}

export interface DetailSummaryItem {
  label: string;
  value: number;
  type?: DetailColumnType;
}

export interface ReportDetailResult {
  metric: ReportDetailMetric;
  title: string;
  description: string;
  /** `false` when the KPI is an all-time snapshot, so the UI can hide the date filter. */
  dateFiltered: boolean;
  filters: { startDate: string; endDate: string };
  columns: DetailColumn[];
  summary: DetailSummaryItem[];
  rows: Record<string, unknown>[];
  truncated: boolean;
}

function getDateRange(startDate?: string, endDate?: string) {
  const end = endDate ? new Date(endDate) : new Date();
  end.setUTCHours(23, 59, 59, 999);

  const start = startDate ? new Date(startDate) : new Date(end);
  if (!startDate) {
    start.setUTCDate(start.getUTCDate() - 29);
  }
  start.setUTCHours(0, 0, 0, 0);

  return { start, end };
}

const dealerLookup = [
  { $lookup: { from: 'dealers', localField: 'dealerId', foreignField: '_id', as: 'dealer' } },
  { $unwind: { path: '$dealer', preserveNullAndEmptyArrays: true } },
];

const dealerNameExpr = { $ifNull: ['$dealer.shopName', { $ifNull: ['$dealer.name', '-'] }] };

const orderLineProductLookup = [
  {
    $lookup: {
      from: 'products',
      localField: 'products.productId',
      foreignField: '_id',
      as: 'product',
    },
  },
  { $unwind: { path: '$product', preserveNullAndEmptyArrays: true } },
  {
    $lookup: {
      from: 'categories',
      localField: 'product.categoryId',
      foreignField: '_id',
      as: 'category',
    },
  },
  { $unwind: { path: '$category', preserveNullAndEmptyArrays: true } },
];

function sum(rows: Record<string, unknown>[], key: string) {
  return rows.reduce((total, row) => total + (Number(row[key]) || 0), 0);
}

function round2(value: number) {
  return Number(value.toFixed(2));
}

/** Order lines (unwound `products`) for a status set, optionally bounded by the date range. */
function orderLinePipeline(statuses: string[], range?: { start: Date; end: Date }) {
  return [
    {
      $match: {
        isTrashed: { $ne: true },
        status: { $in: statuses },
        ...(range ? { createdAt: { $gte: range.start, $lte: range.end } } : {}),
      },
    },
    { $unwind: '$products' },
    ...dealerLookup,
    ...orderLineProductLookup,
    {
      $project: {
        _id: 0,
        orderId: { $toString: '$_id' },
        invoiceNumber: { $ifNull: ['$invoiceNumber', null] },
        date: '$createdAt',
        dealerName: dealerNameExpr,
        productName: { $ifNull: ['$product.name', 'Unknown product'] },
        categoryName: { $ifNull: ['$category.name', 'Uncategorized'] },
        quantity: { $ifNull: ['$products.quantity', 0] },
        price: { $ifNull: ['$products.price', 0] },
        lineTotal: {
          $round: [
            {
              $multiply: [
                { $ifNull: ['$products.quantity', 0] },
                { $ifNull: ['$products.price', 0] },
              ],
            },
            2,
          ],
        },
        status: 1,
      },
    },
    { $sort: { date: -1 } },
    { $limit: MAX_ROWS + 1 },
  ];
}

const ORDER_LINE_COLUMNS: DetailColumn[] = [
  { key: 'invoiceNumber', title: 'Invoice #', type: 'number' },
  { key: 'date', title: 'Date', type: 'date' },
  { key: 'dealerName', title: 'Client' },
  { key: 'productName', title: 'Item' },
  { key: 'categoryName', title: 'Category' },
  { key: 'quantity', title: 'Qty', type: 'number' },
  { key: 'price', title: 'Rate', type: 'currency' },
  { key: 'lineTotal', title: 'Line Total', type: 'currency' },
  { key: 'status', title: 'Status' },
];

/** Return lines (unwound `products`) for one return type. */
function returnLinePipeline(returnType: 'return' | 'damage') {
  return [
    { $match: { isTrashed: { $ne: true }, status: 'completed', returnType } },
    { $unwind: '$products' },
    ...dealerLookup,
    ...orderLineProductLookup,
    {
      $project: {
        _id: 0,
        returnId: { $toString: '$_id' },
        date: '$createdAt',
        dealerName: dealerNameExpr,
        productName: { $ifNull: ['$product.name', 'Unknown product'] },
        categoryName: { $ifNull: ['$category.name', 'Uncategorized'] },
        quantity: { $ifNull: ['$products.quantity', 0] },
        price: { $ifNull: ['$products.price', 0] },
        lineTotal: {
          $round: [
            {
              $multiply: [
                { $ifNull: ['$products.quantity', 0] },
                { $ifNull: ['$products.price', 0] },
              ],
            },
            2,
          ],
        },
        returnReason: { $ifNull: ['$returnReason', '-'] },
      },
    },
    { $sort: { date: -1 } },
    { $limit: MAX_ROWS + 1 },
  ];
}

const RETURN_LINE_COLUMNS: DetailColumn[] = [
  { key: 'date', title: 'Date', type: 'date' },
  { key: 'dealerName', title: 'Client' },
  { key: 'productName', title: 'Item' },
  { key: 'categoryName', title: 'Category' },
  { key: 'quantity', title: 'Qty', type: 'number' },
  { key: 'price', title: 'Rate', type: 'currency' },
  { key: 'lineTotal', title: 'Value', type: 'currency' },
  { key: 'returnReason', title: 'Reason' },
];

/** Order-level rows (one per order, not per line) for the amount KPIs. */
function orderTotalPipeline(statuses: string[], range: { start: Date; end: Date }) {
  return [
    {
      $match: {
        isTrashed: { $ne: true },
        status: { $in: statuses },
        createdAt: { $gte: range.start, $lte: range.end },
      },
    },
    ...dealerLookup,
    {
      $project: {
        _id: 0,
        orderId: { $toString: '$_id' },
        invoiceNumber: { $ifNull: ['$invoiceNumber', null] },
        date: '$createdAt',
        dealerName: dealerNameExpr,
        itemCount: { $size: { $ifNull: ['$products', []] } },
        totalQty: { $sum: { $ifNull: ['$products.quantity', []] } },
        totalPrice: { $round: [{ $ifNull: ['$totalPrice', 0] }, 2] },
        discount: { $round: [{ $ifNull: ['$discount', 0] }, 2] },
        grandTotal: { $round: [{ $ifNull: ['$grandTotal', 0] }, 2] },
        paidAmount: { $round: [{ $ifNull: ['$paidAmount', 0] }, 2] },
        status: 1,
      },
    },
    { $sort: { date: -1 } },
    { $limit: MAX_ROWS + 1 },
  ];
}

const ORDER_TOTAL_COLUMNS: DetailColumn[] = [
  { key: 'invoiceNumber', title: 'Invoice #', type: 'number' },
  { key: 'date', title: 'Date', type: 'date' },
  { key: 'dealerName', title: 'Client' },
  { key: 'itemCount', title: 'Items', type: 'number' },
  { key: 'totalQty', title: 'Qty', type: 'number' },
  { key: 'totalPrice', title: 'Total', type: 'currency' },
  { key: 'discount', title: 'Discount', type: 'currency' },
  { key: 'grandTotal', title: 'Grand Total', type: 'currency' },
  { key: 'paidAmount', title: 'Paid', type: 'currency' },
  { key: 'status', title: 'Status' },
];

/** Runs the pipeline and reports whether it hit `MAX_ROWS` (pipelines fetch one extra row to tell). */
async function run(
  pipeline: Record<string, unknown>[],
  model: { aggregate: (pipeline: any[]) => Promise<any[]> },
) {
  const rows = (await model.aggregate(pipeline)) as Record<string, unknown>[];
  const truncated = rows.length > MAX_ROWS;
  return { rows: truncated ? rows.slice(0, MAX_ROWS) : rows, truncated };
}

export async function getReportDetail(params: {
  metric: ReportDetailMetric;
  startDate?: string;
  endDate?: string;
}): Promise<ReportDetailResult> {
  const { start, end } = getDateRange(params.startDate, params.endDate);
  const range = { start, end };
  const filters = { startDate: start.toISOString(), endDate: end.toISOString() };

  const base = { metric: params.metric, filters, truncated: false };

  switch (params.metric) {
    case 'current-stock': {
      const { rows, truncated } = await run(
        [
          { $match: { isTrashed: { $ne: true } } },
          {
            $lookup: {
              from: 'categories',
              localField: 'categoryId',
              foreignField: '_id',
              as: 'category',
            },
          },
          { $unwind: { path: '$category', preserveNullAndEmptyArrays: true } },
          {
            $lookup: {
              from: 'orders',
              let: { pid: '$_id' },
              pipeline: [
                { $match: { isTrashed: { $ne: true }, status: { $in: OPEN_ORDER_STATUSES } } },
                { $unwind: '$products' },
                { $match: { $expr: { $eq: ['$products.productId', '$$pid'] } } },
                { $group: { _id: null, qty: { $sum: '$products.quantity' } } },
              ],
              as: 'holdAgg',
            },
          },
          {
            $project: {
              _id: 0,
              productId: { $toString: '$_id' },
              barcode: { $ifNull: ['$barcode', '-'] },
              productName: '$name',
              categoryName: { $ifNull: ['$category.name', 'Uncategorized'] },
              availableQty: { $ifNull: ['$quantity', 0] },
              onHoldQty: { $ifNull: [{ $arrayElemAt: ['$holdAgg.qty', 0] }, 0] },
              survivalQuantity: { $ifNull: ['$survivalQuantity', 0] },
              salePrice: { $round: [{ $ifNull: ['$salePrice', 0] }, 2] },
              stockValue: {
                $round: [
                  {
                    $multiply: [{ $ifNull: ['$quantity', 0] }, { $ifNull: ['$salePrice', 0] }],
                  },
                  2,
                ],
              },
            },
          },
          { $sort: { availableQty: -1, productName: 1 } },
          { $limit: MAX_ROWS + 1 },
        ],
        ProductModel,
      );

      return {
        ...base,
        truncated,
        title: 'Current Stock',
        description: 'Sellable pieces per item across all warehouses (live snapshot, not date filtered).',
        dateFiltered: false,
        columns: [
          { key: 'barcode', title: 'Barcode' },
          { key: 'productName', title: 'Item' },
          { key: 'categoryName', title: 'Category' },
          { key: 'availableQty', title: 'Current Stock', type: 'number' },
          { key: 'onHoldQty', title: 'On Hold', type: 'number' },
          { key: 'survivalQuantity', title: 'Low-stock Level', type: 'number' },
          { key: 'salePrice', title: 'Sale Price', type: 'currency' },
          { key: 'stockValue', title: 'Stock Value', type: 'currency' },
        ],
        summary: [
          { label: 'Items', value: rows.length, type: 'number' },
          { label: 'Total Stock', value: sum(rows, 'availableQty'), type: 'number' },
          { label: 'On Hold', value: sum(rows, 'onHoldQty'), type: 'number' },
          { label: 'Stock Value', value: round2(sum(rows, 'stockValue')), type: 'currency' },
        ],
        rows,
      };
    }

    case 'stock-hold': {
      const { rows, truncated } = await run(orderLinePipeline(OPEN_ORDER_STATUSES), OrderModel);
      return {
        ...base,
        truncated,
        title: 'Stock Hold',
        description:
          'Order lines reserved by open orders (pending, approved, packed, dispatched). Not date filtered — mirrors the KPI.',
        dateFiltered: false,
        columns: ORDER_LINE_COLUMNS,
        summary: [
          { label: 'Lines', value: rows.length, type: 'number' },
          { label: 'Held Qty', value: sum(rows, 'quantity'), type: 'number' },
          { label: 'Held Value', value: round2(sum(rows, 'lineTotal')), type: 'currency' },
        ],
        rows,
      };
    }

    case 'returned-qty': {
      const { rows, truncated } = await run(returnLinePipeline('return'), ReturnModel);
      return {
        ...base,
        truncated,
        title: 'Returned Qty',
        description: 'Completed returns of type `return`, line by line. Not date filtered — mirrors the KPI.',
        dateFiltered: false,
        columns: RETURN_LINE_COLUMNS,
        summary: [
          { label: 'Lines', value: rows.length, type: 'number' },
          { label: 'Returned Qty', value: sum(rows, 'quantity'), type: 'number' },
          { label: 'Value', value: round2(sum(rows, 'lineTotal')), type: 'currency' },
        ],
        rows,
      };
    }

    case 'damaged-qty': {
      const { rows, truncated } = await run(returnLinePipeline('damage'), ReturnModel);
      return {
        ...base,
        truncated,
        title: 'Damaged Qty',
        description: 'Completed returns of type `damage`, line by line. Not date filtered — mirrors the KPI.',
        dateFiltered: false,
        columns: RETURN_LINE_COLUMNS,
        summary: [
          { label: 'Lines', value: rows.length, type: 'number' },
          { label: 'Damaged Qty', value: sum(rows, 'quantity'), type: 'number' },
          { label: 'Value', value: round2(sum(rows, 'lineTotal')), type: 'currency' },
        ],
        rows,
      };
    }

    case 'sold-qty': {
      const { rows, truncated } = await run(orderLinePipeline(['delivered'], range), OrderModel);
      return {
        ...base,
        truncated,
        title: 'Sold Qty',
        description: 'Every delivered order line in the selected range.',
        dateFiltered: true,
        columns: ORDER_LINE_COLUMNS,
        summary: [
          { label: 'Lines', value: rows.length, type: 'number' },
          { label: 'Sold Qty', value: sum(rows, 'quantity'), type: 'number' },
          { label: 'Line Value', value: round2(sum(rows, 'lineTotal')), type: 'currency' },
        ],
        rows,
      };
    }

    case 'earned': {
      const { rows, truncated } = await run(orderTotalPipeline(['delivered'], range), OrderModel);
      return {
        ...base,
        truncated,
        title: 'Earned (Delivered Sales)',
        description: 'Delivered orders in the selected range, summed on grand total.',
        dateFiltered: true,
        columns: ORDER_TOTAL_COLUMNS,
        summary: [
          { label: 'Orders', value: rows.length, type: 'number' },
          { label: 'Qty', value: sum(rows, 'totalQty'), type: 'number' },
          { label: 'Earned', value: round2(sum(rows, 'grandTotal')), type: 'currency' },
          { label: 'Paid', value: round2(sum(rows, 'paidAmount')), type: 'currency' },
        ],
        rows,
      };
    }

    case 'booked-sales': {
      const { rows, truncated } = await run(orderTotalPipeline(OPEN_ORDER_STATUSES, range), OrderModel);
      return {
        ...base,
        truncated,
        title: 'Booked Sales (Open Orders)',
        description:
          'Orders created in the range that are still open (pending, approved, packed, dispatched).',
        dateFiltered: true,
        columns: ORDER_TOTAL_COLUMNS,
        summary: [
          { label: 'Orders', value: rows.length, type: 'number' },
          { label: 'Qty', value: sum(rows, 'totalQty'), type: 'number' },
          { label: 'Booked', value: round2(sum(rows, 'grandTotal')), type: 'currency' },
        ],
        rows,
      };
    }

    case 'paid-back': {
      const { rows, truncated } = await run(
        [
          {
            $match: {
              isTrashed: { $ne: true },
              status: 'completed',
              createdAt: { $gte: start, $lte: end },
            },
          },
          ...dealerLookup,
          {
            $project: {
              _id: 0,
              returnId: { $toString: '$_id' },
              date: '$createdAt',
              dealerName: dealerNameExpr,
              returnType: 1,
              itemCount: { $size: { $ifNull: ['$products', []] } },
              totalQty: { $sum: { $ifNull: ['$products.quantity', []] } },
              amount: { $round: [{ $ifNull: ['$amount', 0] }, 2] },
              returnReason: { $ifNull: ['$returnReason', '-'] },
            },
          },
          { $sort: { date: -1 } },
          { $limit: MAX_ROWS + 1 },
        ],
        ReturnModel,
      );

      return {
        ...base,
        truncated,
        title: 'Paid Back (Returns)',
        description: 'Completed returns in the selected range, at the credited amount.',
        dateFiltered: true,
        columns: [
          { key: 'date', title: 'Date', type: 'date' },
          { key: 'dealerName', title: 'Client' },
          { key: 'returnType', title: 'Type' },
          { key: 'itemCount', title: 'Items', type: 'number' },
          { key: 'totalQty', title: 'Qty', type: 'number' },
          { key: 'amount', title: 'Paid Back', type: 'currency' },
          { key: 'returnReason', title: 'Reason' },
        ],
        summary: [
          { label: 'Returns', value: rows.length, type: 'number' },
          { label: 'Qty', value: sum(rows, 'totalQty'), type: 'number' },
          { label: 'Paid Back', value: round2(sum(rows, 'amount')), type: 'currency' },
        ],
        rows,
      };
    }

    case 'net-after-returns': {
      // One ledger: delivered orders add, completed returns subtract. Summing `amount` here gives
      // back exactly the `Net After Returns` tile.
      const { rows, truncated } = await run(
        [
          {
            $match: {
              isTrashed: { $ne: true },
              status: 'delivered',
              createdAt: { $gte: start, $lte: end },
            },
          },
          ...dealerLookup,
          {
            $project: {
              _id: 0,
              entryType: 'Earned',
              date: '$createdAt',
              reference: {
                $cond: [
                  { $ifNull: ['$invoiceNumber', false] },
                  { $concat: ['Invoice #', { $toString: '$invoiceNumber' }] },
                  { $concat: ['Order ', { $toString: '$_id' }] },
                ],
              },
              dealerName: dealerNameExpr,
              amount: { $round: [{ $ifNull: ['$grandTotal', 0] }, 2] },
            },
          },
          {
            $unionWith: {
              coll: 'returns',
              pipeline: [
                {
                  $match: {
                    isTrashed: { $ne: true },
                    status: 'completed',
                    createdAt: { $gte: start, $lte: end },
                  },
                },
                ...dealerLookup,
                {
                  $project: {
                    _id: 0,
                    entryType: 'Paid Back',
                    date: '$createdAt',
                    reference: { $concat: ['Return ', { $toString: '$_id' }] },
                    dealerName: dealerNameExpr,
                    amount: { $round: [{ $multiply: [{ $ifNull: ['$amount', 0] }, -1] }, 2] },
                  },
                },
              ],
            },
          },
          { $sort: { date: -1 } },
          { $limit: MAX_ROWS + 1 },
        ],
        OrderModel,
      );

      const earned = rows
        .filter((row) => row.entryType === 'Earned')
        .reduce((total, row) => total + (Number(row.amount) || 0), 0);
      const paidBack = rows
        .filter((row) => row.entryType === 'Paid Back')
        .reduce((total, row) => total + (Number(row.amount) || 0), 0);

      return {
        ...base,
        truncated,
        title: 'Net After Returns',
        description: 'Delivered sales minus completed returns, entry by entry, over the selected range.',
        dateFiltered: true,
        columns: [
          { key: 'date', title: 'Date', type: 'date' },
          { key: 'entryType', title: 'Entry' },
          { key: 'reference', title: 'Reference' },
          { key: 'dealerName', title: 'Client' },
          { key: 'amount', title: 'Amount', type: 'currency' },
        ],
        summary: [
          { label: 'Entries', value: rows.length, type: 'number' },
          { label: 'Earned', value: round2(earned), type: 'currency' },
          { label: 'Paid Back', value: round2(Math.abs(paidBack)), type: 'currency' },
          { label: 'Net', value: round2(earned + paidBack), type: 'currency' },
        ],
        rows,
      };
    }

    default: {
      const unknown: never = params.metric;
      throw new Error(`Unknown report metric: ${unknown}`);
    }
  }
}
