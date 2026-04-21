import Joi from 'joi';

export const checkInSchema = Joi.object({
  latitude: Joi.number().required(),
  longitude: Joi.number().required(),
  note: Joi.string().optional().allow(''),
  /** Client's local calendar date in YYYY-MM-DD format — used instead of server UTC date. */
  localDate: Joi.string()
    .pattern(/^\d{4}-\d{2}-\d{2}$/)
    .optional(),
});

export const checkOutSchema = Joi.object({
  latitude: Joi.number().required(),
  longitude: Joi.number().required(),
  note: Joi.string().optional().allow(''),
  /** Client's local calendar date in YYYY-MM-DD format — used instead of server UTC date. */
  localDate: Joi.string()
    .pattern(/^\d{4}-\d{2}-\d{2}$/)
    .optional(),
});

export const adminCreateSchema = Joi.object({
  employeeId: Joi.string().required(),
  date: Joi.date().required(),
  checkInTime: Joi.date().required(),
  checkInLatitude: Joi.number().required(),
  checkInLongitude: Joi.number().required(),
  checkOutTime: Joi.date().optional(),
  checkOutLatitude: Joi.number().optional(),
  checkOutLongitude: Joi.number().optional(),
  note: Joi.string().optional().allow(''),
});

/** Admin full update — at least one field required. */
export const updateAttendanceSchema = Joi.object({
  employeeId: Joi.string().optional(),
  date: Joi.date().optional(),
  checkInTime: Joi.date().optional(),
  checkInLatitude: Joi.number().optional(),
  checkInLongitude: Joi.number().optional(),
  checkOutTime: Joi.date().optional().allow(null),
  checkOutLatitude: Joi.number().optional().allow(null),
  checkOutLongitude: Joi.number().optional().allow(null),
  note: Joi.string().optional().allow('', null),
}).or(
  'employeeId',
  'date',
  'checkInTime',
  'checkInLatitude',
  'checkInLongitude',
  'checkOutTime',
  'checkOutLatitude',
  'checkOutLongitude',
  'note',
);

/** Non-admin update — only the note field. */
export const updateNoteSchema = Joi.object({
  note: Joi.string().required().allow(''),
});
