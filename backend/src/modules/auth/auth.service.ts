import bcrypt from 'bcrypt';
import crypto from 'crypto';
import jwt from 'jsonwebtoken';
import { Types } from 'mongoose';
import { UserModel } from '../../models/user.model';
import { sendPasswordResetEmail } from '../email/email.service';
import { unauthorized, conflict, notFound, badRequest } from '../../utils/app-error';

export async function register(data: {
  userID: string;
  username: string;
  fullName?: string;
  phone: string;
  email?: string;
  password: string;
  address?: object;
  profileImage?: string;
}) {
  const existing = await UserModel.findOne({
    $or: [{ userID: data.userID }, { username: data.username }, { phone: data.phone }],
  });

  if (existing) {
    throw conflict('User ID, username or phone already exists');
  }

  const hashedPassword = await bcrypt.hash(data.password, 10);

  const user = await UserModel.create({
    ...data,
    role: 'employee',
    password: hashedPassword,
  });

  const userObject: any = user.toObject();
  delete userObject.password;

  return { message: 'User registered successfully', user: userObject };
}

export async function login(data: { username: string; password: string }) {
  const user = await UserModel.findOne({
    $or: [{ username: data.username }, { phone: data.username }],
    isTrashed: { $ne: true },
  });

  if (!user || !(await bcrypt.compare(data.password, user.password))) {
    throw unauthorized('Invalid credentials');
  }

  if (!user.isActive) {
    throw unauthorized('User account is inactive');
  }

  const payload = { sub: String(user._id), username: user.username, role: user.role };
  const secret = process.env.JWT_SECRET || 'default_secret';
  const expiresIn = process.env.JWT_EXPIRATION || '24h';

  return {
    access_token: jwt.sign(payload, secret, { expiresIn } as any),
    user: {
      id: user._id,
      username: user.username,
      fullName: user.fullName,
      role: user.role,
      phone: user.phone,
      email: user.email,
    },
  };
}

export async function forgotPassword(email: string) {
  const user = await UserModel.findOne({ email, isTrashed: { $ne: true } });

  if (!user) {
    throw notFound('No account found with this email address');
  }

  const resetToken = crypto.randomBytes(32).toString('hex');
  const hashedToken = await bcrypt.hash(resetToken, 10);

  user.resetToken = hashedToken;
  user.resetTokenExpiry = new Date(Date.now() + 3600000); // 1 hour
  await user.save();

  await sendPasswordResetEmail(email, resetToken);

  return { message: 'Password reset link has been sent to your email address' };
}

export async function resetPassword(token: string, newPassword: string) {
  const users = await UserModel.find({
    resetToken: { $exists: true, $ne: null },
    resetTokenExpiry: { $gt: new Date() },
  });

  let matchedUser = null;
  for (const user of users) {
    if (user.resetToken && (await bcrypt.compare(token, user.resetToken))) {
      matchedUser = user;
      break;
    }
  }

  if (!matchedUser) {
    throw badRequest('Invalid or expired reset token');
  }

  const hashed = await bcrypt.hash(newPassword, 10);
  await UserModel.updateOne(
    { _id: matchedUser._id },
    {
      $set: { password: hashed },
      $unset: { resetToken: 1, resetTokenExpiry: 1 },
    },
  );

  return { message: 'Password reset successfully' };
}

export async function changePassword(
  userId: string,
  oldPassword: string,
  newPassword: string,
) {
  if (!Types.ObjectId.isValid(userId)) {
    throw badRequest('Invalid user id');
  }

  const user = await UserModel.findById(userId).select('password isTrashed');
  if (!user || user.isTrashed) {
    throw notFound('User not found');
  }

  let isValid = false;
  try {
    isValid = await bcrypt.compare(oldPassword, user.password);
  } catch {
    throw badRequest('Could not verify current password');
  }
  if (!isValid) {
    // 400 (not 401): admin axios interceptor logs users out on 401
    throw badRequest('Current password is incorrect');
  }

  const hashed = await bcrypt.hash(newPassword, 10);
  const result = await UserModel.updateOne(
    { _id: userId, isTrashed: { $ne: true } },
    { $set: { password: hashed } },
  );
  if (result.matchedCount === 0) {
    throw notFound('User not found');
  }

  return { message: 'Password changed successfully' };
}
