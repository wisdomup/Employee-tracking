import { Types } from 'mongoose';
import { AccountGroupModel, IAccountGroup } from '../../models/account-group.model';
import { LedgerModel, ILedger } from '../../models/ledger.model';
import { FinanceSettingsModel, LEDGER_ROLE_KEYS } from '../../models/finance-settings.model';
import { badRequest, conflict, notFound } from '../../utils/app-error';
import { logActivityAsync } from '../activity-logs/activity-logs.service';
import {
  AccountType,
  MONEY_EPSILON,
  assertCodeInBlock,
  assertControlConfigIsCoherent,
  assertDepthWithinLimit,
  naturalBalance,
  nextCodeInBlock,
  normalBalanceFor,
} from './finance.rules';

/**
 * Chart of accounts: account groups and ledgers.
 *
 * This service owns the MASTER records only. It never touches `cachedBalance`,
 * `cachedDebitTotal` or `cachedCreditTotal` — those belong to the posting service, added in the
 * next step, and a second writer would make the nightly reconciliation meaningless.
 */

// ---------------------------------------------------------------------------
// Reads
// ---------------------------------------------------------------------------

/**
 * Structural shapes, not the Mongoose Document interfaces.
 *
 * `.lean()` returns `FlattenMaps<T>`, which is not assignable to `IAccountGroup` — the driver
 * internals hanging off a Document do not survive the flattening. Casting through `unknown` to
 * silence that would throw away the type checking on the fields this file actually reads. These
 * describe exactly those fields, and both a hydrated document and a lean result satisfy them.
 */
interface GroupData {
  _id: Types.ObjectId;
  code: string;
  name: string;
  accountType: AccountType;
  depth: number;
  sortOrder: number;
  isSystem: boolean;
  isActive: boolean;
  parentGroupId?: Types.ObjectId | null;
}

interface LedgerData {
  _id: Types.ObjectId;
  code: string;
  name: string;
  description?: string;
  groupId: Types.ObjectId;
  openingBalance: { amount: number; asOf: Date | null };
  cachedBalance: number;
  cachedDebitTotal: number;
  cachedCreditTotal: number;
  isControl: boolean;
  subledgerType?: string | null;
  isCashEquivalent: boolean;
  isSystem: boolean;
  isActive: boolean;
  lastReconciledAt?: Date;
  lastReconcileDrift?: number;
}

export interface LedgerView {
  id: string;
  code: string;
  name: string;
  description?: string;
  groupId: string;
  groupName: string;
  groupCode: string;
  accountType: AccountType;
  /** Derived, never stored. See finance.rules.ts. */
  normalBalance: 'debit' | 'credit';
  openingBalance: { amount: number; asOf: Date | null };
  cachedBalance: number;
  /** Balance in the account's own direction — positive means "normal". */
  naturalBalance: number;
  isControl: boolean;
  subledgerType: string | null;
  isCashEquivalent: boolean;
  isSystem: boolean;
  isActive: boolean;
  lastReconciledAt?: Date;
  lastReconcileDrift?: number;
}

function toLedgerView(ledger: LedgerData, group: GroupData): LedgerView {
  return {
    id: String(ledger._id),
    code: ledger.code,
    name: ledger.name,
    description: ledger.description,
    groupId: String(group._id),
    groupName: group.name,
    groupCode: group.code,
    accountType: group.accountType,
    normalBalance: normalBalanceFor(group.accountType),
    openingBalance: ledger.openingBalance,
    cachedBalance: ledger.cachedBalance,
    naturalBalance: naturalBalance(
      group.accountType,
      ledger.cachedDebitTotal,
      ledger.cachedCreditTotal,
    ),
    isControl: ledger.isControl,
    subledgerType: ledger.subledgerType ?? null,
    isCashEquivalent: ledger.isCashEquivalent,
    isSystem: ledger.isSystem,
    isActive: ledger.isActive,
    lastReconciledAt: ledger.lastReconciledAt,
    lastReconcileDrift: ledger.lastReconcileDrift,
  };
}

/** Every group, ordered for display: siblings by `sortOrder`, then by code. */
export async function listGroups(): Promise<GroupData[]> {
  return AccountGroupModel.find().sort({ depth: 1, sortOrder: 1, code: 1 }).lean().exec();
}

export interface LedgerFilters {
  groupId?: string;
  accountType?: AccountType;
  isControl?: boolean;
  isCashEquivalent?: boolean;
  /** Omitted means active only. Pass `all` to include retired accounts. */
  status?: 'active' | 'inactive' | 'all';
  search?: string;
}

export async function listLedgers(filters: LedgerFilters = {}): Promise<LedgerView[]> {
  const groups = await AccountGroupModel.find().lean().exec();
  const groupById = new Map(groups.map((g) => [String(g._id), g as GroupData]));

  const query: Record<string, unknown> = {};

  if (filters.groupId) query.groupId = new Types.ObjectId(filters.groupId);
  if (filters.isControl !== undefined) query.isControl = filters.isControl;
  if (filters.isCashEquivalent !== undefined) query.isCashEquivalent = filters.isCashEquivalent;
  if (filters.status === 'inactive') query.isActive = false;
  else if (filters.status !== 'all') query.isActive = true;

  if (filters.search) {
    // Escaped: a code search for "1.10" must not become a wildcard.
    const safe = filters.search.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    query.$or = [{ name: new RegExp(safe, 'i') }, { code: new RegExp(`^${safe}`) }];
  }

  if (filters.accountType) {
    const ids = groups
      .filter((g) => g.accountType === filters.accountType)
      .map((g) => g._id);
    query.groupId = query.groupId ?? { $in: ids };
  }

  const ledgers = await LedgerModel.find(query).sort({ code: 1 }).lean().exec();

  return ledgers
    .map((l) => {
      const group = groupById.get(String(l.groupId));
      return group ? toLedgerView(l as LedgerData, group) : null;
    })
    .filter((v): v is LedgerView => v !== null);
}

export async function getLedger(id: string): Promise<LedgerView> {
  const ledger = await LedgerModel.findById(id).lean().exec();
  if (!ledger) throw notFound('Ledger not found');
  const group = await AccountGroupModel.findById(ledger.groupId).lean().exec();
  if (!group) throw notFound('This ledger points at a group that no longer exists');
  return toLedgerView(ledger as LedgerData, group as GroupData);
}

/** The next free code in a type's block, for pre-filling the create form. */
export async function suggestLedgerCode(accountType: AccountType): Promise<string> {
  const taken = await LedgerModel.find().select('code').lean().exec();
  const groupCodes = await AccountGroupModel.find().select('code').lean().exec();
  return nextCodeInBlock(accountType, [
    ...taken.map((l) => l.code),
    ...groupCodes.map((g) => g.code),
  ]);
}

// ---------------------------------------------------------------------------
// Groups
// ---------------------------------------------------------------------------

export interface GroupInput {
  name: string;
  code: string;
  accountType?: AccountType;
  parentGroupId?: string | null;
  sortOrder?: number;
}

export async function createGroup(input: GroupInput, actorId?: string): Promise<IAccountGroup> {
  let depth = 1;
  let accountType = input.accountType;
  let parentId: Types.ObjectId | null = null;

  if (input.parentGroupId) {
    const parent = await AccountGroupModel.findById(input.parentGroupId).lean().exec();
    if (!parent) throw notFound('Parent group not found');

    parentId = parent._id;
    depth = parent.depth + 1;
    assertDepthWithinLimit(depth);

    // Type is set at the root and inherited. A child that disagreed with its parent would sit
    // on no financial statement at all, and nothing downstream could report that usefully.
    if (accountType && accountType !== parent.accountType) {
      throw badRequest(
        `A group inside "${parent.name}" must also be ${parent.accountType}. `
          + 'Move it to a different parent, or create it at the top level.',
      );
    }
    accountType = parent.accountType;
  }

  if (!accountType) {
    throw badRequest('Choose what kind of account this group holds.');
  }

  assertCodeInBlock(input.code, accountType);
  await assertCodeIsFree(input.code);

  const group = await AccountGroupModel.create({
    name: input.name,
    code: input.code,
    accountType,
    parentGroupId: parentId,
    depth,
    sortOrder: input.sortOrder ?? 0,
    isSystem: false,
    isActive: true,
    createdBy: actorId ? new Types.ObjectId(actorId) : undefined,
  });

  logActivityAsync({
    employeeId: actorId,
    module: 'ledger',
    entityId: String(group._id),
    action: 'created',
    meta: { kind: 'group', code: group.code, name: group.name, accountType },
  });

  return group;
}

export async function updateGroup(
  id: string,
  input: Partial<GroupInput> & { isActive?: boolean },
  actorId?: string,
): Promise<IAccountGroup> {
  const group = await AccountGroupModel.findById(id).exec();
  if (!group) throw notFound('Account group not found');

  // A system group may be renamed and re-coded but never re-typed: the engine's accounts hang
  // off these, and changing a type underneath them moves real balances between statements.
  if (group.isSystem && input.accountType && input.accountType !== group.accountType) {
    throw badRequest(
      `"${group.name}" is used by the accounting engine and cannot change from ${group.accountType}. `
        + 'Rename it instead, or create a new group.',
    );
  }

  if (input.accountType && input.accountType !== group.accountType) {
    const hasLedgers = await LedgerModel.exists({ groupId: group._id });
    if (hasLedgers) {
      throw badRequest(
        'This group already holds ledgers, so its type cannot change. '
          + 'Move the ledgers to another group first.',
      );
    }
    const hasChildren = await AccountGroupModel.exists({ parentGroupId: group._id });
    if (hasChildren) {
      throw badRequest('Change the type on the child groups first.');
    }
    group.accountType = input.accountType;
  }

  if (input.code && input.code !== group.code) {
    assertCodeInBlock(input.code, group.accountType);
    await assertCodeIsFree(input.code);
    group.code = input.code;
  }

  if (input.name !== undefined) group.name = input.name;
  if (input.sortOrder !== undefined) group.sortOrder = input.sortOrder;
  if (input.isActive !== undefined) group.isActive = input.isActive;
  group.updatedBy = actorId ? new Types.ObjectId(actorId) : undefined;

  await group.save();

  logActivityAsync({
    employeeId: actorId,
    module: 'ledger',
    entityId: String(group._id),
    action: 'updated',
    meta: { kind: 'group', code: group.code, name: group.name },
  });

  return group;
}

export async function deleteGroup(id: string, actorId?: string): Promise<{ message: string }> {
  const group = await AccountGroupModel.findById(id).exec();
  if (!group) throw notFound('Account group not found');

  if (group.isSystem) {
    throw badRequest(
      `"${group.name}" is part of the standard chart and cannot be deleted. Deactivate it instead.`,
    );
  }

  const childCount = await AccountGroupModel.countDocuments({ parentGroupId: group._id }).exec();
  if (childCount > 0) {
    throw conflict(`"${group.name}" still holds ${childCount} group(s). Empty it first.`);
  }

  const ledgerCount = await LedgerModel.countDocuments({ groupId: group._id }).exec();
  if (ledgerCount > 0) {
    throw conflict(`"${group.name}" still holds ${ledgerCount} ledger(s). Empty it first.`);
  }

  await group.deleteOne();

  logActivityAsync({
    employeeId: actorId,
    module: 'ledger',
    entityId: id,
    action: 'deleted',
    meta: { kind: 'group', code: group.code, name: group.name },
  });

  return { message: `Account group "${group.name}" deleted` };
}

// ---------------------------------------------------------------------------
// Ledgers
// ---------------------------------------------------------------------------

export interface LedgerInput {
  name: string;
  code?: string;
  groupId: string;
  description?: string;
  openingBalance?: { amount: number; asOf: string | Date | null };
  isControl?: boolean;
  subledgerType?: string | null;
  isCashEquivalent?: boolean;
}

export async function createLedger(input: LedgerInput, actorId?: string): Promise<LedgerView> {
  const group = await AccountGroupModel.findById(input.groupId).lean().exec();
  if (!group) throw notFound('Account group not found');
  if (!group.isActive) throw badRequest(`"${group.name}" is deactivated. Choose an active group.`);

  const code = input.code ?? (await suggestLedgerCode(group.accountType));
  assertCodeInBlock(code, group.accountType);
  await assertCodeIsFree(code);

  const isControl = Boolean(input.isControl);
  const subledgerType = input.subledgerType ?? null;
  assertControlConfigIsCoherent(isControl, subledgerType);

  const ledger = await LedgerModel.create({
    name: input.name,
    code,
    groupId: group._id,
    description: input.description,
    openingBalance: {
      amount: input.openingBalance?.amount ?? 0,
      asOf: input.openingBalance?.asOf ? new Date(input.openingBalance.asOf) : null,
    },
    // The opening balance is recorded on the master here so the chart can be prepared before
    // the engine exists. It does NOT post anything: the migration entry against Opening Balance
    // Equity is raised in the cutover step, once there is a posting service to raise it with.
    cachedBalance: 0,
    cachedDebitTotal: 0,
    cachedCreditTotal: 0,
    isControl,
    subledgerType,
    isCashEquivalent: Boolean(input.isCashEquivalent),
    isSystem: false,
    isActive: true,
    createdBy: actorId ? new Types.ObjectId(actorId) : undefined,
  });

  logActivityAsync({
    employeeId: actorId,
    module: 'ledger',
    entityId: String(ledger._id),
    action: 'created',
    meta: { code: ledger.code, name: ledger.name, accountType: group.accountType },
  });

  return toLedgerView(ledger, group as GroupData);
}

export async function updateLedger(
  id: string,
  input: Partial<LedgerInput> & { isActive?: boolean },
  actorId?: string,
): Promise<LedgerView> {
  const ledger = await LedgerModel.findById(id).exec();
  if (!ledger) throw notFound('Ledger not found');

  let group = await AccountGroupModel.findById(ledger.groupId).lean().exec();
  if (!group) throw notFound('This ledger points at a group that no longer exists');

  if (input.groupId && String(input.groupId) !== String(ledger.groupId)) {
    const target = await AccountGroupModel.findById(input.groupId).lean().exec();
    if (!target) throw notFound('Account group not found');

    // Moving between types re-signs every balance this account holds and moves it to a
    // different statement. Allowed only while the account is untouched.
    if (target.accountType !== group.accountType && hasMovement(ledger)) {
      throw badRequest(
        `"${ledger.name}" has already been posted to, so it cannot move from ${group.accountType} `
          + `to ${target.accountType}. Deactivate it and create the account you need.`,
      );
    }
    if (ledger.isSystem && target.accountType !== group.accountType) {
      throw badRequest(
        `"${ledger.name}" is used by the accounting engine and must stay a ${group.accountType} account.`,
      );
    }
    ledger.groupId = target._id;
    group = target;
  }

  if (input.code && input.code !== ledger.code) {
    assertCodeInBlock(input.code, group.accountType);
    await assertCodeIsFree(input.code);
    ledger.code = input.code;
  }

  if (input.isControl !== undefined || input.subledgerType !== undefined) {
    const isControl = input.isControl ?? ledger.isControl;
    const subledgerType = input.subledgerType !== undefined
      ? input.subledgerType
      : ledger.subledgerType ?? null;
    assertControlConfigIsCoherent(isControl, subledgerType);

    if (hasMovement(ledger) && isControl !== ledger.isControl) {
      throw badRequest(
        'This account has already been posted to, so it cannot become a control account '
          + 'or stop being one. Its existing entries carry no subledger.',
      );
    }
    ledger.isControl = isControl;
    ledger.subledgerType = (subledgerType as ILedger['subledgerType']) ?? null;
  }

  if (input.name !== undefined) ledger.name = input.name;
  if (input.description !== undefined) ledger.description = input.description;
  if (input.isCashEquivalent !== undefined) ledger.isCashEquivalent = input.isCashEquivalent;

  if (input.openingBalance !== undefined) {
    if (hasMovement(ledger)) {
      throw badRequest(
        'This account has already been posted to. Correct an opening balance with a journal '
          + 'entry, so the change is visible in the account history.',
      );
    }
    ledger.openingBalance = {
      amount: input.openingBalance.amount ?? 0,
      asOf: input.openingBalance.asOf ? new Date(input.openingBalance.asOf) : null,
    };
  }

  if (input.isActive !== undefined && input.isActive !== ledger.isActive) {
    if (!input.isActive && Math.abs(ledger.cachedBalance) >= MONEY_EPSILON) {
      throw badRequest(
        `"${ledger.name}" still holds a balance of ${ledger.cachedBalance}. `
          + 'Clear it to zero before deactivating, or the balance sheet loses it.',
      );
    }
    ledger.isActive = input.isActive;
  }

  ledger.updatedBy = actorId ? new Types.ObjectId(actorId) : undefined;
  await ledger.save();

  logActivityAsync({
    employeeId: actorId,
    module: 'ledger',
    entityId: String(ledger._id),
    action: input.isActive !== undefined ? 'status_changed' : 'updated',
    meta: { code: ledger.code, name: ledger.name, isActive: ledger.isActive },
  });

  return toLedgerView(ledger, group as GroupData);
}

export async function deleteLedger(id: string, actorId?: string): Promise<{ message: string }> {
  const ledger = await LedgerModel.findById(id).exec();
  if (!ledger) throw notFound('Ledger not found');

  if (ledger.isSystem) {
    throw badRequest(
      `"${ledger.name}" is used by the accounting engine and cannot be deleted. `
        + 'Rename it if the wording is wrong, or deactivate it if it is genuinely unused.',
    );
  }

  // Once the posting service lands, this also refuses on any existing journal line. Today the
  // cached totals are the only evidence of movement, and nothing can have moved them yet.
  if (hasMovement(ledger)) {
    throw conflict(
      `"${ledger.name}" has entries posted to it and cannot be deleted. Deactivate it instead — `
        + 'deleting it would remove those entries from every report that has already been read.',
    );
  }

  await ledger.deleteOne();

  logActivityAsync({
    employeeId: actorId,
    module: 'ledger',
    entityId: id,
    action: 'deleted',
    meta: { code: ledger.code, name: ledger.name },
  });

  return { message: `Ledger "${ledger.name}" deleted` };
}

// ---------------------------------------------------------------------------
// Settings
// ---------------------------------------------------------------------------

/**
 * A Mongoose `Map` comes back from `.lean()` as a plain object, not a Map, so `.get()` and
 * `.values()` are not there to call. Both shapes are normalised here rather than dropping
 * `.lean()` — hydrating a document only to read two fields off it is the wrong trade, and
 * remembering which call sites are lean is exactly the kind of detail that rots.
 */
function asRecord<T>(value: Map<string, T> | Record<string, T> | undefined): Record<string, T> {
  if (!value) return {};
  return value instanceof Map ? Object.fromEntries(value) : value;
}

export async function getSettings() {
  const settings = await FinanceSettingsModel.findOne({ key: 'singleton' }).lean().exec();
  if (!settings) {
    throw notFound(
      'Finance settings have not been created. Run the chart of accounts seed.',
    );
  }

  const ledgerMap = asRecord<Types.ObjectId>(settings.ledgerMap);
  const ledgerIds = Object.values(ledgerMap);
  const ledgers = await LedgerModel.find({ _id: { $in: ledgerIds } })
    .select('code name')
    .lean()
    .exec();
  const byId = new Map(ledgers.map((l) => [String(l._id), l]));

  const roles: Record<string, { ledgerId: string; code?: string; name?: string } | null> = {};
  for (const key of LEDGER_ROLE_KEYS) {
    const id = ledgerMap[key];
    const ledger = id ? byId.get(String(id)) : undefined;
    roles[key] = id
      ? { ledgerId: String(id), code: ledger?.code, name: ledger?.name }
      : null;
  }

  return {
    fiscalYearStartMonth: settings.fiscalYearStartMonth,
    baseCurrency: settings.baseCurrency,
    currencySymbol: settings.currencySymbol,
    agingBuckets: settings.agingBuckets,
    booksOpenedAt: settings.booksOpenedAt ?? null,
    cutoverDate: settings.cutoverDate ?? null,
    roles,
    // Posting is switched on one event at a time in a later step. Surfaced now so the settings
    // screen shows the full picture rather than growing a new section later.
    postingEnabled: asRecord<boolean>(settings.postingEnabled),
  };
}

/**
 * Boot check: every engine role points at a ledger that exists.
 *
 * A role pointing at a deleted account fails at the first posting, in production, hours after
 * the deploy that caused it. Checked at startup instead, where it is one line in the log and
 * nobody has posted anything yet.
 */
export async function verifyLedgerMap(): Promise<{ ok: boolean; problems: string[] }> {
  const settings = await FinanceSettingsModel.findOne({ key: 'singleton' }).lean().exec();
  if (!settings) return { ok: false, problems: ['Finance settings document is missing'] };

  const ledgerMap = asRecord<Types.ObjectId>(settings.ledgerMap);
  const problems: string[] = [];
  const ids = LEDGER_ROLE_KEYS.map((k) => ledgerMap[k]).filter(Boolean);
  const found = await LedgerModel.find({ _id: { $in: ids } }).select('_id isActive').lean().exec();
  const byId = new Map(found.map((l) => [String(l._id), l]));

  for (const key of LEDGER_ROLE_KEYS) {
    const id = ledgerMap[key];
    if (!id) {
      problems.push(`"${key}" is not mapped to any ledger`);
      continue;
    }
    const ledger = byId.get(String(id));
    if (!ledger) problems.push(`"${key}" points at a ledger that no longer exists`);
    else if (!ledger.isActive) problems.push(`"${key}" points at a deactivated ledger`);
  }

  return { ok: problems.length === 0, problems };
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** True once anything has been posted to this account. */
function hasMovement(ledger: { cachedDebitTotal: number; cachedCreditTotal: number }): boolean {
  return (
    Math.abs(ledger.cachedDebitTotal) >= MONEY_EPSILON
    || Math.abs(ledger.cachedCreditTotal) >= MONEY_EPSILON
  );
}

/**
 * Codes are unique across groups AND ledgers together.
 *
 * Two collections with separate unique indexes would happily allow a group and a ledger both
 * numbered 1100, and every report that prints a code would then be ambiguous to the one person
 * whose job is reading them.
 */
async function assertCodeIsFree(code: string): Promise<void> {
  const [group, ledger] = await Promise.all([
    AccountGroupModel.findOne({ code }).select('name').lean().exec(),
    LedgerModel.findOne({ code }).select('name').lean().exec(),
  ]);
  if (group) throw conflict(`Code ${code} is already used by the group "${group.name}".`);
  if (ledger) throw conflict(`Code ${code} is already used by the ledger "${ledger.name}".`);
}
