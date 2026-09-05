import { Types } from 'mongoose';
import { DealerModel } from '../../models/dealer.model';
import { CreditRecoveryModel } from '../../models/credit-recovery.model';
import { notFound, badRequest, conflict } from '../../utils/app-error';
import { logActivityAsync } from '../activity-logs/activity-logs.service';
import {
  postCreditRecovery,
  postCreditRecoveryVoid,
} from '../finance/sales-posting.service';
import {
  normalizeCityKey,
  regionLabel,
  round2,
  REPORT_TIMEZONE,
  UNASSIGNED_REGION_KEY,
} from '../region-sales/region-sales.rules';
import { validateRecoveryAmount } from './collections.rules';
import {
  getRiderBalance,
  getDealerOutstanding,
  resolveWindow,
  windowToUtc,
} from './collection-reports.service';
import { resolveRiderCity } from './collections.service';

/**
 * Spec §5 — recovery of OLD pending credit. Not a new sale: no order, no stock, no invoice.
 * The money joins the rider's balance for that mode and the shop's outstanding drops by the
 * same amount.
 *
 * The spec calls this a "free-form entry (Party Name + Amount)" and says a full ledger is not
 * required. We keep it simple — one flat document, no double-entry — but the party is a real
 * `dealerId` rather than a typed string, because the spec's own next line ("the customer's
 * pending credit reduces by the same amount") is not computable against free text. The
 * free-form part survives as `note`.
 */

export async function createRecovery(
  riderId: string,
  body: { dealerId: string; amount: unknown; mode: 'cash' | 'online'; note?: string },
) {
  const riderCity = await resolveRiderCity(riderId);

  const dealer = await DealerModel.findOne({ _id: body.dealerId, isTrashed: { $ne: true } })
    .select('name shopName address.city')
    .lean()
    .exec();
  if (!dealer) throw notFound('Client not found');

  const dealerCityKey = normalizeCityKey(dealer.address?.city);
  if (dealerCityKey !== UNASSIGNED_REGION_KEY && dealerCityKey !== riderCity.cityKey) {
    throw badRequest(
      `"${dealer.shopName || dealer.name}" is in ${regionLabel(dealer.address?.city)} but you work in ` +
        `${riderCity.city}. Recoveries cannot cross cities.`,
    );
  }

  const { outstanding } = await getDealerOutstanding(String(dealer._id));
  const amount = validateRecoveryAmount(body.amount, outstanding);

  const recovery = await CreditRecoveryModel.create({
    dealerId: dealer._id,
    riderId: new Types.ObjectId(riderId),
    city: riderCity.city,
    cityKey: riderCity.cityKey,
    amount,
    mode: body.mode,
    ...(body.note ? { note: String(body.note).slice(0, 500) } : {}),
    collectedAt: new Date(),
    createdBy: new Types.ObjectId(riderId),
  });

  logActivityAsync({
    employeeId: riderId,
    module: 'credit_recovery',
    entityId: String(recovery._id),
    action: 'created',
    meta: {
      dealerId: String(dealer._id),
      amount,
      mode: body.mode,
      cityKey: riderCity.cityKey,
      outstandingBefore: outstanding,
    },
  });

  const [dealerOutstanding, balance] = await Promise.all([
    getDealerOutstanding(String(dealer._id)),
    getRiderBalance(riderId),
  ]);

  // Money in, receivable down. No sale and no stock — see the model header.
  await postCreditRecovery(String(recovery._id), riderId);

  return { recovery, dealerOutstanding, balance };
}

export async function listRecoveries(filters: {
  riderId?: string;
  dealerId?: string;
  cityKey?: string;
  from?: string;
  to?: string;
}) {
  const { from, to } = resolveWindow(filters.from, filters.to);
  const { start, end } = windowToUtc(from, to);

  const match: Record<string, unknown> = {
    voidedAt: { $exists: false },
    collectedAt: { $gte: start, $lte: end },
  };
  if (filters.riderId) match.riderId = new Types.ObjectId(filters.riderId);
  if (filters.dealerId) match.dealerId = new Types.ObjectId(filters.dealerId);
  if (filters.cityKey !== undefined) match.cityKey = filters.cityKey;

  const rows = await CreditRecoveryModel.aggregate([
    { $match: match },
    { $sort: { cityKey: 1, collectedAt: -1 } },
    {
      $lookup: {
        from: 'dealers',
        localField: 'dealerId',
        foreignField: '_id',
        as: 'dealer',
        // No isTrashed filter: a since-deleted client must still show, or the total shrinks.
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
        _id: 1,
        dealerId: 1,
        shop: { $ifNull: [{ $ifNull: ['$dealer.shopName', '$dealer.name'] }, '(deleted client)'] },
        riderId: 1,
        rider: { $ifNull: [{ $ifNull: ['$rider.fullName', '$rider.username'] }, '(deleted rider)'] },
        city: 1,
        cityKey: 1,
        amount: 1,
        mode: 1,
        note: 1,
        collectedAt: 1,
        corrected: { $gt: [{ $size: { $ifNull: ['$corrections', []] } }, 0] },
      },
    },
  ]);

  const totals = rows.reduce(
    (acc, r: any) => {
      if (r.mode === 'cash') acc.cash = round2(acc.cash + r.amount);
      else acc.online = round2(acc.online + r.amount);
      acc.total = round2(acc.total + r.amount);
      acc.count += 1;
      return acc;
    },
    { cash: 0, online: 0, total: 0, count: 0 },
  );

  return { from, to, timezone: REPORT_TIMEZONE, rows, totals };
}

export async function correctRecovery(
  id: string,
  adminId: string,
  body: { amount?: unknown; mode?: 'cash' | 'online'; reason?: string },
) {
  const recovery = await CreditRecoveryModel.findById(id);
  if (!recovery) throw notFound('Recovery entry not found');
  if (recovery.voidedAt) {
    throw badRequest('This entry has been voided and can no longer be corrected.');
  }

  const from = { amount: recovery.amount, mode: recovery.mode };

  let nextAmount = recovery.amount;
  if (body.amount !== undefined) {
    // The cap is the shop's outstanding as it would be WITHOUT this entry — otherwise
    // correcting 1500 -> 2000 is refused because this entry's own 1500 already reduced it.
    const { outstanding } = await getDealerOutstanding(String(recovery.dealerId));
    nextAmount = validateRecoveryAmount(body.amount, round2(outstanding + recovery.amount));
  }
  const nextMode = body.mode ?? recovery.mode;

  if (nextAmount === from.amount && nextMode === from.mode) {
    throw badRequest('The correction is identical to the current entry.');
  }

  recovery.amount = nextAmount;
  recovery.mode = nextMode;
  recovery.corrections.push({
    at: new Date(),
    by: new Types.ObjectId(adminId),
    from,
    to: { amount: nextAmount, mode: nextMode },
    ...(body.reason ? { reason: String(body.reason).slice(0, 500) } : {}),
  });
  recovery.lastCorrectedAt = new Date();
  recovery.lastCorrectedBy = new Types.ObjectId(adminId);
  await recovery.save();

  logActivityAsync({
    employeeId: adminId,
    module: 'credit_recovery',
    entityId: String(recovery._id),
    action: 'updated',
    changes: {
      amount: { from: from.amount, to: nextAmount },
      mode: { from: from.mode, to: nextMode },
    },
    meta: { dealerId: String(recovery.dealerId), riderId: String(recovery.riderId), reason: body.reason ?? null },
  });

  // Reverses the previous entry and posts the corrected one, keyed on the correction stamp.
  await postCreditRecovery(String(recovery._id), adminId);

  return recovery;
}

export async function voidRecovery(id: string, adminId: string, reason: string) {
  const recovery = await CreditRecoveryModel.findById(id);
  if (!recovery) throw notFound('Recovery entry not found');
  if (recovery.voidedAt) throw conflict('This entry has already been voided.');

  recovery.voidedAt = new Date();
  recovery.voidedBy = new Types.ObjectId(adminId);
  recovery.voidReason = String(reason).slice(0, 500);
  await recovery.save();

  logActivityAsync({
    employeeId: adminId,
    module: 'credit_recovery',
    entityId: String(recovery._id),
    action: 'cancelled',
    meta: {
      dealerId: String(recovery.dealerId),
      riderId: String(recovery.riderId),
      amount: recovery.amount,
      reason,
    },
  });

  return recovery;
}
