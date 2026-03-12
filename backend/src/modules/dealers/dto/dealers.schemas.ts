import Joi from 'joi';
import { DEALER_CATEGORIES } from '../../../constants/global';

const categoryValues = Object.values(DEALER_CATEGORIES as Record<string, string>);
const objectId = Joi.string().pattern(/^[0-9a-fA-F]{24}$/);

const addressSchema = Joi.object({
  street: Joi.string().optional(),
  city: Joi.string().optional(),
  state: Joi.string().optional(),
  country: Joi.string().optional(),
  postalCode: Joi.string().optional(),
}).optional();

export const createDealerSchema = Joi.object({
  name: Joi.string().required(),
  phone: Joi.string().required(),
  email: Joi.string().email().optional(),
  address: addressSchema,
  latitude: Joi.number().required(),
  longitude: Joi.number().required(),
  shopImage: Joi.string().required(),
  profilePicture: Joi.string().required(),
  category: Joi.string().valid(...categoryValues).required(),
  rating: Joi.number().optional(),
  status: Joi.string().valid('active', 'inactive').optional(),
  route: objectId.required(),
});

export const updateDealerSchema = Joi.object({
  name: Joi.string().required(),
  phone: Joi.string().required(),
  email: Joi.string().email().optional(),
  address: addressSchema,
  latitude: Joi.number().required(),
  longitude: Joi.number().required(),
  shopImage: Joi.string().required(),
  profilePicture: Joi.string().required(),
  category: Joi.string().valid(...categoryValues).required(),
  rating: Joi.number().optional(),
  status: Joi.string().valid('active', 'inactive').optional(),
  route: objectId.required(),
});
