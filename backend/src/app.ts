import express, { Request, Response, NextFunction } from 'express';
import cors from 'cors';
import swaggerUi from 'swagger-ui-express';
import { AppError } from './utils/app-error';
import { swaggerSpec } from './config/swagger';

import authRouter from './modules/auth/auth.routes';
import usersRouter from './modules/users/users.routes';
import dealersRouter from './modules/dealers/dealers.routes';
import tasksRouter from './modules/tasks/tasks.routes';
import routesRouter from './modules/routes/routes.router';
import routeAssignmentsRouter from './modules/route-assignments/route-assignments.routes';
import dashboardRouter from './modules/dashboard/dashboard.routes';
import activityLogsRouter from './modules/activity-logs/activity-logs.routes';
import categoriesRouter from './modules/categories/categories.routes';
import productsRouter from './modules/products/products.routes';
import ordersRouter from './modules/orders/orders.routes';
import approvalsRouter from './modules/approvals/approvals.routes';
import visitsRouter from './modules/visits/visits.routes';
import returnsRouter from './modules/returns/returns.routes';
import broadcastNotificationsRouter from './modules/broadcast-notifications/broadcast-notifications.routes';
import uploadRouter from './modules/upload/upload.routes';
import catalogsRouter from './modules/catalogs/catalogs.routes';
import trashRouter from './modules/trash/trash.routes';
import attendanceRouter from './modules/attendance/attendance.routes';
import stockReportsRouter from './modules/stock-reports/stock-reports.routes';

const app = express();

app.use(cors());
// Default 100kb is too small for profile images (base64) and other JSON payloads
app.use(express.json({ limit: '15mb' }));
app.use(express.urlencoded({ extended: true, limit: '15mb' }));

// Static uploads
app.use('/api/uploads', express.static('uploads'));

// Swagger UI
app.use('/api/docs', swaggerUi.serve, swaggerUi.setup(swaggerSpec));
app.get('/api/docs.json', (_req: Request, res: Response) => {
  res.setHeader('Content-Type', 'application/json');
  res.send(swaggerSpec);
});

// Routes
app.use('/api/auth', authRouter);
app.use('/api/users', usersRouter);
app.use('/api/dealers', dealersRouter);
app.use('/api/tasks', tasksRouter);
app.use('/api/routes', routesRouter);
app.use('/api/route-assignments', routeAssignmentsRouter);
app.use('/api/dashboard', dashboardRouter);
app.use('/api/activity-logs', activityLogsRouter);
app.use('/api/categories', categoriesRouter);
app.use('/api/products', productsRouter);
app.use('/api/orders', ordersRouter);
app.use('/api/approvals', approvalsRouter);
app.use('/api/visits', visitsRouter);
app.use('/api/returns', returnsRouter);
app.use('/api/broadcast-notifications', broadcastNotificationsRouter);
app.use('/api/upload', uploadRouter);
app.use('/api/catalogs', catalogsRouter);
app.use('/api/trash', trashRouter);
app.use('/api/attendance', attendanceRouter);
app.use('/api/stock-reports', stockReportsRouter);

app.get('/', (req: Request, res: Response) => {
  res.status(200).json({ message: 'GPS Tracking App backend is running' });
});

// 404
app.use((_req: Request, res: Response) => {
  res.status(404).json({ message: 'Route not found' });
});

// Global error handler
app.use((err: unknown, _req: Request, res: Response, _next: NextFunction) => {
  if (err instanceof AppError) {
    return res.status(err.statusCode).json({ message: err.message });
  }

  const e = err as {
    status?: number;
    statusCode?: number;
    type?: string;
    name?: string;
    message?: string;
    code?: number;
    keyValue?: Record<string, unknown>;
  };

  const status = e.statusCode ?? e.status;
  if (status === 413 || e.type === 'entity.too.large') {
    return res.status(413).json({ message: 'Request body too large. Try a smaller image or use file upload.' });
  }

  if (e.name === 'ValidationError') {
    return res.status(400).json({ message: e.message ?? 'Validation failed' });
  }

  if (e.name === 'CastError') {
    return res.status(400).json({ message: 'Invalid id or value' });
  }

  if (e.code === 11000) {
    return res.status(409).json({
      message: 'Duplicate value',
      ...(e.keyValue && { fields: e.keyValue }),
    });
  }

  console.error(err);
  res.status(500).json({ message: 'Internal server error' });
});

export default app;
