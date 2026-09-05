import { Types } from 'mongoose';
import { SettlementModel } from '../../models/settlement.model';
import { JournalEntryModel } from '../../models/journal-entry.model';
import { postEntry, reverseEntry, ledgerIdForRole } from './posting.service';
import { attemptPosting, postingEnabled } from './sales-posting.service';
import { buildIdempotencyKey, round2 } from './finance.rules';

/**
 * Rider float: money collected in the field, and what happens when it comes back.
 *
 * ## One rule, taken straight from the model
 *
 * `Settlement`'s own header states it: *a settlement reduces the rider's balance iff
 * `status === 'received'`*. That is the posting rule too, unchanged. An online settlement is
 * born received, so it posts at submit; a cash one posts only when an admin confirms the money
 * is actually in hand.
 *
 * Nothing is posted while a cash settlement sits pending. The money is still with the rider and
 * 1130 Rider Cash in Hand is exactly where it belongs. Posting on submission would move money
 * into the office that nobody in the office has yet touched.
 *
 * ## Shortfalls are never written off automatically
 *
 * When a rider hands over less than they were carrying, the difference stays on their balance.
 * Clearing it is a deliberate, permissioned act recorded as a write-off settlement — see
 * `writeOffRiderCash` in the collections module. A system that quietly absorbs a cash shortfall
 * is a system nobody can use to ask where the money went.
 */

/** Which side of the books a settlement lands on, and where the money went. */
async function settlementLedgers(settlement: {
  mode: 'cash' | 'online';
  kind?: 'handover' | 'writeoff';
}): Promise<{ debit: string; credit: string }> {
  const isWriteOff = settlement.kind === 'writeoff';

  const [debit, credit] = await Promise.all([
    // A handover puts the money somewhere real; a write-off puts it in Cash Difference, which
    // is a loss, and which is meant to be looked at.
    ledgerIdForRole(isWriteOff ? 'cashDifference' : settlement.mode === 'cash' ? 'officeCash' : 'bank'),
    ledgerIdForRole(settlement.mode === 'cash' ? 'riderCash' : 'onlineInTransit'),
  ]);

  return { debit, credit };
}

/**
 * Post a settlement that has been received.
 *
 * Safe to call on submit AND on receive: the `status !== 'received'` guard makes the first call
 * a no-op for a cash settlement, and the idempotency key makes the second call harmless if the
 * first already wrote it.
 */
export async function postSettlement(settlementId: string, actorId?: string): Promise<boolean> {
  if (!(await postingEnabled('settlement'))) return false;

  const settlement = await SettlementModel.findById(settlementId).lean().exec();
  if (!settlement) return false;

  // The one rule. A pending cash settlement is money still in the rider's pocket.
  if (settlement.status !== 'received') return false;
  if (settlement.voidedAt) return false;

  const stamp = settlement.lastCorrectedAt;
  const key = buildIdempotencyKey('settlement', settlementId, 'received', stamp);

  return attemptPosting(
    'settlement.received',
    key,
    { sourceType: 'settlement_received', sourceId: settlementId, sourceModel: 'Settlement' },
    async () => {
      // A correction reverses the previous entry before the new figure goes down.
      if (stamp) {
        const previous = await JournalEntryModel.findOne({
          idempotencyKey: buildIdempotencyKey('settlement', settlementId, 'received'),
          status: 'posted',
        })
          .select('_id')
          .lean()
          .exec();
        if (previous) {
          await reverseEntry(String(previous._id), { reason: 'Settlement amount corrected' }, actorId);
        }
      }

      const amount = round2(settlement.amount);
      if (amount <= 0) return;

      const { debit, credit } = await settlementLedgers(settlement);
      const riderRef = { type: 'rider', id: String(settlement.riderId) };

      const isWriteOff = settlement.kind === 'writeoff';

      await postEntry(
        {
          // The date the money actually changed hands, not when the row was typed.
          date: settlement.receivedAt ?? settlement.submittedAt,
          narration: isWriteOff
            ? `Rider cash shortfall written off: ${settlement.writeoffReason ?? 'no reason given'}`
            : settlement.mode === 'cash'
              ? 'Cash handed over by rider'
              : 'Online transfer from rider confirmed',
          sourceType: isWriteOff ? 'settlement_variance' : 'settlement_received',
          sourceId: settlementId,
          sourceModel: 'Settlement',
          idempotencyKey: key,
          cityKey: settlement.cityKey,
          lines: [
            { ledgerId: debit, debit: amount },
            { ledgerId: credit, credit: amount, subledgerRef: riderRef },
          ],
        },
        actorId,
      );
    },
  );
}

/** A settlement was voided — the money is back on the rider's balance, so the entry comes off. */
export async function postSettlementVoid(
  settlementId: string,
  actorId?: string,
): Promise<boolean> {
  if (!(await postingEnabled('settlement'))) return false;

  const settlement = await SettlementModel.findById(settlementId)
    .select('lastCorrectedAt')
    .lean()
    .exec();
  if (!settlement) return false;

  // Whichever entry is currently live — the original, or the latest correction.
  const keys = [
    buildIdempotencyKey('settlement', settlementId, 'received'),
    ...(settlement.lastCorrectedAt
      ? [buildIdempotencyKey('settlement', settlementId, 'received', settlement.lastCorrectedAt)]
      : []),
  ];

  const live = await JournalEntryModel.findOne({
    idempotencyKey: { $in: keys },
    status: 'posted',
  })
    .select('_id')
    .lean()
    .exec();
  if (!live) return false;

  return attemptPosting(
    'settlement.void',
    `${String(live._id)}:void`,
    { sourceType: 'settlement_received', sourceId: settlementId, sourceModel: 'Settlement' },
    () => reverseEntry(String(live._id), { reason: 'Settlement voided' }, actorId),
  );
}

/**
 * What the ledger thinks each rider is holding, for the control check in a later step.
 *
 * Returned per rider so it can be compared against `getRiderBalance`, which computes the same
 * figure from the operational records. The two agreeing is the whole point of the module.
 */
export async function riderBalancesFromLedger(): Promise<
  Map<string, { cash: number; online: number }>
> {
  const [riderCash, onlineInTransit] = await Promise.all([
    ledgerIdForRole('riderCash'),
    ledgerIdForRole('onlineInTransit'),
  ]);

  const { JournalLineModel } = await import('../../models/journal-line.model');

  const rows = await JournalLineModel.aggregate<{
    _id: { rider: Types.ObjectId; ledger: Types.ObjectId };
    net: number;
  }>([
    {
      /*
       * `posted` AND `reversed`, not `posted` alone.
       *
       * Reversing an entry marks the ORIGINAL's lines `reversed` and posts the offsetting lines
       * as `posted`. Filtering to `posted` therefore drops the original but keeps the thing that
       * cancels it, so every reversed entry counts once in the wrong direction — a corrected
       * settlement came out +250 instead of −4750 before this was fixed.
       *
       * Including both is what every other balance query here does (`trialBalance`,
       * `reconcileLedgerBalances`); the pair sums to zero, which is the point of a reversal.
       */
      $match: {
        ledgerId: { $in: [new Types.ObjectId(riderCash), new Types.ObjectId(onlineInTransit)] },
        status: { $in: ['posted', 'reversed'] },
        'subledgerRef.type': 'rider',
      },
    },
    {
      $group: {
        _id: { rider: '$subledgerRef.id', ledger: '$ledgerId' },
        net: { $sum: '$signedAmount' },
      },
    },
  ]).exec();

  const out = new Map<string, { cash: number; online: number }>();
  for (const row of rows) {
    const rider = String(row._id.rider);
    const current = out.get(rider) ?? { cash: 0, online: 0 };
    if (String(row._id.ledger) === riderCash) current.cash = round2(row.net);
    else current.online = round2(row.net);
    out.set(rider, current);
  }
  return out;
}
