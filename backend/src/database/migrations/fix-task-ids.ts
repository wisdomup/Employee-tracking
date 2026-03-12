import 'dotenv/config';
import mongoose, { Types } from 'mongoose';

async function fixTaskIds() {
  await mongoose.connect(
    process.env.MONGODB_URI || 'mongodb://localhost:27017/gps_task_tracking',
  );
  console.log('Connected to MongoDB');

  const collection = mongoose.connection.collection('tasks');
  const tasks = await collection.find({}).toArray();
  console.log(`Found ${tasks.length} tasks to check`);

  let fixedCount = 0;

  for (const task of tasks) {
    const needsUpdate =
      typeof task.dealerId === 'string' || typeof task.createdBy === 'string';

    if (needsUpdate) {
      const updateFields: Record<string, unknown> = {};

      if (typeof task.dealerId === 'string') {
        updateFields.dealerId = new Types.ObjectId(task.dealerId);
      }
      if (typeof task.createdBy === 'string') {
        updateFields.createdBy = new Types.ObjectId(task.createdBy);
      }

      await collection.updateOne({ _id: task._id }, { $set: updateFields });
      fixedCount++;
    }
  }

  console.log(`✅ Fixed ${fixedCount} tasks (converted string IDs to ObjectIds)`);
  await mongoose.disconnect();
  console.log('Disconnected from MongoDB');
}

fixTaskIds()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error('❌ Error:', err);
    process.exit(1);
  });
