# Performance Analytics & Monthly Targets

Reference for rider / sales-manager analytics: the `sales_manager` role, the team
hierarchy, monthly targets, and how achievement is computed and scoped.

> Scope note: applies to the **`Employee-tracking`** repo only (`admin/` + `backend/`).
> The sibling `tracking-backend` project is legacy and must not be modified.

---

## 1. Roles and hierarchy

"Rider" is the informal name for the **`order_taker`** role — it was never a separate
role. "Sales manager" did not exist at all and was added as part of this work.

| Role | Analytics visibility |
| --- | --- |
| `admin` | Everyone |
| `sales_manager` | **New.** Their own direct reports, plus themselves |
| `order_taker` (rider) | Only themselves |
| `delivery_man`, `employee` | Only themselves |
| `warehouse_manager` | Only themselves |

The link is a single new field: **`User.managerId`** → `User`. There was no
manager/team/region concept anywhere before this; `RouteAssignment` was the only
grouping and it is unrelated.

- `FIELD_STAFF_ROLES` (`backend/src/constants/global.ts`) = `order_taker`,
  `delivery_man`, `employee`. Only these carry targets, appear as analytics rows, and
  can be assigned a manager.
- The "Reports to (Sales Manager)" picker appears on the employee create/edit forms only
  for those roles. Clearing it unassigns the manager.
- Index: `{ managerId: 1, isTrashed: 1 }` for team resolution.

---

## 2. Targets

A target is **one row per employee per calendar month**.

`backend/src/models/target.model.ts`:

| Field | Notes |
| --- | --- |
| `employeeId` | → User |
| `periodMonth` | `YYYY-MM`, schema-validated. Matches the `%Y-%m` grouping the aggregations already use, so a target joins straight onto a monthly bucket |
| `salesAmount` | Money target, measured against **delivered** order value |
| `orderCount` | Orders booked in the month |
| `visitCount` | Visits checked in **and** checked out |
| `notes` | Optional, ≤500 chars |

Unique index on `{ employeeId, periodMonth }` — this is the upsert key, so saving a
target twice edits it instead of creating a duplicate.

> **Not to be confused with** the pre-existing `User.target` / `User.achivedTarget`
> free-text strings (note the `achived` typo). Those are decorative, are not read by any
> calculation, and were left untouched. Consider deprecating them.

### API

| Method | Path | Who |
| --- | --- | --- |
| `PUT` | `/api/targets` | admin (anyone), sales_manager (own team only) — upsert |
| `GET` | `/api/targets?employeeId=&periodMonth=` | any role, scoped to what they may see |
| `DELETE` | `/api/targets/:id` | admin, sales_manager (own team only) |

---

## 3. Analytics API

| Method | Path | Purpose |
| --- | --- | --- |
| `GET` | `/api/analytics/performance?periodMonth=&employeeId=` | Per-employee actuals vs target for one month, plus team KPI rollup. Defaults to the current month |
| `GET` | `/api/analytics/trend?employeeId=&months=6` | Dense month-by-month series (sales / orders / visits / target line) for charts |

### Metrics per employee

| Metric | Source |
| --- | --- |
| `salesAmount` | Sum of `Order.grandTotal` where `status: delivered` |
| `bookedAmount` | Same, for `pending / approved / packed / dispatched` |
| `orderCount` | Count of delivered orders |
| `visitsCompleted` / `visitsAssigned` / `visitCompletionRate` | From `Visit` |
| `avgVisitMinutes` | Mean `durationMinutes`, over timed visits only |
| `overstayCount` | Visits with `overstayFlagged` — ties into the check-in/checkout work |
| `newClients` | Dealers created in the period with `createdBy` = employee |
| `*AchievementPercent`, `salesRemaining`, `status` | Computed against the month's target |

### Decisions worth knowing

- **Attribution is `Order.createdBy`.** `Order` has no `employeeId` field; the rider who
  booked it is the only per-user link.
- **Orders bucket on `createdAt`**, consistent with the existing `/api/dashboard/reports`.
  Not `orderDate` / `deliveryDate`. Visits bucket on `completedAt`, since a visit only
  counts once the rider has checked out.
- Trashed and cancelled orders are excluded everywhere.
- Orders with no `grandTotal` count toward `orderCount` but add 0 to `salesAmount`.

---

## 4. Achievement rules

Pure functions in `backend/src/modules/analytics/analytics.rules.ts` (unit-tested):

- **No target ⇒ `null`, never `0%`.** "No target set" is not the same as "achieved
  nothing"; the UI renders a dash and a grey bar rather than a red 0%.
- **Achievement is uncapped.** 150% of target reports as 150%. Only the progress *bar*
  clamps to 100% width.
- **Status is pace-aware.** `achievementStatus(actual, target, elapsedFraction)` compares
  progress against how much of the month has already gone, so 40% reads as `on_track` on
  day 3 and `behind` on day 28:

  | Status | Condition |
  | --- | --- |
  | `achieved` | ≥ 100% |
  | `on_track` | ≥ 90% of expected pace |
  | `at_risk` | ≥ 60% of expected pace |
  | `behind` | below that |
  | `no_target` | no target set |

---

## 5. Scoping — the security-critical part

Every analytics and target read passes through the same rule
(`resolveScope` / `resolveVisibleEmployeeIds`):

- `admin` → `null` (unrestricted, no id filter applied)
- `sales_manager` → `[self, ...direct reports]`
- everyone else → `[self]`

Requesting an `employeeId` **outside** your scope returns an **empty report**, not an
error and not someone else's data. The same intersection applies to `GET /api/targets` —
the scope and the explicit filter are intersected rather than one silently overwriting
the other.

This is covered by dedicated tests (see §7); treat those as regression guards if you
touch the scoping code.

---

## 6. Admin UI

- **`/analytics`** — "Team Performance" for admin/managers, "My Performance" for riders
  (the page detects this and hides the employee filter). Month picker, KPI grid,
  sales-vs-target and activity trend charts, and a per-employee table with an
  `AchievementBar` per row.
- **Set/Edit target** button per row (admin and sales managers only) opens `TargetModal`.
- Sidebar entry **Performance**, gated on the `analytics:view-own` permission, so every
  role sees it and the content narrows itself.

Charts reuse the existing `LineTrendChart` (Chart.js). Note that component renders
nothing but `emptyText` when *every* value is 0 — relevant for a brand-new month.

---

## 7. Tests

```bash
npm test                      # all four suites
npm run test:analytics        # pure rules, no database
npm run test:analytics:flow   # aggregations + scoping, in-memory MongoDB
```

- **`analytics.rules.test.ts`** — 19 assertions: period-key maths (incl. leap years),
  achievement null-vs-zero, uncapped over-performance, pace thresholds.
- **`analytics.flow.test.ts`** — 23 assertions against a real database: aggregation
  correctness (delivered vs booked vs cancelled vs trashed), visit productivity, target
  upsert semantics, and a block of scoping tests asserting one manager cannot see
  another's team.

Both use `mongodb-memory-server`; the first run downloads a ~780 MB MongoDB binary and
caches it in `~/.cache/mongodb-binaries`.

---

## 8. Local sandbox

To exercise the UI without touching real data:

```bash
npm run sandbox
```

Starts a throwaway in-memory MongoDB on **port 27018**, seeded with two sales managers,
three riders, orders, visits (some deliberately over the 30-minute limit), and targets —
including one rider with **no** target, to exercise the null-achievement path.

Then point the API at it:

```bash
MONGODB_URI=mongodb://127.0.0.1:27018/sandbox npm run dev
```

Logins are all password `admin123`: `admin`, `manager.north`, `manager.south`,
`rider.ali`. Everything is discarded on Ctrl+C.

---

## 9. Deploying to existing data

No migration is required — `managerId` and all target fields are optional. Until
managers are assigned, every sales manager sees an empty team and analytics behaves as
admin-only. New indexes are created by Mongoose on startup.

Two follow-ups worth considering:

1. Add a compound index `{ createdBy: 1, status: 1, createdAt: -1 }` on `Order` if
   per-rider time-series queries get slow at volume.
2. Decide whether to migrate or drop the legacy `User.target` / `User.achivedTarget`
   strings now that real targets exist.
