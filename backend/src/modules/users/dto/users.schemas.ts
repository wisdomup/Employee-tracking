import Joi from 'joi';
import { ROLES } from '../../../constants/global';

const roleValues = Object.values(ROLES);

const addressSchema = Joi.object({
  street: Joi.string().optional(),
  city: Joi.string().optional(),
  state: Joi.string().optional(),
  country: Joi.string().optional(),
}).optional();

const perksSchema = Joi.object({
  salary: Joi.number().optional(),
  bonus: Joi.number().optional(),
  allowance: Joi.number().optional(),
}).optional();

export const createUserSchema = Joi.object({
  userID: Joi.string().required(),
  username: Joi.string().required(),
  phone: Joi.string().required(),
  email: Joi.string().email().optional(),
  password: Joi.string().min(6).required(),
  role: Joi.string().valid(...roleValues).required(),
  address: addressSchema,
  profileImage: Joi.string().optional(),
  profilePicture: Joi.string().optional(),
  isActive: Joi.boolean().optional(),
  designation: Joi.string().optional(),
  perks: perksSchema,
  target: Joi.string().optional(),
  achivedTarget: Joi.string().optional(),
  extraNotes: Joi.string().optional(),
  lastExperience: Joi.string().optional(),
});

export const updateUserSchema = Joi.object({
  userID: Joi.string().required(),
  username: Joi.string().required(),
  phone: Joi.string().required(),
  email: Joi.string().email().optional(),
  password: Joi.string().min(6).optional(),
  role: Joi.string().valid(...roleValues).required(),
  address: addressSchema,
  profileImage: Joi.string().optional(),
  profilePicture: Joi.string().optional(),
  isActive: Joi.boolean().optional(),
  designation: Joi.string().optional(),
  perks: perksSchema,
  target: Joi.string().optional(),
  achivedTarget: Joi.string().optional(),
  extraNotes: Joi.string().optional(),
  lastExperience: Joi.string().optional(),
});
