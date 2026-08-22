import React, { useEffect, useMemo, useState } from 'react';
import { permissionService, type Profile } from '../../services/permissionService';
import { ASSIGNABLE_ROLES, roleLabel } from '../../utils/permissions';
import styles from '../../styles/Permissions.module.scss';

/**
 * Extra roles on top of a user's primary one.
 *
 * Kept separate from the main Role dropdown rather than turning that into a multi-select,
 * because the primary role is not just "the first one selected" — `managerId`, `warehouseId`,
 * the late-start freeze sweep and the analytics scoping all key off it. A multi-select would
 * make "which one is primary" ambiguous exactly where it matters most.
 *
 * The warning is the important part of this component. Combining roles does NOT combine their
 * permissions: without a profile covering the combination, the person resolves to their
 * primary role alone. Saying so here is the difference between an admin creating a profile and
 * an admin wondering why the second role did nothing.
 */
interface Props {
  primaryRole: string;
  value: string[];
  onChange: (extraRoles: string[]) => void;
  disabled?: boolean;
}

const AdditionalRoles: React.FC<Props> = ({ primaryRole, value, onChange, disabled }) => {
  const [profiles, setProfiles] = useState<Profile[]>([]);

  useEffect(() => {
    permissionService
      .listProfiles()
      .then(setProfiles)
      // A failed lookup only costs the coverage hint; the picker itself still works, and
      // blocking role assignment on it would be worse than showing no hint.
      .catch(() => setProfiles([]));
  }, []);

  const options = useMemo(
    () => ASSIGNABLE_ROLES.filter((r) => r !== 'admin' && r !== primaryRole),
    [primaryRole],
  );

  const combined = useMemo(
    () => [...new Set([primaryRole, ...value])].sort(),
    [primaryRole, value],
  );

  const coveringProfile = useMemo(() => {
    if (combined.length < 2) return null;
    const key = combined.join('+');
    return profiles.find((p) => p.isActive && p.roleKey === key) ?? null;
  }, [combined, profiles]);

  const toggle = (role: string) => {
    onChange(value.includes(role) ? value.filter((r) => r !== role) : [...value, role]);
  };

  return (
    <div className={styles.field}>
      <label>Additional roles</label>

      <div className={styles.roleChoices}>
        {options.map((role) => (
          <label key={role} className={styles.roleChoice}>
            <input
              type="checkbox"
              className={styles.check}
              checked={value.includes(role)}
              onChange={() => toggle(role)}
              disabled={disabled}
            />
            {roleLabel(role)}
          </label>
        ))}
      </div>

      {value.length > 0 &&
        (coveringProfile ? (
          <div className={styles.notice}>
            <strong>Using profile &ldquo;{coveringProfile.name}&rdquo;</strong>
            This combination has a saved permission set. Edit it under Roles &amp; Permissions.
          </div>
        ) : (
          <div className={styles.warning}>
            <strong>No profile covers this combination yet</strong>
            Roles are never merged automatically. Until an admin creates a profile for{' '}
            {combined.map(roleLabel).join(' + ')} and sets its permissions, this person will have
            the permissions of their primary role ({roleLabel(primaryRole)}) only.
          </div>
        ))}
    </div>
  );
};

export default AdditionalRoles;
