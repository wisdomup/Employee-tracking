import { Types } from 'mongoose';
import { RouteAssignmentModel } from '../../models/route-assignment.model';
import { RouteModel } from '../../models/route.model';
import { notFound, badRequest } from '../../utils/app-error';
import { ROLES } from '../../constants/global';
import { assertAssignableActiveFieldUser } from '../users/users.service';

export async function assignRouteToEmployee(routeId: string, employeeId: string) {
  const route = await RouteModel.findById(routeId);
  if (!route) {
    throw notFound('Route not found');
  }

  const employee = await assertAssignableActiveFieldUser(employeeId, [ROLES.ORDER_TAKER]);

  if (employee.role !== ROLES.ORDER_TAKER) {
    throw badRequest('Routes can only be assigned to users with the order_taker role');
  }

  const routeObjectId = new Types.ObjectId(routeId);
  const employeeObjectId = new Types.ObjectId(employeeId);

  const existing = await RouteAssignmentModel.findOne({ routeId: routeObjectId });

  if (existing) {
    if (existing.employeeId.toString() === employeeId) {
      return existing;
    }
    await existing.deleteOne();
  }

  const routeAssignment = await RouteAssignmentModel.create({
    routeId: routeObjectId,
    employeeId: employeeObjectId,
    assignedAt: new Date(),
  });

  return routeAssignment;
}

export async function findAll() {
  return RouteAssignmentModel.find()
    .populate('routeId')
    .populate('employeeId', '-password')
    .sort({ assignedAt: -1 })
    .exec();
}

export async function findByRoute(routeId: string) {
  return RouteAssignmentModel.findOne({ routeId: new Types.ObjectId(routeId) })
    .populate('routeId')
    .populate('employeeId', '-password')
    .exec();
}

export async function findByEmployee(employeeId: string) {
  return RouteAssignmentModel.find({ employeeId: new Types.ObjectId(employeeId) })
    .populate('routeId')
    .exec();
}

export async function unassignRoute(routeId: string) {
  const assignment = await RouteAssignmentModel.findOne({
    routeId: new Types.ObjectId(routeId),
  });

  if (!assignment) {
    throw notFound('Route assignment not found');
  }

  await assignment.deleteOne();

  return { message: 'Route unassigned successfully' };
}
