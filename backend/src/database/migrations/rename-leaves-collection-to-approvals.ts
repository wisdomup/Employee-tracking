/**
 * One-shot migration: rename MongoDB collection `leaves` -> `approvals`
 * and backfill `approvalType: 'leave'` where missing (legacy documents).
 *
 * Run: npx ts-node src/database/migrations/rename-leaves-collection-to-approvals.ts
 * (from backend/, with MONGODB_URI set)
 */
import 'dotenv/config';
import mongoose from 'mongoose';

async function migrate() {
  const uri = process.env.MONGODB_URI || 'mongodb://localhost:27017/gps_task_tracking';
  await mongoose.connect(uri);
  console.log('Connected to MongoDB');

  const db = mongoose.connection.db;
  if (!db) {
    throw new Error('No database connection');
  }

  const cols = await db.listCollections({ name: 'leaves' }).toArray();
  const hasApprovals = (await db.listCollections({ name: 'approvals' }).toArray()).length > 0;

  if (cols.length > 0 && !hasApprovals) {
    await db.collection('leaves').rename('approvals');
    console.log('Renamed collection leaves -> approvals');
  } else if (cols.length > 0 && hasApprovals) {
    console.log('Both leaves and approvals exist; skipping rename. Merge data manually if needed.');
  } else {
    console.log('No leaves collection found; nothing to rename (new or already migrated).');
  }

  const approvals = db.collection('approvals');
  const exists = (await db.listCollections({ name: 'approvals' }).toArray()).length > 0;
  if (exists) {
    const res = await approvals.updateMany(
      { approvalType: { $exists: false } },
      { $set: { approvalType: 'leave' } },
    );
    console.log(`Backfill approvalType: matched ${res.matchedCount}, modified ${res.modifiedCount}`);
  }

  await mongoose.disconnect();
  console.log('Done.');
}

migrate().catch((e) => {
  console.error(e);
  process.exit(1);
});
