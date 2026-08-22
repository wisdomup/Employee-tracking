import 'dotenv/config';
import mongoose from 'mongoose';
import { connectDatabase } from '../../config/database';
import { seedAccessPolicies, validateSeed } from './access-policies.seed';

/**
 * CLI for the permission-matrix seed. `npm run seed:access [-- --force]`.
 *
 * `--force` overwrites policies that already exist, discarding any hand-tuning an admin has
 * done in the matrix editor. That is occasionally what you want — resetting a role back to
 * shipped defaults — and never what you want by accident, so it is opt-in and announced.
 */
async function main() {
  const force = process.argv.includes('--force');

  const problems = validateSeed();
  if (problems.length > 0) {
    console.error('Seed is invalid — refusing to write:\n  ' + problems.join('\n  '));
    process.exit(1);
  }

  await connectDatabase();

  if (force) {
    console.warn('--force: existing role policies will be reset to shipped defaults.\n');
  }

  const result = await seedAccessPolicies({ force, backfillUsers: true });

  if (result.created.length) console.log(`created:  ${result.created.join(', ')}`);
  if (result.updated.length) console.log(`updated:  ${result.updated.join(', ')}`);
  if (result.skipped.length) {
    console.log(`skipped:  ${result.skipped.join(', ')}  (already configured; use --force to reset)`);
  }
  console.log(`users backfilled with roles[]: ${result.usersBackfilled}`);

  await mongoose.disconnect();
}

main().catch(async (err) => {
  console.error(err);
  await mongoose.disconnect().catch(() => undefined);
  process.exit(1);
});
