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
}

export interface SweepSummary {
  evaluated: number;
  frozen: number;
  frozenWithNoAssignedVisits: number;
  skippedAlreadyStarted: number;
  skippedAlreadyFrozen: number;
  skippedExempt: number;
  skippedPardoned: number;
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
};
