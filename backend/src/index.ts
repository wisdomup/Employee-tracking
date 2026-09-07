import 'dotenv/config';
import { connectDatabase } from './config/database';
import { ensureUploadDirectories } from './services/file-upload.service';
import { startVisitGenerationCron } from './jobs/visit-generation.cron';
import { startLowStockCron } from './jobs/low-stock.cron';
import { startLateStartFreezeCron } from './jobs/late-start-freeze.cron';
import { runWarehouseBootstrapOnStart } from './database/warehouse-bootstrap-on-start';
import { runAccessBootstrapOnStart } from './database/access-bootstrap-on-start';
import { runFinanceBootstrapOnStart } from './database/finance-bootstrap-on-start';
import app from './app';

const PORT = process.env.PORT || 8001;

async function bootstrap() {
  await connectDatabase();
  // Before the port is bound, so no request can be served against half-migrated stock.
  await runWarehouseBootstrapOnStart();
  // Before the port is bound: an empty matrix denies every non-admin, so this must not race
  // the first request.
  await runAccessBootstrapOnStart();
  // Seeds the chart of accounts and the number series on a fresh database, then checks every
  // engine role still resolves to a live ledger. Deliberately NOT gating the port like the two
  // above: nothing serves finance documents yet, and a finance misconfiguration must not keep
  // orders, visits and collections offline.
  await runFinanceBootstrapOnStart();
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

