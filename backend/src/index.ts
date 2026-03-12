import 'dotenv/config';
import { connectDatabase } from './config/database';
import { ensureUploadDirectories } from './services/file-upload.service';
import app from './app';

const PORT = process.env.PORT || 8001;

async function bootstrap() {
  await connectDatabase();
  ensureUploadDirectories();

  app.listen(PORT, () => {
    console.log(`Express server running on http://localhost:${PORT}`);
  });
}

bootstrap().catch((err) => {
  console.error('Failed to start server:', err);
  process.exit(1);
});

