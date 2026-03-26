import { Types } from 'mongoose';
import { TaskModel, ICompletionImage } from '../../models/task.model';
import { UserModel } from '../../models/user.model';
import { calculateDistance } from '../../services/distance.service';
import { deleteFile } from '../../services/file-upload.service';
import { logActivity } from '../activity-logs/activity-logs.service';
import { notFound, badRequest } from '../../utils/app-error';

export async function createTask(
  data: {
    taskName: string;
    description?: string;
    referenceImage?: string;
    document?: string;
    employeeNotes?: string;
    quantity?: number;
    dealerId?: string;
    routeId?: string;
  },
  userId: string,
) {
  const { dealerId, routeId, ...taskData } = data;

  return TaskModel.create({
    ...taskData,
    ...(dealerId && { dealerId: new Types.ObjectId(dealerId) }),
    ...(routeId && { routeId: new Types.ObjectId(routeId) }),
    createdBy: new Types.ObjectId(userId),
  });
}

export async function findAll(filters?: {
  dealerId?: string;
  routeId?: string;
  status?: string;
  assignedTo?: string;
}) {
  const query: Record<string, unknown> = {};

  if (filters?.dealerId) query.dealerId = new Types.ObjectId(filters.dealerId);
  if (filters?.routeId) query.routeId = new Types.ObjectId(filters.routeId);
  if (filters?.status) query.status = filters.status;
  if (filters?.assignedTo) query.assignedTo = new Types.ObjectId(filters.assignedTo);

  const tasks = await TaskModel.find(query)
    .populate('dealerId')
    .populate('routeId')
    .populate('assignedTo', '-password')
    .populate('assignedBy', '-password')
    .populate('createdBy', '-password')
    .exec();

  return tasks.map((task) => {
    const taskObj: any = task.toObject();

    if (
      task.status === 'completed' &&
      task.latitude &&
      task.longitude &&
      task.dealerId
    ) {
      const dealer: any = task.dealerId;
      if (dealer?.latitude && dealer?.longitude) {
        taskObj.distanceFromDealer = calculateDistance(
          dealer.latitude,
          dealer.longitude,
          task.latitude,
          task.longitude,
        );
      }
    }

    return taskObj;
  });
}

export async function findById(id: string) {
  const task = await TaskModel.findById(id)
    .populate('dealerId')
    .populate('routeId')
    .populate('assignedTo', '-password')
    .populate('assignedBy', '-password')
    .populate('createdBy', '-password')
    .exec();

  if (!task) {
    throw notFound('Task not found');
  }

  const taskObj: any = task.toObject();

  if (task.status === 'completed' && task.latitude && task.longitude && task.dealerId) {
    const dealer: any = task.dealerId;
    if (dealer?.latitude && dealer?.longitude) {
      taskObj.distanceFromDealer = calculateDistance(
        dealer.latitude,
        dealer.longitude,
        task.latitude,
        task.longitude,
      );
    }
  }

  return taskObj;
}

export async function updateTask(
  id: string,
  data: {
    taskName?: string;
    description?: string;
    referenceImage?: string;
    document?: string;
    employeeNotes?: string;
    quantity?: number;
    dealerId?: string;
    routeId?: string;
  },
) {
  const task = await TaskModel.findById(id);

  if (!task) {
    throw notFound('Task not found');
  }

  if (data.document !== undefined && task.document) {
    try {
      await deleteFile(task.document);
    } catch {
      // ignore
    }
  }

  const { dealerId, routeId, ...updateData } = data;
  const updates: Record<string, unknown> = { ...updateData };

  if (dealerId !== undefined) updates.dealerId = dealerId ? new Types.ObjectId(dealerId) : null;
  if (routeId !== undefined) updates.routeId = routeId ? new Types.ObjectId(routeId) : null;

  Object.assign(task, updates);
  await task.save();

  return task;
}

export async function assignTask(
  taskId: string,
  assignedTo: string,
  assignedBy: string,
) {
  const task = await TaskModel.findById(taskId);
  if (!task) {
    throw notFound('Task not found');
  }

  const employee = await UserModel.findById(assignedTo);
  if (!employee) {
    throw notFound('Employee not found');
  }

  if (task.status === 'in_progress') {
    throw badRequest('Cannot reassign a task that is already in progress');
  }

  task.assignedTo = new Types.ObjectId(assignedTo);
  task.assignedBy = new Types.ObjectId(assignedBy);
  task.status = 'pending';
  await task.save();

  return task.populate(['assignedTo', 'assignedBy', 'dealerId', 'routeId', 'createdBy']);
}

export async function startTask(
  taskId: string,
  data: { latitude: number; longitude: number },
  employeeId: string,
) {
  const task = await TaskModel.findById(taskId);

  if (!task) {
    throw notFound('Task not found');
  }

  if (!task.assignedTo || task.assignedTo.toString() !== employeeId) {
    throw badRequest('This task is not assigned to you');
  }

  if (task.status !== 'pending') {
    throw badRequest('Task is not in pending status');
  }

  task.status = 'in_progress';
  task.startedAt = new Date();
  await task.save();

  await logActivity({
    employeeId,
    module: 'task',
    entityId: taskId,
    taskId,
    action: 'started_task',
    meta: { taskName: task.taskName },
  });

  return task;
}

export async function completeTask(
  taskId: string,
  data: {
    latitude: number;
    longitude: number;
    completionImages: ICompletionImage[];
  },
  employeeId: string,
  userRole?: string,
) {
  const task = await TaskModel.findById(taskId).populate('dealerId').exec();

  if (!task) {
    throw notFound('Task not found');
  }

  const isAdmin = userRole === 'admin';
  if (!isAdmin && (!task.assignedTo || task.assignedTo.toString() !== employeeId)) {
    throw badRequest('This task is not assigned to you');
  }

  if (task.status === 'completed') {
    throw badRequest('Task is already completed');
  }

  if (!data.completionImages || data.completionImages.length === 0) {
    throw badRequest('Completion images are required');
  }

  task.status = 'completed';
  task.completedAt = new Date();
  task.latitude = data.latitude;
  task.longitude = data.longitude;
  task.timestamp = new Date();
  task.completionImages = data.completionImages;
  await task.save();

  await logActivity({
    employeeId,
    module: 'task',
    entityId: taskId,
    taskId,
    action: 'completed_task',
    meta: { taskName: task.taskName },
  });

  return task;
}

export async function deleteTask(id: string) {
  const task = await TaskModel.findById(id);

  if (!task) {
    throw notFound('Task not found');
  }

  if (task.status === 'in_progress') {
    throw badRequest('Cannot delete a task that is in progress');
  }

  if (task.document) {
    try {
      await deleteFile(task.document);
    } catch {
      // ignore
    }
  }

  await TaskModel.findByIdAndDelete(id);

  return { message: 'Task deleted successfully' };
}
