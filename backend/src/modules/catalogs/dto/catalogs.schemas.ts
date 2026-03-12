import Joi from 'joi';

export const updateCatalogSchema = Joi.object({
  name: Joi.string().required(),
});
