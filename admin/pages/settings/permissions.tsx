import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { toast } from 'react-toastify';
import Layout from '../../components/Layout/Layout';
import ProtectedRoute from '../../components/Auth/ProtectedRoute';
import Loader from '../../components/UI/Loader';
import {
  permissionService,
  type ActionId,
  type Catalogue,
  type ModuleGrant,
  type Profile,
  type UncoveredCombination,
} from '../../services/permissionService';
import { roleLabel, ASSIGNABLE_ROLES } from '../../utils/permissions';
import { getApiErrorMessage } from '../../utils/apiError';
import styles from '../../styles/Permissions.module.scss';

/**
 * The permission matrix editor.
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
 */

const ACTION_LABELS: Record<ActionId, string> = {
  view: 'View',
  add: 'Add',
  edit: 'Edit',
  delete: 'Delete',
  change: 'Change',
};

type Subject = { type: 'role'; key: string } | { type: 'profile'; key: string; name: string };

function PermissionsPage() {
  const [catalogue, setCatalogue] = useState<Catalogue | null>(null);
  const [profiles, setProfiles] = useState<Profile[]>([]);
  const [uncovered, setUncovered] = useState<UncoveredCombination[]>([]);

  const [subject, setSubject] = useState<Subject>({ type: 'role', key: 'sales_manager' });

  const [grants, setGrants] = useState<Record<string, ModuleGrant>>({});
  const [reports, setReports] = useState<Set<string>>(new Set());
  const [dirty, setDirty] = useState(false);

  const [loading, setLoading] = useState(true);
  const [policyLoading, setPolicyLoading] = useState(false);
  const [saving, setSaving] = useState(false);

  const [showCreate, setShowCreate] = useState(false);
  const [newName, setNewName] = useState('');
  const [newRoles, setNewRoles] = useState<string[]>([]);

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
      setGrants(policy.grants ?? {});
      setReports(new Set(policy.reports ?? []));
      setDirty(false);
    } catch (err) {
      toast.error(getApiErrorMessage(err, 'Could not load this permission set'));
    } finally {
      setPolicyLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadShell();
  }, [loadShell]);

  useEffect(() => {
    void loadPolicy(subject);
  }, [subject, loadPolicy]);

  // Unsaved ticks are easy to lose to a stray click on another tab, and the only signal that
  // it happened would be the permissions quietly not changing.
  useEffect(() => {
    if (!dirty) return;
    const warn = (e: BeforeUnloadEvent) => {
      e.preventDefault();
      e.returnValue = '';
    };
    window.addEventListener('beforeunload', warn);
    return () => window.removeEventListener('beforeunload', warn);
  }, [dirty]);

  // ── Editing ────────────────────────────────────────────────────────────────

  const switchSubject = (next: Subject) => {
    if (dirty && !window.confirm('You have unsaved changes. Discard them?')) return;
    setSubject(next);
  };

  const toggle = (moduleId: string, action: ActionId) => {
    setGrants((prev) => {
      const grant = { ...(prev[moduleId] ?? {}) };
      grant[action] = !grant[action];
      return { ...prev, [moduleId]: grant };
    });
    setDirty(true);
  };

  /** Tick or clear every action a module supports. */
  const toggleRow = (moduleId: string, actions: ActionId[]) => {
    setGrants((prev) => {
      const grant = prev[moduleId] ?? {};
      const allOn = actions.every((a) => grant[a]);
      const next: ModuleGrant = {};
      for (const a of actions) next[a] = !allOn;
      return { ...prev, [moduleId]: next };
    });
    setDirty(true);
  };

  /** Tick or clear one action down every module that supports it. */
  const toggleColumn = (action: ActionId) => {
    if (!catalogue) return;
    const applicable = catalogue.modules.filter((m) => m.actions.includes(action));
    const allOn = applicable.every((m) => grants[m.id]?.[action]);

    setGrants((prev) => {
      const next = { ...prev };
      for (const m of applicable) {
        next[m.id] = { ...(next[m.id] ?? {}), [action]: !allOn };
      }
      return next;
    });
    setDirty(true);
  };

  const toggleReport = (reportId: string) => {
    setReports((prev) => {
      const next = new Set(prev);
      if (next.has(reportId)) next.delete(reportId);
      else next.add(reportId);
      return next;
    });
    setDirty(true);
  };

  const toggleSurface = (surface: string) => {
    if (!catalogue) return;
    const ids = catalogue.reports.filter((r) => r.surface === surface).map((r) => r.id);
    const allOn = ids.every((id) => reports.has(id));

    setReports((prev) => {
      const next = new Set(prev);
      for (const id of ids) {
        if (allOn) next.delete(id);
        else next.add(id);
      }
      return next;
    });
    setDirty(true);
  };

  const save = async () => {
    if (!catalogue) return;
    setSaving(true);
    try {
      // Only send cells the module actually supports. A stale `true` on an action that was
      // removed from a module would be rejected by the API, and the admin would see a
      // validation error for a checkbox no longer on their screen.
      const permissions: string[] = [];
      for (const m of catalogue.modules) {
        for (const a of m.actions) {
          if (grants[m.id]?.[a]) permissions.push(`${m.id}:${a}`);
        }
      }

      const reportIds = [...reports].filter((id) => catalogue.reports.some((r) => r.id === id));

      if (subject.type === 'role') {
        await permissionService.saveRolePolicy(subject.key, permissions, reportIds);
      } else {
        await permissionService.saveProfilePolicy(subject.key, permissions, reportIds);
      }

      setDirty(false);
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

  const surfaces = useMemo(() => {
    if (!catalogue) return [];
    const order: string[] = [];
    for (const r of catalogue.reports) if (!order.includes(r.surface)) order.push(r.surface);
    return order.map((surface) => ({
      surface,
      items: catalogue.reports.filter((r) => r.surface === surface),
    }));
  }, [catalogue]);

  const groups = useMemo(() => {
    if (!catalogue) return [];
    const order: string[] = [];
    for (const m of catalogue.modules) if (!order.includes(m.group)) order.push(m.group);
    return order.map((group) => ({
      group,
      items: catalogue.modules.filter((m) => m.group === group),
    }));
  }, [catalogue]);

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

  const grantedCount = catalogue.modules.reduce(
    (n, m) => n + m.actions.filter((a) => grants[m.id]?.[a]).length,
    0,
  );

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
            {/* ── Module matrix ── */}
            <h2 className={styles.sectionTitle}>
              Modules — {subjectLabel}{' '}
              <span className={styles.reportCount}>({grantedCount} granted)</span>
            </h2>

            <div className={styles.matrixWrap}>
              <table className={styles.matrix}>
                <thead>
                  <tr>
                    <th>Module</th>
                    {catalogue.actions.map((a) => (
                      <th key={a} className={styles.actionCell}>
                        {ACTION_LABELS[a]}
                        <button
                          type="button"
                          className={styles.colToggle}
                          onClick={() => toggleColumn(a)}
                        >
                          all
                        </button>
                      </th>
                    ))}
                    <th />
                  </tr>
                </thead>
                <tbody>
                  {groups.map(({ group, items }) => (
                    <React.Fragment key={group}>
                      <tr className={styles.groupRow}>
                        <td colSpan={catalogue.actions.length + 2}>{group}</td>
                      </tr>
                      {items.map((m) => (
                        <tr key={m.id}>
                          <td className={styles.moduleCell}>
                            {m.label}
                            {m.changeMeans && (
                              <span className={styles.changeHint}>Change: {m.changeMeans}</span>
                            )}
                          </td>
                          {catalogue.actions.map((a) =>
                            m.actions.includes(a) ? (
                              <td key={a} className={styles.actionCell}>
                                <input
                                  type="checkbox"
                                  className={styles.check}
                                  checked={!!grants[m.id]?.[a]}
                                  onChange={() => toggle(m.id, a)}
                                  aria-label={`${m.label} — ${ACTION_LABELS[a]}`}
                                />
                              </td>
                            ) : (
                              <td
                                key={a}
                                className={styles.naCell}
                                title={`${ACTION_LABELS[a]} does not apply to ${m.label}`}
                              >
                                n/a
                              </td>
                            ),
                          )}
                          <td>
                            <button
                              type="button"
                              className={styles.rowToggle}
                              onClick={() => toggleRow(m.id, m.actions)}
                            >
                              all
                            </button>
                          </td>
                        </tr>
                      ))}
                    </React.Fragment>
                  ))}
                </tbody>
              </table>
            </div>

            {/* ── Reports ── */}
            <h2 className={styles.sectionTitle}>
              Reports — {subjectLabel}{' '}
              <span className={styles.reportCount}>
                ({reports.size} of {catalogue.reports.length})
              </span>
            </h2>

            {surfaces.map(({ surface, items }) => {
              const on = items.filter((r) => reports.has(r.id)).length;
              return (
                <div key={surface} className={styles.reportSurface}>
                  <div className={styles.reportSurfaceHead}>
                    <h3>{surface}</h3>
                    <span className={styles.reportCount}>
                      {on} / {items.length}
                      <button
                        type="button"
                        className={styles.colToggle}
                        onClick={() => toggleSurface(surface)}
                      >
                        {on === items.length ? 'clear all' : 'select all'}
                      </button>
                    </span>
                  </div>
                  <div className={styles.reportList}>
                    {items.map((r) => (
                      <label key={r.id} className={styles.reportItem}>
                        <input
                          type="checkbox"
                          className={styles.check}
                          checked={reports.has(r.id)}
                          onChange={() => toggleReport(r.id)}
                        />
                        {r.label}
                      </label>
                    ))}
                  </div>
                  <p className={styles.viewOnlyNote}>
                    View only. No export, print or download is available on these reports for any
                    role.
                  </p>
                </div>
              );
            })}

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
                  <span className={styles.profileRoles}>
                    {p.roles.map(roleLabel).join(' + ')}
                  </span>
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
                    <button
                      type="button"
                      className={styles.dangerButton}
                      onClick={() => removeProfile(p)}
                    >
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

        {dirty && (
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
              <button
                type="button"
                className={styles.primaryButton}
                onClick={save}
                disabled={saving}
              >
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
