/**
 * One-shot: assign sequential `invoiceNumber` to existing orders and seed the Counter.
 *
 * Run from backend/: npx ts-node src/database/migrations/backfill-order-invoice-numbers.ts
 * (MONGODB_URI set)
 */
import 'dotenv/config';
import mongoose from 'mongoose';
import { OrderModel } from '../../models/order.model';
import { CounterModel } from '../../models/counter.model';

const ORDER_INVOICE_COUNTER_ID = 'orderInvoice';

async function migrate() {
  const uri = process.env.MONGODB_URI || 'mongodb://localhost:27017/gps_task_tracking';
  await mongoose.connect(uri);
  console.log('Connected to MongoDB');

  const maxAgg = await OrderModel.aggregate<{ maxNum: number | null }>([
    { $match: { isTrashed: { $ne: true }, invoiceNumber: { $exists: true, $type: 'number' } } },
    { $group: { _id: null, maxNum: { $max: '$invoiceNumber' } } },
  ]);
  let next = maxAgg[0]?.maxNum ?? 0;

  const missing = await OrderModel.find({
    isTrashed: { $ne: true },
    $or: [{ invoiceNumber: { $exists: false } }, { invoiceNumber: null }],
  })
    .sort({ createdAt: 1 })
    .select('_id')
    .lean();

  console.log(`Orders missing invoiceNumber: ${missing.length}`);
  let updated = 0;
  for (const row of missing) {
    next += 1;
    await OrderModel.updateOne({ _id: row._id }, { $set: { invoiceNumber: next } });
    updated += 1;
  }

  if (next > 0) {
    await CounterModel.findByIdAndUpdate(
      ORDER_INVOICE_COUNTER_ID,
      { $set: { seq: next } },
      { upsert: true },
    );
    console.log(`Counter "${ORDER_INVOICE_COUNTER_ID}" seq set to ${next}`);
  } else {
    await CounterModel.findByIdAndUpdate(
      ORDER_INVOICE_COUNTER_ID,
      { $setOnInsert: { seq: 0 } },
      { upsert: true },
    );
    console.log('No orders found; counter initialized at seq 0');
  }

  console.log(`Updated ${updated} order(s).`);
  await mongoose.disconnect();
  console.log('Done.');
}

migrate().catch((e) => {
  console.error(e);
  process.exit(1);
});
