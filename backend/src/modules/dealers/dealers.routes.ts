import { Router } from 'express';
import { authMiddleware } from '../../middleware/auth.middleware';
import { requireRoles } from '../../middleware/roles.middleware';
import { validate } from '../../middleware/validate.middleware';
import {
  createDealerSchema,
  updateDealerSchema,
  updateDealerLocationSchema,
} from './dto/dealers.schemas';
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
router.post('/', requireRoles('admin', 'employee', 'order_taker'), validate(createDealerSchema), controller.create);

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
// `delivery_man` is here because `resolveCityScope` already lists it in CITY_SCOPED_ROLES —
// the scoping was written for riders but the route gate had locked them out. Riders need the
// client list for the credit-recovery party picker.
router.get(
  '/',
  requireRoles('admin', 'sales_manager', 'employee', 'order_taker', 'delivery_man'),
  controller.findAll,
);

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
router.get('/nearby', requireRoles('admin', 'sales_manager', 'employee', 'order_taker'), controller.findNearby);

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
router.get(
  '/:id',
  requireRoles('admin', 'sales_manager', 'employee', 'order_taker', 'delivery_man'),
  controller.findOne,
);

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
 * /api/dealers/{id}/location:
 *   patch:
 *     tags: [Dealers]
 *     summary: Correct a client's pin and address [Admin, Employee, Order Taker]
 *     description: >
 *       The narrow correction path for field staff, who are the only people standing outside the
 *       shop. Accepts the address and the lat/lng pair and nothing else — phone, category, route
 *       and status stay on the full update. Riders are city-scoped exactly as they are on read.
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
 *               latitude: { type: number }
 *               longitude: { type: number }
 *               address:
 *                 type: object
 *                 properties:
 *                   street: { type: string }
 *                   city: { type: string }
 *                   state: { type: string }
 *                   country: { type: string }
 *                   postalCode: { type: string }
 *     responses:
 *       200:
 *         description: Client location updated
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/Dealer'
 *       400: { description: Validation error — send latitude and longitude together }
 *       401: { description: Unauthorized }
 *       404: { description: Dealer not found or out of your city }
 */
router.patch(
  '/:id/location',
  // Riders too: the delivery boy is the one standing outside the shop when the saved pin
  // turns out to be wrong. Still city-scoped on write by `resolveCityScope`.
  requireRoles('admin', 'employee', 'order_taker', 'delivery_man'),
  validate(updateDealerLocationSchema),
  controller.updateLocation,
);

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
