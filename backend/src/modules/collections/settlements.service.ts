import { Types } from 'mongoose';
import { SettlementModel } from '../../models/settlement.model';
import { notFound, badRequest, conflict } from '../../utils/app-error';
import { logActivityAsync } from '../activity-logs/activity-logs.service';
import { round2, REPORT_TIMEZONE } from '../region-sales/region-sales.rules';
import { validateSettlementAmount } from './collections.rules';
import { getRiderBalance, resolveWindow, windowToUtc } from './collection-reports.service';
import { resolveRiderCity } from './collections.service';

/**
 * Spec §6 — handing money back to the company.
 *
 * Online is one step, cash is two. That asymmetry is expressed ONLY at create time: an online
 * settlement is born `received` (`autoReceived: true`), a cash one is born `pending` and waits
 * for an admin. Everything downstream then obeys a single rule — a settlement reduces the
 * balance iff `status === 'received'` — so the balance aggregation needs no mode branch.
 */

export async function submitSettlement(
  riderId: string,
  body: { mode: 'cash' | 'online'; amount: unknown; note?: string; screenshotUrl?: string },
) {
  const riderCity = await resolveRiderCity(riderId);

  if (body.mode === 'cash' && body.screenshotUrl) {
    // A cash handover has no digital receipt. Accepting one silently would leave a misleading
    // "proof" attached to a payment nobody can verify that way.
    throw badRequest('A screenshot can only be attached to an online settlement.');
  }

  const balance = await getRiderBalance(riderId);
  const available =
    body.mode === 'cash' ? balance.cash.availableToSettle : balance.online.availableToSettle;
  const amount = validateSettlementAmount(body.amount, available, body.mode);

  const submittedAt = new Date();
  const isOnline = body.mode === 'online';

  const settlement = await SettlementModel.create({
    riderId: new Types.ObjectId(riderId),
    city: riderCity.city,
    cityKey: riderCity.cityKey,
    mode: body.mode,
    amount,
    status: isOnline ? 'received' : 'pending',
    ...(isOnline ? { receivedAt: submittedAt, autoReceived: true } : {}),
    ...(body.screenshotUrl ? { screenshotUrl: body.screenshotUrl } : {}),
    ...(body.note ? { note: String(body.note).slice(0, 500) } : {}),
    submittedAt,
  });

  logActivityAsync({
    employeeId: riderId,
    module: 'settlement',
    entityId: String(settlement._id),
    action: 'submitted',
    meta: {
      mode: body.mode,
      amount,
      status: settlement.status,
      cityKey: riderCity.cityKey,
      autoReceived: isOnline,
    },
  });

  return { settlement, balance: await getRiderBalance(riderId) };
}

export async function listSettlements(filters: {
  riderId?: string;
  status?: 'pending' | 'received';
  mode?: 'cash' | 'online';
  cityKey?: string;
  from?: string;
  to?: string;
}) {
  const { from, to } = resolveWindow(filters.from, filters.to);
  const { start, end } = windowToUtc(from, to);

  const match: Record<string, unknown> = {
    voidedAt: { $exists: false },
    submittedAt: { $gte: start, $lte: end },
  };
  if (filters.riderId) match.riderId = new Types.ObjectId(filters.riderId);
  if (filters.status) match.status = filters.status;
  if (filters.mode) match.mode = filters.mode;
  if (filters.cityKey !== undefined) match.cityKey = filters.cityKey;

  const rows = await SettlementModel.aggregate([
    { $match: match },
    // Pending first: the admin's queue is the reason this list exists.
    { $sort: { status: 1, submittedAt: -1 } },
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
      $lookup: {
        from: 'users',
        localField: 'receivedBy',
        foreignField: '_id',
        as: 'receiver',
        pipeline: [{ $project: { fullName: 1, username: 1 } }],
      },
    },
    { $unwind: { path: '$receiver', preserveNullAndEmptyArrays: true } },
    {
      $project: {
        _id: 1,
        riderId: 1,
        rider: { $ifNull: [{ $ifNull: ['$rider.fullName', '$rider.username'] }, '(deleted rider)'] },
        city: 1,
        cityKey: 1,
        mode: 1,
        amount: 1,
        status: 1,
        screenshotUrl: 1,
        note: 1,
        submittedAt: 1,
        receivedAt: 1,
        autoReceived: 1,
        receivedBy: {
          $ifNull: [{ $ifNull: ['$receiver.fullName', '$receiver.username'] }, null],
        },
        corrected: { $gt: [{ $size: { $ifNull: ['$corrections', []] } }, 0] },
      },
    },
  ]);

  const totals = rows.reduce(
    (acc, r: any) => {
      const bucket = `${r.status === 'pending' ? 'pending' : 'received'}${
        r.mode === 'cash' ? 'Cash' : 'Online'
      }` as keyof typeof acc;
      acc[bucket] = round2(acc[bucket] + r.amount);
      return acc;
    },
    { pendingCash: 0, pendingOnline: 0, receivedCash: 0, receivedOnline: 0 },
  );

  return { from, to, timezone: REPORT_TIMEZONE, rows, totals };
}

/** Step 2 of the cash flow: the office confirms the money arrived. Only now does the balance drop. */
export async function receiveSettlement(id: string, adminId: string, note?: string) {
  const settlement = await SettlementModel.findById(id).lean();
  if (!settlement) throw notFound('Settlement not found');
  if (settlement.voidedAt) throw badRequest('This settlement has been voided.');
  if (settlement.mode !== 'cash') {
    throw badRequest('Online settlements are confirmed automatically and need no action.');
  }

  // Guarded CAS on the status, so two admins clicking together produce exactly one receipt.
  const updated = await SettlementModel.findOneAndUpdate(
    { _id: id, status: 'pending', voidedAt: { $exists: false } },
    {
      $set: {
        status: 'received',
        receivedBy: new Types.ObjectId(adminId),
        receivedAt: new Date(),
        ...(note ? { note: String(note).slice(0, 500) } : {}),
      },
    },
    { new: true },
  );

  if (!updated) throw conflict('This settlement has already been marked received.');

  logActivityAsync({
    employeeId: adminId,
    module: 'settlement',
    entityId: String(updated._id),
    action: 'received',
    changes: { status: { from: 'pending', to: 'received' } },
    meta: { riderId: String(updated.riderId), mode: updated.mode, amount: updated.amount },
  });

  return { settlement: updated, riderBalance: await getRiderBalance(String(updated.riderId)) };
}

export async function correctSettlement(
  id: string,
  adminId: string,
  body: { amount?: unknown; note?: string; reason?: string },
) {
  const settlement = await SettlementModel.findById(id);
  if (!settlement) throw notFound('Settlement not found');
  if (settlement.voidedAt) {
    throw badRequest('This settlement has been voided and can no longer be corrected.');
  }

  const from = { amount: settlement.amount };
  let nextAmount = settlement.amount;

  if (body.amount !== undefined) {
    const balance = await getRiderBalance(String(settlement.riderId));
    const side = settlement.mode === 'cash' ? balance.cash : balance.online;
    // Add this settlement back before capping, so an amount can be corrected upward as far as
    // the rider actually collected.
    const available = round2(side.availableToSettle + settlement.amount);
    nextAmount = validateSettlementAmount(body.amount, available, settlement.mode);
  }

  if (nextAmount === from.amount && !body.note) {
    throw badRequest('The correction is identical to the current entry.');
  }

  settlement.amount = nextAmount;
  if (body.note !== undefined) settlement.note = String(body.note).slice(0, 500);
  settlement.corrections.push({
    at: new Date(),
    by: new Types.ObjectId(adminId),
    from,
    to: { amount: nextAmount },
    ...(body.reason ? { reason: String(body.reason).slice(0, 500) } : {}),
  });
  settlement.lastCorrectedAt = new Date();
  settlement.lastCorrectedBy = new Types.ObjectId(adminId);
  await settlement.save();

  logActivityAsync({
    employeeId: adminId,
    module: 'settlement',
    entityId: String(settlement._id),
    action: 'updated',
    changes: { amount: { from: from.amount, to: nextAmount } },
    meta: { riderId: String(settlement.riderId), mode: settlement.mode, reason: body.reason ?? null },
  });

  return settlement;
}

export async function voidSettlement(id: string, adminId: string, reason: string) {
  const settlement = await SettlementModel.findById(id);
  if (!settlement) throw notFound('Settlement not found');
  if (settlement.voidedAt) throw conflict('This settlement has already been voided.');

  settlement.voidedAt = new Date();
  settlement.voidedBy = new Types.ObjectId(adminId);
  settlement.voidReason = String(reason).slice(0, 500);
  await settlement.save();

  logActivityAsync({
    employeeId: adminId,
    module: 'settlement',
    entityId: String(settlement._id),
    action: 'cancelled',
    meta: {
      riderId: String(settlement.riderId),
      mode: settlement.mode,
      amount: settlement.amount,
      reason,
    },
  });

  return settlement;
}
