# Visit Completion Threshold, Skipping & Performance Flags

How the 75% rule works, what happens when a rider skips a visit, and how flagged riders
reach the admin panel.

> Scope note: applies to the **`Employee-tracking`** repo only (`admin/` + `backend/`).
> The sibling `tracking-backend` project is legacy and must not be modified.

---

## 1. The rule

A rider must **complete at least 75%** of the visits assigned to them for a day.
Falling below does **not** block them from working — it raises a flag for the admin.

```
VISIT_COMPLETION_THRESHOLD_PERCENT = 75   // backend/src/modules/visits/visits.rules.ts
```

The admin app mirrors this in `admin/services/visitService.ts` — keep both in sync.

### Window: the day

Visits are generated **per route, per day** by the cron
(`backend/src/jobs/visit-generation.cron.ts`), and unfinished ones roll over to
`incomplete`. So "the visits in the route" is a day's work, and the day is the window the
percentage measures over.

The monthly analytics report shows the same ratio aggregated over the month, using the
identical threshold.

### The formula

```
assigned  = every visit scheduled that day, EXCLUDING cancelled
completed = visits with status 'completed'
rate      = completed / assigned * 100          (100% when assigned is 0)
```

| Status | In denominator? | In numerator? |
| --- | --- | --- |
| `completed` | yes | **yes** |
| `todo` / `in_progress` / `checked_in` | yes | no |
| `skipped` | **yes** — a skip is still work that was assigned | no |
| `incomplete` (rolled over) | yes | no |
| `cancelled` | **no** — called off, not the rider's failure | no |

**Self-started ("extra") visits are excluded entirely** — from both sides of the ratio.
A rider can walk into any client and start a visit (`isSelfInitiated: true`), but this
rule measures adherence to the *assigned route*. If extras counted, a rider could skip
assigned visits and pad the rate back up with easy walk-ins; and abandoning an extra
would unfairly push them below the threshold. Extras are still counted as real work in
analytics — see `extraVisitsCompleted` / `totalVisitsCompleted`.

**An empty day is 100%, not 0%.** A rider with nothing assigned cannot be failing, and
returning 0 there would flag every idle rider.

---

## 2. Skipping a visit

`skipped` is a visit status, with `skippedAt`, `skipReason` and `skippedBy`.

Skipping is allowed from `todo` and `in_progress` only. It is **refused from
`checked_in`** — the rider is standing at the shop, so finishing is the expected action.
It is also refused for `completed`, `cancelled`, `incomplete` and already-skipped visits.

### The projection the rider is warned with

The warning does not show the current rate (which is usually low mid-day and would be
alarming for no reason). It shows **the best rate the day can still finish on** if this
visit is skipped and everything else left is completed:

```
projected = (completed + stillOpen - 1) / assigned
```

where `stillOpen` counts visits not yet completed, skipped or cancelled — including the
one being skipped. On a 4-visit day the first skip projects 75% (still a pass) and the
second projects 50% (a fail), which is exactly when the rider should be warned.

### Two-step API

| Method | Path | Behaviour |
| --- | --- | --- |
| `GET` | `/api/visits/:id/skip-preview` | Read-only. Returns `currentRate`, `projectedRate`, `threshold`, `wouldDropBelowThreshold`, the day tally, and `blockedReason` if the visit cannot be skipped at all. |
| `PATCH` | `/api/visits/:id/skip` | Body `{ reason?, confirm? }`. |

`PATCH /skip` is deliberately two-step:

1. If the skip **would not** breach the threshold → it goes straight through.
2. If it **would** breach and `confirm` is absent → **nothing is written**. The response
   is `{ skipped: false, requiresConfirmation: true, projectedRate, message }`.
3. Re-sent with `confirm: true` → the skip is applied **and a flag is raised**.

The re-check happens server-side on the confirmed call too, so a stale client cannot
skip a breach past the flag.

---

## 3. The flag

Flags live in their own collection so the admin gets a real, filterable queue rather
than having to scan visits.

`backend/src/models/performance-flag.model.ts`:

| Field | Notes |
| --- | --- |
| `employeeId` | the rider |
| `type` | `low_visit_completion`, `overstay` or `late_start` |
| `flagDate` | UTC midnight of the day |
| `message` | human-readable summary shown in the list |
| `value` / `threshold` | e.g. `60` / `75` |
| `visitId`, `routeId` | drill-through |
| `resolved`, `resolvedAt`, `resolvedBy` | acknowledgement |

**Unique on `{ employeeId, type, flagDate }`** — repeated skips on the same bad day
update the one row instead of spamming the admin. The stored `value` always reflects the
latest (worst) rate.

The overstay path (>30 min at a shop) now writes into the same collection, so both
problems appear in one feed. `visit.overstayFlagged` is kept as well, for the per-visit
badge.

The `late_start` type also writes here, but it is the odd one out: unlike these two it
**freezes the account** rather than just raising a flag, so the row is the audit trail for
a lock an admin has to clear by hand. Its `value`/`threshold` are minutes since local
midnight rather than percentages or minutes-of-duration. See
[rider-late-start-freeze.md](./rider-late-start-freeze.md).

### API

| Method | Path | Who |
| --- | --- | --- |
| `GET` | `/api/performance-flags?type=&resolved=&startDate=&endDate=&employeeId=` | any role, scoped |
| `GET` | `/api/performance-flags/summary` | any role, scoped — counts for a badge |
| `PATCH` | `/api/performance-flags/:id/resolve` | admin, sales_manager |

Scoping is the same rule as everywhere else: admin sees all, a sales manager sees their
own team, everyone else sees only themselves.

### UI

`/flags` — "Performance Flags" in the sidebar. Filter by reason, open/reviewed, and date
range; drill through to the visit; mark reviewed. Riders see the page too, showing only
their own flags, so being flagged is never a surprise.

---

## 4. Rider experience

On a visit in `todo` / `in_progress` the rider sees **Check In at Store** and
**Skip this visit** side by side, with a note that they must complete at least 75% of
the day.

`SkipVisitModal` then:

1. Calls the preview and shows today's tally and the projected finish.
2. If the projection is under the pass mark, shows a red warning explaining a report goes
   to their supervisor, and **disables the confirm button until they tick an
   acknowledgement checkbox**.
3. Sends `confirm: true` only after that tick.

A skipped visit renders an amber "Skipped" badge with the reason.

---

## 5. Edge cases and how they behave

| Case | Behaviour |
| --- | --- |
| Zero visits assigned | Rate is 100%. No division by zero, no flag. |
| Rider already below 75% before the skip | Still warned, still flagged on confirm. |
| Repeated skips, same day | One flag row, updated to the worse value. |
| Skipping the only visit of the day | Projects 0% → warns → flags on confirm. |
| Cancelled visits | Excluded from the denominator entirely. |
| Already checked in | Skip refused with a message telling them to complete instead. |
| Someone else's visit | `This visit is not assigned to you`. |
| Admin skipping for a rider | Allowed (ownership check passes for admin); the flag is raised against the **rider**, not the admin. |
| Rider completes 5 self-started extras after skipping 2 assigned visits | Still warned and still flagged — extras cannot pad the adherence rate. |
| Rider starts an extra and never finishes it | No effect on the rate; extras are outside the denominator. |

---

## 6. Tests

```bash
npm run test:visits        # includes 15 skip/threshold unit tests
npm run test:visits:flow   # includes 11 skip integration tests + 4 scoping regressions
```

Unit tests cover the formula, the boundary (exactly 75% passes, 74.9% fails), the
empty-day case, the projection maths and every `skipGuard` transition.

Integration tests, against a real in-memory MongoDB, prove: preview mutates nothing; the
first skip of four is allowed; the second **warns and writes nothing**; confirming applies
the skip and creates exactly one flag; repeat skips update that one flag; and ownership /
status guards hold.
