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
import leavesRouter from './modules/leaves/leaves.routes';
import visitsRouter from './modules/visits/visits.routes';
import returnsRouter from './modules/returns/returns.routes';
import broadcastNotificationsRouter from './modules/broadcast-notifications/broadcast-notifications.routes';
import uploadRouter from './modules/upload/upload.routes';
import catalogsRouter from './modules/catalogs/catalogs.routes';
import trashRouter from './modules/trash/trash.routes';

const app = express();

app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

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
app.use('/api/leaves', leavesRouter);
app.use('/api/visits', visitsRouter);
app.use('/api/returns', returnsRouter);
app.use('/api/broadcast-notifications', broadcastNotificationsRouter);
app.use('/api/upload', uploadRouter);
app.use('/api/catalogs', catalogsRouter);
app.use('/api/trash', trashRouter);

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

  console.error(err);
  res.status(500).json({ message: 'Internal server error' });
});

export default app;
