import bcrypt from 'bcrypt';
import { UserModel } from '../../models/user.model';
import { conflict, notFound } from '../../utils/app-error';

export async function createUser(data: {
  userID: string;
  username: string;
  phone: string;
  email?: string;
  password: string;
  role: string;
  address?: object;
  profileImage?: string;
  profilePicture?: string;
  isActive?: boolean;
  designation?: string;
  perks?: { salary?: number; bonus?: number; allowance?: number };
  target?: string;
  achivedTarget?: string;
  extraNotes?: string;
  lastExperience?: string;
}) {
  const existing = await UserModel.findOne({
    $or: [{ userID: data.userID }, { username: data.username }, { phone: data.phone }],
  });

  if (existing) {
    throw conflict('User ID, username or phone already exists');
  }

  const hashedPassword = await bcrypt.hash(data.password, 10);
  const user = await UserModel.create({ ...data, password: hashedPassword });

  const userObject: any = user.toObject();
  delete userObject.password;

  return userObject;
}

export async function findAll(filters?: { role?: string; isActive?: boolean }) {
  const query: Record<string, unknown> = {};

  if (filters?.role) query.role = filters.role;
  if (filters?.isActive !== undefined) query.isActive = filters.isActive;

  return UserModel.find(query).select('-password').sort({ createdAt: -1 }).exec();
}

export async function findById(id: string) {
  const user = await UserModel.findById(id).select('-password').exec();

  if (!user) {
    throw notFound('User not found');
  }

  return user;
}

export async function findByRole(role: string) {
  return UserModel.find({ role, isActive: true }).select('-password').exec();
}

export async function updateUser(
  id: string,
  data: {
    userID?: string;
    username?: string;
    phone?: string;
    email?: string;
    password?: string;
    role?: string;
    address?: object;
    profileImage?: string;
    profilePicture?: string;
    isActive?: boolean;
    designation?: string;
    perks?: { salary?: number; bonus?: number; allowance?: number };
    target?: string;
    achivedTarget?: string;
    extraNotes?: string;
    lastExperience?: string;
  },
) {
  const user = await UserModel.findById(id);

  if (!user) {
    throw notFound('User not found');
  }

  const orConditions: Array<Record<string, unknown>> = [];
  if (data.userID != null) orConditions.push({ userID: data.userID });
  if (data.username != null) orConditions.push({ username: data.username });
  if (data.phone != null) orConditions.push({ phone: data.phone });
  if (orConditions.length > 0) {
    const existing = await UserModel.findOne({
      _id: { $ne: id },
      $or: orConditions,
    });
    if (existing) {
      throw conflict('User ID, username or phone already exists');
    }
  }

  if (data.password) {
    data.password = await bcrypt.hash(data.password, 10);
  }

  Object.assign(user, data);
  await user.save();

  const userObject: any = user.toObject();
  delete userObject.password;

  return userObject;
}

export async function deleteUser(id: string) {
  const user = await UserModel.findById(id);

  if (!user) {
    throw notFound('User not found');
  }

  user.isActive = false;
  await user.save();

  return { message: 'User deleted successfully' };
}
