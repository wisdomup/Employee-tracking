import 'dotenv/config';
import mongoose from 'mongoose';

async function taskDefaultRoute() {
  await mongoose.connect(
    process.env.MONGODB_URI || 'mongodb://localhost:27017/gps_task_tracking',
  );
  console.log('Connected to MongoDB');

  const routesCollection = mongoose.connection.collection('routes');
  const tasksCollection = mongoose.connection.collection('tasks');

  let defaultRouteId = (await routesCollection.findOne({}))?.['_id'];

  if (!defaultRouteId) {
    const inserted = await routesCollection.insertOne({
      name: 'Default',
      startingPoint: 'Default Start',
      endingPoint: 'Default End',
      createdAt: new Date(),
      updatedAt: new Date(),
    });
    defaultRouteId = inserted.insertedId;
    console.log('✅ Created default route');
  }

  const result = await tasksCollection.updateMany(
    { $or: [{ routeId: { $exists: false } }, { routeId: null }] },
    { $set: { routeId: defaultRouteId } },
  );

  console.log(`✅ Task migration completed: ${result.modifiedCount} task(s) updated with default route`);
  await mongoose.disconnect();
  console.log('Disconnected from MongoDB');
}

taskDefaultRoute()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error('❌ Migration failed:', err);
    process.exit(1);
  });
