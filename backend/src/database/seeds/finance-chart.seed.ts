import { Types } from 'mongoose';
import { AccountGroupModel } from '../../models/account-group.model';
import { LedgerModel } from '../../models/ledger.model';
import {
  FinanceSettingsModel,
  LEDGER_ROLE_KEYS,
  LedgerRoleKey,
} from '../../models/finance-settings.model';
import { AccountType, SubledgerType } from '../../modules/finance/finance.rules';

/**
 * The starting chart of accounts for a single-currency FMCG distribution business, sized to the
 * events this platform actually produces.
 *
 * ## What is and is not fixed
 *
 * Everything here is a SUGGESTION the client's accountant should review before go-live —
 * except the accounts carrying a `role`. Those are referenced by the posting engine through
 * `FinanceSettings.ledgerMap`, are seeded `isSystem`, and cannot be deleted or moved to a group
 * of a different type. They can still be renamed and re-coded, which is the line between
 * "customisable" and "breakable".
 *
 * ## Re-running is safe
 *
 * Existing groups and ledgers are matched by code and skipped, never overwritten — the same
 * contract `access-policies.seed.ts` holds. An accountant's renamed ledger survives a redeploy.
 * The ledger map is repaired on every run, because a role pointing at a deleted ledger is the
 * one state that stops the engine booting.
 */

interface GroupSeed {
  code: string;
  name: string;
  accountType: AccountType;
  parent?: string;
  sortOrder: number;
}

interface LedgerSeed {
  code: string;
  name: string;
  group: string;
  role?: LedgerRoleKey;
  control?: SubledgerType;
  cash?: boolean;
  note?: string;
}

const GROUPS: GroupSeed[] = [
  { code: '1000', name: 'Assets', accountType: 'asset', sortOrder: 10 },
  { code: '1100', name: 'Current Assets', accountType: 'asset', parent: '1000', sortOrder: 10 },
  { code: '1200', name: 'Fixed Assets', accountType: 'asset', parent: '1000', sortOrder: 20 },
  { code: '9000', name: 'Suspense', accountType: 'asset', parent: '1000', sortOrder: 90 },

  { code: '2000', name: 'Liabilities', accountType: 'liability', sortOrder: 20 },
  { code: '2100', name: 'Current Liabilities', accountType: 'liability', parent: '2000', sortOrder: 10 },
  { code: '2200', name: 'Long-term Liabilities', accountType: 'liability', parent: '2000', sortOrder: 20 },

  { code: '3000', name: 'Equity', accountType: 'equity', sortOrder: 30 },

  { code: '4000', name: 'Income', accountType: 'income', sortOrder: 40 },

  { code: '5000', name: 'Cost of Sales', accountType: 'expense', sortOrder: 50 },
  { code: '6000', name: 'Operating Expenses', accountType: 'expense', sortOrder: 60 },
];

const LEDGERS: LedgerSeed[] = [
  // ---- Current assets -----------------------------------------------------
  { code: '1110', name: 'Cash in Hand — Office', group: '1100', role: 'officeCash', cash: true },
  { code: '1120', name: 'Bank — Operating', group: '1100', role: 'bank', cash: true },
  // Cheques are deliberately NOT cash equivalents. A cheque is not money until it clears, and
  // counting one as cash is how a system's bank balance stops matching the bank's.
  { code: '1122', name: 'Cheques in Hand', group: '1100', role: 'chequesInHand' },
  { code: '1125', name: 'Cheques Issued, Uncleared', group: '1100', role: 'chequesIssued' },
  { code: '1130', name: 'Rider Cash in Hand', group: '1100', role: 'riderCash', control: 'rider',
    note: 'Money collected in the field and not yet handed over. One subledger per rider.' },
  { code: '1135', name: 'Online Collections in Transit', group: '1100', role: 'onlineInTransit', control: 'rider',
    note: 'Online payments taken at delivery, not yet confirmed in the bank.' },
  { code: '1140', name: 'Accounts Receivable — Trade', group: '1100', role: 'arTrade', control: 'dealer',
    note: 'What shops owe. Must equal the outstanding credit the collections module reports.' },
  { code: '1150', name: 'Inventory — Sellable', group: '1100', role: 'inventorySellable', control: 'warehouse' },
  { code: '1155', name: 'Inventory — Damaged', group: '1100',
    note: 'Unused unless damage is carried as an asset until scrapped rather than expensed on approval.' },
  { code: '1160', name: 'Inventory — In Transit', group: '1100', role: 'inventoryInTransit', control: 'warehouse' },
  // Stock that has left the warehouse on an order but has not reached the shop yet.
  //
  // Required because this platform deducts stock at ORDER CREATE, not at delivery. Without a
  // holding account the ledger would still show that stock on the shelf until the rider
  // delivered it, and the nightly inventory check would report drift for every open order.
  { code: '1165', name: 'Inventory — Out for Delivery', group: '1100', role: 'inventoryOutForDelivery', control: 'warehouse' },
  { code: '1170', name: 'Input Tax Receivable', group: '1100', role: 'inputTax' },
  { code: '1180', name: 'Advances to Staff', group: '1100', role: 'staffAdvances', control: 'employee' },

  // ---- Fixed assets -------------------------------------------------------
  { code: '1210', name: 'Vehicles', group: '1200' },
  { code: '1220', name: 'Furniture & Equipment', group: '1200' },
  { code: '1290', name: 'Accumulated Depreciation', group: '1200',
    note: 'Contra asset. Depreciation is posted by manual journal until an asset register exists.' },

  // ---- Suspense -----------------------------------------------------------
  { code: '9190', name: 'Suspense', group: '9000', role: 'suspense',
    note: 'Nothing should post here. A non-zero balance is a defect, not a balancing figure.' },

  // ---- Current liabilities ------------------------------------------------
  // Broken down by supplier, which it could not be until the supplier master existed — a control
  // account refuses any posting that cannot name its subledger, so marking it control before
  // then would have blocked goods receipts from posting at all.
  //
  // Nothing posts here except a supplier bill or a payment, both of which carry a vendor. Goods
  // receipts never did and still do not: they credit GRNI instead.
  { code: '2110', name: 'Accounts Payable — Trade', group: '2100', role: 'apTrade', control: 'vendor' },
  // GRNI is a clearing account: it fills as stock arrives and drains as bills are matched. The
  // balance left on it at any moment is stock that has been received and not yet invoiced, which
  // is why the health check proves it against receipts-minus-bills rather than against receipts.
  { code: '2115', name: 'Goods Received Not Invoiced', group: '2100', role: 'grni',
    note: 'Stock received against no supplier bill yet. An ageing balance here is a missing invoice.' },
  { code: '2120', name: 'Output Tax Payable', group: '2100', role: 'outputTax' },
  { code: '2125', name: 'Withholding Tax Payable', group: '2100', role: 'taxWithheldPayable',
    note: 'Tax deducted from suppliers when they are paid, held until it is remitted. Not the '
      + "business's own tax and never netted against input tax." },
  { code: '2130', name: 'Salaries & Wages Payable', group: '2100', role: 'salaryPayable' },
  { code: '2140', name: 'Accrued Expenses', group: '2100' },
  { code: '2210', name: 'Loans Payable', group: '2200' },

  // ---- Equity -------------------------------------------------------------
  { code: '3110', name: "Owner's Capital", group: '3000' },
  { code: '3120', name: 'Drawings', group: '3000' },
  { code: '3130', name: 'Retained Earnings', group: '3000', role: 'retainedEarnings' },
  { code: '3900', name: 'Opening Balance Equity', group: '3000', role: 'openingEquity',
    note: 'Migration only. MUST read zero once the books are open — that is the check that proves it.' },

  // ---- Income -------------------------------------------------------------
  { code: '4110', name: 'Sales — Goods', group: '4000', role: 'salesGoods' },
  { code: '4120', name: 'Sales Returns', group: '4000', role: 'salesReturns', note: 'Contra income.' },
  { code: '4130', name: 'Sales Discounts', group: '4000', role: 'salesDiscounts',
    note: 'Contra income. Recovers a figure the product currently records and then discards.' },
  { code: '4210', name: 'Freight & Service Income', group: '4000' },
  { code: '4220', name: 'Staff Fines Recovered', group: '4000', role: 'staffFines',
    note: 'Late-start fines taken off pay. Posted only when a payroll run recovers one.' },
  { code: '4900', name: 'Other Income', group: '4000' },

  // ---- Cost of sales ------------------------------------------------------
  { code: '5110', name: 'Cost of Goods Sold', group: '5000', role: 'cogs' },
  { code: '5120', name: 'Inventory Write-off — Damage', group: '5000', role: 'damageWriteOff' },
  { code: '5130', name: 'Transfer Shrinkage', group: '5000', role: 'transferShrinkage' },
  { code: '5140', name: 'Inventory Gain/Loss on Count', group: '5000', role: 'countAdjustment' },

  // ---- Operating expenses -------------------------------------------------
  { code: '6110', name: 'Salaries & Wages', group: '6000', role: 'salaryExpense' },
  { code: '6115', name: 'Staff Allowances & Bonus', group: '6000', role: 'staffAllowances' },
  { code: '6120', name: 'Fuel & Vehicle Running', group: '6000' },
  { code: '6125', name: 'Vehicle Repairs & Maintenance', group: '6000' },
  { code: '6130', name: 'Rent', group: '6000' },
  { code: '6140', name: 'Utilities', group: '6000' },
  { code: '6150', name: 'Warehouse & Handling', group: '6000' },
  { code: '6155', name: 'Freight Outward', group: '6000' },
  { code: '6160', name: 'Bad Debt Written Off', group: '6000', role: 'badDebt',
    note: 'The only way to clear credit from a shop that has closed. Nothing else can reduce it.' },
  { code: '6170', name: 'Bank Charges', group: '6000' },
  { code: '6180', name: 'Communication & Internet', group: '6000' },
  { code: '6190', name: 'Depreciation', group: '6000' },
  { code: '6900', name: 'Other Operating Expenses', group: '6000' },
  // Sits in the 9xxx suspense block but is a real expense account, which is why the block check
  // in finance.rules.ts admits 9xxx for every type.
  { code: '9110', name: 'Cash Difference — Short & Over', group: '6000', role: 'cashDifference',
    note: 'Rider settlement variances. Never written off automatically — an admin clears it deliberately.' },
];

export interface ChartSeedResult {
  groupsCreated: string[];
  groupsSkipped: string[];
  ledgersCreated: string[];
  ledgersSkipped: string[];
  rolesMapped: number;
  settingsCreated: boolean;
}

export async function seedFinanceChart(): Promise<ChartSeedResult> {
  const result: ChartSeedResult = {
    groupsCreated: [],
    groupsSkipped: [],
    ledgersCreated: [],
    ledgersSkipped: [],
    rolesMapped: 0,
    settingsCreated: false,
  };

  // ---- Groups, parents before children -----------------------------------
  const groupIdByCode = new Map<string, Types.ObjectId>();
  const depthByCode = new Map<string, number>();

  // Roots first, then one pass per depth. The seed list is already ordered, but relying on that
  // would make adding a group in the wrong place a silent parent-not-found.
  const pending = [...GROUPS];
  let guard = 0;
  while (pending.length > 0) {
    if (guard++ > GROUPS.length + 5) {
      throw new Error('finance-chart.seed: a group names a parent that is not in the seed list');
    }
    for (let i = pending.length - 1; i >= 0; i -= 1) {
      const g = pending[i];
      if (g.parent && !groupIdByCode.has(g.parent)) continue;

      const depth = g.parent ? (depthByCode.get(g.parent) ?? 1) + 1 : 1;
      const existing = await AccountGroupModel.findOne({ code: g.code }).exec();

      if (existing) {
        groupIdByCode.set(g.code, existing._id);
        depthByCode.set(g.code, existing.depth);
        result.groupsSkipped.push(g.code);
      } else {
        const created = await AccountGroupModel.create({
          code: g.code,
          name: g.name,
          accountType: g.accountType,
          parentGroupId: g.parent ? groupIdByCode.get(g.parent)! : null,
          depth,
          sortOrder: g.sortOrder,
          isSystem: true,
          isActive: true,
        });
        groupIdByCode.set(g.code, created._id);
        depthByCode.set(g.code, depth);
        result.groupsCreated.push(g.code);
      }
      pending.splice(i, 1);
    }
  }

  // ---- Ledgers ------------------------------------------------------------
  const ledgerIdByCode = new Map<string, Types.ObjectId>();

  for (const l of LEDGERS) {
    const groupId = groupIdByCode.get(l.group);
    if (!groupId) {
      throw new Error(`finance-chart.seed: ledger ${l.code} names unknown group ${l.group}`);
    }

    const existing = await LedgerModel.findOne({ code: l.code }).exec();
    if (existing) {
      ledgerIdByCode.set(l.code, existing._id);
      result.ledgersSkipped.push(l.code);
      continue;
    }

    const created = await LedgerModel.create({
      code: l.code,
      name: l.name,
      groupId,
      description: l.note,
      openingBalance: { amount: 0, asOf: null },
      cachedBalance: 0,
      cachedDebitTotal: 0,
      cachedCreditTotal: 0,
      isControl: Boolean(l.control),
      subledgerType: l.control ?? null,
      isCashEquivalent: Boolean(l.cash),
      // Only the accounts the engine resolves by role are protected. The rest are ordinary
      // suggestions an accountant may delete outright before anything has posted.
      isSystem: Boolean(l.role),
      isActive: true,
    });
    ledgerIdByCode.set(l.code, created._id);
    result.ledgersCreated.push(l.code);
  }

  // ---- Settings and the ledger map ---------------------------------------
  let settings = await FinanceSettingsModel.findOne({ key: 'singleton' }).exec();
  if (!settings) {
    settings = new FinanceSettingsModel({ key: 'singleton' });
    result.settingsCreated = true;
  }

  // Repaired on every run, unlike the chart itself: a role pointing at a ledger that no longer
  // exists is the one state that stops the module booting, and it must be self-healing.
  for (const l of LEDGERS) {
    if (!l.role) continue;
    const id = ledgerIdByCode.get(l.code);
    if (!id) continue;
    settings.ledgerMap.set(l.role, id);
    result.rolesMapped += 1;
  }

  await settings.save();

  const unmapped = LEDGER_ROLE_KEYS.filter((k) => !settings!.ledgerMap.get(k));
  if (unmapped.length > 0) {
    throw new Error(
      `finance-chart.seed: no ledger seeded for engine role(s): ${unmapped.join(', ')}. `
        + 'Every key in LEDGER_ROLE_KEYS needs an account carrying it.',
    );
  }

  return result;
}

export interface RoleLedgerRepair {
  /** Roles whose account did not exist at all and was created now. */
  created: string[];
  /** Roles whose account was already there under the seeded code, and is now mapped. */
  adopted: string[];
  /** Roles still without an account — reported so the warning names them. */
  unresolved: string[];
}

/**
 * Give every engine role an account, on a database whose chart already exists.
 *
 * `seedFinanceChart` only runs on an empty chart, deliberately: it matches by CODE, and an
 * accountant is allowed to re-code a role's account, so running it again on a live chart would
 * create a duplicate and repoint the role at an empty copy, stranding the history on the old one.
 *
 * That leaves one gap. A role added to `LEDGER_ROLE_KEYS` by a later release has no account on
 * any database installed before it, and the first posting that needs it fails in production —
 * which is exactly what `staffFines` would have done to every payroll run recovering a fine.
 *
 * So this repairs ONLY what is genuinely missing:
 *  - a role already mapped to a ledger that still exists is left completely alone, whatever it
 *    has since been renamed or re-coded to;
 *  - an unmapped role whose seeded code already exists adopts that account rather than creating
 *    a second one under a suffixed code;
 *  - otherwise the account is created from the seed list.
 *
 * A role whose group is missing is reported rather than invented: groups carry the account type
 * every statement is built from, and guessing one produces a Balance Sheet that does not balance.
 */
export async function ensureRoleLedgers(): Promise<RoleLedgerRepair> {
  const repair: RoleLedgerRepair = { created: [], adopted: [], unresolved: [] };

  let settings = await FinanceSettingsModel.findOne({ key: 'singleton' }).exec();
  if (!settings) settings = new FinanceSettingsModel({ key: 'singleton' });

  let changed = false;

  for (const l of LEDGERS) {
    if (!l.role) continue;

    const mappedId = settings.ledgerMap.get(l.role);
    if (mappedId) {
      const stillThere = await LedgerModel.exists({ _id: mappedId });
      // Mapped and present: the accountant's own naming and coding stands.
      if (stillThere) continue;
    }

    const existing = await LedgerModel.findOne({ code: l.code }).select('_id').lean().exec();
    if (existing) {
      settings.ledgerMap.set(l.role, existing._id);
      repair.adopted.push(l.role);
      changed = true;
      continue;
    }

    const group = await AccountGroupModel.findOne({ code: l.group }).select('_id').lean().exec();
    if (!group) {
      repair.unresolved.push(l.role);
      continue;
    }

    const created = await LedgerModel.create({
      code: l.code,
      name: l.name,
      groupId: group._id,
      description: l.note,
      openingBalance: { amount: 0, asOf: null },
      cachedBalance: 0,
      cachedDebitTotal: 0,
      cachedCreditTotal: 0,
      isControl: Boolean(l.control),
      subledgerType: l.control ?? null,
      isCashEquivalent: Boolean(l.cash),
      isSystem: true,
      isActive: true,
    });
    settings.ledgerMap.set(l.role, created._id);
    repair.created.push(l.role);
    changed = true;
  }

  if (changed) await settings.save();
  return repair;
}
