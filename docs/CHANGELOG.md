# Changelog

Running log of notable changes, newest first. Each entry links to the deeper feature doc
where one exists.

Applies to the **`Employee-tracking`** repo only (`admin/` + `backend/`). The sibling
`tracking-backend` project is legacy and is not touched.

---

## 2026-07-29 — 75% visit rule, skipping, performance flags, deeper analytics

Full reference: [visit-completion-and-flags.md](visit-completion-and-flags.md)

### Added
- **75% visit-completion rule.** A rider must complete at least 75% of the visits
  assigned for a day. Constant `VISIT_COMPLETION_THRESHOLD_PERCENT` in `visits.rules.ts`.
- **`skipped` visit status** with `skippedAt` / `skipReason` / `skippedBy`.
- **Two-step skip API.** `GET /api/visits/:id/skip-preview` (read-only projection) and
  `PATCH /api/visits/:id/skip`. A skip that would breach the threshold **writes nothing**
  and returns `requiresConfirmation`; only a re-send with `confirm: true` applies it and
  raises a flag. Re-checked server-side, so a stale client cannot bypass the flag.
- **`PerformanceFlag` collection** — the admin's queryable "needs review" queue, unique
  per `{employeeId, type, flagDate}` so repeat skips update one row rather than spamming.
  Overstays now write here too, alongside the existing `visit.overstayFlagged` badge.
- **`/api/performance-flags`** — list, `/summary` counts, and `PATCH /:id/resolve`.
- **`/flags` admin page** — filter by reason / open / date, drill through to the visit,
  mark reviewed. Riders see their own flags so being flagged is never a surprise.
- **`SkipVisitModal`** — shows the day's tally and projected finish, and requires an
  explicit acknowledgement tick before a below-threshold skip can go through.
- **~20 new analytics metrics** per employee, all also visible to the employee: days
  present, hours worked, avg hours/day, returns + damages + return rate, tasks
  assigned/completed/rate, invoiced vs collected vs outstanding, collection rate,
  discounts, credit orders, shops ordered from, average order value, sales per day
  present, visits per day present, strike rate, skipped visits, and open flag counts.
- 38 new tests (15 unit + 23 integration). Suite total: **120**.

### Fixed
- **Visit list and detail had no viewer scoping (privacy leak).** `GET /api/visits` with
  no `employeeId` returned *every* visit in the system to any authenticated user, and
  `GET /api/visits/:id` would return any visit by id. Both are now intersected with the
  caller's allowed employee set. This pre-dated the analytics work but undermined its
  scoping entirely. Regression tests added.
- **`sales_manager` was locked out of 22 pages** gated `['admin','order_taker']` — they
  had sidebar entries and API permissions but got bounced to `/login`. Added to the 14
  view-only pages their permissions cover (create/edit pages deliberately left out).
- **Analytics double-counted visits across months.** The window used
  `$or: [{completedAt}, {visitDate}]`, so a visit scheduled in July but completed in
  August was counted in both. Now bucketed on a single `effectiveDate`
  (`visitDate ?? createdAt`), in both the monthly report and the trend so they reconcile.
- **Analytics employee dropdown collapsed.** It was derived from `report.rows`; selecting
  one person shrank rows to 1 and the dropdown lost everyone else. Now backed by a
  separate unfiltered roster fetch.
- **Cancelled visits inflated the completion denominator** — they are excluded now.
- **`npm run sandbox` failed on re-run** with duplicate-key errors if a previous instance
  still held the port. It now reuses the port and drops the database first.

### Notes / decisions
- The warning shows the **best rate the day can still finish on**, not the current rate —
  mid-day the current rate is naturally low and would alarm the rider for no reason.
- An empty day is **100%**, not 0% — nobody is flagged for having no assigned work.
- `checked_in` visits cannot be skipped; the rider is at the shop, so finishing is the
  expected action.
- Exactly 75% passes; 74.9% fails.
- When an admin skips on a rider's behalf, the flag is raised against the **rider**.

---

## 2026-07-29 — Performance analytics & monthly targets

Full reference: [analytics-and-targets.md](analytics-and-targets.md)

### Added
- **`sales_manager` role** (6th role) and a `User.managerId` link, so field staff report
  to a manager. No manager/team concept existed before this.
- **`Target` model** — one row per employee per month (`YYYY-MM`), with `salesAmount`,
  `orderCount` and `visitCount`. Unique on `{ employeeId, periodMonth }` so saves upsert.
- **`/api/targets`** — `PUT` (upsert), `GET` (scoped list), `DELETE`.
- **`/api/analytics/performance`** — per-employee actuals vs target for a month, plus a
  team KPI rollup.
- **`/api/analytics/trend`** — dense monthly series for charts, with a target line.
- **`/analytics` admin page** — "Team Performance" for admin/managers, "My Performance"
  for riders. KPI grid, two trend charts, per-employee table with progress bars, and a
  target-setting modal. New **Performance** sidebar entry.
- **`npm run sandbox`** — disposable in-memory MongoDB on port 27018 with demo data, for
  exercising the UI without touching the real database.
- 42 new tests (19 unit + 23 integration), including explicit checks that one sales
  manager cannot see another's team.

### Changed
- `sales_manager` granted read access to the visits, orders and users `GET` routes.
- `ActivityAction` is now imported from the model in `activity-logs.service.ts` instead
  of being redeclared — see the fixed bug below.

### Notes / decisions
- Rider attribution for orders is `Order.createdBy`; `Order` has no `employeeId`.
- Orders bucket on `createdAt` (matching the existing dashboard reports); visits bucket
  on `completedAt`.
- "No target" reports as `null`, never `0%`.
- Achievement is uncapped; only the progress bar clamps at 100%.
- The legacy free-text `User.target` / `User.achivedTarget` strings were left untouched
  and are still unused by any calculation.

---

## 2026-07-29 — Rider check-in / checkout flow

Full reference: [visit-checkin-checkout-flow.md](visit-checkin-checkout-flow.md)

### Added
- **`checked_in` visit status.** A rider must now check in at the shop — GPS verified
  within **150 m** — before they can complete a visit. Previously they could mark a visit
  completed straight from a dropdown with nothing proving they were ever there.
- **Duration tracking + 30-minute overstay flag.** `durationMinutes` and
  `overstayFlagged` are computed at checkout. Over the limit raises an admin-side flag
  (red banner on the visit, ⚠️ badge and "Time At Store" column in the list, an
  "Overstay flagged only" filter, and a `flagged` activity-log entry naming the rider).
  Riders see a live counter that turns red past the limit.
- **Post-checkout shop gallery.** After checking out, a rider may optionally add up to 10
  shop photos and a description. These roll up into a **Shop Photo Gallery** on the
  client page, attributed to the rider who captured them and linked back to the visit.
- `PATCH /api/visits/:id/check-in`, `PATCH /api/visits/:id/gallery`,
  `GET /api/visits/gallery?dealerId=`.
- 40 tests (24 unit + 16 integration).

### Fixed
- **Geofence bypass.** The status-only roles could `PUT /api/visits/:id` with
  `status: 'completed'` and skip check-in entirely. Those roles are now limited to
  `in_progress`; the verified endpoints are the only route to the other states.
- **Duplicated `ActivityAction` type.** The union was declared in both
  `activity-log.model.ts` and `activity-logs.service.ts`. Adding the new `flagged` action
  to only one would have failed schema validation silently at runtime.
- **Blanked client/route names.** The check-in and complete responses are not fully
  populated; assigning them straight to page state wiped the nested dealer/route data.
  The page re-fetches instead.
- **Average visit duration counted untimed visits.** In the analytics aggregation,
  `$ne: ['$durationMinutes', null]` did not exclude missing fields, dragging the average
  down. Replaced with an explicit `$ifNull` sentinel. Caught by the integration test.

### Notes / gotchas
- `GET /api/visits/gallery` **must** stay registered above `GET /api/visits/:id`, or
  Express parses `"gallery"` as a visit id.
- Both tunable constants live in `visits.rules.ts`: `CHECK_IN_RADIUS_METRES` (150) and
  `VISIT_DURATION_LIMIT_MINUTES` (30). The admin app mirrors them in
  `services/visitService.ts` — keep both sides in sync.
- Exactly 30 minutes is **not** flagged; the limit is inclusive.

---

## Testing

```bash
cd backend
npm test                     # all suites (82 tests)
npm run test:visits          # visit rules, no database
npm run test:visits:flow     # visit flow, in-memory MongoDB
npm run test:analytics       # analytics rules, no database
npm run test:analytics:flow  # analytics + scoping, in-memory MongoDB
```

Integration suites use `mongodb-memory-server` (added as a devDependency). The first run
downloads a ~780 MB MongoDB binary and caches it under `~/.cache/mongodb-binaries`, so it
is slow once and fast thereafter. Tests never touch the real database.
