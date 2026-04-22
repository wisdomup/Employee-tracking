import Joi from 'joi';

export const registerSchema = Joi.object({
  userID: Joi.string().required(),
  username: Joi.string().required(),
  fullName: Joi.string().trim().max(200).allow('').optional(),
  phone: Joi.string().required(),
  email: Joi.string().email().optional(),
  password: Joi.string().min(6).required(),
  address: Joi.object({
    street: Joi.string().optional(),
    city: Joi.string().optional(),
    state: Joi.string().optional(),
    country: Joi.string().optional(),
  }).optional(),
  profileImage: Joi.string().optional(),
});

export const loginSchema = Joi.object({
  username: Joi.string().required(),
  password: Joi.string().required(),
});

export const forgotPasswordSchema = Joi.object({
  email: Joi.string().email().required(),
});

export const resetPasswordSchema = Joi.object({
  token: Joi.string().required(),
  newPassword: Joi.string().min(6).required(),
});

export const changePasswordSchema = Joi.object({
  oldPassword: Joi.string().required(),
  newPassword: Joi.string().min(6).required(),
});
