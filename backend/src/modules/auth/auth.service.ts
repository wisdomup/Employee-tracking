import bcrypt from 'bcrypt';
import crypto from 'crypto';
import jwt from 'jsonwebtoken';
import { UserModel } from '../../models/user.model';
import { sendPasswordResetEmail } from '../email/email.service';
import { unauthorized, conflict, notFound, badRequest } from '../../utils/app-error';

export async function register(data: {
  userID: string;
  username: string;
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

  const payload = { sub: user._id, username: user.username, role: user.role };
  const secret = process.env.JWT_SECRET || 'default_secret';
  const expiresIn = process.env.JWT_EXPIRATION || '24h';

  return {
    access_token: jwt.sign(payload, secret, { expiresIn } as any),
    user: {
      id: user._id,
      username: user.username,
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

  matchedUser.password = await bcrypt.hash(newPassword, 10);
  matchedUser.resetToken = undefined;
  matchedUser.resetTokenExpiry = undefined;
  await matchedUser.save();

  return { message: 'Password reset successfully' };
}

export async function changePassword(
  userId: string,
  oldPassword: string,
  newPassword: string,
) {
  const user = await UserModel.findById(userId);
  if (user?.isTrashed) {
    throw notFound('User not found');
  }

  if (!user) {
    throw notFound('User not found');
  }

  const isValid = await bcrypt.compare(oldPassword, user.password);
  if (!isValid) {
    throw unauthorized('Current password is incorrect');
  }

  user.password = await bcrypt.hash(newPassword, 10);
  await user.save();

  return { message: 'Password changed successfully' };
}
