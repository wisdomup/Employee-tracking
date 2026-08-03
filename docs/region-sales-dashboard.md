# Region-wise Daily Sale Dashboard

City-wise daily sale for admins and sales managers, with a three-level drill-down. Built
so an admin can read the numbers off the screen and share them manually — there is no
export or messaging automation, by design.

> Scope note: applies to the **`Employee-tracking`** repo only (`admin/` + `backend/`).
> The sibling `tracking-backend` project is legacy and must not be modified.

---

## 1. What it shows

| Level | Page state | Content |
| --- | --- | --- |
| 1 | Regions | Every region with that day's total, delivered, booked, order count and salesman count |
| 2 | Region → salesmen | Every salesman in that region with their individual sale for the same day |
| 3 | Salesman → day-wise | From–To range: range total plus a day-by-day breakdown and trend chart |

One page (`/region-sales`) with a breadcrumb; the selected date survives drilling in and
back out.

### Delivered vs Booked

Both are shown side by side rather than blended into one number:

- **Delivered** — `status: 'delivered'`. Realised revenue.
- **Booked** — `pending`, `approved`, `packed`, `dispatched`. Committed but not delivered.
- **Total** — delivered + booked.
- **Cancelled and trashed orders are excluded entirely.**

This matters because orders rarely deliver the same day. A "today's sale" figure built
only from delivered orders would read close to Rs. 0 every morning and be useless for
daily sharing. The two constants are imported from `analytics.service.ts`
(`DELIVERED_STATUSES` / `BOOKED_STATUSES`) rather than redeclared, so the app doesn't grow
a fourth definition of "sale".

---

## 2. Region = the salesman's city

Regions come from **`User.address.city`** — where the salesman is assigned, not where the
shop is. All Lahore salesmen's sales roll into "Lahore".

Because city is free text, `"Lahore"`, `"lahore"` and `" Lahore "` would otherwise be
three separate regions. `normalizeCityKey()` lowercases and trims for the grouping key,
while the display label keeps the original casing.

Salesmen with **no city** land in an **`Unassigned`** bucket rather than being dropped, so
no sale ever goes missing from the grand total. Unassigned is always sorted last — it's a
data-quality bucket, not a real region. Filling in that employee's city moves them out
of it.

> An alternative source exists — `Order → dealerId → Dealer.address.city`, i.e. the city
> where the sale *happened*. That is better-populated but answers a different question.
> The salesman's city was chosen deliberately.

---

## 3. Day boundaries are Pakistan time — and why that matters

**`REPORT_TIMEZONE` defaults to `Asia/Karachi`** (override with the env var of the same
name).

Every other aggregation in this app buckets dates in **UTC**. That is invisible in a
monthly report, but for a *daily* number it is wrong: at UTC+5, an order booked at
02:00 PKT has a UTC date of the **previous day**, so it would be credited to the wrong
day's total.

This module therefore:
- Converts the picker's `YYYY-MM-DD` into UTC instants for that **local** day
  (`localDayRangeUtc`). Karachi's 31 July spans `2026-07-30T19:00Z` →
  `2026-07-31T18:59:59.999Z`.
- Passes `timezone: REPORT_TIMEZONE` to `$dateToString` when grouping day-wise, so the DB
  labels match the JS-side boundaries exactly.

The offset is derived from `Intl.DateTimeFormat`, not hardcoded to +5, so the helper stays
correct in a DST-observing zone (there are tests for a US spring-forward day).

**Consequence to be aware of:** `/analytics` and `/reports` still bucket in UTC. For the
same calendar period their figures can differ slightly from this dashboard. That was an
explicit choice — changing them would move historical numbers.

---

## 4. Date field: `createdAt`, not `orderDate`

`Order.orderDate` exists in the schema but **no production code path ever writes it** —
only `full.seed.ts` does. `createdAt` is the only reliable "day the sale happened", which
matches every other aggregation and `docs/analytics-and-targets.md`.

Attribution is `Order.createdBy`; `Order` has no `employeeId` field.

---

## 5. Zero rows are deliberate

All three levels are built from the **salesman roster first**, then joined to that day's
orders — not derived from the orders alone. So:

- A region where nobody sold today still appears at **Rs. 0**.
- Every salesman in a region appears, including those with no sale — the requirement is
  "us region ke tamam salesmen ki list", not just the ones who sold.
- The day-wise series is **dense**: a day with no orders is an explicit Rs. 0 row, not a
  gap in the table or a break in the chart.

---

## 6. API

| Method | Path | Notes |
| --- | --- | --- |
| `GET` | `/api/region-sales/regions?date=YYYY-MM-DD` | Defaults to today in the report timezone |
| `GET` | `/api/region-sales/regions/:regionKey/salesmen?date=` | `regionKey` is the lowercased city, or the literal `unassigned` |
| `GET` | `/api/region-sales/salesman/:employeeId?from=&to=` | Defaults to the last 7 days; range capped at 366 days |

**Access: `admin` and `sales_manager` only** (`requireRoles`). Riders get 403 — this is an
oversight view.

**Scoping:** admin sees every region; a sales manager sees only their own team
(`User.managerId`), via the shared `resolveVisibleEmployeeIds` in `users.service.ts`.
Requesting an employee outside your scope returns an **empty report**, not a 403 and never
another team's data — consistent with `/analytics` and `/flags`.

### Indexes added
- `Order`: `{ createdBy: 1, status: 1, createdAt: -1 }` — the exact shape all three
  queries use; none existed.
- `User`: `{ 'address.city': 1, isTrashed: 1 }` — Dealer already had one, User didn't.

---

## 7. Tests

```bash
npm run test:region-sales        # 19 unit tests — timezone, day keys, city normalisation
npm run test:region-sales:flow   # 27 integration tests against in-memory MongoDB
```

Unit tests pin the boundary behaviour: a Karachi day's exact UTC span, a 02:00 PKT order
belonging to the *next* day, contiguity between consecutive days (1 ms apart), DST
handling, leap days, and that case/whitespace city variants collapse to one key.

Integration tests cover the aggregation and, critically, the scoping: one manager cannot
see another's region, drill into it, or pull a salesman from it. Also proven: cancelled /
trashed / amount-less orders excluded, `Unassigned` bucket, zero-sale salesmen present,
and that level-2 figures sum to the level-1 region total.

### Two bugs the tests caught during development
1. **`Intl.formatToParts` has no milliseconds**, so the computed offset came out as
   299.98 minutes instead of 300 and shifted the end-of-day boundary by ~1 s. Fixed by
   rounding to whole minutes — every real zone offset is a whole number of minutes.
2. **Mongoose makes `createdAt` immutable**, so a test fixture that backdated orders via
   `updateOne` was silently ignored and every order defaulted to "now". Fixed with
   `create([...], { timestamps: false })`. Worth remembering when writing any date-based
   fixture.

---

## 8. Manual check

```bash
cd backend
npm run sandbox
MONGODB_URI=mongodb://127.0.0.1:27018/sandbox npm run dev
cd ../admin && npm run dev
```

The sandbox seeds `rider.ali` in `Lahore`, `rider.bina` in `lahore` (different casing on
purpose) and `rider.chand` in `Karachi`. Log in as `admin` to see both regions, or as
`manager.north` / `manager.south` to confirm each sees only their own team. Password is
`admin123` for all.

Verify that a region's total equals the sum of its salesmen for the same date — the two
levels are computed by separate queries, so that equality is the useful cross-check.
