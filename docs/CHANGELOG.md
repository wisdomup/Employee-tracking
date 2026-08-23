# Changelog

Running log of notable changes, newest first. Each entry links to the deeper feature doc
where one exists.

Applies to the **`Employee-tracking`** repo only (`admin/` + `backend/`). The sibling
`tracking-backend` project is legacy and is not touched.

---

## 2026-08-20 — Fix: an unfreeze was undone within seconds

### Fixed
- **Unfreezing a rider did nothing.** The admin lifted the lock and the rider was handed
  straight back into the exact state that froze them — still past the deadline, still with
  no check-in — so the check-in guard fired again on their very next action and re-froze
  them. The intervention was cosmetic.

  An unfreeze now records **`User.freezePardonedFor`**, UTC midnight of that day. While it
  matches today neither enforcement path will re-freeze the rider, so they finish their
  visits normally. The admin's "Run late-start check now" button no longer undoes their own
  unfreeze either (`skippedPardoned` in the sweep summary).

  The pardon is scoped to **one day and one rider**. Late again tomorrow means frozen again,
  and the admin can unfreeze again — the cycle repeats indefinitely, with each freeze still
  writing its own `late_start` flag so a repeat offender stays visible. `freezeUser` clears
  a spent pardon, since a fresh freeze can only be a later day than the one it covered.

  The rider's red banner is replaced for the rest of the day by a green "Your account has
  been unfrozen" note confirming they are cleared and reminding them of tomorrow's deadline
  (`pardonedToday` on `GET /api/account-freeze/me`). The admin's unfreeze confirmation now
  spells out the same thing.

  `unfreezeUser` and `getFreezeStatus` gained an optional injected clock, matching
  `sweepLateStarters` and `enforceFirstCheckInDeadline`, purely so the pardon date is
  testable. `test:freeze:flow` is now 42 integration tests.

## 2026-08-20 — Fix: the late-start freeze was never firing

### Fixed
- **An empty day silently disabled the whole late-start rule.** Riders were still taking
  orders after 12:30 PM. The timezone was correct throughout (`Asia/Karachi`, PKT) — the
  cause was the "no assigned visits = exempt" carve-out. Visit generation had stopped
  producing visits three weeks earlier, so *every* rider had an empty day *every* day, the
  exemption fired for all of them, and neither the check-in guard nor the sweep could ever
  freeze anyone.

  A rider is now expected at a shop by the deadline whether or not the cron handed them a
  route. Self-started extras and cancelled-only days are no longer escapes either, since
  they only mattered through that same count. `sweepLateStarters` still reports
  `frozenWithNoAssignedVisits`, but as a **count, not a skip** — a rising number there means
  the visit cron has gone idle, which is worth knowing but no longer excuses anybody.

  Two real excuses replace it: **Friday** (the company holiday the visit cron already omits,
  now enforced in the rule itself rather than only in the cron expression, so the check-in
  guard honours it too) and an **approved leave** for that date. A `pending` leave request
  does not count — otherwise the freeze would be avoidable by filing a request nobody
  approves.

### Added
- **`RIDER_FREEZE_ENABLED`** — a master switch covering both the check-in guard and the
  sweep. `LATE_START_CRON_ENABLED` only stops the sweep and would leave riders still being
  refused at check-in.
- **Timezone pinned explicitly** in `.env` (`REPORT_TIMEZONE` / `RIDER_FREEZE_TIMEZONE` =
  `Asia/Karachi`). It already defaulted to PKT in code, but leaving it implicit meant the
  deadline quietly followed whatever `REPORT_TIMEZONE` was set to.
- `visits.flow.test.ts` now disables the rule. It drives check-in at the real wall-clock
  time, so it passed before 12:30 PKT and failed after — latent flakiness introduced when
  the guard was added. Suites: `test:freeze` 32, `test:freeze:flow` 42.

## 2026-08-18 — Take an order during a shop visit ("Order Lena")

### Added
- **A rider checked in at a shop can punch the order right there, and the visit report shows
  what the visit was worth.** New `Order.visitId` binds an order to the visit it was taken
  during. `POST /api/orders` accepts an optional `visitId` and refuses it unless the visit
  exists, belongs to the caller (admins exempt, so they can punch on a rider's behalf), is for
  the same client, and — the point of the feature — is **`checked_in`**. A `todo` or already
  completed visit is refused: the geofenced check-in is the proof the rider was actually in the
  shop, and without that the report's claim would be worthless. The link is validated before any
  stock is reserved, so a rejected order cannot strand committed stock.

  The visits list and detail now carry an `orderSummary` (count, amount, cancelled count,
  invoice numbers), attached by one batched aggregation over the page rather than a lookup per
  row. **A visit with no order carries no summary at all** — deliberately not a zeroed object,
  since a visit whose only order was cancelled legitimately totals Rs. 0 and the two must stay
  distinguishable. Cancelled orders are counted but excluded from the money; trashed orders drop
  out entirely.

  UI: a green **Order Lena** button beside Complete Visit, shown only while checked in, opening
  the order form with the client locked to that shop and returning to the visit on save. The
  visit detail gained an "Order Taken During This Visit" section with links through to each
  order. The visits list gained an **Order** column — green amount, or amber **No Order**, never
  a blank cell — which sums in the table footer, and the rider's day view gained the same chip
  per card. Covered by `npm run test:visits:orders` (21 integration tests). See
  [visit-checkin-checkout-flow.md](./visit-checkin-checkout-flow.md) §9.

## 2026-08-18 — Riders are frozen for starting the day late

### Added
- **An `order_taker` must check in at their first shop by 12:30 PM, or the account freezes.**
  Riders were routinely starting the day hours late, and the existing 75% completion rule
  could not catch it — a rider who starts at 3pm and rushes four shops still passes. Check-in
  is the geofenced proof they are physically at a store, so it is what counts as starting
  work. Two paths freeze an account: the check-in guard refuses a first check-in made after
  the deadline (403, on the spot), and a daily sweep at deadline + 5 minutes catches riders
  who never turned up at all — a no-show performs no action, so the guard alone would leave
  them quietly unfrozen all day. Both are idempotent and both write a `late_start` performance
  flag, so every freeze has an audit trail in the existing `/flags` feed.

  A frozen rider **can still sign in and read their day** — writes are refused across visits,
  orders, returns, dealers, approvals and collections with a 403 carrying the reason, while
  GETs stay open so they can actually find out what happened. `isFrozen` is deliberately
  separate from `isActive`: one is the admin's permanent switch, the other an automatic lock.
  The state is resolved per-request from the database, so an admin's unfreeze takes effect on
  the rider's very next call rather than when their 24-hour token expires.

  Exempt: riders with no assigned visits that day (nothing to be late for — same principle as
  an empty day scoring 100% on the completion rule), self-started extras, cancelled visits,
  and every role other than `order_taker`. Exactly 12:30:00 passes; 12:31 is late. The
  deadline is a wall-clock time in `RIDER_FREEZE_TIMEZONE` (falling back to `REPORT_TIMEZONE`,
  default `Asia/Karachi`) — compared in UTC it would fire at 5:30 PM local and everyone would
  pass. Configurable via `RIDER_FIRST_VISIT_DEADLINE`, `LATE_START_CRON_ENABLED` and
  `LATE_START_CRON_SCHEDULE`; a malformed deadline stops the sweep starting rather than
  freezing everybody at 00:00.

  New admin page **`/frozen-accounts`** is the unfreeze queue — who, when, why, system or
  admin — with an optional note kept in the activity log and a button to re-run the sweep
  after an outage. Riders see a persistent banner above every screen with the reason and a
  Contact admin button. `/employees` gained a Frozen chip; `/flags` gained a Late start
  filter. Covered by `npm run test:freeze` (27 unit) and `npm run test:freeze:flow`
  (26 integration). See [rider-late-start-freeze.md](./rider-late-start-freeze.md).

## 2026-08-13 — Item-wise discounts on orders

### Added
- **Per-line discounts while punching an order.** Every product row on the create/edit order
  forms now takes a flat Rs. discount, stored on the order line, alongside the existing
  order-level field. Discounts are clamped to each line's subtotal server-side, so a row can
  never go below zero, and `grandTotal` = gross total − item discounts − order discount.
  Create, edit, detail and list pages all show the breakdown (Total → Item Discounts →
  Order Discount → Grand Total), the printed sale invoice gained a per-line Discount column
  with net line totals, and the analytics "Discount" column now sums line discounts on top of
  the order-level one. Money math lives in a new pure module `orders/orders.totals.ts`,
  covered by `npm run test:orders:totals`.

- **Client names are clickable, and the client profile gained an Orders History.** On the
  orders list, order detail, returns list and return detail, the client name now links to
  `/clients/[id]` (same style as the activity-logs entity links; it doesn't trigger the row's
  own navigation). The profile itself gained an **Orders table** below Visits — invoice
  number, date, status, payment type, who punched it and grand total with a summed footer —
  fetched per client and auto-scoped by the server, so an order_taker viewing a client still
  only sees the orders they punched. Rows open the order.

## 2026-08-11 — Client corrections, stock-in edits, report totals & dashboard rework

Seven client-requested items. The two with real depth are the Stock In correction path and the
region-sales date range; the rest are additive.

### Added
- **Order takers can correct a client's pin and address.** New `PATCH /api/dealers/:id/location`,
  open to `admin`, `employee` and `order_taker`, plus a **Fix Location** button and map dialog on
  the client profile. Deliberately narrow: it accepts the address and the lat/lng pair and nothing
  else, because the rider standing outside the shop is the only person who can see the pin is
  wrong, while phone, category, route and status stay office decisions on the full admin form.
  Riders are city-scoped exactly as they are on read, so a client they cannot open is a client
  they cannot relocate. New permission key `dealers:fix-location`.
- **Admin can edit or delete a wrong Stock In receipt** — `PUT` and `DELETE` on
  `/api/warehouse/stock-receipts/:id`, both admin-only, with an edit form at
  `/warehouse/stock-in/[id]/edit` and a Delete action on the list and detail pages. See
  [warehouse-and-stock.md](./warehouse-and-stock.md#the-three-exits-from-a-wrong-receipt).
- **Grand total under every report.** The shared `Table` component gained `showGrandTotal`, wired
  into all sixteen report tables across `/reports`, `/stock-reports`, `/warehouse/reports`,
  `/region-sales` and `/analytics`. Totals cover the whole dataset rather than the visible page,
  and are carried into CSV and PDF exports as a footer row.
- **Last visit on the client profile.** `GET /api/visits/last?dealerId=…` returns the most recent
  *completed* visit and how many days ago it was; the profile opens with a banner showing the date,
  the gap ("yesterday", "12 days ago"), the rider and the route. It turns amber past a fortnight.
  Backed by a new `{ dealerId, status, completedAt }` index.
- **Date ranges on the region-sales dashboard.** `/api/region-sales/regions` and its salesmen
  drill-down now take `from`/`to` alongside the original `date`, capped at 366 days. One shared
  range spans all three drill-down levels, with Today / Yesterday / Last 7 / Last 30 / This month
  presets. See [region-sales-dashboard.md](./region-sales-dashboard.md).
- **`GET /api/dashboard/my-stats`** — the signed-in user's own visit, task and sale counts for one
  day, aggregated in the database.
- **A "Today" card row on the admin dashboard** (completed visits, visits still open, orders today,
  delivered and booked sale) and a **"My Day" row on the salesman dashboard** (completed visits,
  visits to do, own sale, tasks). Every card deep-links into the list it counts.
- **`/visits` reads its filters from the URL** (`status`, `startDate`, `endDate`, `employeeId`,
  `clientId`, `overstay`, `view`), which is what lets the Completed Visits cards open a filtered
  list. A filtered link lands on the list view, since the calendar cannot express a status filter.

### Fixed
- **The admin dashboard's Completed Tasks map never showed shop pins.** The page read
  `task.clientLocation` while the API only ever sent `dealerLocation`. The API now returns both
  names for the same object.
- **The salesman dashboard's task cards counted the rider's entire history** while the visit cards
  next to them counted today, so two rows of numbers silently answered different questions. Both
  are now day-scoped server-side aggregates instead of `.filter()` over fetched lists.

### Caught in review

Six defects found reviewing the above before it shipped, each now covered by a test:

- **The correction dialog refused any client with a blank address field.** The shared
  `addressSchema` is built from bare `Joi.string()`, which rejects `''`; the create form only gets
  away with it because it strips empty entries before posting. The dialog shows all five fields
  pre-filled, so a client with no State recorded posted `state: ''` and was refused — for a field
  the rider never touched. It now has its own schema that allows `''`, which also gives the rider
  the only way to *clear* a wrong value.
- **"Last visit" said "today" for a visit that happened yesterday.** The gap was counted in UTC
  calendar days; Pakistan is UTC+5, so between midnight and 05:00 PKT the UTC date is still
  yesterday's. It now buckets with `localDayKey` in `REPORT_TIMEZONE`, the same helper the
  region-sales dashboard uses.
- **A rolled-back receipt edit could double stock on the retry.** The edit's idempotency scope is
  derived from the receipt's `updatedAt`. A failed attempt restores the original stock but saves
  nothing, so a retry reused the stamp — the reversal was then treated as a replay and moved no
  stock, while the re-apply added its pieces on top of the restored ones (proved: 130 where 80 was
  correct). The rolled-back attempt is now recorded in `lastEditFailedAt`, which moves `updatedAt`
  on so the retry gets a fresh stamp. Replay protection for a genuinely double-submitted edit is
  unchanged, and both directions are now tested.
- **`findPostedMovementIds` had no sort.** Harmless while a document posted one ledger row per
  product, which stopped being true the moment a receipt could be edited and re-posted against the
  same `refId` — the winning row became whichever the query planner returned first. Now ordered by
  `_id` so the newest row deterministically wins.
- **Dashboard visit cards did not match the lists they open.** The counts mixed `completedAt` with
  `visitDate` and used *local* midnight, while `/visits` filters `visitDate` on *UTC* day bounds —
  so "completed" could exceed "scheduled", and both could disagree with the list. All three counts
  now share one window on `visitDate` computed exactly as `findAll` does, and the response carries
  the day so the card links to precisely the rows it counted.
- **`/api/dashboard/my-stats` accepted any string as a date.** An unparseable one became an Invalid
  Date that matched nothing and reported a blank day as real; `2026-02-30` is well-formed and JS
  quietly rolls it to March 2. It now validates with the shared `isValidDayKey`.

### Changed
- `getRegionTotals` / `getRegionSalesmen` take a window (`string | { from, to, date }`) instead of a
  bare day string. A plain string still means that single day, so every existing caller is
  unaffected; the responses gained `from` and `to` and kept `date` as an alias for `to`.
- `stock-in:edit` and `stock-in:delete` join the admin-only permission keys that appear in no
  permission Set — unlike `stock-in:cancel`, which `warehouse_manager` keeps. A cancel leaves the
  wrong figures visible in the record; an edit rewrites them and a delete hides the document.

---

## 2026-08-06 — Warehouse & stock management

Full detail in [warehouse-and-stock.md](./warehouse-and-stock.md). Stock used to be a single
number per product with no purchases module at all — the only way it went up was an admin typing a
figure into the product form. It is now per-warehouse, split into buckets, behind an append-only
ledger.

### Added
- **Warehouses** (`/warehouse`). Admin can add one at any time — name, city, address, manager. One is
  flagged **Main** (enforced by a unique partial index, not by convention) and all Stock In lands
  there. Stock is counted in **pieces**, never cartons.
- **Three buckets per warehouse+product**: `sellable`, `damaged`, and `inTransit` for goods that have
  left an origin on an approved transfer but not yet arrived.
- **One choke point.** `stock-ledger.service.ts#applyStockMovements` is the only code allowed to touch
  a stock balance. It guarantees stock can never go negative (a guarded `$inc`, not a read-then-write
  check), applies multi-line movements all-or-nothing, is replay-safe via a unique `idempotencyKey`,
  and writes an audit row per bucket change with actor, reason and business date.
- **Stock In** — lightweight receipt (date, free-text supplier, pieces and rate per line), always into
  Main, with the last purchase rate shown as a reference next to each rate input. Printable slip.
- **One-time opening stock** per warehouse and product, split sellable/damaged with a rate, enforced
  as one-time by a unique partial index. Cancelling frees the slot for a correction.
- **Transfers** — create → admin approves → destination confirms what actually arrived. Stock leaves
  the source at **approval**, into its `inTransit` bucket: in between the goods are on a truck and
  must not be sellable anywhere. A shortfall credits only what arrived and parks the difference in
  `inTransit` until an admin writes it off or returns it. Over-receipt is rejected outright.
- **Damage / Claim** — `internal_damage` or `client_claim` (client name required). Creating an entry
  moves no stock; only an admin approval moves pieces from sellable to damaged.
- **Monthly stock count** — one warehouse at a time, sellable and damaged counted separately, prefilled
  with the system figures so an untouched sheet means everything matches.
- **Reports** — stock on hand, movement history, transfer history with mismatches, damage/claim with
  approver and client, monthly count variance, and sales/valuation over a date range with best sellers.
- **Sales draw from a warehouse** resolved from the salesman's city (`normalizeCityKey`, the same
  normalisation the region-sales dashboard uses). Precedence: `User.warehouseId` → city match → Main.
  Admin can override per order, applied as a compensating pair of movements so total stock is unchanged.
- **New role `warehouse_staff`** plus `User.warehouseId`. Staff raise documents at their own warehouse
  and never approve them; `warehouse_manager` is company-wide when no warehouse is set.
- **System notifications** through the existing broadcast inbox (`source: 'system'` plus a deep link):
  transfer awaiting approval, transfer approved, quantity mismatch, damage awaiting approval, count
  submitted, low stock, insufficient stock on a sale. A daily cron also logs any stock-integrity drift.
- `npm run migrate:warehouse-bootstrap` (dry run by default) and `npm run reconcile:stock`.

### Changed
- **`Product.quantity` is now a derived mirror** of total sellable stock across all warehouses,
  recomputed after every movement. Every pre-existing reader — the order stock check, all five
  stock-reports, the products list, the dashboard — keeps working untouched. The products create/edit
  forms no longer accept it, and the service strips it: the edit form used to re-send the figure it
  read at page load, so saving a description twenty minutes later reset stock to a stale number.
- **`Product.purchasePrice` is now a running weighted average**, maintained by Stock In, with a new
  read-only `lastPurchaseRate` alongside it. Only receipt movements may carry a cost, which is what
  structurally guarantees transfers, sales, damage and count adjustments can never shift it.
- **Order lines snapshot `unitCost`** when the stock moves, and the P&L prefers the snapshot. Without
  it, an average cost that changes on every goods receipt would silently restate last month's profit.
- **A completed `damage`-type return now credits the damaged bucket** and mints a linked approved
  client-claim entry. It previously changed no stock at all and only appeared in reports.
- `/stock-reports` relabelled where the new module made it ambiguous: "Available Qty" → "Total Sellable
  (all warehouses)", the "Damage Stock" tab → "Return Damage" (it is dealer return damage, a different
  thing from warehouse damage entries).

### Fixed
Four live bugs in the existing order stock logic, each of which would have corrupted per-warehouse
stock from day one:
- **A negative order line minted stock.** `orders.schemas.ts` had a bare `Joi.number()` on line
  quantity, so `POST /api/orders` with `quantity: -5` passed the stock check (`-5 > stock` is false)
  and then ran `$inc: { quantity: +5 }`. Now `.integer().min(1)`, matching the returns schema.
- **A partial decrement was never restored.** On a multi-line order, if line 2's guarded decrement
  failed, line 1's was orphaned and the order was hard-deleted — permanently burning an invoice number
  in a series that is supposed to be gap-free. Lines are now compensated, and the invoice number is
  allocated only after the stock has actually moved.
- **Cancelling a delivered order invented stock.** The cancel path had no `delivered` exclusion, unlike
  `deleteOrder` which did. Also: `cancelled → pending` never re-decremented (free oversell), and a
  trash round-trip gave stock back on delete without taking it on restore.
- **Cancelling was open to non-admins.** `PUT /orders/:id` allowed `employee` and `order_taker`, so a
  rider could cancel a delivered order and mint stock.

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
