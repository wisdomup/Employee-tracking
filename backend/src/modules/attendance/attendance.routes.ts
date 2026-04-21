import { Router } from 'express';
import { authMiddleware } from '../../middleware/auth.middleware';
import { requireRoles } from '../../middleware/roles.middleware';
import { validate } from '../../middleware/validate.middleware';
import {
  checkInSchema,
  checkOutSchema,
  adminCreateSchema,
  updateAttendanceSchema,
  updateNoteSchema,
} from './dto/attendance.schemas';
import * as controller from './attendance.controller';

const router = Router();

router.use(authMiddleware);

/**
 * @openapi
 * /api/attendance/check-in:
 *   post:
 *     tags: [Attendance]
 *     summary: Employee check-in with GPS location
 *     security:
 *       - bearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [latitude, longitude]
 *             properties:
 *               latitude: { type: number }
 *               longitude: { type: number }
 *               note: { type: string }
 *     responses:
 *       201: { description: Checked in successfully }
 *       409: { description: Already checked in today }
 */
router.post('/check-in', validate(checkInSchema), controller.checkIn);

/**
 * @openapi
 * /api/attendance/check-out:
 *   post:
 *     tags: [Attendance]
 *     summary: Employee check-out with GPS location
 *     security:
 *       - bearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [latitude, longitude]
 *             properties:
 *               latitude: { type: number }
 *               longitude: { type: number }
 *               note: { type: string }
 *     responses:
 *       200: { description: Checked out successfully }
 *       400: { description: Not checked in today }
 *       409: { description: Already checked out today }
 */
router.post('/check-out', validate(checkOutSchema), controller.checkOut);

/**
 * @openapi
 * /api/attendance/today:
 *   get:
 *     tags: [Attendance]
 *     summary: Get today's attendance record for the logged-in user
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       200: { description: Today's record or null }
 */
router.get('/today', controller.getToday);

/**
 * @openapi
 * /api/attendance:
 *   post:
 *     tags: [Attendance]
 *     summary: Admin — manually create an attendance record for any employee
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       201: { description: Record created }
 *       409: { description: Record already exists for that employee+date }
 */
router.post('/', requireRoles('admin'), validate(adminCreateSchema), controller.adminCreate);

/**
 * @openapi
 * /api/attendance:
 *   get:
 *     tags: [Attendance]
 *     summary: List attendance records (admin sees all with filters; non-admin sees own)
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: query
 *         name: employeeId
 *         schema: { type: string }
 *         description: Admin only — filter by employee
 *       - in: query
 *         name: startDate
 *         schema: { type: string, format: date }
 *       - in: query
 *         name: endDate
 *         schema: { type: string, format: date }
 *     responses:
 *       200: { description: List of attendance records }
 */
router.get('/', controller.findAll);

/**
 * @openapi
 * /api/attendance/{id}:
 *   get:
 *     tags: [Attendance]
 *     summary: Get a single attendance record
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema: { type: string }
 *     responses:
 *       200: { description: Attendance record }
 *       403: { description: Not your record }
 *       404: { description: Not found }
 */
router.get('/:id', controller.findOne);

/**
 * @openapi
 * /api/attendance/{id}:
 *   patch:
 *     tags: [Attendance]
 *     summary: Update attendance record (admin — any field; non-admin — note only on own record)
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema: { type: string }
 *     responses:
 *       200: { description: Updated record }
 *       403: { description: Forbidden }
 *       404: { description: Not found }
 */
router.patch(
  '/:id',
  (req, _res, next) => {
    const schema = req.user?.role === 'admin' ? updateAttendanceSchema : updateNoteSchema;
    return validate(schema)(req, _res, next);
  },
  controller.update,
);

/**
 * @openapi
 * /api/attendance/{id}:
 *   delete:
 *     tags: [Attendance]
 *     summary: Soft-delete an attendance record [Admin]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema: { type: string }
 *     responses:
 *       200: { description: Moved to trash }
 */
router.delete('/:id', requireRoles('admin'), controller.remove);

router.patch('/:id/restore', requireRoles('admin'), controller.restoreRecord);
router.delete('/:id/permanent', requireRoles('admin'), controller.removePermanent);

export default router;
