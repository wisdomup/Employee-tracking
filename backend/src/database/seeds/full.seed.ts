import 'dotenv/config';
import mongoose, { Types } from 'mongoose';
import bcrypt from 'bcrypt';
import { seedAccessPolicies } from './access-policies.seed';
import { UserModel } from '../../models/user.model';
import { RouteModel } from '../../models/route.model';
import { RouteAssignmentModel } from '../../models/route-assignment.model';
import { DealerModel } from '../../models/dealer.model';
import { CategoryModel } from '../../models/category.model';
import { ProductModel } from '../../models/product.model';
import { TaskModel } from '../../models/task.model';
import { VisitModel } from '../../models/visit.model';
import { AttendanceModel } from '../../models/attendance.model';
import { ApprovalModel } from '../../models/approval.model';
import { BroadcastNotificationModel } from '../../models/broadcast-notification.model';
import { BroadcastNotificationReadModel } from '../../models/broadcast-notification-read.model';
import { CatalogModel } from '../../models/catalog.model';
import { OrderModel } from '../../models/order.model';
import { ReturnModel } from '../../models/return.model';
import { ActivityLogModel } from '../../models/activity-log.model';
import { CounterModel } from '../../models/counter.model';

type SeedUserInput = {
  userID: string;
  username: string;
  phone: string;
  email: string;
  password: string;
  role: 'admin' | 'employee' | 'warehouse_manager' | 'order_taker' | 'delivery_man';
  fullName: string;
};

const ORDER_INVOICE_COUNTER_ID = 'orderInvoice';

async function upsertUser(input: SeedUserInput) {
  const existing = await UserModel.findOne({
    $or: [{ username: input.username }, { phone: input.phone }, { userID: input.userID }],
  });

  if (existing) {
    return existing;
  }

  const hashedPassword = await bcrypt.hash(input.password, 10);
  const created = await UserModel.create({
    userID: input.userID,
    username: input.username,
    fullName: input.fullName,
    phone: input.phone,
    email: input.email,
    password: hashedPassword,
    role: input.role,
    isActive: true,
    address: { street: 'Main Road', city: 'Lahore', state: 'Punjab', country: 'Pakistan' },
    designation: input.role.replace('_', ' '),
    perks: { salary: 50000, bonus: 4000, allowance: 2500 },
  });

  return created;
}

async function seedAll() {
  const uri = process.env.MONGODB_URI || 'mongodb://localhost:27017/gps_task_tracking';
  await mongoose.connect(uri);
  console.log('Connected to MongoDB');

  // The permission matrix first. Every non-admin resolves to zero permissions without it, so
  // a freshly seeded dev database would answer 403 on almost every screen and look broken in
  // a way that has nothing to do with the data below.
  const access = await seedAccessPolicies({ backfillUsers: false });
  console.log(`Access policies: ${access.created.length} created, ${access.skipped.length} kept`);

  const users = {
    admin: await upsertUser({
      userID: 'ADM-0001',
      username: 'admin',
      phone: '1234567890',
      email: 'admin@revitalize.local',
      password: 'admin123',
      role: 'admin',
      fullName: 'System Admin',
    }),
    orderTaker: await upsertUser({
      userID: 'USR-0002',
      username: 'order.taker',
      phone: '1234567891',
      email: 'ordertaker@revitalize.local',
      password: 'user123',
      role: 'order_taker',
      fullName: 'Order Taker User',
    }),
    delivery: await upsertUser({
      userID: 'USR-0003',
      username: 'delivery.man',
      phone: '1234567892',
      email: 'delivery@revitalize.local',
      password: 'user123',
      role: 'delivery_man',
      fullName: 'Delivery User',
    }),
    warehouse: await upsertUser({
      userID: 'USR-0004',
      username: 'warehouse.manager',
      phone: '1234567893',
      email: 'warehouse@revitalize.local',
      password: 'user123',
      role: 'warehouse_manager',
      fullName: 'Warehouse Manager',
    }),
    employee: await upsertUser({
      userID: 'USR-0005',
      username: 'field.employee',
      phone: '1234567894',
      email: 'employee@revitalize.local',
      password: 'user123',
      role: 'employee',
      fullName: 'Field Employee',
    }),
  };

  const routeNorth = await RouteModel.findOneAndUpdate(
    { name: 'North Zone Route' },
    {
      $setOnInsert: {
        name: 'North Zone Route',
        startingPoint: 'Warehouse North Gate',
        endingPoint: 'Canal Market',
        city: 'Lahore',
        state: 'Punjab',
        country: 'Pakistan',
        zipCode: '54000',
        createdBy: users.admin._id,
      },
    },
    { new: true, upsert: true },
  );

  const routeSouth = await RouteModel.findOneAndUpdate(
    { name: 'South Zone Route' },
    {
      $setOnInsert: {
        name: 'South Zone Route',
        startingPoint: 'Warehouse South Gate',
        endingPoint: 'Model Town',
        city: 'Lahore',
        state: 'Punjab',
        country: 'Pakistan',
        zipCode: '54700',
        createdBy: users.admin._id,
      },
    },
    { new: true, upsert: true },
  );

  await RouteAssignmentModel.findOneAndUpdate(
    { routeId: routeNorth._id },
    {
      $set: {
        employeeId: users.delivery._id,
        assignedAt: new Date(),
      },
    },
    { upsert: true },
  );

  await RouteAssignmentModel.findOneAndUpdate(
    { routeId: routeSouth._id },
    {
      $set: {
        employeeId: users.employee._id,
        assignedAt: new Date(),
      },
    },
    { upsert: true },
  );

  const dealerA = await DealerModel.findOneAndUpdate(
    { phone: '03001234567' },
    {
      $setOnInsert: {
        name: 'Ali Traders',
        shopName: 'Ali General Store',
        phone: '03001234567',
        email: 'ali.traders@example.com',
        address: {
          street: 'Street 10',
          city: 'Lahore',
          state: 'Punjab',
          country: 'Pakistan',
          postalCode: '54000',
        },
        latitude: 31.5204,
        longitude: 74.3587,
        category: 'retailer',
        rating: 4.2,
        route: routeNorth._id,
        status: 'active',
        createdBy: users.orderTaker._id,
      },
    },
    { new: true, upsert: true },
  );

  const dealerB = await DealerModel.findOneAndUpdate(
    { phone: '03007654321' },
    {
      $setOnInsert: {
        name: 'Rahman Wholesales',
        shopName: 'Rahman Cash and Carry',
        phone: '03007654321',
        email: 'rahman.wholesale@example.com',
        address: {
          street: 'Block H',
          city: 'Lahore',
          state: 'Punjab',
          country: 'Pakistan',
          postalCode: '54700',
        },
        latitude: 31.4697,
        longitude: 74.2728,
        category: 'wholesaler',
        rating: 4.6,
        route: routeSouth._id,
        status: 'active',
        createdBy: users.orderTaker._id,
      },
    },
    { new: true, upsert: true },
  );

  const beveragesCategory = await CategoryModel.findOneAndUpdate(
    { name: 'Beverages' },
    {
      $setOnInsert: {
        name: 'Beverages',
        description: 'Cold drinks and juices',
        createdBy: users.admin._id,
      },
    },
    { new: true, upsert: true },
  );

  const snacksCategory = await CategoryModel.findOneAndUpdate(
    { name: 'Snacks' },
    {
      $setOnInsert: {
        name: 'Snacks',
        description: 'Daily use snack items',
        createdBy: users.admin._id,
      },
    },
    { new: true, upsert: true },
  );

  const cola = await ProductModel.findOneAndUpdate(
    { barcode: 'PRD-10001' },
    {
      $setOnInsert: {
        barcode: 'PRD-10001',
        name: 'Cola 1L',
        description: 'Carbonated soft drink',
        salePrice: 180,
        purchasePrice: 150,
        onlinePrice: 175,
        quantity: 200,
        survivalQuantity: 50,
        categoryId: beveragesCategory._id,
        createdBy: users.admin._id,
        extras: { brand: 'Revive Drinks', unit: '1L bottle' },
      },
    },
    { new: true, upsert: true },
  );

  const orangeJuice = await ProductModel.findOneAndUpdate(
    { barcode: 'PRD-10002' },
    {
      $setOnInsert: {
        barcode: 'PRD-10002',
        name: 'Orange Juice 500ml',
        description: 'Fruit juice',
        salePrice: 140,
        purchasePrice: 115,
        onlinePrice: 135,
        quantity: 150,
        survivalQuantity: 40,
        categoryId: beveragesCategory._id,
        createdBy: users.admin._id,
        extras: { brand: 'FreshLine', unit: '500ml bottle' },
      },
    },
    { new: true, upsert: true },
  );

  const chips = await ProductModel.findOneAndUpdate(
    { barcode: 'PRD-10003' },
    {
      $setOnInsert: {
        barcode: 'PRD-10003',
        name: 'Potato Chips Family Pack',
        description: 'Salted potato chips',
        salePrice: 90,
        purchasePrice: 70,
        onlinePrice: 85,
        quantity: 300,
        survivalQuantity: 80,
        categoryId: snacksCategory._id,
        createdBy: users.admin._id,
        extras: { flavor: 'salted', weight: '80g' },
      },
    },
    { new: true, upsert: true },
  );

  const orderDate = new Date();
  const baseOrderProducts = [
    { productId: cola._id as Types.ObjectId, quantity: 12, price: 180 },
    { productId: orangeJuice._id as Types.ObjectId, quantity: 10, price: 140 },
  ];
  const totalPrice = baseOrderProducts.reduce((acc, item) => acc + item.quantity * item.price, 0);
  const discount = 100;
  const grandTotal = totalPrice - discount;

  const existingOrderA = await OrderModel.findOne({ description: 'Seed order A' });
  const existingOrderB = await OrderModel.findOne({ description: 'Seed order B' });

  let counter = await CounterModel.findById(ORDER_INVOICE_COUNTER_ID);
  if (!counter) {
    counter = await CounterModel.create({ _id: ORDER_INVOICE_COUNTER_ID, seq: 0 });
  }

  const orderAInvoice = existingOrderA?.invoiceNumber ?? counter.seq + 1;
  const orderBInvoice = existingOrderB?.invoiceNumber ?? orderAInvoice + 1;
  counter.seq = Math.max(counter.seq, orderBInvoice);
  await counter.save();

  const orderA = await OrderModel.findOneAndUpdate(
    { description: 'Seed order A' },
    {
      $setOnInsert: {
        invoiceNumber: orderAInvoice,
        products: baseOrderProducts,
        totalPrice,
        discount,
        grandTotal,
        paidAmount: 1500,
        description: 'Seed order A',
        status: 'approved',
        paymentType: 'cash',
        orderDate,
        deliveryDate: new Date(orderDate.getTime() + 24 * 60 * 60 * 1000),
        dealerId: dealerA._id,
        routeId: routeNorth._id,
        createdBy: users.orderTaker._id,
        approvedBy: users.admin._id,
        approvedAt: new Date(),
        termsAndConditions: '<p>Payment due within 7 days. Goods once sold are not returnable without approval.</p>',
      },
    },
    { new: true, upsert: true },
  );

  const orderB = await OrderModel.findOneAndUpdate(
    { description: 'Seed order B' },
    {
      $setOnInsert: {
        invoiceNumber: orderBInvoice,
        products: [
          { productId: chips._id as Types.ObjectId, quantity: 25, price: 90 },
          { productId: cola._id as Types.ObjectId, quantity: 8, price: 180 },
        ],
        totalPrice: 25 * 90 + 8 * 180,
        discount: 50,
        grandTotal: 25 * 90 + 8 * 180 - 50,
        paidAmount: 1000,
        description: 'Seed order B',
        status: 'pending',
        paymentType: 'credit',
        orderDate,
        dealerId: dealerB._id,
        routeId: routeSouth._id,
        createdBy: users.orderTaker._id,
        termsAndConditions: '<p>Credit terms: 14 days.</p>',
      },
    },
    { new: true, upsert: true },
  );

  await TaskModel.findOneAndUpdate(
    { taskName: 'Deliver order to Ali General Store' },
    {
      $setOnInsert: {
        taskName: 'Deliver order to Ali General Store',
        description: 'Deliver approved goods and collect pending amount.',
        quantity: 22,
        dealerId: dealerA._id,
        routeId: routeNorth._id,
        assignedTo: users.delivery._id,
        assignedBy: users.admin._id,
        status: 'in_progress',
        startedAt: new Date(),
        latitude: 31.5204,
        longitude: 74.3587,
        timestamp: new Date(),
        createdBy: users.admin._id,
      },
    },
    { new: true, upsert: true },
  );

  const completedVisit = await VisitModel.findOneAndUpdate(
    { dealerId: dealerA._id, employeeId: users.delivery._id },
    {
      $setOnInsert: {
        dealerId: dealerA._id,
        employeeId: users.delivery._id,
        routeId: routeNorth._id,
        visitDate: new Date(),
        status: 'completed',
        completedAt: new Date(),
        latitude: 31.5204,
        longitude: 74.3587,
        completionImages: [
          { type: 'shop', url: 'https://picsum.photos/seed/shop-visit/640/480' },
          { type: 'selfie', url: 'https://picsum.photos/seed/selfie-visit/640/480' },
        ],
        createdBy: users.admin._id,
      },
    },
    { new: true, upsert: true },
  );

  const attendanceDate = new Date();
  attendanceDate.setUTCHours(0, 0, 0, 0);

  await AttendanceModel.findOneAndUpdate(
    { employeeId: users.delivery._id, date: attendanceDate },
    {
      $setOnInsert: {
        employeeId: users.delivery._id,
        date: attendanceDate,
        checkInTime: new Date(Date.now() - 8 * 60 * 60 * 1000),
        checkInLatitude: 31.5204,
        checkInLongitude: 74.3587,
        checkOutTime: new Date(),
        checkOutLatitude: 31.523,
        checkOutLongitude: 74.361,
        note: 'Completed morning route.',
        createdBy: users.admin._id,
      },
    },
    { upsert: true },
  );

  await ApprovalModel.findOneAndUpdate(
    { employeeId: users.employee._id, leaveReason: 'Medical checkup (seed data)' },
    {
      $setOnInsert: {
        approvalType: 'leave',
        leaveType: 'half_day',
        employeeId: users.employee._id,
        leaveReason: 'Medical checkup (seed data)',
        status: 'approved',
        leaveDate: new Date(Date.now() + 2 * 24 * 60 * 60 * 1000),
        approvedBy: users.admin._id,
        approvedAt: new Date(),
      },
    },
    { upsert: true },
  );

  const notification = await BroadcastNotificationModel.findOneAndUpdate(
    { title: 'Daily Sales Push' },
    {
      $setOnInsert: {
        title: 'Daily Sales Push',
        description: 'Focus on beverages category this week and submit route updates before 6 PM.',
        audienceType: 'all_employees',
        targetUserIds: [],
        startAt: new Date(),
        createdBy: users.admin._id,
      },
    },
    { new: true, upsert: true },
  );

  await BroadcastNotificationReadModel.findOneAndUpdate(
    { userId: users.delivery._id, notificationId: notification._id },
    {
      $setOnInsert: {
        userId: users.delivery._id,
        notificationId: notification._id,
        readAt: new Date(),
      },
    },
    { upsert: true },
  );

  await CatalogModel.findOneAndUpdate(
    { name: 'July Product Catalog' },
    {
      $setOnInsert: {
        name: 'July Product Catalog',
        fileUrl: 'https://example.com/catalogs/july-products.pdf',
        createdBy: users.admin._id,
      },
    },
    { upsert: true },
  );

  const returnAmount = 2 * 90 + 1 * 180;
  await ReturnModel.findOneAndUpdate(
    { dealerId: dealerA._id, returnReason: 'Damaged pack in transit (seed data)' },
    {
      $setOnInsert: {
        dealerId: dealerA._id,
        returnType: 'damage',
        products: [
          { productId: chips._id as Types.ObjectId, quantity: 2, price: 90 },
          { productId: cola._id as Types.ObjectId, quantity: 1, price: 180 },
        ],
        amount: returnAmount,
        status: 'pending',
        returnReason: 'Damaged pack in transit (seed data)',
        createdBy: users.orderTaker._id,
      },
    },
    { upsert: true },
  );

  await ActivityLogModel.findOneAndUpdate(
    {
      module: 'order',
      entityId: String(orderA._id),
      action: 'created',
    },
    {
      $setOnInsert: {
        employeeId: users.orderTaker._id,
        module: 'order',
        entityId: String(orderA._id),
        action: 'created',
        changes: {
          status: { from: undefined, to: 'approved' },
          total: { from: undefined, to: orderA.grandTotal },
        },
        meta: {
          invoiceNumber: orderA.invoiceNumber,
          dealer: dealerA.shopName,
        },
        timestamp: new Date(),
      },
    },
    { upsert: true },
  );

  await ActivityLogModel.findOneAndUpdate(
    {
      module: 'visit',
      entityId: String(completedVisit._id),
      action: 'completed_task',
    },
    {
      $setOnInsert: {
        employeeId: users.delivery._id,
        module: 'visit',
        entityId: String(completedVisit._id),
        action: 'completed_task',
        meta: {
          route: routeNorth.name,
          dealer: dealerA.shopName,
        },
        timestamp: new Date(),
      },
    },
    { upsert: true },
  );

  console.log('\nSeeding completed successfully.\n');
  console.log('Admin credentials:');
  console.log('  username: admin');
  console.log('  password: admin123');
  console.log('\nSample user credentials (all use password: user123):');
  console.log('  order_taker:      order.taker');
  console.log('  delivery_man:     delivery.man');
  console.log('  warehouse_manager: warehouse.manager');
  console.log('  employee:         field.employee');

  console.log('\nCreated/ensured data in collections:');
  console.log('  users, routes, routeassignments, dealers, categories, products');
  console.log('  orders, tasks, visits, attendances, approvals, broadcastnotifications');
  console.log('  broadcastnotificationreads, catalogs, returns, activitylogs, counters');

  await mongoose.disconnect();
  console.log('\nDisconnected from MongoDB');
}

seedAll()
  .then(() => process.exit(0))
  .catch(async (error) => {
    console.error('Seed failed:', error);
    try {
      await mongoose.disconnect();
    } catch {
      // no-op
    }
    process.exit(1);
  });
