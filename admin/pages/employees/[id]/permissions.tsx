import React, { useCallback, useEffect, useState } from 'react';
import { useRouter } from 'next/router';
import Link from 'next/link';
import { ArrowLeft } from '@phosphor-icons/react';
import { toast } from 'react-toastify';
import Layout from '../../../components/Layout/Layout';
import ProtectedRoute from '../../../components/Auth/ProtectedRoute';
import Loader from '../../../components/UI/Loader';
import PermissionEditor from '../../../components/Permissions/PermissionEditor';
import { usePermissionGrid } from '../../../hooks/usePermissionGrid';
import {
  permissionService,
  type Catalogue,
  type UserAccessDetail,
} from '../../../services/permissionService';
import { roleLabel } from '../../../utils/permissions';
import { getApiErrorMessage } from '../../../utils/apiError';
import styles from '../../../styles/Permissions.module.scss';

/**
 * Edit one person's permissions directly, without touching their role or creating a profile.
 *
 * ## How this differs from the role matrix
 *
 * Saving here writes a **per-user override**, and an override replaces their role entirely
 * rather than adding to it. That is the whole point — an admin wants "this one person, exactly
 * these permissions" without inventing a role nobody else will ever hold.
 *
 * The trade is that the person stops tracking their role. Widen the Salesman role later and
 * this person will not get the new permission, because they are no longer being answered by
 * the Salesman policy. The banner says so, and **Reset to role** removes the override in one
 * click.
 *
 * ## Why the grid opens pre-ticked
 *
 * It loads with what this person can do *right now*, resolved exactly as a real request
 * resolves. Opening on a blank grid would make every override start by silently revoking
 * everything, and would turn a small adjustment into a memory test. Nothing is written until
 * Save, so the prefill is a starting point, not a grant.
 */
function UserPermissionsPage() {
  const router = useRouter();
  const { id } = router.query;

  const [catalogue, setCatalogue] = useState<Catalogue | null>(null);
  const [detail, setDetail] = useState<UserAccessDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  const grid = usePermissionGrid(catalogue);

  const load = useCallback(async (userId: string) => {
    setLoading(true);
    try {
      const [cat, det] = await Promise.all([
        permissionService.getCatalogue(),
        permissionService.getUserAccess(userId),
      ]);
      setCatalogue(cat);
      setDetail(det);
      grid.reset(det.permissions, det.reports);
    } catch (err) {
      toast.error(getApiErrorMessage(err, "Could not load this person's permissions"));
    } finally {
      setLoading(false);
    }
    // `grid.reset` is stable (useCallback with no deps); listing `grid` would re-run on every
    // keystroke-sized state change and refetch the page.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (!router.isReady || typeof id !== 'string') return;
    void load(id);
  }, [router.isReady, id, load]);

  const save = async () => {
    if (typeof id !== 'string') return;
    setSaving(true);
    try {
      await permissionService.saveUserPolicy(id, grid.toPermissions(), grid.toReports());
      grid.markClean();
      toast.success('Saved. This person now has their own permission set.');
      await load(id);
    } catch (err) {
      toast.error(getApiErrorMessage(err, 'Could not save these permissions'));
    } finally {
      setSaving(false);
    }
  };

  const resetToRole = async () => {
    if (typeof id !== 'string' || !detail) return;

    const roles = detail.user.roles.map(roleLabel).join(' + ');
    if (
      !window.confirm(
        `Remove this person's own permission set?\n\n` +
          `Their access goes back to being decided by their role (${roles}). ` +
          `Anything you customised here is discarded.`,
      )
    ) {
      return;
    }

    try {
      await permissionService.clearUserPolicy(id);
      toast.success('Removed. Their role decides again.');
      await load(id);
    } catch (err) {
      toast.error(getApiErrorMessage(err, 'Could not remove the override'));
    }
  };

  if (loading || !catalogue || !detail) {
    return (
      <Layout>
        <Loader />
      </Layout>
    );
  }

  const person = detail.user;
  const displayName = person.fullName?.trim() || person.username;

  /** Where their access comes from today, in words an admin can act on. */
  const sourceLine = (() => {
    if (detail.hasOverride) return 'Their own permission set — their roles are not being used.';
    if (detail.source === 'profile') {
      return `The profile "${detail.profileName}", covering ${person.roles.map(roleLabel).join(' + ')}.`;
    }
    if (detail.source === 'primary-role-fallback') {
      return (
        `Their primary role ${roleLabel(person.role)} only. They hold ` +
        `${person.roles.map(roleLabel).join(' + ')} but no profile covers that combination.`
      );
    }
    if (detail.source === 'role') return `Their role, ${roleLabel(person.role)}.`;
    return 'Nothing is granting them access.';
  })();

  return (
    <Layout>
      <div className={styles.page}>
        <div className={styles.header}>
          <div>
            <Link href="/employees" className={styles.rowToggle} style={{ display: 'inline-flex', gap: 6, alignItems: 'center', marginBottom: 10 }}>
              <ArrowLeft size={14} weight="bold" aria-hidden />
              Back to Employees
            </Link>
            <h1>Permissions — {displayName}</h1>
            <p>
              {person.userID ? `${person.userID} · ` : ''}
              {person.roles.map(roleLabel).join(' + ')}
              {person.isActive ? '' : ' · inactive'}
            </p>
          </div>
          <div className={styles.headerActions}>
            {detail.hasOverride && (
              <button type="button" className={styles.dangerButton} onClick={resetToRole}>
                Reset to role
              </button>
            )}
          </div>
        </div>

        {detail.hasOverride ? (
          <div className={styles.warning}>
            <strong>This person has their own permission set</strong>
            Their roles are no longer deciding what they can do — everything below is what
            applies. If you later widen {roleLabel(person.role)}, this person will not pick the
            change up. Use <em>Reset to role</em> to put them back on normal role behaviour.
          </div>
        ) : (
          <div className={styles.notice}>
            <strong>Currently following: {sourceLine}</strong>
            The grid below shows what they can do right now. Change anything and save, and this
            person gets their own set — from then on their role stops applying to them.
          </div>
        )}

        {detail.source === 'primary-role-fallback' && !detail.hasOverride && (
          <div className={styles.warning}>
            <strong>Heads up — a role combination with no profile</strong>
            They hold {person.roles.map(roleLabel).join(' + ')} but are running on{' '}
            {roleLabel(person.role)} alone. Saving here fixes it for this one person; creating a
            profile under Roles &amp; Permissions fixes it for everyone with the same mix.
          </div>
        )}

        <PermissionEditor
          catalogue={catalogue}
          grants={grid.grants}
          reports={grid.reports}
          onToggle={grid.toggle}
          onToggleRow={grid.toggleRow}
          onToggleColumn={grid.toggleColumn}
          onToggleReport={grid.toggleReport}
          onToggleSurface={grid.toggleSurface}
          subjectLabel={displayName}
        />

        {grid.dirty && (
          <div className={styles.dirtyBar}>
            <span>
              {detail.hasOverride
                ? `Unsaved changes to ${displayName}`
                : `Unsaved — saving gives ${displayName} their own permission set`}
            </span>
            <div className={styles.headerActions}>
              <button
                type="button"
                className={styles.secondaryButton}
                onClick={() => grid.reset(detail.permissions, detail.reports)}
                disabled={saving}
              >
                Discard
              </button>
              <button type="button" className={styles.primaryButton} onClick={save} disabled={saving}>
                {saving ? 'Saving…' : 'Save permissions'}
              </button>
            </div>
          </div>
        )}
      </div>
    </Layout>
  );
}

export default function ProtectedUserPermissionsPage() {
  return (
    // Not a matrix cell: editing who can do what must not be reachable through a checkbox the
    // matrix itself controls.
    <ProtectedRoute allowedRoles={['admin']}>
      <UserPermissionsPage />
    </ProtectedRoute>
  );
}
