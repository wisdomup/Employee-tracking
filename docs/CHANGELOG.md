# Changelog

Running log of notable changes, newest first. Each entry links to the deeper feature doc
where one exists.

Applies to the **`Employee-tracking`** repo only (`admin/` + `backend/`). The sibling
`tracking-backend` project is legacy and is not touched.

---

## 2026-08-03 — Auto-assign toggle, and visits no longer leak across days

### Added
- **Per-rider auto-assign toggle.** `User.autoAssignVisits` (default true) with an
  "Auto-assign route visits" checkbox on the employee create/edit forms, shown for field
  roles. When off, the nightly cron generates nothing for that rider — useful for someone
  on leave or working ad-hoc. They can still be assigned visits manually and can still
  start their own walk-ins.
- Treated as `$ne: false`, so users predating the field stay enabled — no migration.

### Fixed
- **Stale visits stayed open forever (the "visits carry over to the next day" bug).**
  The rollover that closes yesterday's unfinished visits had three holes, all now closed
  by a new global `rolloverStaleVisits()` that runs first and unconditionally:
  1. It only covered `todo` / `in_progress` — a rider who checked in but never checked
     out kept a **`checked_in`** visit open indefinitely.
  2. It was **route-scoped**, so visits with no `routeId` (admin-created, or rider-started
     walk-ins) were never matched.
  3. It ran **inside the per-route loop**, so routes the cron skipped — inactive employee,
     no dealers, trashed route — never had their stale visits closed. With *no* eligible
     routes at all the function early-returned and swept nothing.
  Verified live: a cron run reporting `routesProcessed: 0` now still reports
  `totalMarkedIncomplete: 3`. Visits keep their original `visitDate`, so history is intact
  — they simply stop counting as open work.
- **A single-date visit filter returned two days.** `findAll` widened a start-only filter
  back by one day (`start.setUTCDate(... - 1)`), so "From: 3 Aug" returned 2 Aug as well.
  Each bound now means exactly what it says.
- **Region label was non-deterministic.** The `{'address.city': 1}` index added in the
  previous change altered the query plan, so the roster came back ordered by city and the
  region's display name flipped to whichever casing sorted first — "Lahore" became
  "lahore". Roster order is now explicitly sorted, and a mixed-case spelling is preferred
  over all-lower/all-upper. Regression test pins it.
- Rider dashboard fetched **every visit ever** to compute stats (no date filter). Now
  scoped to today. Note those particular counts were computed but never rendered, so this
  was wasted work rather than a visible wrong number.

### Notes
- 199 tests (14 new), covering: rollover across all three previously-missed shapes,
  rollover idempotency, `visitDate` preservation, single-date filtering, and the
  auto-assign toggle in both states plus the missing-field default.

---

## 2026-07-31 — Riders can start a visit at any client (walk-in visits)

### Added
- **`POST /api/visits/self`** — a rider picks any client they can see and starts a visit
  there, with no route assignment needed and in any order. The visit is marked
  `isSelfInitiated` but is otherwise **completely ordinary**: same 150 m geofenced
  check-in, same "must check in before checkout", same shop photo + selfie requirement,
  same duration/overstay tracking, same post-checkout gallery.
- **Idempotent per day** — if a visit for that rider and client already exists today
  (route-assigned or started earlier), it is returned (`200`, `created: false`) instead
  of creating a duplicate, so visit counts stay honest.
- **`StartVisitButton`** on the client detail page and as a per-row "Visit" action on the
  clients list, dropping the rider straight into the normal check-in screen.
- **"Extra" badge** on the visit detail page and the rider's day view, so an admin can
  tell a self-chosen visit from an assigned one at a glance.
- Analytics gains `extraVisitsCompleted`, `extraVisitsStarted` and
  `totalVisitsCompleted`, shown as new KPI cards and a `+N extra` line under each rider's
  visit column — for the rider themselves and for admins/managers alike.
- 8 new tests. Suite total: **190**.

### Notes / decisions
- **Extras are excluded from the 75% adherence rule, on both sides of the ratio.** They
  measure route adherence, so letting extras in would let a rider skip assigned visits
  and pad the rate back up with easy walk-ins — and would equally punish someone who
  started an extra and abandoned it. There is a test that specifically proves a rider
  cannot mask a skip with five completed extras.
- Consequently `visitCompletionRate` stays comparable to the 75% pass mark, while
  `totalVisitsCompleted` and `visitsPerDayPresent` reflect all work done including extras.
- **City scoping still applies** — a rider cannot start a visit at a client outside their
  own city. This goes through `dealersService.findById` with the same city scope the
  client list uses, so the endpoint can't become a way around that restriction.
- A missing `isSelfInitiated` means "assigned", which is correct for every visit that
  existed before this change — no migration needed.

---

## 2026-07-31 — Region-wise daily sale dashboard

Full reference: [region-sales-dashboard.md](region-sales-dashboard.md)

### Added
- **`/region-sales` page** — three-level drill-down on one page with a breadcrumb:
  regions → salesmen in a region → one salesman's day-wise report. The selected date
  survives drilling in and back out. Admin and sales_manager only.
- **`GET /api/region-sales/regions`**, **`/regions/:regionKey/salesmen`** and
  **`/salesman/:employeeId`** — new `region-sales` module.
- **Delivered and Booked shown side by side** at every level, never blended. Only
  counting delivered would show ~Rs. 0 every morning, since orders rarely deliver
  same-day. Status constants are now exported from `analytics.service.ts` and reused, so
  the app doesn't gain a fourth definition of "sale".
- **`REPORT_TIMEZONE` (default `Asia/Karachi`)** — day boundaries for this dashboard are
  Pakistan-local, not UTC. Offset is derived via `Intl`, so it stays correct in a
  DST-observing zone.
- Region = the salesman's `address.city`, case/whitespace normalised so `"Lahore"`,
  `"lahore"` and `" Lahore "` are one region. Salesmen with no city go to an
  **`Unassigned`** bucket (sorted last) rather than being dropped.
- Zero rows everywhere by design: regions with no sale, salesmen with no sale, and days
  with no orders all render as Rs. 0 instead of disappearing.
- Indexes: `Order { createdBy, status, createdAt }` and `User { 'address.city', isTrashed }`.
- Sandbox seed now assigns cities to riders (`Lahore` / `lahore` / `Karachi`) so the
  region grouping and the rider client-filter are both demonstrable.
- 46 new tests (19 unit + 27 integration). Suite total: **182**.

### Notes / decisions
- **Day boundary:** existing `/analytics` and `/reports` still bucket in UTC, so their
  figures can differ slightly from this dashboard for the same period. Deliberate —
  changing them would move historical numbers.
- **`orderDate` is dead** — no production path writes it, only the seed. `createdAt` is
  the only reliable sale date, matching every other aggregation.
- Region is the *salesman's* city, not the *shop's*. `Order → dealerId → Dealer.address.city`
  is better-populated and answers "where the sale happened" if that's ever wanted instead.
- No export or WhatsApp automation, per the requirement — the admin reads and copies.

### Gotchas found while building
- `Intl.formatToParts` has no millisecond field, so a naive offset calculation returned
  299.98 minutes instead of 300 and shifted the end-of-day boundary. Offsets are always
  whole minutes; the result is rounded.
- **Mongoose makes `createdAt` immutable** — backdating a fixture via `updateOne` is
  silently ignored and the doc keeps "now". Use `create([...], { timestamps: false })`.

---

## 2026-07-31 — Navigate buttons wherever location data is shown

### Added
- **`NavigateButton`** (`admin/components/Map/NavigateButton.tsx`) — opens Google Maps
  driving directions, using the device's current location as the origin when the browser
  allows it. Geolocation is best-effort: if it's denied, unavailable, or times out, Maps
  still opens and falls back to the device location rather than blocking the user.
  Two variants: `button` (full teal button) and `link` (compact inline).
- **Every map marker popup now carries a Navigate link** — added once in `MapView`, so
  all five maps in the app (dashboard, client, task, visit, attendance) get it without
  per-page changes. Popups also now show the coordinates. Opt out with
  `showNavigate={false}`.
- Navigate buttons added to: client detail (Location), task detail (Client Information),
  attendance detail (**both** check-in and check-out locations), visit detail (completion
  point, alongside the existing client Navigate), the clients list (per row), and the
  rider's day-view visit cards.

### Fixed
- **HTML injection in map popups.** `MapView` bound `marker.label` directly as popup
  HTML, and those labels contain user-entered client names — so a client named with
  markup would inject into the popup. Labels are now escaped. Found while adding the
  Navigate link, since appending HTML safely required handling this first.

### Changed
- The visit detail page's hand-rolled geolocation/navigation block (~30 lines) was
  replaced with `NavigateButton`, removing what would otherwise have been copy-pasted
  into four more pages.

### Notes
- Popup links deliberately pass **no origin** — requesting geolocation from inside a map
  popup would prompt awkwardly, and Maps already defaults to the device's location.
  The standalone buttons do request an origin, since the click is a deliberate action.

---

## 2026-07-31 — City-scoped client visibility for riders

### Added
- **Riders only see clients in their own city.** A rider's `address.city` is matched
  against each client's `address.city`, enforced server-side in
  `dealers.service.findAll` / `findById` / `findByLocation` via a new
  `resolveCityScope(viewerId, viewerRole)` helper in `users.service.ts`.
- City matching is **case- and whitespace-insensitive** ("Lahore" / "lahore" /
  " Lahore " all match), and the city name is regex-escaped so a name containing `.`
  can't act as a wildcard.
- Applies to `order_taker` and `delivery_man`. Admin, sales_manager, employee and
  warehouse_manager stay unrestricted.
- Blocks URL-guessing: `GET /api/dealers/:id` returns 404 for an out-of-city client
  rather than serving it.
- Banner on the rider's Clients page naming the city being filtered on, so a short list
  reads as "filtered" rather than "clients missing".
- Index `{ 'address.city': 1, isTrashed: 1 }` on Dealer.
- 16 new integration tests (`npm run test:city-scope`). Suite total: **136**.

### Fixed
- **`sales_manager` was rejected by the dealers API.** They had the Clients page and the
  `dealers:view` permission from the previous change, but were missing from the backend
  `requireRoles` guard on `GET /api/dealers`, `/nearby` and `/:id` — so the page loaded
  and every request failed with "Insufficient permissions". Caught during live
  verification, not by the type checker or tests.

### Notes / decisions
- **A rider with no city set sees ALL clients**, not none. Most existing riders predate
  this feature and have an empty `address.city`; failing closed would have emptied their
  client list on deploy. Filtering activates per-rider once an admin fills in their city.
- Clients with **no city** are hidden from city-scoped riders (they match nobody).
- City is free text on both User and Dealer. A structured alternative already exists —
  `RouteAssignment` (employee → route) plus `Dealer.route` — and would be more robust if
  city data proves messy in practice.

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
