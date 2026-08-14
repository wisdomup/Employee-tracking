import { Types } from 'mongoose';
import { OrderModel } from '../../models/order.model';
import { UserModel } from '../../models/user.model';
import { DeliveryCollectionModel } from '../../models/delivery-collection.model';
import { CreditRecoveryModel } from '../../models/credit-recovery.model';
import { SettlementModel } from '../../models/settlement.model';
import { ROLES } from '../../constants/global';
import { badRequest } from '../../utils/app-error';
import {
  REPORT_TIMEZONE,
  isValidDayKey,
  localDayRangeUtc,
  todayDayKey,
  dayRangeLength,
  normalizeCityKey,
  regionLabel,
  round2,
} from '../region-sales/region-sales.rules';

/**
 * Read side of the collection module: balances, the entry-wise report (§8), today's activity
 * (§9) and the day-end summary (§10).
 *
 * BALANCES ARE COMPUTED, NEVER STORED. Spec §7 lets an admin rectify any entry with no approval
 * step; with a stored running balance every correction would be `update doc` + `$inc balance`
 * applied non-atomically (this codebase uses no transactions), and a crash between the two
 * leaves a permanently wrong balance that cannot even be detected. Recomputing is self-healing:
 * fix the row and the balance is instantly right. The one denormalised mirror this codebase does
 * have — product stock — still drifted badly enough to need a reconcile migration.
 */

/** Every money query excludes voided entries. Voided rows stay visible, but count for nothing. */
const NOT_VOID = { voidedAt: { $exists: false } } as const;

/** Longest window the report will serve, matching the region-sales dashboard. */
const MAX_RANGE_DAYS = 366;

export interface RiderBalance {
  cash: {
    collected: number;
    settled: number;
    pendingSettlement: number;
    inHand: number;
    availableToSettle: number;
  };
  online: {
    collected: number;
    settled: number;
    pendingSettlement: number;
    outstanding: number;
    availableToSettle: number;
  };
  /** Credit this rider has issued that the customers have not yet paid back. */
  creditIssuedOutstanding: number;
}

function emptyBalance(): RiderBalance {
  return {
    cash: { collected: 0, settled: 0, pendingSettlement: 0, inHand: 0, availableToSettle: 0 },
    online: { collected: 0, settled: 0, pendingSettlement: 0, outstanding: 0, availableToSettle: 0 },
    creditIssuedOutstanding: 0,
  };
}

/**
 * Cash in hand, online outstanding and issued credit for one rider.
 *
 * Three small `$group`s rather than one `$unionWith`: same result, easier to read, and each one
 * is a plain index seek on `{ riderId, ... }`.
 */
export async function getRiderBalance(riderId: string): Promise<RiderBalance> {
  const rider = new Types.ObjectId(riderId);

  const [collected, recovered, settled] = await Promise.all([
    DeliveryCollectionModel.aggregate<{ cash: number; online: number; credit: number }>([
      { $match: { riderId: rider, ...NOT_VOID } },
      {
        $group: {
          _id: null,
          cash: { $sum: '$cash' },
          online: { $sum: '$online' },
          credit: { $sum: '$credit' },
        },
      },
    ]),
    CreditRecoveryModel.aggregate<{ cash: number; online: number; total: number }>([
      { $match: { riderId: rider, ...NOT_VOID } },
      {
        $group: {
          _id: null,
          cash: { $sum: { $cond: [{ $eq: ['$mode', 'cash'] }, '$amount', 0] } },
          online: { $sum: { $cond: [{ $eq: ['$mode', 'online'] }, '$amount', 0] } },
          total: { $sum: '$amount' },
        },
      },
    ]),
    SettlementModel.aggregate<{
      receivedCash: number;
      receivedOnline: number;
      pendingCash: number;
      pendingOnline: number;
    }>([
      { $match: { riderId: rider, ...NOT_VOID } },
      {
        $group: {
          _id: null,
          // ONE rule for both modes: a settlement reduces the balance iff it is `received`.
          // Online settlements are born `received`, cash ones only after an admin confirms.
          receivedCash: {
            $sum: {
              $cond: [
                { $and: [{ $eq: ['$mode', 'cash'] }, { $eq: ['$status', 'received'] }] },
                '$amount',
                0,
              ],
            },
          },
          receivedOnline: {
            $sum: {
              $cond: [
                { $and: [{ $eq: ['$mode', 'online'] }, { $eq: ['$status', 'received'] }] },
                '$amount',
                0,
              ],
            },
          },
          pendingCash: {
            $sum: {
              $cond: [
                { $and: [{ $eq: ['$mode', 'cash'] }, { $eq: ['$status', 'pending'] }] },
                '$amount',
                0,
              ],
            },
          },
          pendingOnline: {
            $sum: {
              $cond: [
                { $and: [{ $eq: ['$mode', 'online'] }, { $eq: ['$status', 'pending'] }] },
                '$amount',
                0,
              ],
            },
          },
        },
      },
    ]),
  ]);

  const c = collected[0] ?? { cash: 0, online: 0, credit: 0 };
  const r = recovered[0] ?? { cash: 0, online: 0, total: 0 };
  const s = settled[0] ?? { receivedCash: 0, receivedOnline: 0, pendingCash: 0, pendingOnline: 0 };

  const cashIn = c.cash + r.cash;
  const onlineIn = c.online + r.online;

  return {
    cash: {
      collected: round2(cashIn),
      settled: round2(s.receivedCash),
      pendingSettlement: round2(s.pendingCash),
      inHand: round2(cashIn - s.receivedCash),
      availableToSettle: round2(cashIn - s.receivedCash - s.pendingCash),
    },
    online: {
      collected: round2(onlineIn),
      settled: round2(s.receivedOnline),
      pendingSettlement: round2(s.pendingOnline),
      outstanding: round2(onlineIn - s.receivedOnline),
      availableToSettle: round2(onlineIn - s.receivedOnline - s.pendingOnline),
    },
    creditIssuedOutstanding: round2(c.credit - r.total),
  };
}

export interface DealerOutstanding {
  dealerId: string;
  creditTotal: number;
  recoveredTotal: number;
  outstanding: number;
}

/** What one shop still owes: credit issued on deliveries, less everything recovered since. */
export async function getDealerOutstanding(dealerId: string): Promise<DealerOutstanding> {
  const dealer = new Types.ObjectId(dealerId);
  const [issued, recovered] = await Promise.all([
    DeliveryCollectionModel.aggregate<{ total: number }>([
      { $match: { dealerId: dealer, ...NOT_VOID } },
      { $group: { _id: null, total: { $sum: '$credit' } } },
    ]),
    CreditRecoveryModel.aggregate<{ total: number }>([
      { $match: { dealerId: dealer, ...NOT_VOID } },
      { $group: { _id: null, total: { $sum: '$amount' } } },
    ]),
  ]);

  const creditTotal = round2(issued[0]?.total ?? 0);
  const recoveredTotal = round2(recovered[0]?.total ?? 0);
  return {
    dealerId,
    creditTotal,
    recoveredTotal,
    outstanding: round2(creditTotal - recoveredTotal),
  };
}

// ---------------------------------------------------------------------------
// Window resolution — every date boundary in this module is a REPORT_TIMEZONE
// boundary, never a UTC one. At UTC+5 a delivery at 02:00 PKT would otherwise be
// reported on the previous day and the rider's day-end would not reconcile with
// the cash in his pocket.
// ---------------------------------------------------------------------------

export function resolveDay(raw?: string): string {
  if (!raw) return todayDayKey();
  if (!isValidDayKey(raw)) throw badRequest(`Invalid date "${raw}" — expected YYYY-MM-DD`);
  return raw;
}

export function resolveWindow(from?: string, to?: string): { from: string; to: string } {
  const resolvedTo = resolveDay(to);
  const resolvedFrom = from ? resolveDay(from) : resolvedTo;
  if (resolvedFrom > resolvedTo) {
    throw badRequest('The start date cannot be after the end date.');
  }
  if (dayRangeLength(resolvedFrom, resolvedTo) > MAX_RANGE_DAYS) {
    throw badRequest(`Date range is too large — pick ${MAX_RANGE_DAYS} days or fewer`);
  }
  return { from: resolvedFrom, to: resolvedTo };
}

/** Inclusive UTC instants spanning a local day range. */
export function windowToUtc(from: string, to: string): { start: Date; end: Date } {
  return {
    start: localDayRangeUtc(from).start,
    end: localDayRangeUtc(to).end,
  };
}

// ---------------------------------------------------------------------------
// §8 Collection Report — entry-wise
// ---------------------------------------------------------------------------

export interface ReportFilters {
  riderId?: string;
  cityKey?: string;
  from?: string;
  to?: string;
  page?: number;
  limit?: number;
}

function buildCollectionMatch(filters: {
  riderId?: string;
  cityKey?: string;
  start: Date;
  end: Date;
}): Record<string, unknown> {
  const match: Record<string, unknown> = {
    ...NOT_VOID,
    deliveredAt: { $gte: filters.start, $lte: filters.end },
  };
  if (filters.riderId) match.riderId = new Types.ObjectId(filters.riderId);
  // Filter on cityKey, never on the display `city`: grouping and filtering must use the same
  // key or a grand total stops matching the sum of its own city subtotals.
  if (filters.cityKey !== undefined) match.cityKey = filters.cityKey;
  return match;
}

export async function getCollectionReport(filters: ReportFilters) {
  const { from, to } = resolveWindow(filters.from, filters.to);
  const { start, end } = windowToUtc(from, to);
  const match = buildCollectionMatch({
    riderId: filters.riderId,
    cityKey: filters.cityKey,
    start,
    end,
  });

  const page = Math.max(1, Math.floor(Number(filters.page) || 1));
  const limit = Math.min(2000, Math.max(1, Math.floor(Number(filters.limit) || 500)));

  const [rows, totalsRows, countRows] = await Promise.all([
    DeliveryCollectionModel.aggregate([
      { $match: match },
      // City first so the report reads as strict city-wise grouping (§8) rather than an
      // interleaved list, then newest-first within each city.
      { $sort: { cityKey: 1, deliveredAt: -1 } },
      { $skip: (page - 1) * limit },
      { $limit: limit },
      {
        $lookup: {
          from: 'dealers',
          localField: 'dealerId',
          foreignField: '_id',
          as: 'dealer',
          // Deliberately NOT filtering isTrashed: a since-deleted client must still appear,
          // or the grand total silently shrinks.
          pipeline: [{ $project: { name: 1, shopName: 1 } }],
        },
      },
      { $unwind: { path: '$dealer', preserveNullAndEmptyArrays: true } },
      {
        $lookup: {
          from: 'users',
          localField: 'riderId',
          foreignField: '_id',
          as: 'rider',
          pipeline: [{ $project: { fullName: 1, username: 1 } }],
        },
      },
      { $unwind: { path: '$rider', preserveNullAndEmptyArrays: true } },
      {
        $project: {
          _id: 0,
          collectionId: '$_id',
          orderId: 1,
          invoiceNumber: 1,
          dealerId: 1,
          shop: {
            $ifNull: [
              { $ifNull: ['$dealer.shopName', '$dealer.name'] },
              '(deleted client)',
            ],
          },
          riderId: 1,
          rider: { $ifNull: [{ $ifNull: ['$rider.fullName', '$rider.username'] }, '(deleted rider)'] },
          city: 1,
          cityKey: 1,
          amount: '$orderAmount',
          cash: 1,
          online: 1,
          credit: 1,
          deliveredAt: 1,
          note: 1,
          correctionCount: { $size: { $ifNull: ['$corrections', []] } },
          corrected: { $gt: [{ $size: { $ifNull: ['$corrections', []] } }, 0] },
        },
      },
    ]),
    // Totals come from a SEPARATE group over the whole filtered set. Summing `rows` would make
    // page 2 report page-2 totals — the classic paginated-report bug.
    DeliveryCollectionModel.aggregate<{
      amount: number;
      cash: number;
      online: number;
      credit: number;
      count: number;
    }>([
      { $match: match },
      {
        $group: {
          _id: null,
          amount: { $sum: '$orderAmount' },
          cash: { $sum: '$cash' },
          online: { $sum: '$online' },
          credit: { $sum: '$credit' },
          count: { $sum: 1 },
        },
      },
    ]),
    DeliveryCollectionModel.aggregate<{ cityKey: string; city: string; amount: number; cash: number; online: number; credit: number; count: number }>([
      { $match: match },
      {
        $group: {
          _id: '$cityKey',
          city: { $first: '$city' },
          amount: { $sum: '$orderAmount' },
          cash: { $sum: '$cash' },
          online: { $sum: '$online' },
          credit: { $sum: '$credit' },
          count: { $sum: 1 },
        },
      },
      { $sort: { _id: 1 } },
      { $project: { _id: 0, cityKey: '$_id', city: 1, amount: 1, cash: 1, online: 1, credit: 1, count: 1 } },
    ]),
  ]);

  const t = totalsRows[0] ?? { amount: 0, cash: 0, online: 0, credit: 0, count: 0 };

  return {
    from,
    to,
    timezone: REPORT_TIMEZONE,
    filters: {
      riderId: filters.riderId ?? null,
      cityKey: filters.cityKey ?? null,
    },
    rows,
    totals: {
      amount: round2(t.amount),
      cash: round2(t.cash),
      online: round2(t.online),
      credit: round2(t.credit),
      count: t.count,
    },
    // Per-city subtotals, so the UI can render one block per city and prove the grand total is
    // the sum of them.
    cities: countRows.map((c) => ({
      cityKey: c.cityKey,
      city: regionLabel(c.city),
      amount: round2(c.amount),
      cash: round2(c.cash),
      online: round2(c.online),
      credit: round2(c.credit),
      count: c.count,
    })),
    page: {
      page,
      limit,
      total: t.count,
      pages: Math.max(1, Math.ceil(t.count / limit)),
    },
  };
}

// ---------------------------------------------------------------------------
// §9 Today's Activity — live, roster-driven
// ---------------------------------------------------------------------------

/** The rider roster. Built from users, not from collections, so a zero-activity rider appears. */
async function riderRoster(riderId?: string) {
  const query: Record<string, unknown> = {
    role: ROLES.DELIVERY_MAN,
    isTrashed: { $ne: true },
  };
  if (riderId) query._id = new Types.ObjectId(riderId);
  return UserModel.find(query)
    .select('_id fullName username userID isActive address.city')
    .sort({ fullName: 1, username: 1 })
    .lean()
    .exec();
}

export async function listRiders() {
  const riders = await riderRoster();
  const balances = await Promise.all(riders.map((r) => getRiderBalance(String(r._id))));
  return riders.map((r, i) => ({
    _id: String(r._id),
    username: r.username,
    fullName: r.fullName ?? null,
    userID: r.userID ?? null,
    isActive: r.isActive,
    city: regionLabel(r.address?.city),
    cityKey: normalizeCityKey(r.address?.city),
    cashInHand: balances[i].cash.inHand,
  }));
}

export async function getTodayActivity(params: { riderId?: string; date?: string }) {
  const date = resolveDay(params.date);
  const { start, end } = windowToUtc(date, date);
  const riders = await riderRoster(params.riderId);

  if (riders.length === 0) {
    return {
      date,
      timezone: REPORT_TIMEZONE,
      riders: [],
      totals: {
        assigned: 0, packed: 0, delivered: 0, pending: 0,
        cash: 0, online: 0, credit: 0, total: 0, cashInHand: 0,
      },
    };
  }

  const riderIds = riders.map((r) => r._id as Types.ObjectId);

  const [orderRows, collectionRows, recoveryRows, balances] = await Promise.all([
    // Open work is NOT date-filtered: an order assigned on Tuesday and still undelivered is
    // part of today's workload. Only `delivered` is scoped to the requested day.
    OrderModel.aggregate<{
      _id: Types.ObjectId;
      riderId: Types.ObjectId;
      invoiceNumber?: number;
      status: string;
      grandTotal?: number;
      assignedAt?: Date;
      packedAt?: Date;
      deliveredAt?: Date;
      shop: string;
    }>([
      {
        $match: {
          assignedRiderId: { $in: riderIds },
          isTrashed: { $ne: true },
          $or: [
            { status: { $in: ['approved', 'packed', 'dispatched'] } },
            { status: 'delivered', deliveredAt: { $gte: start, $lte: end } },
          ],
        },
      },
      {
        $lookup: {
          from: 'dealers',
          localField: 'dealerId',
          foreignField: '_id',
          as: 'dealer',
          pipeline: [{ $project: { name: 1, shopName: 1 } }],
        },
      },
      { $unwind: { path: '$dealer', preserveNullAndEmptyArrays: true } },
      {
        $project: {
          _id: 1,
          riderId: '$assignedRiderId',
          invoiceNumber: 1,
          status: 1,
          grandTotal: 1,
          assignedAt: 1,
          packedAt: 1,
          deliveredAt: 1,
          shop: {
            $ifNull: [{ $ifNull: ['$dealer.shopName', '$dealer.name'] }, '(deleted client)'],
          },
        },
      },
      { $sort: { assignedAt: 1 } },
    ]),
    DeliveryCollectionModel.aggregate<{
      _id: Types.ObjectId;
      orderId: Types.ObjectId;
      riderId: Types.ObjectId;
      cash: number;
      online: number;
      credit: number;
      orderAmount: number;
    }>([
      { $match: { riderId: { $in: riderIds }, deliveredAt: { $gte: start, $lte: end }, ...NOT_VOID } },
      { $project: { orderId: 1, riderId: 1, cash: 1, online: 1, credit: 1, orderAmount: 1 } },
    ]),
    CreditRecoveryModel.aggregate([
      { $match: { riderId: { $in: riderIds }, collectedAt: { $gte: start, $lte: end }, ...NOT_VOID } },
      {
        $lookup: {
          from: 'dealers',
          localField: 'dealerId',
          foreignField: '_id',
          as: 'dealer',
          pipeline: [{ $project: { name: 1, shopName: 1 } }],
        },
      },
      { $unwind: { path: '$dealer', preserveNullAndEmptyArrays: true } },
      { $sort: { collectedAt: -1 } },
      {
        $project: {
          _id: 1,
          riderId: 1,
          dealerId: 1,
          shop: { $ifNull: [{ $ifNull: ['$dealer.shopName', '$dealer.name'] }, '(deleted client)'] },
          amount: 1,
          mode: 1,
          note: 1,
          collectedAt: 1,
        },
      },
    ]),
    Promise.all(riders.map((r) => getRiderBalance(String(r._id)))),
  ]);

  const collectionByOrder = new Map(collectionRows.map((c) => [String(c.orderId), c]));

  const riderBlocks = riders.map((rider, i) => {
    const id = String(rider._id);
    const orders = orderRows.filter((o) => String(o.riderId) === id);
    const collections = collectionRows.filter((c) => String(c.riderId) === id);
    const recoveries = recoveryRows.filter((r: any) => String(r.riderId) === id);

    const packed = orders.filter((o) => o.status === 'packed').length;
    const delivered = orders.filter((o) => o.status === 'delivered').length;
    // "Pending" is work still to do: assigned-but-not-delivered.
    const pending = orders.filter((o) => o.status !== 'delivered').length;

    const cash = round2(collections.reduce((s, c) => s + c.cash, 0));
    const online = round2(collections.reduce((s, c) => s + c.online, 0));
    const credit = round2(collections.reduce((s, c) => s + c.credit, 0));

    return {
      rider: {
        id,
        name: rider.fullName || rider.username,
        city: regionLabel(rider.address?.city),
        cityKey: normalizeCityKey(rider.address?.city),
        isActive: rider.isActive,
      },
      counts: { assigned: orders.length, packed, delivered, pending },
      collection: { cash, online, credit, total: round2(cash + online + credit) },
      cashInHand: balances[i].cash.inHand,
      timeline: orders.map((o) => {
        const c = collectionByOrder.get(String(o._id));
        return {
          orderId: String(o._id),
          invoiceNumber: o.invoiceNumber ?? null,
          shop: o.shop,
          status: o.status,
          amount: round2(o.grandTotal ?? 0),
          assignedAt: o.assignedAt ?? null,
          packedAt: o.packedAt ?? null,
          deliveredAt: o.deliveredAt ?? null,
          cash: c ? round2(c.cash) : null,
          online: c ? round2(c.online) : null,
          credit: c ? round2(c.credit) : null,
        };
      }),
      recoveries: recoveries.map((r: any) => ({
        _id: String(r._id),
        dealerId: String(r.dealerId),
        shop: r.shop,
        amount: round2(r.amount),
        mode: r.mode,
        note: r.note ?? null,
        collectedAt: r.collectedAt,
      })),
    };
  });

  const sum = (pick: (b: (typeof riderBlocks)[number]) => number) =>
    round2(riderBlocks.reduce((s, b) => s + pick(b), 0));

  return {
    date,
    timezone: REPORT_TIMEZONE,
    riders: riderBlocks,
    totals: {
      assigned: riderBlocks.reduce((s, b) => s + b.counts.assigned, 0),
      packed: riderBlocks.reduce((s, b) => s + b.counts.packed, 0),
      delivered: riderBlocks.reduce((s, b) => s + b.counts.delivered, 0),
      pending: riderBlocks.reduce((s, b) => s + b.counts.pending, 0),
      cash: sum((b) => b.collection.cash),
      online: sum((b) => b.collection.online),
      credit: sum((b) => b.collection.credit),
      total: sum((b) => b.collection.total),
      cashInHand: sum((b) => b.cashInHand),
    },
  };
}

// ---------------------------------------------------------------------------
// §10 Day-end Summary
// ---------------------------------------------------------------------------

export async function getDayEndSummary(params: {
  riderId?: string;
  cityKey?: string;
  date?: string;
}) {
  const date = resolveDay(params.date);
  const { start, end } = windowToUtc(date, date);

  const orderMatch: Record<string, unknown> = {
    isTrashed: { $ne: true },
    $or: [
      { status: { $in: ['approved', 'packed', 'dispatched'] } },
      { status: 'delivered', deliveredAt: { $gte: start, $lte: end } },
    ],
  };
  if (params.riderId) orderMatch.assignedRiderId = new Types.ObjectId(params.riderId);
  else orderMatch.assignedRiderId = { $ne: null };

  // City is a property of the RIDER, and orders do not carry it — so when a city filter is
  // supplied the rider set is resolved first and the orders narrowed to it.
  if (params.cityKey !== undefined) {
    const cityRiders = await UserModel.find({
      role: ROLES.DELIVERY_MAN,
      isTrashed: { $ne: true },
    })
      .select('_id address.city')
      .lean()
      .exec();
    const ids = cityRiders
      .filter((r) => normalizeCityKey(r.address?.city) === params.cityKey)
      .map((r) => r._id as Types.ObjectId);
    if (params.riderId && !ids.some((id) => String(id) === params.riderId)) {
      orderMatch.assignedRiderId = { $in: [] };
    } else if (!params.riderId) {
      orderMatch.assignedRiderId = { $in: ids };
    }
  }

  const collectionMatch = buildCollectionMatch({
    riderId: params.riderId,
    cityKey: params.cityKey,
    start,
    end,
  });

  const [orders, totalsRows] = await Promise.all([
    OrderModel.aggregate([
      { $match: orderMatch },
      {
        $lookup: {
          from: 'dealers',
          localField: 'dealerId',
          foreignField: '_id',
          as: 'dealer',
          pipeline: [{ $project: { name: 1, shopName: 1 } }],
        },
      },
      { $unwind: { path: '$dealer', preserveNullAndEmptyArrays: true } },
      {
        $lookup: {
          from: 'users',
          localField: 'assignedRiderId',
          foreignField: '_id',
          as: 'rider',
          pipeline: [{ $project: { fullName: 1, username: 1, 'address.city': 1 } }],
        },
      },
      { $unwind: { path: '$rider', preserveNullAndEmptyArrays: true } },
      {
        $lookup: {
          from: 'deliverycollections',
          localField: '_id',
          foreignField: 'orderId',
          as: 'collection',
          pipeline: [
            { $match: NOT_VOID },
            { $project: { cash: 1, online: 1, credit: 1, orderAmount: 1 } },
          ],
        },
      },
      { $unwind: { path: '$collection', preserveNullAndEmptyArrays: true } },
      { $sort: { deliveredAt: -1, assignedAt: 1 } },
      {
        $project: {
          _id: 0,
          orderId: '$_id',
          invoiceNumber: 1,
          shop: { $ifNull: [{ $ifNull: ['$dealer.shopName', '$dealer.name'] }, '(deleted client)'] },
          rider: { $ifNull: [{ $ifNull: ['$rider.fullName', '$rider.username'] }, '—'] },
          city: { $ifNull: ['$rider.address.city', ''] },
          status: 1,
          amount: { $ifNull: ['$grandTotal', 0] },
          cash: { $ifNull: ['$collection.cash', null] },
          online: { $ifNull: ['$collection.online', null] },
          credit: { $ifNull: ['$collection.credit', null] },
          packedAt: 1,
          deliveredAt: 1,
        },
      },
    ]),
    DeliveryCollectionModel.aggregate<{
      amount: number; cash: number; online: number; credit: number; count: number;
    }>([
      { $match: collectionMatch },
      {
        $group: {
          _id: null,
          amount: { $sum: '$orderAmount' },
          cash: { $sum: '$cash' },
          online: { $sum: '$online' },
          credit: { $sum: '$credit' },
          count: { $sum: 1 },
        },
      },
    ]),
  ]);

  const t = totalsRows[0] ?? { amount: 0, cash: 0, online: 0, credit: 0, count: 0 };
  const delivered = orders.filter((o: any) => o.status === 'delivered').length;

  return {
    date,
    timezone: REPORT_TIMEZONE,
    totals: {
      cash: round2(t.cash),
      online: round2(t.online),
      credit: round2(t.credit),
      amount: round2(t.amount),
    },
    counts: {
      delivered,
      pending: orders.length - delivered,
      assigned: orders.length,
    },
    orders: orders.map((o: any) => ({ ...o, city: regionLabel(o.city) })),
  };
}
