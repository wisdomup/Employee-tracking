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
  shopName: Joi.string().allow('').optional(),
  phone: Joi.string().required(),
  email: Joi.string().email().optional(),
  address: addressSchema,
  latitude: Joi.number().required(),
  longitude: Joi.number().required(),
  shopImage: Joi.string().required(),
  profilePicture: Joi.string().allow('').optional(),
  category: Joi.string().valid(...categoryValues).required(),
  rating: Joi.number().optional(),
  status: Joi.string().valid('active', 'inactive').optional(),
  route: objectId.required(),
});

/**
 * Address for the correction path, where every field is allowed to be blank.
 *
 * `addressSchema` above cannot be reused: bare `Joi.string()` rejects `''`, and the create form
 * gets away with it only because it strips empty entries before posting. The correction dialog
 * shows all five fields pre-filled, so a client with no State recorded would post `state: ''`
 * and be refused with "is not allowed to be empty" — for a field the rider never touched.
 * Allowing `''` also gives the rider the only way to CLEAR a field that holds the wrong value.
 */
const correctableAddressSchema = Joi.object({
  street: Joi.string().trim().max(300).allow('').optional(),
  city: Joi.string().trim().max(120).allow('').optional(),
  state: Joi.string().trim().max(120).allow('').optional(),
  country: Joi.string().trim().max(120).allow('').optional(),
  postalCode: Joi.string().trim().max(30).allow('').optional(),
}).optional();

/**
 * The order taker's correction form. Only the pin and the postal address — everything the
 * full update accepts (phone, category, route, status) stays an office decision.
 */
export const updateDealerLocationSchema = Joi.object({
  address: correctableAddressSchema,
  latitude: Joi.number().min(-90).max(90).optional(),
  longitude: Joi.number().min(-180).max(180).optional(),
})
  .or('address', 'latitude', 'longitude')
  // A pin is a pair — accepting one half would leave the client at a coordinate that mixes the
  // old value with the new one.
  .and('latitude', 'longitude');

export const updateDealerSchema = Joi.object({
  name: Joi.string().required(),
  shopName: Joi.string().allow('').optional(),
  phone: Joi.string().required(),
  email: Joi.string().email().optional(),
  address: addressSchema,
  latitude: Joi.number().required(),
  longitude: Joi.number().required(),
  shopImage: Joi.string().required(),
  profilePicture: Joi.string().allow('').optional(),
  category: Joi.string().valid(...categoryValues).required(),
  rating: Joi.number().optional(),
  status: Joi.string().valid('active', 'inactive').optional(),
  route: objectId.required(),
});
