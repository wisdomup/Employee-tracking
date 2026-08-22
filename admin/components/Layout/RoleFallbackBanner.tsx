import React from 'react';
import { useAuth } from '../../contexts/AuthContext';
import { isAdmin, roleLabel } from '../../utils/permissions';

/**
 * Shown when a user holds several roles but no permission profile covers that combination.
 *
 * The resolver falls back to their primary role in that case — deliberately, because the
 * alternatives are worse: unioning the roles is the auto-merge the requirement forbids, and
 * denying everything locks out a real person over an unfinished config screen.
 *
 * But a silent fallback is its own problem. Someone given Warehouse Staff on top of Rider
 * would find the warehouse screens simply missing, with nothing to explain why, and would
 * reasonably report it as a bug. This says what happened and who can fix it.
 *
 * Styled inline rather than through a module: it is four rules, and a near-duplicate of
 * `FrozenAccountBanner.module.scss` would be the kind of copy that drifts.
 */
const RoleFallbackBanner: React.FC = () => {
  const { user, access } = useAuth();

  if (!access || isAdmin()) return null;
  if (access.source !== 'primary-role-fallback') return null;

  const held = user?.roles?.length ? user.roles : user?.role ? [user.role] : [];
  const primary = user?.role;

  return (
    <div
      role="status"
      style={{
        background: '#fffbeb',
        borderLeft: '3px solid #d97706',
        borderRadius: '0 6px 6px 0',
        padding: '11px 16px',
        margin: '0 0 16px',
        fontSize: 13.5,
        lineHeight: 1.55,
        color: '#78350f',
      }}
    >
      <strong style={{ display: 'block', marginBottom: 2 }}>
        Some of your roles are not active yet
      </strong>
      You are assigned {held.map(roleLabel).join(' + ')}, but this combination has no permission
      set. Until an admin creates one, you have the permissions of {roleLabel(primary)} only. Ask
      an admin to set it up under Roles &amp; Permissions.
    </div>
  );
};

export default RoleFallbackBanner;
