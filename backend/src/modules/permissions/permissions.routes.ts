import { Router } from 'express';
import { authMiddleware } from '../../middleware/auth.middleware';
import { requireAdmin } from '../../middleware/permission.middleware';
import * as controller from './permissions.controller';

const router = Router();

router.use(authMiddleware);

/**
 * @openapi
 * /api/permissions/me:
 *   get:
 *     tags: [Permissions]
 *     summary: The signed-in user's resolved permissions and reports
 *     description: >
 *       Backs the admin panel's `can()`. Admin resolves to the full catalogue rather than to
 *       an empty set, so the client needs no special case of its own. `source` reports which
 *       policy answered — `primary-role-fallback` means the user holds a role combination no
 *       profile covers yet.
 *     security: [{ bearerAuth: [] }]
 *     responses:
 *       200: { description: "{ isAdmin, permissions[], reports[], source }" }
 */
router.get('/me', controller.me);

/**
 * Everything below edits the matrix and is the super-admin's alone.
 *
 * `requireAdmin()` rather than a permission key, on purpose: routing matrix editing through a
 * matrix cell would ship a checkbox capable of revoking the ability to un-revoke it.
 */
router.use(requireAdmin());

/**
 * @openapi
 * /api/permissions/catalogue:
 *   get:
 *     tags: [Permissions]
 *     summary: Every module, action and report the matrix can gate [Admin]
 *     security: [{ bearerAuth: [] }]
 *     responses:
 *       200: { description: "{ actions[], modules[], reports[], editableRoles[] }" }
 */
router.get('/catalogue', controller.catalogue);

/**
 * @openapi
 * /api/permissions/roles/{role}:
 *   get:
 *     tags: [Permissions]
 *     summary: One role's saved matrix [Admin]
 *     security: [{ bearerAuth: [] }]
 *     parameters:
 *       - in: path
 *         name: role
 *         required: true
 *         schema: { type: string }
 *     responses:
 *       200: { description: "{ grants{}, reports[], isSystem, updatedAt }" }
 *   put:
 *     tags: [Permissions]
 *     summary: Replace one role's matrix [Admin]
 *     description: >
 *       Full replacement, not a patch — anything absent from `permissions` is turned off.
 *       The editor always sends the complete grid, so a partial update would silently mean
 *       "leave the boxes I unticked alone", which is the opposite of what unticking means.
 *     security: [{ bearerAuth: [] }]
 *     responses:
 *       200: { description: The saved policy }
 *       400: { description: Unknown permission, unknown report, or the admin role }
 */
router.get('/roles/:role', controller.getRolePolicy);
router.put('/roles/:role', controller.saveRolePolicy);

/**
 * @openapi
 * /api/permissions/profiles:
 *   get:
 *     tags: [Permissions]
 *     summary: Named multi-role profiles, with how many users hold each combination [Admin]
 *     security: [{ bearerAuth: [] }]
 *     responses:
 *       200: { description: "{ profiles[] }" }
 *   post:
 *     tags: [Permissions]
 *     summary: Create a profile for a role combination [Admin]
 *     security: [{ bearerAuth: [] }]
 *     responses:
 *       201: { description: "{ id, roleKey, roles[] }" }
 *       400: { description: Fewer than two roles, unknown role, or the combination already has a profile }
 */
router.get('/profiles', controller.listProfiles);
router.post('/profiles', controller.createProfile);

/**
 * @openapi
 * /api/permissions/profiles/uncovered:
 *   get:
 *     tags: [Permissions]
 *     summary: Role combinations users hold that no profile covers [Admin]
 *     description: >
 *       These users resolve to their primary role only. They can work, but with less access
 *       than the combination implies — the admin screen shows this as a warning list.
 *     security: [{ bearerAuth: [] }]
 *     responses:
 *       200: { description: "{ combinations[] }" }
 */
// Registered before `/profiles/:id` so Express does not read "uncovered" as an id.
router.get('/profiles/uncovered', controller.uncovered);

router.get('/profiles/:id', controller.getProfilePolicy);
router.put('/profiles/:id', controller.saveProfilePolicy);
router.patch('/profiles/:id/active', controller.setProfileActive);
router.delete('/profiles/:id', controller.deleteProfile);

/**
 * @openapi
 * /api/permissions/users/{userId}/roles:
 *   put:
 *     tags: [Permissions]
 *     summary: Assign roles to a user [Admin]
 *     description: >
 *       First entry becomes the primary role. Responds with `needsProfile: true` when the
 *       combination has no profile yet, so the UI can offer to create one instead of leaving
 *       the user quietly on their primary role.
 *     security: [{ bearerAuth: [] }]
 *     responses:
 *       200: { description: "{ userId, role, roles[], needsProfile }" }
 */
router.put('/users/:userId/roles', controller.setUserRoles);

export default router;
