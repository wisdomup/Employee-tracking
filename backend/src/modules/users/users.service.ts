import bcrypt from 'bcrypt';
import { Types } from 'mongoose';
import { UserModel } from '../../models/user.model';
import { conflict, notFound } from '../../utils/app-error';
import { logActivityAsync } from '../activity-logs/activity-logs.service';

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
}, actorId?: string) {
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

  logActivityAsync({
    employeeId: actorId,
    module: 'employee',
    entityId: String(user._id),
    action: 'created',
    meta: {
      username: user.username,
      phone: user.phone,
      userID: user.userID,
      role: user.role,
      isActive: user.isActive,
    },
  });

  return userObject;
}

export async function findAll(filters?: { role?: string; isActive?: boolean }) {
  const query: Record<string, unknown> = { isTrashed: { $ne: true } };

  if (filters?.role) query.role = filters.role;
  if (filters?.isActive !== undefined) query.isActive = filters.isActive;

  return UserModel.find(query).select('-password').sort({ createdAt: -1 }).exec();
}

export async function findById(id: string) {
  const user = await UserModel.findOne({ _id: id, isTrashed: { $ne: true } }).select('-password').exec();

  if (!user) {
    throw notFound('User not found');
  }

  return user;
}

export async function findByRole(role: string) {
  return UserModel.find({ role, isActive: true, isTrashed: { $ne: true } }).select('-password').exec();
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
  actorId?: string,
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

  const previousActive = user.isActive;
  if (data.password) {
    data.password = await bcrypt.hash(data.password, 10);
  }

  Object.assign(user, data);
  await user.save();

  const userObject: any = user.toObject();
  delete userObject.password;

  const activeChanged = data.isActive !== undefined && previousActive !== data.isActive;
  logActivityAsync({
    employeeId: actorId,
    module: 'employee',
    entityId: String(user._id),
    action: activeChanged ? 'status_changed' : 'updated',
    changes: activeChanged
      ? { isActive: { from: previousActive, to: data.isActive } }
      : undefined,
    meta: {
      username: user.username,
      phone: user.phone,
      userID: user.userID,
      role: user.role,
      isActive: user.isActive,
    },
  });

  return userObject;
}

export type ProfileUpdatePayload = {
  username?: string;
  phone?: string;
  email?: string;
  address?: {
    street?: string | null;
    city?: string | null;
    state?: string | null;
    country?: string | null;
  };
  profileImage?: string | null;
};

export async function updateProfile(userId: string, data: ProfileUpdatePayload, actorId?: string) {
  const user = await UserModel.findById(userId);

  if (!user || user.isTrashed) {
    throw notFound('User not found');
  }

  const orConditions: Array<Record<string, unknown>> = [];
  if (data.username != null) orConditions.push({ username: data.username });
  if (data.phone != null) orConditions.push({ phone: data.phone });
  if (orConditions.length > 0) {
    const existing = await UserModel.findOne({
      _id: { $ne: userId },
      $or: orConditions,
    });
    if (existing) {
      throw conflict('Username or phone already exists');
    }
  }

  if (data.username !== undefined) user.username = data.username.trim();
  if (data.phone !== undefined) user.phone = data.phone.trim();
  if (data.email !== undefined) {
    user.email = data.email === '' ? undefined : data.email.trim();
  }
  if (data.profileImage !== undefined) {
    user.profileImage = data.profileImage === '' || data.profileImage == null ? undefined : data.profileImage;
  }
  if (data.address !== undefined) {
    const a = data.address;
    user.address = {
      street: a.street?.trim() || undefined,
      city: a.city?.trim() || undefined,
      state: a.state?.trim() || undefined,
      country: a.country?.trim() || undefined,
    };
  }

  await user.save();

  const userObject: any = user.toObject();
  delete userObject.password;

  logActivityAsync({
    employeeId: actorId,
    module: 'employee',
    entityId: String(user._id),
    action: 'updated',
    meta: {
      username: user.username,
      phone: user.phone,
      userID: user.userID,
      role: user.role,
      isActive: user.isActive,
      selfProfile: true,
    },
  });

  return userObject;
}

export async function deleteUser(id: string, actorId?: string) {
  const user = await UserModel.findOne({ _id: id, isTrashed: { $ne: true } });

  if (!user) {
    throw notFound('User not found');
  }

  user.isTrashed = true;
  user.trashedAt = new Date();
  if (actorId) {
    user.trashedBy = user.trashedBy ?? new Types.ObjectId(actorId);
  }
  await user.save();

  logActivityAsync({
    employeeId: actorId,
    module: 'employee',
    entityId: String(user._id),
    action: 'deleted',
    changes: { isTrashed: { from: false, to: true } },
    meta: {
      username: user.username,
      phone: user.phone,
      userID: user.userID,
      role: user.role,
      isActive: user.isActive,
      isTrashed: user.isTrashed,
    },
  });

  return { message: 'User moved to trash successfully' };
}

export async function restoreUser(id: string, actorId?: string) {
  const user = await UserModel.findOne({ _id: id, isTrashed: true });
  if (!user) {
    throw notFound('User not found in trash');
  }

  user.isTrashed = false;
  user.trashedAt = undefined;
  user.trashedBy = undefined;
  await user.save();

  logActivityAsync({
    employeeId: actorId,
    module: 'employee',
    entityId: String(user._id),
    action: 'updated',
    changes: { isTrashed: { from: true, to: false } },
    meta: { username: user.username, phone: user.phone, userID: user.userID, role: user.role },
  });

  return user.toObject();
}

export async function permanentlyDeleteUser(id: string, actorId?: string) {
  const user = await UserModel.findOne({ _id: id, isTrashed: true });
  if (!user) {
    throw notFound('User not found in trash');
  }

  await UserModel.findByIdAndDelete(id);
  logActivityAsync({
    employeeId: actorId,
    module: 'employee',
    entityId: String(user._id),
    action: 'deleted',
    meta: { username: user.username, phone: user.phone, userID: user.userID, role: user.role, permanent: true },
  });
  return { message: 'User permanently deleted successfully' };
}
