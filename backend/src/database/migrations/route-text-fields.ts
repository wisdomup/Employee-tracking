import 'dotenv/config';
import mongoose from 'mongoose';

interface OldRouteDoc {
  _id: unknown;
  routeName?: string;
  startLat?: number;
  startLng?: number;
  startAddress?: string;
  endLat?: number;
  endLng?: number;
  endAddress?: string;
}

async function migrateRouteTextFields() {
  await mongoose.connect(
    process.env.MONGODB_URI || 'mongodb://localhost:27017/gps_task_tracking',
  );
  console.log('Connected to MongoDB');

  const collection = mongoose.connection.collection('routes');
  const routes = await collection.find({}).toArray() as unknown as OldRouteDoc[];
  console.log(`Found ${routes.length} routes to migrate`);

  let updatedCount = 0;

  for (const route of routes) {
    if (!route.routeName) continue;

    const name = route.routeName;
    const startingPoint = route.startAddress ?? `${route.startLat}, ${route.startLng}`;
    const endingPoint = route.endAddress ?? `${route.endLat}, ${route.endLng}`;

    await collection.updateOne(
      { _id: route._id as any },
      { $set: { name, startingPoint, endingPoint } },
    );
    updatedCount++;
  }

  console.log(`✅ Route migration completed: ${updatedCount} route(s) updated`);
  await mongoose.disconnect();
  console.log('Disconnected from MongoDB');
}

migrateRouteTextFields()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error('❌ Migration failed:', err);
    process.exit(1);
  });
