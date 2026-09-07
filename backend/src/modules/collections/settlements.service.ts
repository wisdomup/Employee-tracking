import { Types } from 'mongoose';
import { SettlementModel } from '../../models/settlement.model';
import { notFound, badRequest, conflict } from '../../utils/app-error';
import { logActivityAsync } from '../activity-logs/activity-logs.service';
import { round2, REPORT_TIMEZONE } from '../region-sales/region-sales.rules';
import { validateSettlementAmount } from './collections.rules';
import { getRiderBalance, resolveWindow, windowToUtc } from './collection-reports.service';
import { resolveRiderCity } from './collections.service';
import {
  postSettlement,
  postSettlementVoid,
} from '../finance/settlement-posting.service';

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

  // An online settlement is born received, so this posts immediately. A cash one is pending, and
  // this call is a deliberate no-op: the money is still in the rider's pocket, which is exactly
  // where the ledger already has it.
  await postSettlement(String(settlement._id), riderId);

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

  // The cash is now genuinely in the office, so it moves off the rider and onto the company.
  await postSettlement(String(updated._id), adminId);

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

  // Reverses the previous entry and re-posts at the corrected figure. A correction that leaves
  // the rider short does NOT write the difference off — it stays on their balance until somebody
  // clears it deliberately.
  await postSettlement(String(settlement._id), adminId);

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

  // The money is back on the rider's balance, so the entry comes off the books with it.
  await postSettlementVoid(String(settlement._id), adminId);

  return settlement;
}

/**
 * Clear a confirmed cash shortfall a rider is not going to hand over.
 *
 * The deliberate act that step 05 exists to make possible. When an admin corrects a settlement
 * downwards, the difference STAYS on the rider's balance — the system never absorbs a shortfall
 * on its own, because a system that quietly does that is one nobody can use to ask where the
 * money went. This is how it is written off, on purpose, by a named person, with a reason.
 *
 * Recorded as a settlement of kind `writeoff` rather than as a new kind of document. That is
 * what makes it correct without touching the balance maths: `getRiderBalance` already reduces
 * the rider's cash by every received settlement, and a write-off genuinely does reduce what they
 * owe. Only the accounting differs — the money goes to Cash Difference instead of to the office.
 */
export async function writeOffRiderCash(
  riderId: string,
  body: { amount: unknown; mode: 'cash' | 'online'; reason: unknown },
  adminId: string,
) {
  const reason = String(body.reason ?? '').trim();
  if (reason.length < 3) {
    throw badRequest('Say why this shortfall is being written off.');
  }

  const balance = await getRiderBalance(riderId);
  const available = body.mode === 'cash' ? balance.cash.inHand : balance.online.outstanding;

  // Capped at what the rider is actually carrying. Writing off more than that would drive the
  // balance negative and invent a debt owed back TO the rider.
  const amount = validateSettlementAmount(body.amount, available, body.mode);

  const riderCity = await resolveRiderCity(riderId);
  const now = new Date();

  const settlement = await SettlementModel.create({
    riderId: new Types.ObjectId(riderId),
    city: riderCity.city,
    cityKey: riderCity.cityKey,
    mode: body.mode,
    kind: 'writeoff',
    writeoffReason: reason,
    amount,
    // Born received: the shortfall is settled the moment it is written off. `autoReceived` stays
    // false because a person decided this, which is the distinction that field exists to draw.
    status: 'received',
    receivedBy: new Types.ObjectId(adminId),
    receivedAt: now,
    submittedAt: now,
  });

  logActivityAsync({
    employeeId: adminId,
    module: 'settlement',
    entityId: String(settlement._id),
    action: 'created',
    meta: { riderId, mode: body.mode, amount, kind: 'writeoff', reason },
  });

  await postSettlement(String(settlement._id), adminId);

  return { settlement, riderBalance: await getRiderBalance(riderId) };
}
