import React, { useCallback, useEffect, useState } from 'react';
import { toast } from 'react-toastify';
import Layout from '../../components/Layout/Layout';
import ProtectedRoute from '../../components/Auth/ProtectedRoute';
import Loader from '../../components/UI/Loader';
import PermissionEditor from '../../components/Permissions/PermissionEditor';
import { usePermissionGrid } from '../../hooks/usePermissionGrid';
import {
  permissionService,
  grantsToPermissions,
  type Catalogue,
  type Profile,
  type UncoveredCombination,
} from '../../services/permissionService';
import { roleLabel, ASSIGNABLE_ROLES } from '../../utils/permissions';
import { getApiErrorMessage } from '../../utils/apiError';
import styles from '../../styles/Permissions.module.scss';

/**
 * The role and profile permission matrix.
 *
 * Two things are edited here and they are deliberately different shapes:
 *
 *  - **Modules** get a grid of module × action. Actions a module does not support render as a
 *    greyed `n/a` rather than an unchecked box, so "not allowed" stays distinguishable from
 *    "cannot be allowed".
 *  - **Reports** get a flat allow-list, one checkbox per individual report. There is no
 *    add/edit/delete axis and no export — reports are view-only for everyone, Admin included.
 *
 * The Admin role has no tab. It resolves to full access before any policy is read, which is
 * exactly what stops this screen from being able to lock you out of this screen.
 *
 * The grid itself lives in `components/Permissions/PermissionEditor`, shared with the per-user
 * editor at `/employees/[id]/permissions` so the two cannot drift apart.
 */

type Subject = { type: 'role'; key: string } | { type: 'profile'; key: string; name: string };

function PermissionsPage() {
  const [catalogue, setCatalogue] = useState<Catalogue | null>(null);
  const [profiles, setProfiles] = useState<Profile[]>([]);
  const [uncovered, setUncovered] = useState<UncoveredCombination[]>([]);

  const [subject, setSubject] = useState<Subject>({ type: 'role', key: 'sales_manager' });

  const [loading, setLoading] = useState(true);
  const [policyLoading, setPolicyLoading] = useState(false);
  const [saving, setSaving] = useState(false);

  const [showCreate, setShowCreate] = useState(false);
  const [newName, setNewName] = useState('');
  const [newRoles, setNewRoles] = useState<string[]>([]);

  const grid = usePermissionGrid(catalogue);

  // ── Loading ────────────────────────────────────────────────────────────────

  const loadShell = useCallback(async () => {
    setLoading(true);
    try {
      const [cat, profs, unc] = await Promise.all([
        permissionService.getCatalogue(),
        permissionService.listProfiles(),
        permissionService.getUncoveredCombinations(),
      ]);
      setCatalogue(cat);
      setProfiles(profs);
      setUncovered(unc);
    } catch (err) {
      toast.error(getApiErrorMessage(err, 'Could not load the permission catalogue'));
    } finally {
      setLoading(false);
    }
  }, []);

  const loadPolicy = useCallback(async (s: Subject) => {
    setPolicyLoading(true);
    try {
      const policy =
        s.type === 'role'
          ? await permissionService.getRolePolicy(s.key)
          : await permissionService.getProfilePolicy(s.key);
      grid.reset(grantsToPermissions(policy.grants ?? {}), policy.reports ?? []);
    } catch (err) {
      toast.error(getApiErrorMessage(err, 'Could not load this permission set'));
    } finally {
      setPolicyLoading(false);
    }
    // `grid.reset` is stable; listing `grid` would re-run this on every tick.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    void loadShell();
  }, [loadShell]);

  useEffect(() => {
    void loadPolicy(subject);
  }, [subject, loadPolicy]);

  // ── Editing ────────────────────────────────────────────────────────────────

  const switchSubject = (next: Subject) => {
    if (grid.dirty && !window.confirm('You have unsaved changes. Discard them?')) return;
    setSubject(next);
  };

  const save = async () => {
    setSaving(true);
    try {
      const permissions = grid.toPermissions();
      const reportIds = grid.toReports();

      if (subject.type === 'role') {
        await permissionService.saveRolePolicy(subject.key, permissions, reportIds);
      } else {
        await permissionService.saveProfilePolicy(subject.key, permissions, reportIds);
      }

      grid.markClean();
      toast.success('Permissions saved. They take effect on the next request.');
    } catch (err) {
      toast.error(getApiErrorMessage(err, 'Could not save these permissions'));
    } finally {
      setSaving(false);
    }
  };

  // ── Profiles ───────────────────────────────────────────────────────────────

  const createProfile = async () => {
    if (newRoles.length < 2) {
      toast.error('Pick at least two roles — a profile describes a combination.');
      return;
    }
    try {
      const created = await permissionService.createProfile({
        name: newName.trim() || newRoles.map(roleLabel).join(' + '),
        roles: newRoles,
      });
      toast.success('Profile created. Set its permissions below — nothing is granted by default.');
      setShowCreate(false);
      setNewName('');
      setNewRoles([]);
      await loadShell();
      setSubject({ type: 'profile', key: created.id, name: newName || created.roles.join(' + ') });
    } catch (err) {
      toast.error(getApiErrorMessage(err, 'Could not create the profile'));
    }
  };

  const removeProfile = async (p: Profile) => {
    if (!window.confirm(`Delete "${p.name}"? Users on this combination fall back to their primary role.`)) {
      return;
    }
    try {
      await permissionService.deleteProfile(p.id);
      toast.success('Profile deleted');
      if (subject.type === 'profile' && subject.key === p.id) {
        setSubject({ type: 'role', key: 'sales_manager' });
      }
      await loadShell();
    } catch (err) {
      toast.error(getApiErrorMessage(err, 'Could not delete the profile'));
    }
  };

  // ── Render ─────────────────────────────────────────────────────────────────

  const subjectLabel =
    subject.type === 'role'
      ? roleLabel(subject.key)
      : (profiles.find((p) => p.id === subject.key)?.name ?? 'Profile');

  if (loading || !catalogue) {
    return (
      <Layout>
        <Loader />
      </Layout>
    );
  }

  return (
    <Layout>
      <div className={styles.page}>
        <div className={styles.header}>
          <div>
            <h1>Roles &amp; Permissions</h1>
            <p>
              Control what each role can do, module by module and action by action. Reports are
              granted one report at a time and are view-only for everyone — there is no export,
              print or download on any report, for any role.
            </p>
          </div>
        </div>

        <div className={styles.notice}>
          <strong>Admin is not listed.</strong>
          The admin role always has full access and is not editable. That is deliberate: a matrix
          able to revoke access to the matrix editor could lock you out of your own system.
        </div>

        <div className={styles.notice}>
          <strong>Need to change one person, not a whole role?</strong>
          Open <em>Employees</em>, then <em>User Roles</em> on their row. That sets permissions for
          that person alone, without creating a role or a profile for them.
        </div>

        {uncovered.length > 0 && (
          <div className={styles.warning}>
            <strong>
              {uncovered.length} role combination{uncovered.length === 1 ? '' : 's'} in use with no
              profile
            </strong>
            {uncovered.map((c) => (
              <div key={c.roleKey}>
                {c.roles.map(roleLabel).join(' + ')} — {c.userCount} user
                {c.userCount === 1 ? '' : 's'}, currently running on their primary role only.
              </div>
            ))}
            Create a profile below to set what these combinations may do. Roles are never merged
            automatically.
          </div>
        )}

        {/* ── Subject tabs ── */}
        <div className={styles.tabs}>
          {ASSIGNABLE_ROLES.filter((r) => r !== 'admin').map((role) => (
            <button
              key={role}
              type="button"
              className={`${styles.tab} ${
                subject.type === 'role' && subject.key === role ? styles.tabActive : ''
              }`}
              onClick={() => switchSubject({ type: 'role', key: role })}
            >
              {roleLabel(role)}
            </button>
          ))}
          {/* Legacy role, shown last and labelled as such — existing accounts still resolve
              against it, but nobody new should be assigned it. */}
          <button
            type="button"
            className={`${styles.tab} ${
              subject.type === 'role' && subject.key === 'employee' ? styles.tabActive : ''
            }`}
            onClick={() => switchSubject({ type: 'role', key: 'employee' })}
          >
            {roleLabel('employee')}
          </button>

          {profiles.map((p) => (
            <button
              key={p.id}
              type="button"
              className={`${styles.tab} ${styles.tabProfile} ${
                subject.type === 'profile' && subject.key === p.id ? styles.tabActive : ''
              }`}
              onClick={() => switchSubject({ type: 'profile', key: p.id, name: p.name })}
            >
              {p.name}
            </button>
          ))}
        </div>

        {policyLoading ? (
          <Loader />
        ) : (
          <>
            <PermissionEditor
              catalogue={catalogue}
              grants={grid.grants}
              reports={grid.reports}
              onToggle={grid.toggle}
              onToggleRow={grid.toggleRow}
              onToggleColumn={grid.toggleColumn}
              onToggleReport={grid.toggleReport}
              onToggleSurface={grid.toggleSurface}
              subjectLabel={subjectLabel}
            />

            {/* ── Profiles ── */}
            <h2 className={styles.sectionTitle}>Multi-role profiles</h2>
            <p style={{ margin: 0, color: '#64748b', fontSize: 14, maxWidth: '74ch' }}>
              When one person holds more than one role, their permissions are not merged
              automatically. Create a profile for that combination and set its permissions by hand
              — then assign it wherever the same mix occurs.
            </p>

            <div className={styles.profileGrid}>
              {profiles.map((p) => (
                <div key={p.id} className={styles.profileCard}>
                  <h4>{p.name}</h4>
                  <span className={styles.profileRoles}>{p.roles.map(roleLabel).join(' + ')}</span>
                  <div className={styles.profileMeta}>
                    <span>
                      {p.userCount} user{p.userCount === 1 ? '' : 's'}
                    </span>
                    {!p.isActive && <span className={styles.inactivePill}>Inactive</span>}
                  </div>
                  <div className={styles.profileActions}>
                    <button
                      type="button"
                      className={styles.secondaryButton}
                      onClick={() => switchSubject({ type: 'profile', key: p.id, name: p.name })}
                    >
                      Edit permissions
                    </button>
                    <button type="button" className={styles.dangerButton} onClick={() => removeProfile(p)}>
                      Delete
                    </button>
                  </div>
                </div>
              ))}
            </div>

            {showCreate ? (
              <div className={styles.formCard}>
                <div className={styles.field}>
                  <label htmlFor="profileName">Profile name</label>
                  <input
                    id="profileName"
                    type="text"
                    value={newName}
                    placeholder={
                      newRoles.length ? newRoles.map(roleLabel).join(' + ') : 'e.g. Rider + Warehouse'
                    }
                    onChange={(e) => setNewName(e.target.value)}
                  />
                </div>
                <div className={styles.field}>
                  <label>Roles in this combination (pick at least two)</label>
                  <div className={styles.roleChoices}>
                    {ASSIGNABLE_ROLES.filter((r) => r !== 'admin').map((r) => (
                      <label key={r} className={styles.roleChoice}>
                        <input
                          type="checkbox"
                          className={styles.check}
                          checked={newRoles.includes(r)}
                          onChange={() =>
                            setNewRoles((prev) =>
                              prev.includes(r) ? prev.filter((x) => x !== r) : [...prev, r],
                            )
                          }
                        />
                        {roleLabel(r)}
                      </label>
                    ))}
                  </div>
                </div>
                <div className={styles.headerActions}>
                  <button type="button" className={styles.primaryButton} onClick={createProfile}>
                    Create profile
                  </button>
                  <button
                    type="button"
                    className={styles.secondaryButton}
                    onClick={() => setShowCreate(false)}
                  >
                    Cancel
                  </button>
                </div>
              </div>
            ) : (
              <div>
                <button
                  type="button"
                  className={styles.secondaryButton}
                  onClick={() => setShowCreate(true)}
                >
                  New profile
                </button>
              </div>
            )}
          </>
        )}

        {grid.dirty && (
          <div className={styles.dirtyBar}>
            <span>Unsaved changes to {subjectLabel}</span>
            <div className={styles.headerActions}>
              <button
                type="button"
                className={styles.secondaryButton}
                onClick={() => loadPolicy(subject)}
                disabled={saving}
              >
                Discard
              </button>
              <button type="button" className={styles.primaryButton} onClick={save} disabled={saving}>
                {saving ? 'Saving…' : 'Save changes'}
              </button>
            </div>
          </div>
        )}
      </div>
    </Layout>
  );
}

export default function ProtectedPermissionsPage() {
  return (
    // Not `permission="settings:edit"`: the matrix editor must not be reachable through a cell
    // the matrix itself controls.
    <ProtectedRoute allowedRoles={['admin']}>
      <PermissionsPage />
    </ProtectedRoute>
  );
}
