import { Router } from 'express';
import { authMiddleware } from '../../middleware/auth.middleware';
import { requireRoles } from '../../middleware/roles.middleware';
import { validate } from '../../middleware/validate.middleware';
import { createDealerSchema, updateDealerSchema } from './dto/dealers.schemas';
import * as controller from './dealers.controller';

const router = Router();

router.use(authMiddleware);

/**
 * @openapi
 * /api/dealers:
 *   post:
 *     tags: [Dealers]
 *     summary: Create a new dealer [Admin, Employee]
 *     security:
 *       - bearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [name, phone]
 *             properties:
 *               name: { type: string, example: Asad Ali }
 *               shopName: { type: string, example: ABC Store }
 *               phone: { type: string, example: '03001234567' }
 *               email: { type: string, example: store@example.com }
 *               latitude: { type: number, example: 31.5204 }
 *               longitude: { type: number, example: 74.3587 }
 *               shopImage: { type: string }
 *               status: { type: string, enum: [active, inactive] }
 *               address:
 *                 type: object
 *                 properties:
 *                   street: { type: string }
 *                   city: { type: string }
 *                   state: { type: string }
 *                   country: { type: string }
 *                   postalCode: { type: string }
 *     responses:
 *       201:
 *         description: Dealer created successfully
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/Dealer'
 *       400: { description: Validation error }
 *       401: { description: Unauthorized }
 */
router.post('/', requireRoles('admin', 'employee'), validate(createDealerSchema), controller.create);

/**
 * @openapi
 * /api/dealers:
 *   get:
 *     tags: [Dealers]
 *     summary: Get all dealers with optional filters [Admin, Employee]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: query
 *         name: status
 *         schema: { type: string, enum: [active, inactive] }
 *         description: Filter by dealer status
 *       - in: query
 *         name: search
 *         schema: { type: string }
 *         description: Search dealers by name, phone or email (partial match)
 *     responses:
 *       200:
 *         description: List of dealers
 *         content:
 *           application/json:
 *             schema:
 *               type: array
 *               items:
 *                 $ref: '#/components/schemas/Dealer'
 *       401: { description: Unauthorized }
 */
router.get('/', requireRoles('admin', 'employee'), controller.findAll);

/**
 * @openapi
 * /api/dealers/nearby:
 *   get:
 *     tags: [Dealers]
 *     summary: Find dealers near a GPS coordinate [Admin, Employee]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: query
 *         name: lat
 *         required: true
 *         schema: { type: number }
 *         description: Latitude of the search origin
 *       - in: query
 *         name: lng
 *         required: true
 *         schema: { type: number }
 *         description: Longitude of the search origin
 *       - in: query
 *         name: radius
 *         required: true
 *         schema: { type: number }
 *         description: Search radius in meters
 *     responses:
 *       200:
 *         description: Dealers within the given radius
 *         content:
 *           application/json:
 *             schema:
 *               type: array
 *               items:
 *                 $ref: '#/components/schemas/Dealer'
 *       400: { description: Missing or invalid lat/lng/radius parameters }
 *       401: { description: Unauthorized }
 */
router.get('/nearby', requireRoles('admin', 'employee'), controller.findNearby);

/**
 * @openapi
 * /api/dealers/{id}:
 *   get:
 *     tags: [Dealers]
 *     summary: Get a dealer by ID [Admin, Employee]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema: { type: string }
 *         description: MongoDB ObjectId of the dealer
 *     responses:
 *       200:
 *         description: Returns the dealer
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/Dealer'
 *       401: { description: Unauthorized }
 *       404: { description: Dealer not found }
 */
router.get('/:id', requireRoles('admin', 'employee'), controller.findOne);

/**
 * @openapi
 * /api/dealers/{id}:
 *   put:
 *     tags: [Dealers]
 *     summary: Update a dealer by ID [Admin, Employee]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema: { type: string }
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               name: { type: string }
 *               shopName: { type: string }
 *               phone: { type: string }
 *               email: { type: string }
 *               latitude: { type: number }
 *               longitude: { type: number }
 *               shopImage: { type: string }
 *               status: { type: string, enum: [active, inactive] }
 *     responses:
 *       200:
 *         description: Dealer updated successfully
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/Dealer'
 *       400: { description: Validation error }
 *       401: { description: Unauthorized }
 *       404: { description: Dealer not found }
 */
router.put('/:id', requireRoles('admin', 'employee'), validate(updateDealerSchema), controller.update);

/**
 * @openapi
 * /api/dealers/{id}:
 *   delete:
 *     tags: [Dealers]
 *     summary: Delete a dealer by ID [Admin]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema: { type: string }
 *     responses:
 *       200: { description: Dealer deleted successfully }
 *       401: { description: Unauthorized }
 *       403: { description: Forbidden — admin role required }
 *       404: { description: Dealer not found }
 */
router.delete('/:id', requireRoles('admin'), controller.remove);
router.patch('/:id/restore', requireRoles('admin'), controller.restore);
router.delete('/:id/permanent', requireRoles('admin'), controller.removePermanent);

export default router;
