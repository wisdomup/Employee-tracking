import Joi from 'joi';
import { SUBLEDGER_TYPES } from '../finance.rules';

/**
 * A trail is addressed by a tagged union, so the query is validated per kind rather than as a bag
 * of optional fields. A `kind=party` with no `partyId` is refused here rather than reaching the
 * service and coming back as an empty trail, which would read as "nothing was posted".
 *
 * Validated in the controller rather than by `validate()`, which reads `req.body` only — every
 * report in this module is a GET and does the same.
 */
const objectId = Joi.string().hex().length(24);
/**
 * A day, or a month for the statement figures.
 *
 * One pattern rather than two fields: the same `from`/`to` pair addresses an account trail (days)
 * and a statement figure (months), and splitting them would mean the client had to know which kind
 * of figure it was linking to before it could name the window.
 */
const day = Joi.string()
  .pattern(/^\d{4}-\d{2}(-\d{2})?$/)
  .messages({ 'string.pattern.base': 'Dates are YYYY-MM-DD, or YYYY-MM for a statement figure.' });

export const trailQuerySchema = Joi.object({
  kind: Joi.string()
    .valid('ledger', 'group', 'party', 'entry', 'source', 'derived')
    .required(),

  /*
   * A derived figure names the report it appears on and the figure within it. Months, not days:
   * these are statement figures and a statement works in whole months, so `from`/`to` are relaxed
   * to accept either here and the resolver converts.
   */
  report: Joi.string()
    .valid('profit-and-loss', 'balance-sheet', 'cash-flow', 'tax-summary')
    .when('kind', { is: 'derived', then: Joi.required() }),
  figure: Joi.string()
    .max(60)
    .when('kind', { is: 'derived', then: Joi.required() }),

  ledgerId: objectId.when('kind', {
    is: 'ledger',
    then: Joi.required(),
    otherwise: Joi.optional(),
  }),
  groupId: objectId.when('kind', { is: 'group', then: Joi.required() }),
  entryId: objectId.when('kind', { is: 'entry', then: Joi.required() }),
  sourceId: objectId.when('kind', { is: 'source', then: Joi.required() }),

  partyType: Joi.string()
    .valid(...SUBLEDGER_TYPES)
    .when('kind', { is: 'party', then: Joi.required() }),
  partyId: objectId.when('kind', { is: 'party', then: Joi.required() }),

  from: day.optional(),
  to: day.optional(),
})
  // `ledgerId` is meaningful on a party trail too — it narrows the party to one control account —
  // so it is allowed there rather than stripped.
  .unknown(false);
