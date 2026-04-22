/** Matches `backend/src/constants/global.ts` ROLES values (lowercase). */
const ROLE_SLUGS = new Set([
  'admin',
  'employee',
  'warehouse_manager',
  'order_taker',
  'delivery_man',
]);

/**
 * Human-facing label for a populated User (or similar).
 * Uses optional `fullName` when set; otherwise prefers `userID` when `username` is empty
 * or equals a role slug (e.g. login "admin"), then `username`, then `userID`.
 */
export function employeeDisplayLabel(u: unknown): string {
  if (!u || typeof u !== 'object') return '';
  const o = u as Record<string, unknown>;
  const fullName = typeof o.fullName === 'string' ? o.fullName.trim() : '';
  if (fullName) return fullName;

  const username = typeof o.username === 'string' ? o.username.trim() : '';
  const userID = o.userID != null ? String(o.userID).trim() : '';

  const usernameIsRoleSlug = username !== '' && ROLE_SLUGS.has(username.toLowerCase());

  if (userID && (usernameIsRoleSlug || !username)) return userID;
  if (username) return username;
  if (userID) return userID;
  return '';
}
