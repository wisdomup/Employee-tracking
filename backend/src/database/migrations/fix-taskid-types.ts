import 'dotenv/config';
import mongoose, { Types } from 'mongoose';

async function fixTaskIdTypes() {
  await mongoose.connect(
    process.env.MONGODB_URI || 'mongodb://localhost:27017/gps_task_tracking',
  );
  console.log('Connected to MongoDB');

  const collection = mongoose.connection.collection('taskassignments');
  const assignments = await collection.find({}).toArray();
  console.log(`Found ${assignments.length} assignments to check`);

  let fixedCount = 0;

  for (const assignment of assignments) {
    if (typeof assignment.taskId === 'string') {
      await collection.updateOne(
        { _id: assignment._id },
        {
          $set: {
            taskId: new Types.ObjectId(assignment.taskId),
            employeeId: new Types.ObjectId(assignment.employeeId),
          },
        },
      );
      fixedCount++;
    }
  }

  console.log(`✅ Fixed ${fixedCount} assignments (converted string IDs to ObjectIds)`);
  await mongoose.disconnect();
  console.log('Disconnected from MongoDB');
}

fixTaskIdTypes()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error('❌ Error:', err);
    process.exit(1);
  });
