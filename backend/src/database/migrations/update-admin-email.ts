import 'dotenv/config';
import mongoose from 'mongoose';

async function updateAdminEmail() {
  await mongoose.connect(
    process.env.MONGODB_URI || 'mongodb://localhost:27017/gps_task_tracking',
  );
  console.log('Connected to MongoDB');

  const collection = mongoose.connection.collection('users');

  const result = await collection.findOneAndUpdate(
    { username: 'admin' },
    { $set: { email: 'wisdomuppk@gmail.com' } },
    { returnDocument: 'after' },
  );

  if (!result) {
    console.log('❌ Admin user not found!');
  } else {
    console.log('✅ Admin email updated successfully!');
    console.log('=====================================');
    console.log('Username:', result['username']);
    console.log('Phone:', result['phone']);
    console.log('Email:', result['email']);
    console.log('=====================================');
  }

  await mongoose.disconnect();
  console.log('Disconnected from MongoDB');
}

updateAdminEmail()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error('❌ Migration failed:', err);
    process.exit(1);
  });
