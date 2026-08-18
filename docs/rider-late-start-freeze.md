# Rider Late-Start Freeze

Riders must reach their first shop by **12:30 PM**. Miss it and the account is frozen
until an admin lifts it.

> Scope note: applies to the **`Employee-tracking`** repo only (`admin/` + `backend/`).
> The sibling `tracking-backend` project is legacy and must not be modified.

---

## 1. The rule

An **`order_taker`** must **check in** at their first shop of the day by the deadline.
Check-in is the geofenced proof they are physically at the store (150 m radius), which is
why it — not opening the app, not marking attendance — is what counts as starting work.

```
RIDER_FIRST_VISIT_DEADLINE = 12:30    // backend/src/modules/account-freeze/account-freeze.rules.ts
FREEZE_ELIGIBLE_ROLES      = [order_taker]
```

Being late does **not** just raise a flag the way the 75% rule does — it **freezes the
account**. A frozen rider can still sign in and read their day, but every write is refused
until an admin unfreezes them.

### Who it applies to

| | |
| --- | --- |
| **Roles** | `order_taker` only. Extending it is a one-line change to `FREEZE_ELIGIBLE_ROLES`. |
| **Exempt** | Riders with **no assigned visits** that day — nothing to be late for. Same principle as the 75% rule scoring an empty day 100%. |
| **Exempt** | Deactivated (`isActive: false`) and trashed users. |
| **Not counted as assigned** | Self-started extras (`isSelfInitiated`) and `cancelled` visits. |

### The boundary

Exactly **12:30:00 passes**. "By 12:30" includes 12:30, and a rider who makes it to the
second should not be punished by the seconds hand. **12:31 is late.**

### Timezone

The deadline is a **wall-clock time in `RIDER_FREEZE_TIMEZONE`** (falling back to
`REPORT_TIMEZONE`, default `Asia/Karachi`). This matters: compared in UTC, a 12:30
deadline would fire at 5:30 PM local at UTC+5 and every rider would pass.

**Day bucketing is UTC**, deliberately — it matches `getDayVisitTally` and the visit cron,
which stamp `visitDate` at UTC midnight. Bucketing the freeze check by local day instead
would put it on a different boundary from the visits it is checking, and a rider near the
edge would be frozen for missing visits the query could not see.

---

## 2. Two things trigger a freeze

Neither alone is sufficient, which is why both exist.

### a. The check-in guard — the rider who turns up late

`visits.service.checkInVisit` → `enforceFirstCheckInDeadline`.

When a rider tries to check in, and **all** of these hold:

1. their role is freeze-eligible, **and**
2. the deadline has passed, **and**
3. this would be their **first** check-in of the day, **and**
4. they have at least one assigned visit today

…the account is frozen and the check-in is **refused with 403**. They never get to start.

Only the *first* arrival is judged. Once a rider is out on time, the rest of the day is
governed by the existing completion and overstay rules, not this one.

An admin checking in on a rider's behalf is never caught — the role tested is the *acting*
user's.

### b. The daily sweep — the rider who never turns up

`jobs/late-start-freeze.cron.ts` → `sweepLateStarters`.

A no-show performs no action, so rule (a) can never catch them and the admin would see
nothing all day. The cron runs at **deadline + 5 minutes** (default `35 12 * * 0,1,2,3,4,6`
— every day except Friday, the company holiday the visit cron already skips) and freezes
every eligible rider who had assigned visits and still has no check-in.

The 5-minute grace means a rider checking in at 12:29:58 is never raced by the sweep.
`sweepLateStarters` re-checks the deadline itself and no-ops when called early, so a
misconfigured schedule cannot freeze anyone prematurely.

Both paths are **idempotent**: re-freezing an already-frozen user is a no-op, so the
original `frozenAt` (the moment they actually offended) survives a repeated sweep, and
there is one flag per rider per day rather than one per run.

---

## 3. What "frozen" means

### On the user

`backend/src/models/user.model.ts`:

| Field | Notes |
| --- | --- |
| `isFrozen` | the lock itself; missing means not frozen |
| `frozenAt` | when it was applied |
| `frozenReason` | shown verbatim to the rider and the admin |
| `frozenBy` | **absent** when the system froze them; set when an admin did it by hand |
| `unfrozenAt` / `unfrozenBy` | cleared again on the next freeze |

**`isFrozen` is deliberately separate from `isActive`.** `isActive` is the admin's
permanent on/off switch for an account; this is an automatic, admin-clearable discipline
lock. Conflating them would make "did an admin disable this person, or were they just
late?" unanswerable, and would break the `isActive` checks in route assignment.

### Enforcement

`middleware/frozen.middleware.ts` → `blockFrozenWrites`, mounted on the six routers a
rider records work through: **visits, orders, returns, dealers, approvals, collections**.

- **Writes** (`POST` / `PUT` / `PATCH` / `DELETE`) → **403** with the stored reason.
- **Reads** (`GET` / `HEAD` / `OPTIONS`) → allowed.

Reads stay open on purpose: a frozen rider must be able to open the app and find out what
happened. Blocking GETs would leave them on an error screen with no explanation.

**403, not 401.** A 401 makes the admin app's axios interceptor log the user straight out —
precisely the opposite of "can still sign in and see why".

The freeze state is resolved **per request** from the database in `authMiddleware`, not
read from the JWT, so an admin's unfreeze takes effect on the rider's very next call
instead of when their 24-hour token expires.

### The flag

A `late_start` row in the existing `PerformanceFlag` collection, so a freeze always has an
audit trail in the admin's "needs review" feed alongside overstays and low completion.

`value` and `threshold` are both **minutes since local midnight** (`812` vs `750`), so
they compare directly; `/flags` renders them back as times. `value` is absent for a
no-show — there is no arrival to record — and `meta.neverArrived` distinguishes the case.

---

## 4. API

| Method | Path | Who |
| --- | --- | --- |
| `GET` | `/api/account-freeze/me` | any authenticated role — the rider's own state + the deadline |
| `GET` | `/api/account-freeze` | admin — the unfreeze queue |
| `POST` | `/api/account-freeze/sweep` | admin — re-run the sweep after an outage; a no-op before the deadline |
| `PATCH` | `/api/account-freeze/:id/unfreeze` | **admin only** — body `{ note? }`, kept in the activity log |

`/me` is deliberately outside `blockFrozenWrites` and open to every role: a frozen rider
must always be able to read why they are frozen.

---

## 5. UI

**Rider** — `FrozenAccountBanner` renders above the page content on **every** screen (in
`Layout`), because the freeze applies everywhere; putting it only on Visits would leave a
rider who lands on Orders staring at unexplained 403s. It shows the reason, when they were
frozen, and a **Contact admin** WhatsApp button — the same number the login page offers.

The banner re-fetches `/account-freeze/me` on mount rather than trusting the stored user,
because a rider is typically frozen *during* a session they are already signed into, so
localStorage is exactly the thing that is stale. The stored value seeds the first paint so
the banner does not flicker in for someone already frozen at sign-in.

**Admin** — `/frozen-accounts` ("Frozen Accounts", admin-only sidebar entry) is the
unfreeze queue: who is frozen, when, why, and whether it was the system or an admin.
Unfreeze prompts for an optional note. A **Run late-start check now** button re-runs the
sweep manually.

`/employees` shows a blue **Frozen** chip next to the Active badge — the freeze is separate
from `isActive`, so showing only Active there would hide why they cannot work.

`/flags` gains a **Late start** filter and badge.

---

## 6. Configuration

```bash
RIDER_FIRST_VISIT_DEADLINE=12:30           # HH:MM, 24-hour
RIDER_FREEZE_TIMEZONE=Asia/Karachi         # falls back to REPORT_TIMEZONE
LATE_START_CRON_ENABLED=false              # turn the no-show sweep off
LATE_START_CRON_SCHEDULE=35 12 * * 0,1,2,3,4,6
```

A malformed `RIDER_FIRST_VISIT_DEADLINE` **throws**. The cron catches it and refuses to
start, logging the reason — better a sweep that does not run than one that freezes
everybody at 00:00. `parseTimeOfDay` rejects `noon`, `1230`, `12:30pm`, `24:00`, `12:60`.

---

## 7. Edge cases and how they behave

| Case | Behaviour |
| --- | --- |
| Checks in at exactly 12:30:00 | Passes. Not frozen. |
| Checks in at 12:30:59 | Passes — seconds do not make a rider late. |
| Checks in at 12:31 | Frozen, check-in refused (403). |
| Already checked in at 9am, checks in again at 4pm | Untouched. Only the first arrival is judged. |
| No assigned visits today | Exempt, both paths. |
| Only self-started extras assigned | Exempt — extras are not assigned work. |
| Only cancelled visits today | Exempt — called off, not the rider's failure. |
| `delivery_man` / `employee` / warehouse roles, arbitrarily late | Never frozen. Rule is `order_taker` only. |
| Admin checks in on the rider's behalf after 12:30 | Allowed — the acting role is tested. The rider is still caught on their own next attempt. |
| Server down over the deadline | The check-in guard still freezes them when they try to start. `POST /sweep` re-runs the no-show half. |
| Sweep runs twice | One flag, original `frozenAt` preserved. |
| Rider frozen mid-session | Next write returns 403; the banner appears on the next page load. No forced logout. |
| Admin unfreezes | Effective on the rider's very next request — no re-login needed. |
| Unfrozen rider is late again tomorrow | Frozen again; stale `unfrozenAt`/`unfrozenBy` are cleared. |
| Unfreezing someone not frozen | 400 `This account is not frozen`. |
| Frozen rider opens the app | Everything readable; every write refused with the stored reason. |

---

## 8. Tests

```bash
npm run test:freeze        # 27 unit tests — deadline maths, timezone, formatting
npm run test:freeze:flow   # 26 integration tests against in-memory MongoDB
```

Unit tests cover the `12:30:00` / `12:30:59` / `12:31` boundary, that the timezone
genuinely changes the verdict (09:00 UTC is late in Karachi, on time in UTC), midnight
reported as hour 24 by some runtimes, `12:00 PM` not rendering as `0:00 PM`, and every
malformed deadline being rejected rather than silently defaulted.

Integration tests prove: an on-time rider is untouched; a late first check-in freezes and
is refused; a rider already out is unaffected; empty days, extras-only days, cancelled-only
days and non-rider roles are all exempt; the sweep no-ops before the deadline, catches
no-shows, skips starters/empty days/trashed/deactivated riders, and is idempotent;
unfreeze clears the lock, records the actor, refuses non-frozen accounts and 404s unknown
ones; a re-freeze clears the stale unfreeze stamps; passwords never leave `findFrozenUsers`;
and the write block lets GET through while refusing every write with a 403.
