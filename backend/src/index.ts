import 'dotenv/config';
import { connectDatabase } from './config/database';
import { ensureUploadDirectories } from './services/file-upload.service';
import { startVisitGenerationCron } from './jobs/visit-generation.cron';
import { startLowStockCron } from './jobs/low-stock.cron';
import { runWarehouseBootstrapOnStart } from './database/warehouse-bootstrap-on-start';
import app from './app';

const PORT = process.env.PORT || 8001;

async function bootstrap() {
  await connectDatabase();
  // Before the port is bound, so no request can be served against half-migrated stock.
  await runWarehouseBootstrapOnStart();
  ensureUploadDirectories();
  startVisitGenerationCron();
  startLowStockCron();

  app.listen(PORT, () => {
    console.log(`Server for Tracking App running on http://localhost:${PORT}`);
  });
}

bootstrap().catch((err) => {
  console.error('Failed to start server:', err);
  process.exit(1);
});

