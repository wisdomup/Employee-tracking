import Joi from 'joi';

export const createTaskSchema = Joi.object({
  taskName: Joi.string().required(),
  description: Joi.string().optional(),
  referenceImage: Joi.string().optional(),
  employeeNotes: Joi.string().optional(),
  quantity: Joi.number().optional(),
  dealerId: Joi.string().optional(),
  routeId: Joi.string().optional(),
});

export const updateTaskSchema = Joi.object({
  taskName: Joi.string().required(),
  description: Joi.string().optional(),
  referenceImage: Joi.string().optional(),
  employeeNotes: Joi.string().optional(),
  quantity: Joi.number().optional(),
  dealerId: Joi.string().optional().allow(null, ''),
  routeId: Joi.string().optional().allow(null, ''),
  status: Joi.string().valid('pending', 'in_progress', 'completed').optional(),
});

export const assignTaskSchema = Joi.object({
  assignedTo: Joi.string().required(),
});

export const startTaskSchema = Joi.object({
  latitude: Joi.number().required(),
  longitude: Joi.number().required(),
});

export const completeTaskSchema = Joi.object({
  latitude: Joi.number().required(),
  longitude: Joi.number().required(),
  completionImages: Joi.array()
    .items(
      Joi.object({
        type: Joi.string().valid('shop', 'selfie').required(),
        url: Joi.string().required(),
      }),
    )
    .min(1)
    .required(),
});
