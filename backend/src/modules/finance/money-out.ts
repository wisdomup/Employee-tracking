import { Types } from 'mongoose';
import { LedgerModel } from '../../models/ledger.model';
import { SupplierPaymentModel } from '../../models/supplier-payment.model';
import { ExpenseModel } from '../../models/expense.model';
import { badRequest, conflict } from '../../utils/app-error';

/**
 * The two rules every document that takes money out has to share.
 *
 * Supplier payments and expenses both pay out of a cash or bank account, and both can be paid by
 * cheque. The rules live in one place because the day two copies drifted, one kind of document
 * would quietly be allowed what the other refuses.
 */

function pad(no: number): string {
  return String(no).padStart(4, '0');
}

/**
 * The account the money comes out of must be somewhere money actually is.
 *
 * Cash-equivalent, because paying "from" an expense account would record money leaving a place it
 * was never in, and the bank balance would stay untouched while the money was spent. Not a control
 * account, because those belong to their own modules — rider cash is the rider's, and paying out
 * of it would make the rider appear short with nothing in that module to explain it.
 */
export async function loadPaidFromAccount(ledgerId: string) {
  if (!Types.ObjectId.isValid(ledgerId)) {
    throw badRequest('Say which cash or bank account the money is coming out of.');
  }

  const ledger = await LedgerModel.findById(ledgerId)
    .select('_id code name isActive isControl isCashEquivalent')
    .lean()
    .exec();
  if (!ledger) throw badRequest('That cash or bank account does not exist.');

  const label = `"${ledger.code} ${ledger.name}"`;
  if (!ledger.isActive) throw badRequest(`${label} is deactivated and cannot be paid from.`);
  if (ledger.isControl) {
    throw badRequest(
      `${label} belongs to its own module and cannot be paid from here. Choose the office cash or `
        + 'a bank account.',
    );
  }
  if (!ledger.isCashEquivalent) {
    throw badRequest(
      `${label} is not a cash or bank account, so no money can come out of it. Choose the office `
        + 'cash or a bank account.',
    );
  }

  return ledger;
}

/**
 * One cheque leaf, one document — across supplier payments AND expenses.
 *
 * A cheque number is printed on one physical leaf from one chequebook. The same number from the
 * same bank account twice is a typing slip or a cheque paid out twice, whichever screen it was
 * typed into. Cancelled documents still hold their number: the leaf is spent either way.
 *
 * Each collection also has its own unique index, which is what holds under a race within one
 * kind of document. Across the two collections this check is the only guard — two people typing
 * the same leaf into a payment and an expense in the same second could both get through. Rare,
 * and bank reconciliation would show the cheque twice the day it happened.
 */
export async function assertChequeLeafUnused(
  paidFromLedgerId: Types.ObjectId,
  chequeNo: string | undefined,
  exclude: { paymentId?: string; expenseId?: string } = {},
): Promise<void> {
  if (!chequeNo) return;

  const notSelf = (id?: string) =>
    id && Types.ObjectId.isValid(id) ? { _id: { $ne: new Types.ObjectId(id) } } : {};

  const [payment, expense] = await Promise.all([
    SupplierPaymentModel.findOne({ paidFromLedgerId, chequeNo, ...notSelf(exclude.paymentId) })
      .select('paymentNo status')
      .lean()
      .exec(),
    ExpenseModel.findOne({ paidFromLedgerId, chequeNo, ...notSelf(exclude.expenseId) })
      .select('expenseNo status')
      .lean()
      .exec(),
  ]);

  let which: string | null = null;
  let status: string | undefined;
  if (payment) {
    which = payment.paymentNo ? `payment P-${pad(payment.paymentNo)}` : 'a draft payment';
    status = payment.status;
  } else if (expense) {
    which = expense.expenseNo ? `expense E-${pad(expense.expenseNo)}` : 'a draft expense';
    status = expense.status;
  }
  if (!which) return;

  const cancelled = status === 'cancelled'
    ? ', which was cancelled — a cheque leaf is spent once it is written, even if what it paid was called off'
    : '';

  throw conflict(
    `Cheque ${chequeNo} from this account is already recorded as ${which}${cancelled}.`,
  );
}
