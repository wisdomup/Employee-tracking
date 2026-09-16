import { Types } from 'mongoose';
import { LedgerModel } from '../../models/ledger.model';
import { JournalLineModel } from '../../models/journal-line.model';
import { PurchaseBillModel } from '../../models/purchase-bill.model';
import { ExpenseModel } from '../../models/expense.model';
import { VendorModel } from '../../models/vendor.model';
import { FinanceSettingsModel } from '../../models/finance-settings.model';
import { MONEY_EPSILON, REPORT_TIMEZONE, round2 } from './finance.rules';
import { localDayKey } from '../region-sales/region-sales.rules';

/**
 * What tax was paid on purchases and charged on sales in a period.
 *
 * ## What this deliberately does NOT do
 *
 * It works out no tax. There is no rate table, nothing is calculated from a percentage, and no
 * document has its tax filled in for it. Every figure here was typed by a person onto a bill or
 * an expense and posted to the accounts, and this report adds them up.
 *
 * That is not a shortcut, it is the only honest thing to build until somebody says which taxes
 * this business is actually registered for. Sales tax charged on an invoice and withholding tax
 * deducted when a supplier is paid are opposite in almost every respect — one is collected from
 * the customer and owed onward, the other is withheld from the supplier and owed onward — and
 * rate machinery guessed at now would have to be pulled back out of bills, payments and expenses
 * when the answer arrives.
 *
 * So: the reporting half, which the answer cannot change, is here. The calculating half waits.
 *
 * ## The reconciliation is the point
 *
 * The totals come from the LEDGER, because the ledger is what the accounts actually say. The
 * supplier-by-supplier breakdown comes from the DOCUMENTS, because a posting to the input-tax
 * account carries no supplier on it — only bills and expenses know who the tax was paid to.
 *
 * Those two can disagree: a manual journal entry touching the tax account appears in one and not
 * the other. A return filed off a breakdown that does not add up to the ledger is a return that
 * disagrees with the books, so the difference is worked out and named rather than left for
 * somebody to find at the counter.
 */

export interface TaxPartyRow {
  vendorId: string | null;
  name: string;
  taxRegistrationNo?: string;
  documentCount: number;
  /** What the goods or services cost before tax. */
  taxableAmount: number;
  taxAmount: number;
  /** False when there is no tax number, which is what stops a line being filed. */
  filable: boolean;
}

export interface TaxSummary {
  from: string;
  to: string;
  /** Tax paid on purchases, from the ledger. Claimable. */
  inputTax: number;
  /** Tax charged on sales, from the ledger. Owed onward. */
  outputTax: number;
  /** Positive is payable to the revenue office, negative is reclaimable. */
  net: number;
  /**
   * Tax deducted from suppliers when they were paid, held until it is remitted.
   *
   * Reported beside the other two and NEVER added into `net`. This is somebody else's tax,
   * deducted on the revenue office's behalf; it nets against nothing and is remitted on its own
   * return. Rolling it into the sales-tax position would overstate what is owed there and leave
   * the withholding return with no figure at all.
   */
  taxWithheld: number;
  inputTaxCode: string;
  outputTaxCode: string;
  withheldTaxCode: string;
  /** Supplier by supplier, from the documents — the purchase side of a return. */
  purchases: TaxPartyRow[];
  purchasesTaxTotal: number;
  /** Ledger less documents. Anything other than nil needs explaining before filing. */
  unattributedInputTax: number;
  warnings: string[];
}

/**
 * Turn `-0` back into `0`.
 *
 * Negating a nil balance produces negative zero, which formats as "-0.00" and reads as a real
 * figure sitting the wrong way round. `cash-reports` hit the same trap when it negated the
 * uncleared-cheque balance. `-0 === 0` is true, so this comparison catches it.
 */
function normaliseZero(value: number): number {
  return value === 0 ? 0 : value;
}

async function ledgerForRole(role: string): Promise<{ id: Types.ObjectId; code: string } | null> {
  const settings = await FinanceSettingsModel.findOne({ key: 'singleton' })
    .select('ledgerMap')
    .lean()
    .exec();
  const map = settings?.ledgerMap as unknown as Record<string, Types.ObjectId> | undefined;
  const id = map?.[role];
  if (!id) return null;

  const ledger = await LedgerModel.findById(id).select('code').lean().exec();
  if (!ledger) return null;
  return { id: ledger._id, code: ledger.code };
}

/**
 * Movement on one account within the window, in its own direction.
 *
 * Input tax is an asset and output tax a liability, so the caller says which way round to read
 * the net. Reversed lines are included alongside the reversals that undid them — together they
 * come to nothing, which is exactly what a cancelled bill should contribute to a tax return.
 */
async function movementInWindow(
  ledgerId: Types.ObjectId,
  from: string,
  to: string,
  debitNatured: boolean,
): Promise<number> {
  const rows = await JournalLineModel.aggregate<{ debit: number; credit: number }>([
    { $match: { ledgerId, status: { $in: ['posted', 'reversed'] } } },
    {
      $addFields: {
        day: { $dateToString: { format: '%Y-%m-%d', date: '$date', timezone: REPORT_TIMEZONE } },
      },
    },
    { $match: { day: { $gte: from, $lte: to } } },
    { $group: { _id: null, debit: { $sum: '$debit' }, credit: { $sum: '$credit' } } },
  ]).exec();

  const net = round2((rows[0]?.debit ?? 0) - (rows[0]?.credit ?? 0));
  return normaliseZero(debitNatured ? net : round2(-net));
}

/** Bills and expenses carrying tax in the window, grouped by who was paid. */
async function purchaseBreakdown(from: string, to: string): Promise<TaxPartyRow[]> {
  const window = { $gte: from, $lte: to };

  const [bills, expenses] = await Promise.all([
    PurchaseBillModel.aggregate<{
      _id: Types.ObjectId;
      count: number;
      tax: number;
      total: number;
    }>([
      { $match: { status: 'posted', taxAmount: { $gt: 0 } } },
      {
        $addFields: {
          day: {
            $dateToString: { format: '%Y-%m-%d', date: '$billDate', timezone: REPORT_TIMEZONE },
          },
        },
      },
      { $match: { day: window } },
      {
        $group: {
          _id: '$vendorId',
          count: { $sum: 1 },
          tax: { $sum: '$taxAmount' },
          total: { $sum: '$totalAmount' },
        },
      },
    ]).exec(),

    ExpenseModel.aggregate<{
      _id: Types.ObjectId | null;
      count: number;
      tax: number;
      net: number;
    }>([
      { $match: { status: 'posted', taxAmount: { $gt: 0 } } },
      {
        $addFields: {
          day: {
            $dateToString: { format: '%Y-%m-%d', date: '$expenseDate', timezone: REPORT_TIMEZONE },
          },
        },
      },
      { $match: { day: window } },
      {
        $group: {
          _id: '$vendorId',
          count: { $sum: 1 },
          tax: { $sum: '$taxAmount' },
          // `amount` is already before tax on an expense, unlike a bill's total.
          net: { $sum: '$amount' },
        },
      },
    ]).exec(),
  ]);

  const byVendor = new Map<string, { count: number; tax: number; taxable: number }>();
  const add = (key: string, count: number, tax: number, taxable: number) => {
    const row = byVendor.get(key) ?? { count: 0, tax: 0, taxable: 0 };
    row.count += count;
    row.tax = round2(row.tax + tax);
    row.taxable = round2(row.taxable + taxable);
    byVendor.set(key, row);
  };

  for (const bill of bills) {
    add(String(bill._id), bill.count, round2(bill.tax), round2(bill.total - bill.tax));
  }
  for (const expense of expenses) {
    // An expense with no supplier on it still carries claimable tax; it is bucketed rather than
    // dropped, because a missing line is invisible on a return and a named one is not.
    add(expense._id ? String(expense._id) : 'unnamed', expense.count, round2(expense.tax), round2(expense.net));
  }

  const vendorIds = [...byVendor.keys()]
    .filter((k) => k !== 'unnamed')
    .map((k) => new Types.ObjectId(k));

  const vendors = await VendorModel.find({ _id: { $in: vendorIds } })
    .select('_id name taxRegistrationNo')
    .lean()
    .exec();
  const vendorById = new Map(vendors.map((v) => [String(v._id), v]));

  return [...byVendor.entries()]
    .map(([key, row]) => {
      const vendor = key === 'unnamed' ? null : vendorById.get(key);
      return {
        vendorId: vendor ? String(vendor._id) : null,
        name: vendor?.name ?? 'Not attached to a supplier',
        taxRegistrationNo: vendor?.taxRegistrationNo || undefined,
        documentCount: row.count,
        taxableAmount: row.taxable,
        taxAmount: row.tax,
        filable: Boolean(vendor?.taxRegistrationNo),
      };
    })
    // Most tax first: that is the order in which a wrong or unfilable line costs the most.
    .sort((a, b) => b.taxAmount - a.taxAmount);
}

export async function taxSummary(input: { from?: string; to?: string } = {}): Promise<TaxSummary> {
  const to = input.to || localDayKey(new Date());
  // A month back by default, which is the shortest period anybody files for.
  const from = input.from || to.slice(0, 8) + '01';

  const [inputRole, outputRole, withheldRole] = await Promise.all([
    ledgerForRole('inputTax'),
    ledgerForRole('outputTax'),
    ledgerForRole('taxWithheldPayable'),
  ]);

  const warnings: string[] = [];

  const [inputTax, outputTax, taxWithheld, purchases] = await Promise.all([
    inputRole ? movementInWindow(inputRole.id, from, to, true) : Promise.resolve(0),
    outputRole ? movementInWindow(outputRole.id, from, to, false) : Promise.resolve(0),
    withheldRole ? movementInWindow(withheldRole.id, from, to, false) : Promise.resolve(0),
    purchaseBreakdown(from, to),
  ]);

  if (!inputRole) warnings.push('No account is set up to hold tax paid on purchases.');
  if (!outputRole) warnings.push('No account is set up to hold tax charged on sales.');
  if (!withheldRole) {
    warnings.push('No account is set up to hold tax withheld from suppliers.');
  }

  const purchasesTaxTotal = round2(purchases.reduce((sum, row) => sum + row.taxAmount, 0));
  const unattributedInputTax = round2(inputTax - purchasesTaxTotal);

  if (Math.abs(unattributedInputTax) >= MONEY_EPSILON) {
    warnings.push(
      `${Math.abs(unattributedInputTax).toFixed(2)} of tax on purchases `
        + `${unattributedInputTax > 0 ? 'is in the accounts but on no bill or expense' : 'is on bills or expenses but not in the accounts'}`
        + '. A return filed from the list below would not agree with the books until that is explained.',
    );
  }

  const unfilable = purchases.filter((row) => !row.filable);
  if (unfilable.length > 0) {
    const total = round2(unfilable.reduce((sum, row) => sum + row.taxAmount, 0));
    warnings.push(
      `${unfilable.length} ${unfilable.length === 1 ? 'supplier has' : 'suppliers have'} no tax `
        + `number on file, covering ${total.toFixed(2)} of tax. Those lines cannot go on a return `
        + 'until the number is added to the supplier.',
    );
  }

  if (Math.abs(outputTax) < MONEY_EPSILON) {
    /*
     * Said out loud, because a nil figure on a tax report reads as a fault.
     *
     * Orders carry no tax figure anywhere in this system — there is no field on them to hold one
     * — so nothing can post tax on a sale. This is the shape of the data, not a missing posting,
     * and somebody comparing this report against their own invoices needs to know which.
     */
    warnings.push(
      'No tax has been charged on sales in this period. Orders carry no tax figure in this '
        + 'system, so nothing can post one — this is not a missed posting.',
    );
  }

  return {
    from,
    to,
    inputTax,
    outputTax,
    // Withheld tax is deliberately absent from this sum — see the field's note.
    net: normaliseZero(round2(outputTax - inputTax)),
    taxWithheld,
    withheldTaxCode: withheldRole?.code ?? '',
    inputTaxCode: inputRole?.code ?? '',
    outputTaxCode: outputRole?.code ?? '',
    purchases,
    purchasesTaxTotal,
    unattributedInputTax,
    warnings,
  };
}
