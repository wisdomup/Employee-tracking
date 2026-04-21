import api from './api';

/** Returns today's date as YYYY-MM-DD in the browser's local timezone. */
export function getTodayLocalDate(): string {
  const d = new Date();
  const year = d.getFullYear();
  const month = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

export interface AttendanceEmployee {
  _id: string;
  username?: string;
  userID?: string;
  role?: string;
}

export interface Attendance {
  _id: string;
  employeeId: AttendanceEmployee | string;
  date: string;
  checkInTime: string;
  checkInLatitude: number;
  checkInLongitude: number;
  checkOutTime?: string;
  checkOutLatitude?: number;
  checkOutLongitude?: number;
  note?: string;
  createdBy?: { _id: string; username?: string; userID?: string };
  createdAt: string;
  updatedAt: string;
}

export function getEmployeeLabel(emp: AttendanceEmployee | string | undefined): string {
  if (!emp) return '-';
  if (typeof emp === 'string') return emp;
  return emp.username || emp.userID || emp._id;
}

export const attendanceService = {
  async checkIn(latitude: number, longitude: number, note?: string): Promise<Attendance> {
    const res = await api.post('/attendance/check-in', {
      latitude,
      longitude,
      note,
      localDate: getTodayLocalDate(),
    });
    return res.data;
  },

  async checkOut(latitude: number, longitude: number, note?: string): Promise<Attendance> {
    const res = await api.post('/attendance/check-out', {
      latitude,
      longitude,
      note,
      localDate: getTodayLocalDate(),
    });
    return res.data;
  },

  async getTodayRecord(): Promise<Attendance | null> {
    const res = await api.get(`/attendance/today?date=${getTodayLocalDate()}`);
    return res.data;
  },

  async getAttendance(filters?: {
    employeeId?: string;
    startDate?: string;
    endDate?: string;
  }): Promise<Attendance[]> {
    const params = new URLSearchParams();
    if (filters?.employeeId) params.append('employeeId', filters.employeeId);
    if (filters?.startDate) params.append('startDate', filters.startDate);
    if (filters?.endDate) params.append('endDate', filters.endDate);
    const res = await api.get(`/attendance?${params.toString()}`);
    return res.data;
  },

  async getRecord(id: string): Promise<Attendance> {
    const res = await api.get(`/attendance/${id}`);
    return res.data;
  },

  async updateRecord(id: string, data: Partial<Attendance> & { note?: string }): Promise<Attendance> {
    const res = await api.patch(`/attendance/${id}`, data);
    return res.data;
  },

  async deleteRecord(id: string): Promise<{ message: string }> {
    const res = await api.delete(`/attendance/${id}`);
    return res.data;
  },

  async createRecord(data: {
    employeeId: string;
    date: string;
    checkInTime: string;
    checkInLatitude: number;
    checkInLongitude: number;
    checkOutTime?: string;
    checkOutLatitude?: number;
    checkOutLongitude?: number;
    note?: string;
  }): Promise<Attendance> {
    const res = await api.post('/attendance', data);
    return res.data;
  },
};
