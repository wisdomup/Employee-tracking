import api from './api';

/**
 * The rider late-start freeze. A rider who does not check in at their first shop by the
 * daily deadline is frozen: they can still sign in and read their day, but every write is
 * refused by the server until an admin lifts it.
 *
 * Mirrors `backend/src/modules/account-freeze` — the deadline itself is server-side and
 * arrives on `FreezeStatus.deadline`, so it is never duplicated here.
 */

export interface FreezeStatus {
  isFrozen: boolean;
  frozenAt: string | null;
  frozenReason: string | null;
  /** Human-readable deadline, e.g. "12:30 PM". Server-formatted in the business timezone. */
  deadline: string;
  /** True when an admin lifted a freeze for them earlier today; they are clear until tomorrow. */
  pardonedToday: boolean;
  /** False for roles the rule does not apply to — the banner stays hidden for them. */
  subjectToRule: boolean;
  /** What a late start costs THIS rider — their own amount, or the company default. */
  fineAmount: number;
  /** Today's fine, when one was raised. Null on a day nothing was charged. */
  todayFine: RiderFineSummary | null;
  /** Everything still owed, today's fine included. */
  outstandingFines: number;
  outstandingFineCount: number;
  /** Already taken off their pay by a posted payroll run. */
  finesRecovered: number;
}

/** A fine as the rider's banner and the admin's queue need it. */
export interface RiderFineSummary {
  /** Absent on the rider's own status — riders have no fine to act on, only to read. */
  _id?: string;
  amount: number;
  status: 'outstanding' | 'waived';
  reason: string;
  issuedAt: string;
}

export interface FrozenUser {
  _id: string;
  username: string;
  fullName?: string;
  phone: string;
  role: string;
  isFrozen: boolean;
  frozenAt?: string;
  frozenReason?: string;
  frozenBy?: { _id: string; username?: string; fullName?: string } | null;
  address?: { city?: string };
  /** What a late start costs this rider — their own amount, or the company default. */
  fineAmount: number;
  /** True when that amount was set for this rider specifically. */
  hasCustomFineAmount: boolean;
  /** The fine raised with today's freeze, if any. */
  todayFine: RiderFineSummary | null;
  outstandingFines: number;
  outstandingFineCount: number;
  /** Already taken off their pay by a posted payroll run. */
  finesRecovered: number;
}

/** The numbers behind the admin banner. One call — the banner renders on every screen. */
export interface FineOverview {
  frozenCount: number;
  finedToday: number;
  finesTodayTotal: number;
  outstandingCount: number;
  outstandingTotal: number;
  /** Recovered through payroll — proof the fines are actually collected. */
  recoveredTotal: number;
  /** The company default, so the banner can say what the next late start will cost. */
  defaultFineAmount: number;
}

export interface RiderFine {
  _id: string;
  employeeId: string;
  fineDate: string;
  amount: number;
  originalAmount?: number;
  reason: string;
  status: 'outstanding' | 'waived';
  source: 'check_in_guard' | 'sweep' | 'manual';
  issuedAt: string;
  waivedAt?: string;
  waiveNote?: string;
  waivedBy?: { _id: string; username?: string; fullName?: string } | null;
}

export interface SweepSummary {
  evaluated: number;
  frozen: number;
  /** How many of those freezes carried a fine, and the rupees raised in the run. */
  fined: number;
  finesTotal: number;
  frozenWithNoAssignedVisits: number;
  skippedAlreadyStarted: number;
  skippedAlreadyFrozen: number;
  skippedExempt: number;
  skippedPardoned: number;
  skippedAlreadyJudged: number;
}

export const accountFreezeService = {
  /** The caller's own freeze state. Safe for every role — riders included. */
  async getMyStatus(): Promise<FreezeStatus> {
    const { data } = await api.get<FreezeStatus>('/account-freeze/me');
    return data;
  },

  /** Admin: everyone currently frozen, newest freeze first. */
  async getFrozenUsers(): Promise<FrozenUser[]> {
    const { data } = await api.get<FrozenUser[]>('/account-freeze');
    return Array.isArray(data) ? data : [];
  },

  /** Admin: lift a freeze. `note` is kept in the activity log, not on the user. */
  async unfreeze(userId: string, note?: string): Promise<void> {
    await api.patch(`/account-freeze/${userId}/unfreeze`, note ? { note } : {});
  },

  /** Admin: re-run the daily sweep, e.g. after the server was down over the deadline. */
  async runSweep(): Promise<SweepSummary> {
    const { data } = await api.post<SweepSummary>('/account-freeze/sweep');
    return data;
  },

  /** Admin: the freeze + fine counters the site-wide admin banner renders. */
  async getFineOverview(): Promise<FineOverview> {
    const { data } = await api.get<FineOverview>('/account-freeze/fines/overview');
    return data;
  },

  /** Admin: one rider's fine history — what a disputed fine is checked against. */
  async getRiderFines(userId: string): Promise<RiderFine[]> {
    const { data } = await api.get<RiderFine[]>(`/account-freeze/${userId}/fines`);
    return Array.isArray(data) ? data : [];
  },

  /**
   * Admin: set this rider's own fine, or pass `null` to put them back on the company
   * default. `0` is a real value — frozen, not fined. A fine already raised today and not
   * yet waived is re-priced to the new amount.
   */
  async setFineAmount(
    userId: string,
    amount: number | null,
  ): Promise<{ fineAmount: number; hasCustomFineAmount: boolean; todayFineUpdated: boolean }> {
    const { data } = await api.patch(`/account-freeze/${userId}/fine-amount`, { amount });
    return data;
  },

  /** Admin: cancel a fine. The freeze is left exactly as it is. */
  async waiveFine(fineId: string, note?: string): Promise<void> {
    await api.patch(`/account-freeze/fines/${fineId}/waive`, note ? { note } : {});
  },
};
