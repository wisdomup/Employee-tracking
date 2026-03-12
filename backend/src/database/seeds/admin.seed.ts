import 'dotenv/config';
import mongoose from 'mongoose';
import bcrypt from 'bcrypt';

async function seedAdmin() {
  await mongoose.connect(
    process.env.MONGODB_URI || 'mongodb://localhost:27017/gps_task_tracking',
  );
  console.log('Connected to MongoDB');

  const collection = mongoose.connection.collection('users');

  const existing = await collection.findOne({ username: 'admin' });

  if (existing) {
    console.log('✅ Admin user already exists!');
    console.log('Username:', existing['username']);
    console.log('Phone:', existing['phone']);
    await mongoose.disconnect();
    return;
  }

  const hashedPassword = await bcrypt.hash('admin123', 10);

  await collection.insertOne({
    username: 'admin',
    phone: '1234567890',
    email: 'wisdomuppk@gmail.com',
    password: hashedPassword,
    role: 'admin',
    isActive: true,
    address: { street: '', city: '', state: '', country: '' },
    createdAt: new Date(),
    updatedAt: new Date(),
  });

  console.log('🎉 Admin user created successfully!');
  console.log('=====================================');
  console.log('Username: admin');
  console.log('Phone:    1234567890');
  console.log('Email:    wisdomuppk@gmail.com');
  console.log('Password: admin123');
  console.log('=====================================');

  await mongoose.disconnect();
  console.log('Disconnected from MongoDB');
}

seedAdmin()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error('❌ Seed failed:', err);
    process.exit(1);
  });
