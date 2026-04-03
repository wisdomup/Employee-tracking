/**
 * One-shot: map legacy `broadcastTo` to `audienceType` / `targetUserIds` on broadcastnotifications.
 *
 * Run from backend/: npx ts-node src/database/migrations/broadcast-notifications-audience.ts
 * (MONGODB_URI set)
 */
import 'dotenv/config';
import mongoose from 'mongoose';

function mapBroadcastTo(
  v: string | undefined,
): { audienceType: string; clearTargets: boolean } {
  switch (v) {
    case 'all':
      return { audienceType: 'all', clearTargets: true };
    case 'employees':
      return { audienceType: 'all_employees', clearTargets: true };
    case 'dealers':
    case 'customers':
      return { audienceType: 'all_employees', clearTargets: true };
    default:
      return { audienceType: 'all_employees', clearTargets: true };
  }
}

async function migrate() {
  const uri = process.env.MONGODB_URI || 'mongodb://localhost:27017/gps_task_tracking';
  await mongoose.connect(uri);
  console.log('Connected to MongoDB');

  const db = mongoose.connection.db;
  if (!db) {
    throw new Error('No database connection');
  }

  const col = db.collection('broadcastnotifications');
  const exists = (await db.listCollections({ name: 'broadcastnotifications' }).toArray()).length > 0;
  if (!exists) {
    console.log('No broadcastnotifications collection; nothing to do.');
    await mongoose.disconnect();
    return;
  }

  const missingAudience = await col.countDocuments({
    $or: [{ audienceType: { $exists: false } }, { audienceType: null }],
  });
  console.log(`Documents missing audienceType: ${missingAudience}`);

  const cursor = col.find({
    $or: [{ audienceType: { $exists: false } }, { audienceType: null }],
  });

  let updated = 0;
  for await (const doc of cursor) {
    const broadcastTo = typeof doc.broadcastTo === 'string' ? doc.broadcastTo : undefined;
    const { audienceType, clearTargets } = mapBroadcastTo(broadcastTo);
    const $set: Record<string, unknown> = { audienceType };
    const $unset: Record<string, string> = {};
    if (clearTargets) {
      $set.targetUserIds = [];
    }
    if (doc.broadcastTo !== undefined) {
      $unset.broadcastTo = '';
    }
    await col.updateOne(
      { _id: doc._id },
      {
        $set,
        ...(Object.keys($unset).length ? { $unset } : {}),
      },
    );
    updated += 1;
  }

  console.log(`Updated ${updated} document(s).`);
  await mongoose.disconnect();
  console.log('Done.');
}

migrate().catch((e) => {
  console.error(e);
  process.exit(1);
});
