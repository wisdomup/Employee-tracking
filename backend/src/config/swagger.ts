import swaggerJsdoc from 'swagger-jsdoc';
import path from 'path';

const options: swaggerJsdoc.Options = {
  definition: {
    openapi: '3.0.0',
    info: {
      title: 'Wisdomup API',
      version: '1.0.0',
      description:
        'REST API for the Wisdomup field-force management platform. ' +
        'Most endpoints require a Bearer JWT token — click "Authorize" and paste your token to test protected routes.',
    },
    servers: [
      {
        url: 'http://localhost:8001',
        description: 'Local development server',
      },
    ],
    components: {
      securitySchemes: {
        bearerAuth: {
          type: 'http',
          scheme: 'bearer',
          bearerFormat: 'JWT',
          description: 'Enter your JWT access token',
        },
      },
      schemas: {
        Error: {
          type: 'object',
          properties: {
            message: { type: 'string' },
          },
        },
        ValidationError: {
          type: 'object',
          properties: {
            message: { type: 'string', example: 'Validation error' },
            errors: {
              type: 'array',
              items: { type: 'string' },
            },
          },
        },
        Address: {
          type: 'object',
          properties: {
            street: { type: 'string' },
            city: { type: 'string' },
            state: { type: 'string' },
            country: { type: 'string' },
          },
        },
        User: {
          type: 'object',
          properties: {
            _id: { type: 'string', example: '64a7f3c2e4b0c123456789ef' },
            username: { type: 'string', example: 'john_doe' },
            phone: { type: 'string', example: '03001234567' },
            email: { type: 'string', example: 'john@example.com' },
            role: {
              type: 'string',
              enum: ['admin', 'employee', 'warehouse_manager', 'order_taker', 'delivery_man'],
            },
            isActive: { type: 'boolean', example: true },
            address: { $ref: '#/components/schemas/Address' },
            profileImage: { type: 'string' },
            createdAt: { type: 'string', format: 'date-time' },
            updatedAt: { type: 'string', format: 'date-time' },
          },
        },
        Dealer: {
          type: 'object',
          properties: {
            _id: { type: 'string', example: '64a7f3c2e4b0c123456789ef' },
            name: { type: 'string', example: 'Asad Ali' },
            shopName: { type: 'string', example: 'ABC Store' },
            phone: { type: 'string', example: '03001234567' },
            email: { type: 'string', example: 'dealer@example.com' },
            address: {
              type: 'object',
              properties: {
                street: { type: 'string' },
                city: { type: 'string' },
                state: { type: 'string' },
                country: { type: 'string' },
                postalCode: { type: 'string' },
              },
            },
            latitude: { type: 'number', example: 31.5204 },
            longitude: { type: 'number', example: 74.3587 },
            shopImage: { type: 'string' },
            status: { type: 'string', enum: ['active', 'inactive'], example: 'active' },
          },
        },
        Route: {
          type: 'object',
          properties: {
            _id: { type: 'string', example: '64a7f3c2e4b0c123456789ef' },
            name: { type: 'string', example: 'Gulberg Route' },
            startingPoint: { type: 'string', example: 'Main Boulevard' },
            endingPoint: { type: 'string', example: 'Liberty Market' },
            createdAt: { type: 'string', format: 'date-time' },
            updatedAt: { type: 'string', format: 'date-time' },
          },
        },
        Task: {
          type: 'object',
          properties: {
            _id: { type: 'string', example: '64a7f3c2e4b0c123456789ef' },
            taskName: { type: 'string', example: 'Deliver stock' },
            description: { type: 'string' },
            referenceImage: { type: 'string' },
            quantity: { type: 'number', example: 10 },
            dealerId: { $ref: '#/components/schemas/Dealer' },
            routeId: { $ref: '#/components/schemas/Route' },
            assignedTo: { $ref: '#/components/schemas/User' },
            assignedBy: { $ref: '#/components/schemas/User' },
            status: {
              type: 'string',
              enum: ['pending', 'in_progress', 'completed'],
            },
            startedAt: { type: 'string', format: 'date-time' },
            completedAt: { type: 'string', format: 'date-time' },
            latitude: { type: 'number' },
            longitude: { type: 'number' },
            completionImages: {
              type: 'array',
              items: {
                type: 'object',
                properties: {
                  type: { type: 'string', enum: ['shop', 'selfie'] },
                  url: { type: 'string' },
                },
              },
            },
            createdBy: { $ref: '#/components/schemas/User' },
            createdAt: { type: 'string', format: 'date-time' },
            updatedAt: { type: 'string', format: 'date-time' },
          },
        },
        RouteAssignment: {
          type: 'object',
          properties: {
            _id: { type: 'string' },
            routeId: { $ref: '#/components/schemas/Route' },
            employeeId: { $ref: '#/components/schemas/User' },
            assignedAt: { type: 'string', format: 'date-time' },
          },
        },
        ActivityLog: {
          type: 'object',
          properties: {
            _id: { type: 'string' },
            employeeId: { $ref: '#/components/schemas/User' },
            module: {
              type: 'string',
              enum: ['task', 'order', 'product', 'category', 'dealer', 'route', 'return', 'visit', 'employee'],
            },
            entityId: { type: 'string' },
            taskId: { $ref: '#/components/schemas/Task' },
            action: {
              type: 'string',
              enum: ['created', 'updated', 'deleted', 'status_changed', 'started_task', 'completed_task'],
            },
            changes: { type: 'object' },
            meta: { type: 'object' },
            timestamp: { type: 'string', format: 'date-time' },
          },
        },
        Category: {
          type: 'object',
          properties: {
            _id: { type: 'string' },
            name: { type: 'string' },
            description: { type: 'string' },
            image: { type: 'string' },
            createdBy: { $ref: '#/components/schemas/User' },
            createdAt: { type: 'string', format: 'date-time' },
          },
        },
        Product: {
          type: 'object',
          properties: {
            _id: { type: 'string' },
            barcode: { type: 'string' },
            name: { type: 'string' },
            description: { type: 'string' },
            image: { type: 'string' },
            salePrice: { type: 'number' },
            purchasePrice: { type: 'number' },
            quantity: { type: 'number' },
            categoryId: { $ref: '#/components/schemas/Category' },
            createdBy: { $ref: '#/components/schemas/User' },
          },
        },
        Order: {
          type: 'object',
          properties: {
            _id: { type: 'string' },
            products: {
              type: 'array',
              items: {
                type: 'object',
                properties: {
                  productId: { type: 'string' },
                  quantity: { type: 'number' },
                  price: { type: 'number' },
                },
              },
            },
            totalPrice: { type: 'number' },
            discount: { type: 'number' },
            grandTotal: { type: 'number' },
            paidAmount: { type: 'number' },
            status: {
              type: 'string',
              enum: ['pending', 'approved', 'packed', 'dispatched', 'delivered', 'cancelled'],
            },
            dealerId: { $ref: '#/components/schemas/Dealer' },
            routeId: { $ref: '#/components/schemas/Route' },
            createdBy: { $ref: '#/components/schemas/User' },
          },
        },
      },
    },
    tags: [
      { name: 'Auth', description: 'Authentication — register, login, password management' },
      { name: 'Users', description: 'User management (admin-managed)' },
      { name: 'Dealers', description: 'Dealer/shop management and geo-search' },
      { name: 'Tasks', description: 'Task creation, assignment and lifecycle management' },
      { name: 'Routes', description: 'Route management' },
      { name: 'Route Assignments', description: 'Assign routes to order_taker employees' },
      { name: 'Dashboard', description: 'Aggregated statistics' },
      { name: 'Activity Logs', description: 'Employee activity history' },
      { name: 'Categories', description: 'Product category management' },
      { name: 'Products', description: 'Product catalogue management' },
      { name: 'Orders', description: 'Order management' },
      { name: 'Approvals', description: 'Employee approval requests (leave, allowance, etc.)' },
      { name: 'Visits', description: 'Dealer visit tracking' },
      { name: 'Returns', description: 'Product returns and claims' },
      { name: 'Broadcast Notifications', description: 'Push broadcast notifications to target groups' },
    ],
  },
  apis: [
    path.join(__dirname, '../modules/auth/auth.routes.ts'),
    path.join(__dirname, '../modules/users/users.routes.ts'),
    path.join(__dirname, '../modules/dealers/dealers.routes.ts'),
    path.join(__dirname, '../modules/tasks/tasks.routes.ts'),
    path.join(__dirname, '../modules/routes/routes.router.ts'),
    path.join(__dirname, '../modules/route-assignments/route-assignments.routes.ts'),
    path.join(__dirname, '../modules/dashboard/dashboard.routes.ts'),
    path.join(__dirname, '../modules/activity-logs/activity-logs.routes.ts'),
    path.join(__dirname, '../modules/categories/categories.routes.ts'),
    path.join(__dirname, '../modules/products/products.routes.ts'),
    path.join(__dirname, '../modules/orders/orders.routes.ts'),
    path.join(__dirname, '../modules/approvals/approvals.routes.ts'),
    path.join(__dirname, '../modules/visits/visits.routes.ts'),
    path.join(__dirname, '../modules/returns/returns.routes.ts'),
    path.join(__dirname, '../modules/broadcast-notifications/broadcast-notifications.routes.ts'),
    // Also scan compiled JS in dist/ when running built app
    path.join(__dirname, '../modules/auth/auth.routes.js'),
    path.join(__dirname, '../modules/users/users.routes.js'),
    path.join(__dirname, '../modules/dealers/dealers.routes.js'),
    path.join(__dirname, '../modules/tasks/tasks.routes.js'),
    path.join(__dirname, '../modules/routes/routes.router.js'),
    path.join(__dirname, '../modules/route-assignments/route-assignments.routes.js'),
    path.join(__dirname, '../modules/dashboard/dashboard.routes.js'),
    path.join(__dirname, '../modules/activity-logs/activity-logs.routes.js'),
    path.join(__dirname, '../modules/categories/categories.routes.js'),
    path.join(__dirname, '../modules/products/products.routes.js'),
    path.join(__dirname, '../modules/orders/orders.routes.js'),
    path.join(__dirname, '../modules/approvals/approvals.routes.js'),
    path.join(__dirname, '../modules/visits/visits.routes.js'),
    path.join(__dirname, '../modules/returns/returns.routes.js'),
    path.join(__dirname, '../modules/broadcast-notifications/broadcast-notifications.routes.js'),
  ],
};

export const swaggerSpec = swaggerJsdoc(options);
