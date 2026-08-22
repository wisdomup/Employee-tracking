import { AccessPolicyModel } from '../models/access-policy.model';
import { seedAccessPolicies } from './seeds/access-policies.seed';

/**
 * Make sure the permission matrix exists before the HTTP port is bound.
 *
 * This is not an optimisation, it is the safety net. The resolver returns "no permissions"
 * for a role with no policy, so a process that boots against an empty `accesspolicies`
 * collection locks out every non-admin in the company — silently, with correct-looking 403s.
 * That can happen on a fresh database, on a restored backup taken before this feature, or if
 * someone drops the collection. Seeding here means the worst case is "the defaults came back",
 * not "nobody can log in".
 *
 * After the first run this costs one indexed `countDocuments` per boot and returns.
 *
 * Existing policies are never overwritten: `seedAccessPolicies` skips any subject that already
 * has one unless `force` is passed. An admin's hand-tuned matrix survives every redeploy.
 *
 * Env:
 *   ACCESS_BOOTSTRAP_ON_START=false   skip entirely (`npm run seed:access` still works)
 */
function parseBoolEnv(value: string | undefined, defaultTrue: boolean): boolean {
  if (value === undefined || value === '') return defaultTrue;
  const v = value.trim().toLowerCase();
  if (['1', 'true', 'yes', 'on'].includes(v)) return true;
  if (['0', 'false', 'no', 'off'].includes(v)) return false;
  return defaultTrue;
}

export async function runAccessBootstrapOnStart(): Promise<void> {
  if (!parseBoolEnv(process.env.ACCESS_BOOTSTRAP_ON_START, true)) {
    console.log('Access-policy bootstrap skipped (ACCESS_BOOTSTRAP_ON_START=false)');
    return;
  }

  try {
    const existing = await AccessPolicyModel.countDocuments({ subjectType: 'role' }).exec();

    // The user backfill is the one part worth running even when policies are present: a
    // restored backup can carry policies but pre-multi-role user documents.
    const result = await seedAccessPolicies({ force: false, backfillUsers: true });

    if (result.created.length > 0) {
      console.log(
        `Access policies seeded for: ${result.created.join(', ')}` +
          (existing === 0 ? ' (empty matrix on boot — defaults restored)' : ''),
      );
    }
    if (result.usersBackfilled > 0) {
      console.log(`Backfilled roles[] on ${result.usersBackfilled} user(s)`);
    }
  } catch (err) {
    // Deliberately fatal. Booting with a half-seeded matrix would serve confident 403s to
    // real staff, which is far harder to diagnose than a process that refuses to start.
    console.error('Access-policy bootstrap failed:', err);
    throw err;
  }
}
