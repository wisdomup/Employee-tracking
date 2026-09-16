import { Types } from 'mongoose';
import { TaxRateModel, ITaxRate, TaxRateKind } from '../../models/tax-rate.model';
import { SupplierPaymentModel } from '../../models/supplier-payment.model';
import { badRequest, conflict, notFound } from '../../utils/app-error';
import { logActivityAsync } from '../activity-logs/activity-logs.service';
import { round2 } from './finance.rules';

/**
 * The tax rates this business is registered for.
 *
 * A small master, deliberately. It fills a field in on a payment so the same figure is not worked
 * out by hand every time — and so "which rate did we apply to Acme in March" has an answer. It is
 * not an engine: nothing here recalculates a document that has already been posted, because a
 * rate changing at the next budget must not restate a payment that was made under the old one.
 */

export interface TaxRateView {
  id: string;
  name: string;
  kind: TaxRateKind;
  percentage: number;
  notes?: string;
  isActive: boolean;
  /** How many posted documents used it. Above zero it can be retired but never deleted. */
  usageCount: number;
}

function toView(rate: ITaxRate, usageCount: number): TaxRateView {
  return {
    id: String(rate._id),
    name: rate.name,
    kind: rate.kind,
    percentage: rate.percentage,
    notes: rate.notes,
    isActive: rate.isActive,
    usageCount,
  };
}

async function usageByRate(ids: Types.ObjectId[]): Promise<Map<string, number>> {
  if (ids.length === 0) return new Map();

  const rows = await SupplierPaymentModel.aggregate<{ _id: Types.ObjectId; count: number }>([
    { $match: { taxRateId: { $in: ids }, status: { $ne: 'draft' } } },
    { $group: { _id: '$taxRateId', count: { $sum: 1 } } },
  ]).exec();

  return new Map(rows.map((r) => [String(r._id), r.count]));
}

export async function listTaxRates(
  filters: { kind?: TaxRateKind; status?: 'active' | 'inactive' | 'all' } = {},
): Promise<TaxRateView[]> {
  const query: Record<string, unknown> = {};
  if (filters.kind) query.kind = filters.kind;
  if (!filters.status || filters.status === 'active') query.isActive = true;
  else if (filters.status === 'inactive') query.isActive = false;

  const rates = await TaxRateModel.find(query).sort({ kind: 1, name: 1 }).exec();
  const usage = await usageByRate(rates.map((r) => r._id));

  return rates.map((rate) => toView(rate, usage.get(String(rate._id)) ?? 0));
}

export interface TaxRateInput {
  name: string;
  kind: TaxRateKind;
  percentage: number;
  notes?: string;
}

export async function createTaxRate(
  input: TaxRateInput,
  actorId?: string,
): Promise<TaxRateView> {
  const existing = await TaxRateModel.findOne({ kind: input.kind, name: input.name.trim() })
    .collation({ locale: 'en', strength: 2 })
    .select('_id')
    .lean()
    .exec();

  if (existing) {
    throw conflict(
      `A ${input.kind === 'sales' ? 'sales' : 'withholding'} rate called "${input.name.trim()}" `
        + 'already exists. Two with one name is somebody about to pick the wrong one.',
    );
  }

  const rate = await TaxRateModel.create({
    name: input.name.trim(),
    kind: input.kind,
    percentage: round2(input.percentage),
    notes: input.notes?.trim() || undefined,
    createdBy: actorId ? new Types.ObjectId(actorId) : undefined,
  });

  logActivityAsync({
    employeeId: actorId,
    module: 'tax_rate',
    entityId: String(rate._id),
    action: 'created',
    meta: { name: rate.name, kind: rate.kind, percentage: rate.percentage },
  });

  return toView(rate, 0);
}

export async function updateTaxRate(
  id: string,
  input: Partial<TaxRateInput> & { isActive?: boolean },
  actorId?: string,
): Promise<TaxRateView> {
  if (!Types.ObjectId.isValid(id)) throw notFound('Tax rate not found');

  const rate = await TaxRateModel.findById(id).exec();
  if (!rate) throw notFound('Tax rate not found');

  /*
   * The KIND can never change.
   *
   * Flipping a withholding rate into a sales rate would leave every payment that used it citing
   * a rate that no longer describes what was deducted — and the next person reading that payment
   * would have no way of knowing.
   */
  if (input.kind && input.kind !== rate.kind) {
    throw badRequest(
      'A rate cannot change between sales and withholding. Retire this one and add the other — '
        + 'the documents that used it have to keep meaning what they meant.',
    );
  }

  if (input.name !== undefined) {
    const clash = await TaxRateModel.findOne({
      _id: { $ne: rate._id },
      kind: rate.kind,
      name: input.name.trim(),
    })
      .collation({ locale: 'en', strength: 2 })
      .select('_id')
      .lean()
      .exec();
    if (clash) throw conflict(`Another rate of this kind is already called "${input.name.trim()}".`);
    rate.name = input.name.trim();
  }

  // Editing the percentage changes what future documents are filled in with and nothing else.
  // Everything already posted keeps the figure it was posted with.
  if (input.percentage !== undefined) rate.percentage = round2(input.percentage);
  if (input.notes !== undefined) rate.notes = input.notes.trim() || undefined;
  if (input.isActive !== undefined) rate.isActive = input.isActive;
  rate.updatedBy = actorId ? new Types.ObjectId(actorId) : undefined;
  await rate.save();

  logActivityAsync({
    employeeId: actorId,
    module: 'tax_rate',
    entityId: id,
    action: 'updated',
    meta: { name: rate.name, percentage: rate.percentage, isActive: rate.isActive },
  });

  const usage = await usageByRate([rate._id]);
  return toView(rate, usage.get(id) ?? 0);
}

export async function deleteTaxRate(id: string, actorId?: string): Promise<{ message: string }> {
  if (!Types.ObjectId.isValid(id)) throw notFound('Tax rate not found');

  const rate = await TaxRateModel.findById(id).lean().exec();
  if (!rate) throw notFound('Tax rate not found');

  const usage = await usageByRate([rate._id]);
  const used = usage.get(id) ?? 0;

  if (used > 0) {
    throw badRequest(
      `${used} payment${used === 1 ? '' : 's'} cite this rate, so deleting it would leave them `
        + 'saying a deduction was made at a rate that no longer exists. Retire it instead — it '
        + 'then stops being offered without changing anything already recorded.',
    );
  }

  await TaxRateModel.deleteOne({ _id: rate._id }).exec();

  logActivityAsync({
    employeeId: actorId,
    module: 'tax_rate',
    entityId: id,
    action: 'deleted',
    meta: { name: rate.name, kind: rate.kind },
  });

  return { message: 'Tax rate deleted' };
}

/**
 * Resolve a rate for use on a document, and work out what it comes to.
 *
 * Refuses a rate of the wrong kind by name rather than by silently returning nothing: offering a
 * sales rate where a withholding rate belongs would deduct the wrong figure from a supplier's
 * payment, and nothing downstream would know it was the wrong sort of tax.
 */
export async function amountAtRate(
  rateId: string,
  base: number,
  kind: TaxRateKind,
): Promise<{ rate: ITaxRate; amount: number }> {
  if (!Types.ObjectId.isValid(rateId)) throw badRequest('That is not a tax rate.');

  const rate = await TaxRateModel.findById(rateId).exec();
  if (!rate) throw notFound('Tax rate not found');

  if (rate.kind !== kind) {
    throw badRequest(
      `"${rate.name}" is a ${rate.kind === 'sales' ? 'sales' : 'withholding'} tax rate and cannot `
        + `be used ${kind === 'withholding' ? 'to deduct from a supplier payment' : 'on a sale'}.`,
    );
  }

  if (!rate.isActive) {
    throw badRequest(`"${rate.name}" has been retired and cannot be applied to a new document.`);
  }

  return { rate, amount: round2((base * rate.percentage) / 100) };
}
