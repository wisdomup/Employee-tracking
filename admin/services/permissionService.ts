import api from './api';
import type { ResolvedAccess } from '../utils/permissions';

/**
 * The permission matrix API.
 *
 * Only `getMyAccess` is called by ordinary screens; everything else backs the admin matrix
 * editor and answers 403 for anyone who is not the super-admin.
 */

export type ActionId = 'view' | 'add' | 'edit' | 'delete' | 'change';

export interface ModuleDefinition {
  id: string;
  label: string;
  group: string;
  /** Actions this module supports. Anything absent renders as a greyed n/a cell. */
  actions: ActionId[];
  /** Help text for the `change` column, which means something different per module. */
  changeMeans?: string;
}

export interface ReportDefinition {
  id: string;
  label: string;
  surface: string;
  path: string;
}

export interface Catalogue {
  actions: ActionId[];
  modules: ModuleDefinition[];
  reports: ReportDefinition[];
  editableRoles: string[];
}

export type ModuleGrant = Partial<Record<ActionId, boolean>>;

export interface Policy {
  subjectType: 'role' | 'profile';
  subjectKey: string;
  grants: Record<string, ModuleGrant>;
  reports: string[];
  isSystem: boolean;
  updatedAt: string | null;
}

export interface Profile {
  id: string;
  name: string;
  description: string;
  roles: string[];
  roleKey: string;
  isActive: boolean;
  /** How many active users hold exactly this combination. */
  userCount: number;
}

export interface UncoveredCombination {
  roles: string[];
  roleKey: string;
  userCount: number;
}

/** Flatten a stored grant map into the `module:action` list the save endpoint expects. */
export function grantsToPermissions(grants: Record<string, ModuleGrant>): string[] {
  const keys: string[] = [];
  for (const [moduleId, grant] of Object.entries(grants)) {
    for (const [action, on] of Object.entries(grant)) {
      if (on) keys.push(`${moduleId}:${action}`);
    }
  }
  return keys;
}

export const permissionService = {
  async getMyAccess(): Promise<ResolvedAccess> {
    const { data } = await api.get<ResolvedAccess>('/permissions/me');
    return data;
  },

  async getCatalogue(): Promise<Catalogue> {
    const { data } = await api.get<Catalogue>('/permissions/catalogue');
    return data;
  },

  async getRolePolicy(role: string): Promise<Policy> {
    const { data } = await api.get<Policy>(`/permissions/roles/${role}`);
    return data;
  },

  /**
   * Full replacement, not a patch: anything absent from `permissions` is turned off. The
   * editor always sends the whole grid, because a partial update would make unticking a box
   * mean nothing.
   */
  async saveRolePolicy(
    role: string,
    permissions: string[],
    reports: string[],
  ): Promise<Policy> {
    const { data } = await api.put<Policy>(`/permissions/roles/${role}`, { permissions, reports });
    return data;
  },

  async getProfilePolicy(id: string): Promise<Policy> {
    const { data } = await api.get<Policy>(`/permissions/profiles/${id}`);
    return data;
  },

  async saveProfilePolicy(
    id: string,
    permissions: string[],
    reports: string[],
  ): Promise<Policy> {
    const { data } = await api.put<Policy>(`/permissions/profiles/${id}`, { permissions, reports });
    return data;
  },

  async listProfiles(): Promise<Profile[]> {
    const { data } = await api.get<{ profiles: Profile[] }>('/permissions/profiles');
    return data.profiles;
  },

  async createProfile(input: {
    name: string;
    description?: string;
    roles: string[];
  }): Promise<{ id: string; roleKey: string; roles: string[] }> {
    const { data } = await api.post('/permissions/profiles', input);
    return data;
  },

  async setProfileActive(id: string, isActive: boolean): Promise<void> {
    await api.patch(`/permissions/profiles/${id}/active`, { isActive });
  },

  async deleteProfile(id: string): Promise<void> {
    await api.delete(`/permissions/profiles/${id}`);
  },

  async getUncoveredCombinations(): Promise<UncoveredCombination[]> {
    const { data } = await api.get<{ combinations: UncoveredCombination[] }>(
      '/permissions/profiles/uncovered',
    );
    return data.combinations;
  },

  async setUserRoles(
    userId: string,
    roles: string[],
  ): Promise<{ userId: string; role: string; roles: string[]; needsProfile: boolean }> {
    const { data } = await api.put(`/permissions/users/${userId}/roles`, { roles });
    return data;
  },
};

export default permissionService;
