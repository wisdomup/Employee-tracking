import 'dotenv/config';
import { connectDatabase } from './config/database';
import { ensureUploadDirectories } from './services/file-upload.service';
import { startVisitGenerationCron } from './jobs/visit-generation.cron';
import { startLowStockCron } from './jobs/low-stock.cron';
import { startLateStartFreezeCron } from './jobs/late-start-freeze.cron';
import { runWarehouseBootstrapOnStart } from './database/warehouse-bootstrap-on-start';
import { runAccessBootstrapOnStart } from './database/access-bootstrap-on-start';
import { seedFinanceCounters } from './modules/finance/finance-counters';
import app from './app';

const PORT = process.env.PORT || 8001;

async function bootstrap() {
  await connectDatabase();
  // Before the port is bound, so no request can be served against half-migrated stock.
  await runWarehouseBootstrapOnStart();
  // Before the port is bound: an empty matrix denies every non-admin, so this must not race
  // the first request.
  await runAccessBootstrapOnStart();
  // Cheap and idempotent: creates any missing finance number series at zero. Not before the
  // port like the two above — nothing serves finance documents yet, so a slow write here must
  // not delay the boot of everything else. Kept in the same place it will be needed later.
  await seedFinanceCounters();
  ensureUploadDirectories();
  startVisitGenerationCron();
  startLowStockCron();
  startLateStartFreezeCron();

  app.listen(PORT, () => {
    console.log(`Server for Tracking App running on http://localhost:${PORT}`);
  });
}

bootstrap().catch((err) => {
  console.error('Failed to start server:', err);
  process.exit(1);
});

