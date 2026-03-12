import { Router } from 'express';
import { authMiddleware } from '../../middleware/auth.middleware';
import { validate } from '../../middleware/validate.middleware';
import {
  registerSchema,
  loginSchema,
  forgotPasswordSchema,
  resetPasswordSchema,
  changePasswordSchema,
} from './dto/auth.schemas';
import * as controller from './auth.controller';

const router = Router();

/**
 * @openapi
 * /api/auth/register:
 *   post:
 *     tags: [Auth]
 *     summary: Register a new employee account (role is always set to employee)
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [userID, username, phone, password]
 *             properties:
 *               userID: { type: string, example: EMP001 }
 *               username: { type: string, example: john_doe }
 *               phone: { type: string, example: '03001234567' }
 *               email: { type: string, example: john@example.com }
 *               password: { type: string, minLength: 6, example: secret123 }
 *               address:
 *                 $ref: '#/components/schemas/Address'
 *               profileImage: { type: string }
 *     responses:
 *       201:
 *         description: Employee registered successfully
 *       400:
 *         description: Validation error
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/ValidationError'
 *       409:
 *         description: Username or phone already in use
 */
router.post('/register', validate(registerSchema), controller.register);

/**
 * @openapi
 * /api/auth/login:
 *   post:
 *     tags: [Auth]
 *     summary: Log in and receive a JWT access token
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [username, password]
 *             properties:
 *               username: { type: string, example: admin }
 *               password: { type: string, example: admin123 }
 *     responses:
 *       200:
 *         description: Login successful — returns JWT token and user info
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 access_token: { type: string }
 *                 user:
 *                   $ref: '#/components/schemas/User'
 *       401:
 *         description: Invalid credentials or inactive account
 */
router.post('/login', validate(loginSchema), controller.login);

/**
 * @openapi
 * /api/auth/forgot-password:
 *   post:
 *     tags: [Auth]
 *     summary: Request a password-reset email
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [email]
 *             properties:
 *               email: { type: string, example: john@example.com }
 *     responses:
 *       200:
 *         description: Reset email sent if the address is registered
 *       400:
 *         description: Validation error
 *       404:
 *         description: No account found for this email
 */
router.post('/forgot-password', validate(forgotPasswordSchema), controller.forgotPassword);

/**
 * @openapi
 * /api/auth/reset-password:
 *   post:
 *     tags: [Auth]
 *     summary: Reset password using a token received by email
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [token, newPassword]
 *             properties:
 *               token: { type: string, example: abc123resettoken }
 *               newPassword: { type: string, minLength: 6, example: newSecret123 }
 *     responses:
 *       200:
 *         description: Password reset successfully
 *       400:
 *         description: Invalid or expired reset token
 */
router.post('/reset-password', validate(resetPasswordSchema), controller.resetPassword);

/**
 * @openapi
 * /api/auth/change-password:
 *   post:
 *     tags: [Auth]
 *     summary: Change password for the currently authenticated user
 *     security:
 *       - bearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [oldPassword, newPassword]
 *             properties:
 *               oldPassword: { type: string, example: secret123 }
 *               newPassword: { type: string, minLength: 6, example: newSecret456 }
 *     responses:
 *       200:
 *         description: Password changed successfully
 *       400:
 *         description: Old password is incorrect
 *       401:
 *         description: Unauthorized — missing or invalid JWT token
 */
router.post('/change-password', authMiddleware, validate(changePasswordSchema), controller.changePassword);

export default router;
