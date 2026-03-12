import { UserModel } from '../../models/user.model';
import { DealerModel } from '../../models/dealer.model';
import { TaskModel } from '../../models/task.model';
import { getRecentActivity } from '../activity-logs/activity-logs.service';

export async function getDashboardStats() {
  const totalEmployees = await UserModel.countDocuments({ role: 'employee', isActive: true });
  const totalDealers = await DealerModel.countDocuments({ status: 'active' });
  const totalTasks = await TaskModel.countDocuments();

  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const tomorrow = new Date(today);
  tomorrow.setDate(tomorrow.getDate() + 1);

  const tasksCompletedToday = await TaskModel.countDocuments({
    status: 'completed',
    completedAt: { $gte: today, $lt: tomorrow },
  });

  const tasksInProgress = await TaskModel.countDocuments({ status: 'in_progress' });

  const recentActivity = await getRecentActivity(10);

  const completedTasksForMap = await TaskModel.find({
    status: 'completed',
    latitude: { $exists: true },
    longitude: { $exists: true },
  })
    .populate('dealerId')
    .populate('assignedTo', 'username')
    .limit(50)
    .exec();

  return {
    stats: {
      totalEmployees,
      totalDealers,
      totalTasks,
      tasksCompletedToday,
      tasksInProgress,
    },
    recentActivity,
    completedTasksForMap: completedTasksForMap.map((task) => {
      const dealer: any = task.dealerId;
      return {
        taskName: task.taskName,
        employeeName: (task.assignedTo as any)?.username,
        dealerLocation: dealer
          ? { latitude: dealer.latitude, longitude: dealer.longitude, name: dealer.name }
          : null,
        completionLocation: { latitude: task.latitude, longitude: task.longitude },
        completedAt: task.completedAt,
      };
    }),
  };
}
