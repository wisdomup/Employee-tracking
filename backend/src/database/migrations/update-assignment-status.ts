import 'dotenv/config';
import mongoose from 'mongoose';

async function updateAssignmentStatus() {
  await mongoose.connect(
    process.env.MONGODB_URI || 'mongodb://localhost:27017/gps_task_tracking',
  );
  console.log('Connected to MongoDB');

  const collection = mongoose.connection.collection('taskassignments');

  const result = await collection.updateMany(
    { status: 'assigned' },
    { $set: { status: 'to_do' } },
  );

  console.log(`✅ Updated ${result.modifiedCount} assignments from "assigned" to "to_do"`);
  await mongoose.disconnect();
  console.log('Disconnected from MongoDB');
}

updateAssignmentStatus()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error('❌ Error:', err);
    process.exit(1);
  });
