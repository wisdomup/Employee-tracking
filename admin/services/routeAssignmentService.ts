import api from './api';

export interface RouteAssignment {
  _id: string;
  routeId: any;
  employeeId: any;
  assignedAt: string;
  createdAt?: string;
  updatedAt?: string;
}

export const routeAssignmentService = {
  async getRouteAssignments() {
    const response = await api.get('/route-assignments');
    return response.data;
  },

  async getByRoute(routeId: string) {
    const response = await api.get(`/route-assignments/route/${routeId}`);
    return response.data;
  },

  async getByEmployee(employeeId: string) {
    const response = await api.get(`/route-assignments/employee/${employeeId}`);
    return response.data;
  },

  async assignRouteToEmployee(routeId: string, employeeId: string) {
    const response = await api.post('/route-assignments', {
      routeId,
      employeeId,
    });
    return response.data;
  },

  async unassignRoute(routeId: string) {
    const response = await api.delete(`/route-assignments/route/${routeId}`);
    return response.data;
  },
};
