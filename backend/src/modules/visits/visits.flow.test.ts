/**
 * End-to-end integration test for the rider check-in → checkout flow.
 *
 * Runs against a throwaway in-memory MongoDB (mongodb-memory-server), so it never
 * touches the real database. Exercises the actual service functions and asserts on
 * what is really persisted. Run with:
 *   npm run test:visits:flow
 */
import assert from 'node:assert/strict';
import mongoose, { Types } from 'mongoose';
import { MongoMemoryServer } from 'mongodb-memory-server';

// This suite drives check-in at the REAL wall-clock time, so with the late-start rule
// active every case here would fail when run after 12:30 PKT and pass before it. The
// freeze has its own deterministic suite (`npm run test:freeze:flow`); switch it off here
// so this one tests the check-in/checkout flow and nothing else.
process.env.RIDER_FREEZE_ENABLED = 'false';

import { VisitModel } from '../../models/visit.model';
import { DealerModel } from '../../models/dealer.model';
import { UserModel } from '../../models/user.model';
import { PerformanceFlagModel } from '../../models/performance-flag.model';
import { RouteModel } from '../../models/route.model';
import { RouteAssignmentModel } from '../../models/route-assignment.model';
import * as visitsService from './visits.service';
import { VISIT_DURATION_LIMIT_MINUTES, VISIT_COMPLETION_THRESHOLD_PERCENT } from './visits.rules';

let passed = 0;
async function test(name: string, fn: () => Promise<void> | void): Promise<void> {
  await fn();
  passed += 1;
  // eslint-disable-next-line no-console
  console.log(`  ✓ ${name}`);
}

/** Asserts the promise rejects with a message matching `pattern`. */
async function rejectsWith(promise: Promise<unknown>, pattern: RegExp): Promise<void> {
  try {
    await promise;
  } catch (err) {
    const message = (err as Error).message ?? String(err);
    assert.match(message, pattern);
    return;
  }
  assert.fail(`Expected rejection matching ${pattern}, but it resolved`);
}

// Karachi coordinates for the shop, plus points at known distances from it.
const SHOP = { lat: 24.8607, lng: 67.0011 };
const NEARBY = { lat: 24.86075, lng: 67.0011 }; // ~5 m away — inside the 150 m radius
const FAR_AWAY = { lat: 24.8707, lng: 67.0011 }; // ~1.1 km away — outside the radius

const RIDER_ID = new Types.ObjectId();
const OTHER_RIDER_ID = new Types.ObjectId();

const IMAGES: { type: 'shop' | 'selfie'; url: string }[] = [
  { type: 'shop', url: '/uploads/completions/shop.jpg' },
  { type: 'selfie', url: '/uploads/completions/selfie.jpg' },
];

let mongod: MongoMemoryServer;
let dealerId: Types.ObjectId;

async function makeVisit(overrides: Record<string, unknown> = {}) {
  return VisitModel.create({
    dealerId,
    employeeId: RIDER_ID,
    visitDate: new Date(),
    status: 'todo',
    ...overrides,
  });
}

async function main(): Promise<void> {
  mongod = await MongoMemoryServer.create();
  await mongoose.connect(mongod.getUri(), { dbName: 'visit-flow-test' });
  // eslint-disable-next-line no-console
  console.log('Connected to throwaway in-memory MongoDB\n');

  const dealer = await DealerModel.create({
    name: 'Test Shop',
    phone: '03001234567', // required + unique on the Dealer model
    latitude: SHOP.lat,
    longitude: SHOP.lng,
  });
  dealerId = dealer._id as Types.ObjectId;

  // Real rider documents, so `.populate('employeeId')` resolves instead of yielding null.
  await UserModel.create([
    {
      _id: RIDER_ID,
      userID: 'R-001',
      username: 'rider.one',
      phone: '03009999001',
      password: 'hashed',
      role: 'order_taker',
    },
    {
      _id: OTHER_RIDER_ID,
      userID: 'R-002',
      username: 'rider.two',
      phone: '03009999002',
      password: 'hashed',
      role: 'order_taker',
    },
  ]);

  // -------------------------------------------------------------------------
  console.log('Check-in — location gate');
  // -------------------------------------------------------------------------
  await test('rider too far from the shop is refused, with the distance in the message', async () => {
    const visit = await makeVisit();
    await rejectsWith(
      visitsService.checkInVisit(
        String(visit._id),
        { latitude: FAR_AWAY.lat, longitude: FAR_AWAY.lng },
        String(RIDER_ID),
        'order_taker',
      ),
      /must be within 150 metres.*currently \d+ metres away/is,
    );
    const after = await VisitModel.findById(visit._id);
    assert.equal(after!.status, 'todo', 'status must not change on a failed check-in');
    assert.equal(after!.checkedInAt, undefined);
  });

  await test('rider at the shop checks in: status, timestamp and GPS are persisted', async () => {
    const visit = await makeVisit();
    const before = Date.now();
    await visitsService.checkInVisit(
      String(visit._id),
      { latitude: NEARBY.lat, longitude: NEARBY.lng },
      String(RIDER_ID),
      'order_taker',
    );
    const after = await VisitModel.findById(visit._id);
    assert.equal(after!.status, 'checked_in');
    assert.ok(after!.checkedInAt instanceof Date);
    assert.ok(after!.checkedInAt!.getTime() >= before);
    assert.equal(after!.checkedInLatitude, NEARBY.lat);
    assert.equal(after!.checkedInLongitude, NEARBY.lng);
  });

  await test('rider cannot check in to a visit assigned to someone else', async () => {
    const visit = await makeVisit();
    await rejectsWith(
      visitsService.checkInVisit(
        String(visit._id),
        { latitude: NEARBY.lat, longitude: NEARBY.lng },
        String(OTHER_RIDER_ID),
        'order_taker',
      ),
      /not assigned to you/i,
    );
  });

  await test('double check-in is refused', async () => {
    const visit = await makeVisit({ status: 'checked_in', checkedInAt: new Date() });
    await rejectsWith(
      visitsService.checkInVisit(
        String(visit._id),
        { latitude: NEARBY.lat, longitude: NEARBY.lng },
        String(RIDER_ID),
        'order_taker',
      ),
      /already checked in/i,
    );
  });

  // -------------------------------------------------------------------------
  console.log('\nCheckout — check-in is mandatory first');
  // -------------------------------------------------------------------------
  await test('rider CANNOT complete a visit without checking in', async () => {
    const visit = await makeVisit();
    await rejectsWith(
      visitsService.completeVisit(
        String(visit._id),
        { latitude: NEARBY.lat, longitude: NEARBY.lng, completionImages: IMAGES },
        String(RIDER_ID),
        'order_taker',
      ),
      /must check in at the store/i,
    );
    const after = await VisitModel.findById(visit._id);
    assert.equal(after!.status, 'todo', 'a refused checkout must not complete the visit');
    assert.equal(after!.completedAt, undefined);
  });

  await test('rider CANNOT skip check-in by moving the visit to in_progress first', async () => {
    const visit = await makeVisit({ status: 'in_progress' });
    await rejectsWith(
      visitsService.completeVisit(
        String(visit._id),
        { latitude: NEARBY.lat, longitude: NEARBY.lng, completionImages: IMAGES },
        String(RIDER_ID),
        'order_taker',
      ),
      /must check in at the store/i,
    );
  });

  await test('full happy path: check in, then check out', async () => {
    const visit = await makeVisit();
    await visitsService.checkInVisit(
      String(visit._id),
      { latitude: NEARBY.lat, longitude: NEARBY.lng },
      String(RIDER_ID),
      'order_taker',
    );
    await visitsService.completeVisit(
      String(visit._id),
      { latitude: NEARBY.lat, longitude: NEARBY.lng, completionImages: IMAGES },
      String(RIDER_ID),
      'order_taker',
    );
    const after = await VisitModel.findById(visit._id);
    assert.equal(after!.status, 'completed');
    assert.ok(after!.checkedInAt instanceof Date, 'check-in time is retained after checkout');
    assert.ok(after!.completedAt instanceof Date, 'checkout time is recorded');
    assert.equal(after!.completionImages?.length, 2);
  });

  await test('checkout still requires both a shop image and a selfie', async () => {
    const visit = await makeVisit({ status: 'checked_in', checkedInAt: new Date() });
    await rejectsWith(
      visitsService.completeVisit(
        String(visit._id),
        {
          latitude: NEARBY.lat,
          longitude: NEARBY.lng,
          completionImages: [{ type: 'shop', url: '/a.jpg' }],
        },
        String(RIDER_ID),
        'order_taker',
      ),
      /both shop image and selfie/i,
    );
  });

  await test('admin may complete without checking in (override)', async () => {
    const visit = await makeVisit();
    await visitsService.completeVisit(
      String(visit._id),
      { latitude: NEARBY.lat, longitude: NEARBY.lng, completionImages: IMAGES },
      String(new Types.ObjectId()),
      'admin',
    );
    const after = await VisitModel.findById(visit._id);
    assert.equal(after!.status, 'completed');
    assert.equal(after!.durationMinutes, undefined, 'no check-in means no measurable duration');
    assert.equal(after!.overstayFlagged, false);
  });

  // -------------------------------------------------------------------------
  console.log(`\nDuration tracking and the ${VISIT_DURATION_LIMIT_MINUTES}-minute flag`);
  // -------------------------------------------------------------------------
  await test('a 10-minute visit records the duration and is NOT flagged', async () => {
    const checkedInAt = new Date(Date.now() - 10 * 60_000);
    const visit = await makeVisit({ status: 'checked_in', checkedInAt });
    await visitsService.completeVisit(
      String(visit._id),
      { latitude: NEARBY.lat, longitude: NEARBY.lng, completionImages: IMAGES },
      String(RIDER_ID),
      'order_taker',
    );
    const after = await VisitModel.findById(visit._id);
    assert.equal(after!.durationMinutes, 10);
    assert.equal(after!.overstayFlagged, false);
  });

  await test('a 45-minute visit is flagged for admin review', async () => {
    const checkedInAt = new Date(Date.now() - 45 * 60_000);
    const visit = await makeVisit({ status: 'checked_in', checkedInAt });
    await visitsService.completeVisit(
      String(visit._id),
      { latitude: NEARBY.lat, longitude: NEARBY.lng, completionImages: IMAGES },
      String(RIDER_ID),
      'order_taker',
    );
    const after = await VisitModel.findById(visit._id);
    assert.equal(after!.durationMinutes, 45);
    assert.equal(after!.overstayFlagged, true);
  });

  await test('admin can list only the flagged visits', async () => {
    const flagged = await visitsService.findAll({ overstayFlagged: true });
    assert.ok(flagged.length >= 1, 'expected at least the 45-minute visit');
    assert.ok(
      flagged.every((v) => v.overstayFlagged === true),
      'the filter must return only flagged visits',
    );
    assert.ok(
      flagged.every((v) => (v.durationMinutes ?? 0) > VISIT_DURATION_LIMIT_MINUTES),
      'every flagged visit must exceed the limit',
    );
    // And the flag identifies which rider it was.
    assert.ok(flagged.every((v) => v.employeeId != null));
  });

  // -------------------------------------------------------------------------
  console.log('\nPost-checkout shop gallery');
  // -------------------------------------------------------------------------
  await test('rider cannot add gallery photos before checking out', async () => {
    const visit = await makeVisit({ status: 'checked_in', checkedInAt: new Date() });
    await rejectsWith(
      visitsService.updateVisitGallery(
        String(visit._id),
        { galleryImages: [{ url: '/uploads/completions/extra.jpg' }] },
        String(RIDER_ID),
        'order_taker',
      ),
      /only add shop photos and notes after checking out/i,
    );
  });

  await test('rider adds optional photos and a description after checkout', async () => {
    const visit = await makeVisit({ status: 'checked_in', checkedInAt: new Date() });
    await visitsService.completeVisit(
      String(visit._id),
      { latitude: NEARBY.lat, longitude: NEARBY.lng, completionImages: IMAGES },
      String(RIDER_ID),
      'order_taker',
    );
    await visitsService.updateVisitGallery(
      String(visit._id),
      {
        galleryImages: [
          { url: '/uploads/completions/front.jpg', caption: 'Storefront' },
          { url: '/uploads/completions/shelf.jpg' },
        ],
        visitNotes: 'Owner wants more stock next week.',
      },
      String(RIDER_ID),
      'order_taker',
    );
    const after = await VisitModel.findById(visit._id);
    assert.equal(after!.galleryImages?.length, 2);
    assert.equal(after!.galleryImages?.[0].caption, 'Storefront');
    assert.equal(after!.visitNotes, 'Owner wants more stock next week.');
    assert.ok(after!.galleryUpdatedAt instanceof Date);
  });

  await test('another rider cannot attach photos to a visit that is not theirs', async () => {
    const visit = await makeVisit({ status: 'completed', completedAt: new Date() });
    await rejectsWith(
      visitsService.updateVisitGallery(
        String(visit._id),
        { visitNotes: 'sneaky' },
        String(OTHER_RIDER_ID),
        'order_taker',
      ),
      /not assigned to you/i,
    );
  });

  await test('the shop gallery lists entries linked to both the shop and the rider', async () => {
    const entries = await visitsService.findDealerGallery(String(dealerId));
    assert.ok(entries.length >= 1, 'expected at least one gallery entry');

    const entry = entries.find((e) => e.visitNotes === 'Owner wants more stock next week.');
    assert.ok(entry, 'the entry we just created should be in the shop gallery');

    // Linked to the shop...
    const populatedDealer = entry!.dealerId as unknown as { _id: Types.ObjectId; name: string };
    assert.equal(String(populatedDealer._id), String(dealerId));
    assert.equal(populatedDealer.name, 'Test Shop');

    // ...and attributed to the rider who recorded it.
    const populatedRider = entry!.employeeId as unknown as { _id: Types.ObjectId };
    assert.equal(String(populatedRider._id), String(RIDER_ID));

    assert.equal(entry!.galleryImages?.length, 2);
    // Visits with no photos and no notes must not appear in the gallery.
    assert.ok(
      entries.every((e) => (e.galleryImages?.length ?? 0) > 0 || Boolean(e.visitNotes)),
      'empty visits must be excluded from the gallery',
    );
  });

  // -------------------------------------------------------------------------
  console.log(`\nSkipping visits and the ${VISIT_COMPLETION_THRESHOLD_PERCENT}% rule`);
  // -------------------------------------------------------------------------

  /** A fixed day well clear of the other fixtures, so tallies are isolated. */
  const SKIP_DAY = new Date(Date.UTC(2026, 4, 12, 9, 0, 0));

  /** Creates `count` todo visits for RIDER_ID on SKIP_DAY and returns them. */
  async function seedDay(count: number, overrides: Record<string, unknown>[] = []) {
    await VisitModel.deleteMany({ employeeId: RIDER_ID, visitDate: SKIP_DAY });
    await PerformanceFlagModel.deleteMany({ employeeId: RIDER_ID });
    const docs = [];
    for (let i = 0; i < count; i += 1) {
      docs.push({
        dealerId,
        employeeId: RIDER_ID,
        visitDate: SKIP_DAY,
        status: 'todo',
        ...(overrides[i] ?? {}),
      });
    }
    return VisitModel.create(docs);
  }

  await test('preview reports the day tally without changing anything', async () => {
    const visits = await seedDay(4);
    const preview = await visitsService.previewSkipVisit(
      String(visits[0]._id),
      String(RIDER_ID),
      'order_taker',
    );
    assert.equal(preview.assigned, 4);
    assert.equal(preview.completed, 0);
    assert.equal(preview.stillOpen, 4);
    assert.equal(preview.threshold, VISIT_COMPLETION_THRESHOLD_PERCENT);
    // Skipping 1 of 4 still allows a 75% finish, so no warning.
    assert.equal(preview.projectedRate, 75);
    assert.equal(preview.wouldDropBelowThreshold, false);

    const after = await VisitModel.findById(visits[0]._id);
    assert.equal(after!.status, 'todo', 'preview must not mutate the visit');
  });

  await test('first skip of 4 is allowed outright — 75% is still reachable', async () => {
    const visits = await seedDay(4);
    const result = await visitsService.skipVisit(
      String(visits[0]._id),
      { reason: 'Shop closed' },
      String(RIDER_ID),
      'order_taker',
    );
    assert.equal(result.skipped, true);
    assert.equal(result.requiresConfirmation, false);
    assert.equal(result.flagged, false);

    const after = await VisitModel.findById(visits[0]._id);
    assert.equal(after!.status, 'skipped');
    assert.ok(after!.skippedAt instanceof Date);
    assert.equal(after!.skipReason, 'Shop closed');
    assert.equal(String(after!.skippedBy), String(RIDER_ID));

    const flags = await PerformanceFlagModel.find({ employeeId: RIDER_ID });
    assert.equal(flags.length, 0, 'no flag while the rider can still pass');
  });

  await test('a second skip WARNS instead of skipping, and writes nothing', async () => {
    const visits = await seedDay(4, [{ status: 'skipped', skippedAt: new Date() }]);
    const result = await visitsService.skipVisit(
      String(visits[1]._id),
      {},
      String(RIDER_ID),
      'order_taker',
    );
    assert.equal(result.skipped, false);
    assert.equal(result.requiresConfirmation, true);
    assert.equal(result.projectedRate, 50);
    assert.match(result.message ?? '', /below the required 75%/i);

    const untouched = await VisitModel.findById(visits[1]._id);
    assert.equal(untouched!.status, 'todo', 'the warning must not mutate the visit');
    const flags = await PerformanceFlagModel.find({ employeeId: RIDER_ID });
    assert.equal(flags.length, 0, 'warning alone must not raise a flag');
  });

  await test('confirming the second skip goes through AND flags the rider to admin', async () => {
    const visits = await seedDay(4, [{ status: 'skipped', skippedAt: new Date() }]);
    const result = await visitsService.skipVisit(
      String(visits[1]._id),
      { confirm: true, reason: 'Running late' },
      String(RIDER_ID),
      'order_taker',
    );
    assert.equal(result.skipped, true);
    assert.equal(result.flagged, true);

    const flags = await PerformanceFlagModel.find({ employeeId: RIDER_ID, type: 'low_visit_completion' });
    assert.equal(flags.length, 1);
    assert.equal(flags[0].threshold, VISIT_COMPLETION_THRESHOLD_PERCENT);
    assert.equal(flags[0].value, 50);
    assert.equal(flags[0].resolved, false);
    assert.match(flags[0].message, /below the required 75%/i);
  });

  await test('repeat skips on the same bad day update one flag, not many', async () => {
    const visits = await seedDay(4, [{ status: 'skipped', skippedAt: new Date() }]);
    await visitsService.skipVisit(String(visits[1]._id), { confirm: true }, String(RIDER_ID), 'order_taker');
    await visitsService.skipVisit(String(visits[2]._id), { confirm: true }, String(RIDER_ID), 'order_taker');

    const flags = await PerformanceFlagModel.find({ employeeId: RIDER_ID, type: 'low_visit_completion' });
    assert.equal(flags.length, 1, 'upserted per employee/day — admin is not spammed');
    assert.equal(flags[0].value, 25, 'the flag reflects the latest, worse rate');
  });

  await test('a rider cannot skip a visit belonging to someone else', async () => {
    const visits = await seedDay(2);
    await rejectsWith(
      visitsService.skipVisit(String(visits[0]._id), { confirm: true }, String(OTHER_RIDER_ID), 'order_taker'),
      /not assigned to you/i,
    );
  });

  await test('a visit already checked in cannot be skipped', async () => {
    const visits = await seedDay(4, [{ status: 'checked_in', checkedInAt: new Date() }]);
    await rejectsWith(
      visitsService.skipVisit(String(visits[0]._id), { confirm: true }, String(RIDER_ID), 'order_taker'),
      /complete the visit instead/i,
    );
  });

  await test('a completed visit cannot be skipped', async () => {
    const visits = await seedDay(4, [{ status: 'completed', completedAt: new Date() }]);
    await rejectsWith(
      visitsService.skipVisit(String(visits[0]._id), { confirm: true }, String(RIDER_ID), 'order_taker'),
      /already completed/i,
    );
  });

  await test('cancelled visits are excluded from the denominator', async () => {
    // 4 rows, one cancelled => assigned is 3, not 4.
    const visits = await seedDay(4, [{ status: 'cancelled' }]);
    const preview = await visitsService.previewSkipVisit(
      String(visits[1]._id),
      String(RIDER_ID),
      'order_taker',
    );
    assert.equal(preview.assigned, 3);
    // 3 open of 3 assigned; skipping one leaves a best case of 2/3 = 66.7% => warns.
    assert.equal(preview.projectedRate, 66.7);
    assert.equal(preview.wouldDropBelowThreshold, true);
  });

  await test('completing the rest of the day keeps a single skip passing', async () => {
    const visits = await seedDay(4);
    await visitsService.skipVisit(String(visits[0]._id), {}, String(RIDER_ID), 'order_taker');
    await VisitModel.updateMany(
      { _id: { $in: [visits[1]._id, visits[2]._id, visits[3]._id] } },
      { $set: { status: 'completed', completedAt: SKIP_DAY } },
    );
    const tally = await visitsService.getDayVisitTally(RIDER_ID, SKIP_DAY);
    assert.equal(tally.completed, 3);
    assert.equal(tally.assigned, 4);
    assert.equal(tally.skipped, 1);
    assert.equal(tally.stillOpen, 0);
  });

  await test('an overstay checkout also raises an admin flag record', async () => {
    await PerformanceFlagModel.deleteMany({ employeeId: RIDER_ID, type: 'overstay' });
    const checkedInAt = new Date(Date.now() - 50 * 60_000);
    const visit = await makeVisit({ status: 'checked_in', checkedInAt });
    await visitsService.completeVisit(
      String(visit._id),
      { latitude: NEARBY.lat, longitude: NEARBY.lng, completionImages: IMAGES },
      String(RIDER_ID),
      'order_taker',
    );
    const flags = await PerformanceFlagModel.find({ employeeId: RIDER_ID, type: 'overstay' });
    assert.equal(flags.length, 1);
    assert.equal(flags[0].threshold, VISIT_DURATION_LIMIT_MINUTES);
    assert.ok((flags[0].value ?? 0) >= 50);
  });

  // -------------------------------------------------------------------------
  console.log('\nSelf-started visits (rider picks any client, no route assignment)');
  // -------------------------------------------------------------------------
  // A shop no other test touches, so the per-day dedupe starts from a clean slate.
  const walkInShop = await DealerModel.create({
    name: 'Walk-in Shop',
    phone: '03007654321',
    latitude: SHOP.lat,
    longitude: SHOP.lng,
  });
  const walkInId = walkInShop._id as Types.ObjectId;

  await test('a rider can start a visit for a client with no route assignment', async () => {
    const result = await visitsService.startSelfVisit(
      String(walkInId),
      String(RIDER_ID),
      'order_taker',
    );
    assert.equal(result.created, true);
    assert.equal(result.visit.isSelfInitiated, true);
    assert.equal(result.visit.status, 'todo');
    assert.equal(String(result.visit.employeeId), String(RIDER_ID));
    assert.equal(String(result.visit.dealerId), String(walkInId));
  });

  await test('starting the same client again the same day reuses the visit, no duplicate', async () => {
    const first = await visitsService.startSelfVisit(String(walkInId), String(RIDER_ID), 'order_taker');
    const second = await visitsService.startSelfVisit(String(walkInId), String(RIDER_ID), 'order_taker');
    assert.equal(second.created, false);
    assert.equal(String(second.visit._id), String(first.visit._id));
  });

  await test('a self-started visit follows the SAME check-in and checkout flow', async () => {
    // Clear today's walk-in visit so a genuinely fresh one is created.
    await VisitModel.deleteMany({ employeeId: RIDER_ID, dealerId: walkInId });
    const { visit } = await visitsService.startSelfVisit(
      String(walkInId),
      String(RIDER_ID),
      'order_taker',
    );

    // Geofence still applies — far away is refused.
    await rejectsWith(
      visitsService.checkInVisit(String(visit._id), { latitude: FAR_AWAY.lat, longitude: FAR_AWAY.lng }, String(RIDER_ID), 'order_taker'),
      /too far|metres/i,
    );

    // Checkout still requires a prior check-in.
    await rejectsWith(
      visitsService.completeVisit(
        String(visit._id),
        { latitude: NEARBY.lat, longitude: NEARBY.lng, completionImages: IMAGES },
        String(RIDER_ID),
        'order_taker',
      ),
      /check in/i,
    );

    // Happy path: check in at the shop, then check out with both photos.
    await visitsService.checkInVisit(
      String(visit._id),
      { latitude: NEARBY.lat, longitude: NEARBY.lng },
      String(RIDER_ID),
      'order_taker',
    );
    const done = await visitsService.completeVisit(
      String(visit._id),
      { latitude: NEARBY.lat, longitude: NEARBY.lng, completionImages: IMAGES },
      String(RIDER_ID),
      'order_taker',
    );
    assert.equal(done.status, 'completed');
    assert.ok(done.durationMinutes != null, 'duration is tracked just like an assigned visit');
    assert.equal(done.isSelfInitiated, true, 'still marked as an extra after checkout');
  });

  await test('extras do NOT count toward the 75% adherence rule', async () => {
    const day = new Date(Date.UTC(2026, 5, 3, 9, 0, 0));
    await VisitModel.deleteMany({ employeeId: RIDER_ID, visitDate: day });

    // 4 assigned visits, none done yet.
    await VisitModel.create(
      Array.from({ length: 4 }, () => ({
        dealerId,
        employeeId: RIDER_ID,
        visitDate: day,
        status: 'todo',
      })),
    );
    // Plus 3 completed extras on the same day.
    await VisitModel.create(
      Array.from({ length: 3 }, () => ({
        dealerId,
        employeeId: RIDER_ID,
        visitDate: day,
        status: 'completed',
        completedAt: day,
        isSelfInitiated: true,
      })),
    );

    const tally = await visitsService.getDayVisitTally(RIDER_ID, day);
    assert.equal(tally.assigned, 4, 'extras must not inflate the denominator');
    assert.equal(tally.completed, 0, 'completed extras are not adherence credit');
    assert.equal(tally.stillOpen, 4);
    assert.equal(tally.extrasCompleted, 3, 'but they are still reported');
  });

  await test('completing extras cannot pad away skipped route visits', async () => {
    const day = new Date(Date.UTC(2026, 5, 4, 9, 0, 0));
    await VisitModel.deleteMany({ employeeId: RIDER_ID, visitDate: day });
    await PerformanceFlagModel.deleteMany({ employeeId: RIDER_ID });

    // 4 assigned, 1 already skipped; plus 5 completed extras.
    const assigned = await VisitModel.create([
      { dealerId, employeeId: RIDER_ID, visitDate: day, status: 'skipped', skippedAt: day },
      { dealerId, employeeId: RIDER_ID, visitDate: day, status: 'todo' },
      { dealerId, employeeId: RIDER_ID, visitDate: day, status: 'todo' },
      { dealerId, employeeId: RIDER_ID, visitDate: day, status: 'todo' },
    ]);
    await VisitModel.create(
      Array.from({ length: 5 }, () => ({
        dealerId,
        employeeId: RIDER_ID,
        visitDate: day,
        status: 'completed',
        completedAt: day,
        isSelfInitiated: true,
      })),
    );

    // Skipping a second assigned visit must still trip the warning despite the 5 extras.
    const result = await visitsService.skipVisit(
      String(assigned[1]._id),
      {},
      String(RIDER_ID),
      'order_taker',
    );
    assert.equal(result.requiresConfirmation, true, 'extras must not mask the breach');
    assert.equal(result.projectedRate, 50);
  });

  await test('a rider cannot start a visit for a client outside their city', async () => {
    // Give the rider a city, and put the dealer in a different one.
    await UserModel.updateOne({ _id: RIDER_ID }, { $set: { 'address.city': 'Lahore' } });
    await DealerModel.updateOne({ _id: dealerId }, { $set: { 'address.city': 'Karachi' } });

    await rejectsWith(
      visitsService.startSelfVisit(String(dealerId), String(RIDER_ID), 'order_taker'),
      /not found/i,
    );

    // Same city works again.
    await DealerModel.updateOne({ _id: dealerId }, { $set: { 'address.city': 'lahore' } });
    const ok = await visitsService.startSelfVisit(String(dealerId), String(RIDER_ID), 'order_taker');
    assert.ok(ok.visit);

    // Reset so later assertions are unaffected.
    await UserModel.updateOne({ _id: RIDER_ID }, { $unset: { 'address.city': 1 } });
    await DealerModel.updateOne({ _id: dealerId }, { $unset: { 'address.city': 1 } });
  });

  await test('an unknown client id is rejected', async () => {
    await rejectsWith(
      visitsService.startSelfVisit(String(new Types.ObjectId()), String(RIDER_ID), 'order_taker'),
      /not found/i,
    );
    await rejectsWith(
      visitsService.startSelfVisit('not-an-id', String(RIDER_ID), 'order_taker'),
      /valid client/i,
    );
  });

  // -------------------------------------------------------------------------
  console.log("\nDay isolation — yesterday's visits must not appear today");
  // -------------------------------------------------------------------------
  const yesterday = new Date(Date.now() - 24 * 3600_000);
  const dayStr = (d: Date) => d.toISOString().slice(0, 10);

  await test('a single-date filter returns ONLY that date, not the day before', async () => {
    await VisitModel.deleteMany({ employeeId: OTHER_RIDER_ID });
    await VisitModel.create([
      { dealerId, employeeId: OTHER_RIDER_ID, visitDate: yesterday, status: 'todo' },
      { dealerId, employeeId: OTHER_RIDER_ID, visitDate: new Date(), status: 'todo' },
    ]);

    // Passing only startDate used to widen the window back a day, pulling in yesterday.
    const startOnly = await visitsService.findAll({
      employeeId: String(OTHER_RIDER_ID),
      startDate: dayStr(new Date()),
    });
    assert.equal(startOnly.length, 1, 'a start-only filter must not include yesterday');

    const bothBounds = await visitsService.findAll({
      employeeId: String(OTHER_RIDER_ID),
      startDate: dayStr(new Date()),
      endDate: dayStr(new Date()),
    });
    assert.equal(bothBounds.length, 1);
  });

  await test("rollover closes yesterday's open visits, including checked_in", async () => {
    await VisitModel.deleteMany({ employeeId: OTHER_RIDER_ID });
    // The rollover is global by design, so clear out anything earlier tests left open
    // first — otherwise the count below would include their leftovers.
    await visitsService.rolloverStaleVisits();

    const stale = await VisitModel.create([
      { dealerId, employeeId: OTHER_RIDER_ID, visitDate: yesterday, status: 'todo' },
      { dealerId, employeeId: OTHER_RIDER_ID, visitDate: yesterday, status: 'in_progress' },
      // Checked in but never checked out — previously left open forever.
      { dealerId, employeeId: OTHER_RIDER_ID, visitDate: yesterday, status: 'checked_in', checkedInAt: yesterday },
      // Already-finished ones must be left alone.
      { dealerId, employeeId: OTHER_RIDER_ID, visitDate: yesterday, status: 'completed', completedAt: yesterday },
      { dealerId, employeeId: OTHER_RIDER_ID, visitDate: yesterday, status: 'skipped', skippedAt: yesterday },
    ]);
    const today = await VisitModel.create({
      dealerId,
      employeeId: OTHER_RIDER_ID,
      visitDate: new Date(),
      status: 'todo',
    });

    const { markedIncomplete } = await visitsService.rolloverStaleVisits();
    assert.equal(markedIncomplete, 3, 'todo + in_progress + checked_in');

    const after = await VisitModel.find({ _id: { $in: stale.map((v) => v._id) } }).sort({ _id: 1 });
    const statuses = after.map((v) => v.status);
    assert.ok(statuses.filter((s) => s === 'incomplete').length === 3);
    assert.ok(statuses.includes('completed'), 'completed is untouched');
    assert.ok(statuses.includes('skipped'), 'skipped is untouched');

    const todayAfter = await VisitModel.findById(today._id);
    assert.equal(todayAfter!.status, 'todo', "today's visit must NOT be rolled over");
  });

  await test('rollover reaches visits with no route at all (walk-ins included)', async () => {
    await VisitModel.deleteMany({ employeeId: OTHER_RIDER_ID });
    const routeless = await VisitModel.create({
      dealerId,
      employeeId: OTHER_RIDER_ID,
      visitDate: yesterday,
      status: 'todo',
      isSelfInitiated: true,
      // deliberately no routeId
    });
    await visitsService.rolloverStaleVisits();
    const after = await VisitModel.findById(routeless._id);
    assert.equal(after!.status, 'incomplete', 'route-less visits were previously missed');
  });

  await test('rollover keeps the original visitDate so history stays accurate', async () => {
    await VisitModel.deleteMany({ employeeId: OTHER_RIDER_ID });
    const v = await VisitModel.create({
      dealerId,
      employeeId: OTHER_RIDER_ID,
      visitDate: yesterday,
      status: 'todo',
    });
    await visitsService.rolloverStaleVisits();
    const after = await VisitModel.findById(v._id);
    assert.equal(dayStr(after!.visitDate as Date), dayStr(yesterday), 'date is not moved forward');

    // ...and it therefore does not show up in today's list.
    const todayList = await visitsService.findAll({
      employeeId: String(OTHER_RIDER_ID),
      startDate: dayStr(new Date()),
      endDate: dayStr(new Date()),
    });
    assert.equal(todayList.length, 0, "yesterday's visit must not appear under today");
  });

  await test('rollover is idempotent — running it twice changes nothing more', async () => {
    await VisitModel.deleteMany({ employeeId: OTHER_RIDER_ID });
    await VisitModel.create({ dealerId, employeeId: OTHER_RIDER_ID, visitDate: yesterday, status: 'todo' });
    const first = await visitsService.rolloverStaleVisits();
    const second = await visitsService.rolloverStaleVisits();
    assert.equal(first.markedIncomplete, 1);
    assert.equal(second.markedIncomplete, 0);
  });

  // -------------------------------------------------------------------------
  console.log('\nAuto-assign toggle');
  // -------------------------------------------------------------------------
  await test('a rider with auto-assign OFF gets no generated visits', async () => {
    const route = await RouteModel.create({ name: 'Toggle Beat', startingPoint: 'A', endingPoint: 'B' });
    const shop = await DealerModel.create({
      name: 'Toggle Shop',
      phone: '03005550001',
      route: route._id,
      latitude: SHOP.lat,
      longitude: SHOP.lng,
    });
    await RouteAssignmentModel.create({ routeId: route._id, employeeId: OTHER_RIDER_ID, assignedAt: new Date() });
    await UserModel.updateOne({ _id: OTHER_RIDER_ID }, { $set: { isActive: true, autoAssignVisits: false } });
    await VisitModel.deleteMany({ employeeId: OTHER_RIDER_ID });

    const off = await visitsService.createVisitsForRoute(String(route._id));
    assert.equal(off.created, 0, 'auto-assign is off, so nothing should be generated');

    // Flip it back on and the same call now generates the route's visits.
    await UserModel.updateOne({ _id: OTHER_RIDER_ID }, { $set: { autoAssignVisits: true } });
    const on = await visitsService.createVisitsForRoute(String(route._id));
    assert.equal(on.created, 1);

    // Cleanup so later assertions are unaffected.
    await RouteAssignmentModel.deleteMany({ routeId: route._id });
    await VisitModel.deleteMany({ employeeId: OTHER_RIDER_ID });
    await DealerModel.deleteOne({ _id: shop._id });
  });

  await test('a rider with the field missing is treated as auto-assign ON', async () => {
    await UserModel.updateOne({ _id: OTHER_RIDER_ID }, { $unset: { autoAssignVisits: 1 } });
    const user = await UserModel.findById(OTHER_RIDER_ID).lean();
    assert.equal(user!.autoAssignVisits, undefined, 'field really is absent');

    const route = await RouteModel.create({ name: 'Default Beat', startingPoint: 'A', endingPoint: 'B' });
    const shop = await DealerModel.create({
      name: 'Default Shop',
      phone: '03005550002',
      route: route._id,
      latitude: SHOP.lat,
      longitude: SHOP.lng,
    });
    await RouteAssignmentModel.create({ routeId: route._id, employeeId: OTHER_RIDER_ID, assignedAt: new Date() });
    await VisitModel.deleteMany({ employeeId: OTHER_RIDER_ID });

    const result = await visitsService.createVisitsForRoute(String(route._id));
    assert.equal(result.created, 1, 'existing users keep generating visits — no migration needed');

    await RouteAssignmentModel.deleteMany({ routeId: route._id });
    await VisitModel.deleteMany({ employeeId: OTHER_RIDER_ID });
    await DealerModel.deleteOne({ _id: shop._id });
  });

  // -------------------------------------------------------------------------
  console.log('\nVisit list scoping (regression: riders could read every visit)');
  // -------------------------------------------------------------------------
  await test('a rider listing visits with no filter sees ONLY their own', async () => {
    await makeVisit();
    await VisitModel.create({
      dealerId,
      employeeId: OTHER_RIDER_ID,
      visitDate: new Date(),
      status: 'todo',
    });

    const scoped = await visitsService.findAll({ visibleEmployeeIds: [RIDER_ID] });
    assert.ok(scoped.length > 0);
    assert.ok(
      scoped.every((v) => String((v.employeeId as { _id?: Types.ObjectId })._id ?? v.employeeId) === String(RIDER_ID)),
      "another rider's visits must not appear",
    );
  });

  await test('a rider asking for a colleague by id gets nothing, not their data', async () => {
    const scoped = await visitsService.findAll({
      employeeId: String(OTHER_RIDER_ID),
      visibleEmployeeIds: [RIDER_ID],
    });
    assert.equal(scoped.length, 0);
  });

  await test('admin (unrestricted scope) still sees everyone', async () => {
    const all = await visitsService.findAll({ visibleEmployeeIds: null });
    const employeeIds = new Set(
      all.map((v) => String((v.employeeId as { _id?: Types.ObjectId })._id ?? v.employeeId)),
    );
    assert.ok(employeeIds.has(String(RIDER_ID)));
    assert.ok(employeeIds.has(String(OTHER_RIDER_ID)));
  });

  await test('findById refuses a visit outside the caller scope', async () => {
    const foreign = await VisitModel.create({
      dealerId,
      employeeId: OTHER_RIDER_ID,
      visitDate: new Date(),
      status: 'todo',
    });
    await rejectsWith(
      visitsService.findById(String(foreign._id), [RIDER_ID]),
      /not found/i,
    );
    // ...but the owner can read it.
    const ok = await visitsService.findById(String(foreign._id), [OTHER_RIDER_ID]);
    assert.equal(String(ok._id), String(foreign._id));
  });

  // eslint-disable-next-line no-console
  console.log(`\nAll ${passed} visit-flow integration tests passed.`);
}

main()
  .then(async () => {
    await mongoose.disconnect();
    await mongod.stop();
    process.exit(0);
  })
  .catch(async (err) => {
    // eslint-disable-next-line no-console
    console.error('\n✗ FAILED:', err);
    await mongoose.disconnect().catch(() => undefined);
    await mongod?.stop().catch(() => undefined);
    process.exit(1);
  });
