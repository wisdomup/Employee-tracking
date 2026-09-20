# Rider Late-Start Freeze

Riders must reach their first shop by **12:30 PM**. Miss it and the account is frozen
until an admin lifts it, and a **Rs. 200 fine** is raised for that day.

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
| **Exempt** | **Friday** — the company holiday, the same day the visit cron omits. |
| **Exempt** | An **approved leave** (`Approval` with `approvalType: 'leave'`, `status: 'approved'`) for that date. Any leave type counts: an admin signed off on the absence, and a half day is a fine reason to reach the first shop after noon. A `pending` request does **not** excuse anyone — otherwise the freeze would be avoidable by filing a request nobody approves. |
| **Exempt** | Deactivated (`isActive: false`) and trashed users. |
| **NOT exempt** | Having **no assigned visits**. See below. |

### Why an empty day is not an excuse

The rule originally exempted riders with no assigned visits — "nothing to be late for",
mirroring the 75% rule scoring an empty day 100%. That was wrong here, and it silently
disabled the entire feature in production.

Visit generation had stopped producing visits (the last were three weeks old), so **every
rider had an empty day, every day**. The exemption fired for all of them, the check-in
guard never triggered, the sweep skipped everyone, and nobody was ever frozen — while the
riders carried on taking orders after 12:30 as though no rule existed.

A rider is now expected at a shop by the deadline whether or not the cron handed them a
route. `sweepLateStarters` still reports `frozenWithNoAssignedVisits` — **a count, not a
skip**. A number rising there means the visit cron has gone idle and is worth
investigating, but it no longer stops anyone being frozen.

Self-started extras and cancelled visits are likewise no longer an escape: they were only
ever relevant through the assigned-visit count, which no longer gates the freeze.

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
4. it is not the company holiday and they are not on approved leave, **and**
5. an admin has not already pardoned them today, **and**
6. they have not already been judged today at all (see 3a)

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
every eligible rider who still has no check-in — assigned visits or not.

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
| `freezePardonedFor` | UTC midnight of the day an admin lifted a freeze — the pardon. See 3a. |
| `freezeFineAmount` | this rider's own late-start fine; **absent** means the company default, `0` means no fine |

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

## 3a. The pardon — what an unfreeze actually does

Lifting a freeze does more than flip `isFrozen`. It stamps
**`User.freezePardonedFor`** with UTC midnight of that day, and while that matches today
neither enforcement path will re-freeze the rider.

**Without it an unfreeze is useless.** The rider is handed straight back into the exact
state that froze them — still past the deadline, still with no check-in — so the check-in
guard fires again on their very next action and re-locks them within seconds of the admin
letting them go. The admin's "Run late-start check now" button would do the same.

The pardon is scoped to **one day, one rider**:

| | |
| --- | --- |
| Rest of today | The rider works normally. Check-ins, orders, everything. |
| Tomorrow, on time | Nothing happens; the pardon is irrelevant. |
| Tomorrow, late again | **Frozen again.** The pardon forgave a day, it did not exempt the rider. |
| A colleague, same day | Unaffected. The pardon is per-rider. |

An admin can repeat the cycle indefinitely: freeze → unfreeze → work → next-day freeze →
unfreeze. The repeat offence is visible either way, because each freeze still writes its
own `late_start` flag into `/flags`.

`freezeUser` clears `freezePardonedFor` whenever it actually freezes someone. A fresh
freeze can only be a later day than the pardon covered, so leaving it would be stale data
the sweep has to reason about.


### Judged once a day

Sitting in front of the pardon is a blunter rule: **if a `late_start` flag already exists
for this rider today, the rule stops looking at them until tomorrow.** The flag is written
the instant a rider is first evaluated, so its presence means the day's verdict is already
in.

This is what makes "only the FIRST visit is checked" literally true. A rider refused at
their first shop has no `checkedInAt` recorded, so without it every later attempt still
looks like a first check-in and gets re-judged — which is how an unfreeze ended up being
undone seconds later.

It overlaps with `freezePardonedFor` on purpose. The pardon depends on two dates agreeing;
this depends only on a row existing, so it still holds if those dates could ever disagree
(a timezone/day-boundary edge, a hand-edited record). The sweep reports it as
`skippedAlreadyJudged`.

Enforcement is not weakened: a rider who is frozen and *not* unfrozen simply stays frozen.

### Clocks

`unfreezeUser` and `getFreezeStatus` take an optional `now` (defaulting to real time) purely
so the pardon date is testable, matching `sweepLateStarters(now)` and
`enforceFirstCheckInDeadline({ now })`. Production always passes real time.

### What each side sees

- **Rider** — the red frozen banner is replaced by a green *"Your account has been
  unfrozen"* note for the rest of the day, telling them they are cleared and reminding them
  of tomorrow's deadline. `GET /api/account-freeze/me` returns `pardonedToday` for this.
- **Admin** — the unfreeze confirmation spells out that the rider is clear for the rest of
  today and will be frozen again if late tomorrow. `sweepLateStarters` reports
  `skippedPardoned`.

## 3b. The fine

Every freeze also raises a **fine** for that day — **Rs. 200** by default. The rider is
told the amount in the same refusal that blocks their check-in; the admin is told in a
banner on every screen.

### Where it lives

One document per offence in `RiderFine` (`backend/src/models/rider-fine.model.ts`), not a
running total on the user. A total answers "how much" and nothing else — the first dispute
("I was on leave on the 9th, why am I fined for it?") is unanswerable from one.

`{ employeeId, type, fineDate }` is **uniquely indexed**, and `fineDate` is UTC midnight,
the same day boundary the freeze and the flag use. Both freeze paths raise the fine and the
manual sweep button can be pressed repeatedly: a rider is fined **once** for one day's
offence however many times the rule looks at them.

**It is deliberately not an accounting document.** No journal entry is written. A fine is a
disciplinary record, not money that moved, and posting an unpaid, frequently waived figure
into the trial balance would leave somebody reconciling it. Recovery from pay is a payroll deduction and is posted there, once, when it actually happens —
see "Recovering it from pay" below.

### The amount

Most specific wins:

| | |
| --- | --- |
| `user.freezeFineAmount` | this rider's own amount, set by an admin |
| `RIDER_FREEZE_FINE_AMOUNT` | the company default for everyone else |
| `200` | the built-in default |

`freezeFineAmount` has **no schema default**, on purpose: absent must keep meaning "follow
the company default", or a later change to the default would reach nobody. **`0` is a real
value** — frozen, not fined — which is why absent and zero cannot be collapsed into one
state, and why no `Rs. 0` row is written for such a rider.

Amounts are whole rupees, non-negative, capped at 100,000. The cap is a typo guard, not a
business rule: `20000` typed for `200.00` is an easy slip and a fine two orders of
magnitude out is worse than a refused edit. A malformed `RIDER_FREEZE_FINE_AMOUNT` falls
back to 200 with a warning rather than stopping the app — unlike the deadline, where a
wrong value freezes the wrong people.

### Changing it for one rider

`PATCH /api/account-freeze/:id/fine-amount` does **two** things, and the admin prompt says
so: it sets the rider's amount for future late starts **and** re-prices a fine already
raised today. An admin standing on the Frozen Accounts screen is looking at today's fine —
changing only the future one leaves the number in front of them untouched, which is not
what "change his fine" means to anybody. The first amount survives as
`originalAmount`, with `amountChangedBy`/`amountChangedAt`.

A **waived** fine is never re-priced: re-pricing something an admin deliberately cancelled
would quietly un-forgive it.

### Waiving, freezing and unfreezing are three separate decisions

| Action | Effect on the freeze | Effect on the fine |
| --- | --- | --- |
| Unfreeze | lifted, pardoned for today | **untouched** — still outstanding |
| Recover on payroll | untouched | collected — it stops being owed, and becomes income |
| Waive | **untouched** — still frozen | cancelled, row kept with `waivedBy`/`waiveNote` |
| Set amount to 0 | still frozen next time | no fine raised at all |

A waived fine keeps its row and its amount. Deleting it would make the admin's decision
invisible the moment it is questioned.

### Recovering it from pay

A fine is collected through **payroll**, as a deduction on the month's run
(`modules/finance/payroll.service.ts`).

Pre-filled in full, unlike an advance recovery, which starts at zero and is typed in. An advance
is repaid on terms somebody agreed; a fine is simply owed, and a deduction nobody remembers to
type is a fine that is never collected — which was the state before this existed. The amount is
still editable on the draft, and capped at the month's gross pay: the rest stays owed and comes
off a later month.

Posting the run books it:

```
    Dr  Salaries & Wages              the salary half
    Dr  Staff Allowances & Bonus      the rest of the pay
        Cr  Advances to Staff         what is being taken back, per employee
        Cr  4220 Staff Fines Recovered   fines coming off this month's pay
        Cr  Salaries & Wages Payable  what is left to hand over
```

**Income, not a smaller wage bill.** Crediting `Salaries & Wages` instead would understate what
staff cost the business and hide the fines completely — two figures wrong to make one entry
shorter. The fine becomes income at the moment it is recovered and not before, so a fine that is
raised and then waived never reaches the books at all.

One line for the month, not one per rider: a fine is not a subledger balance. What each rider owes
lives in the fines themselves.

### What a rider still owes is derived, never stored

```
balance = fines raised and not waived  −  what posted payroll runs have already recovered
```

No `recovered` flag exists on a fine, and nothing is written back to one when it is collected.
That is the same rule bills and advances follow here, for the same reason: a stored figure has to
be corrected on every path, and the first path anybody forgets leaves it wrong with nothing to
check it against. Two consequences fall out for free:

- **Cancelling a payroll run releases its fines.** The recovery stops existing, so the balance
  goes back up with no second write and nothing pointing at a month that was reversed.
- **A draft recovers nothing.** Only posted runs count, so a draft sitting unposted never tells a
  rider they no longer owe money that is still on their next payslip.

### Waiving after recovery

Refused. The money has already left the payslip and nothing on the Frozen Accounts screen can hand
it back, so the admin is told to refund it as a bonus on the next run rather than given a button
that half works. Cancel the run first and the waive works again.

## 4. API

| Method | Path | Who |
| --- | --- | --- |
| `GET` | `/api/account-freeze/me` | any authenticated role — the rider's own state + the deadline |
| `GET` | `/api/account-freeze` | admin — the unfreeze queue |
| `POST` | `/api/account-freeze/sweep` | admin — re-run the sweep after an outage; a no-op before the deadline |
| `PATCH` | `/api/account-freeze/:id/unfreeze` | **admin only** — body `{ note? }`, kept in the activity log |
| `GET` | `/api/account-freeze/fines/overview` | admin — the counters behind the admin banner |
| `GET` | `/api/account-freeze/:id/fines` | admin — one rider's fine history, newest first |
| `PATCH` | `/api/account-freeze/:id/fine-amount` | admin — body `{ amount }`; `null` restores the default, `0` means no fine |
| `PATCH` | `/api/account-freeze/fines/:fineId/waive` | admin — body `{ note? }`; cancels a fine, leaves the freeze |

`/me` is deliberately outside `blockFrozenWrites` and open to every role: a frozen rider
must always be able to read why they are frozen.

---

## 5. UI

**Rider** — `FrozenAccountBanner` renders above the page content on **every** screen (in
`Layout`), because the freeze applies everywhere; putting it only on Visits would leave a
rider who lands on Orders staring at unexplained 403s. It shows the reason, when they were
frozen, and a **Contact admin** WhatsApp button — the same number the login page offers. It also shows the fine raised for today and, once they are unfrozen, what is still outstanding — a fine a rider skim-reads past is a fine they dispute at payroll.

The banner re-fetches `/account-freeze/me` on mount rather than trusting the stored user,
because a rider is typically frozen *during* a session they are already signed into, so
localStorage is exactly the thing that is stale. The stored value seeds the first paint so
the banner does not flicker in for someone already frozen at sign-in.

**Admin** — `/frozen-accounts` ("Frozen Accounts", admin-only sidebar entry) is the
unfreeze queue: who is frozen, when, why, and whether it was the system or an admin.
Unfreeze prompts for an optional note. A **Run late-start check now** button re-runs the
sweep manually.

`FreezeFinesAdminBanner` renders on **every** admin screen (for `account-freeze:view`
holders only, and only when something is frozen or fined today): how many accounts are
frozen, what today's fines come to, and what is outstanding overall, with a link to the
queue. Without it an admin learns about a freeze only by opening Frozen Accounts — the one
screen nobody opens on a day they do not already suspect a problem.

The payroll run screen (`/finance/payroll/[id]`) carries a **Fines back** column beside
**Advance back**, pre-filled and editable while the run is a draft, with what each person still
owes shown under their name.

The queue itself carries **Today's fine**, **Fine per late start** (marked *custom* when it
was set for that rider) and **Outstanding**, plus **Change fine** and **Cancel fine**
buttons for holders of `account-freeze:change` — the same permission the unfreeze route
enforces server-side.

`/employees` shows a blue **Frozen** chip next to the Active badge — the freeze is separate
from `isActive`, so showing only Active there would hide why they cannot work.

`/flags` gains a **Late start** filter and badge.

---

## 6. Configuration

```bash
RIDER_FIRST_VISIT_DEADLINE=12:30           # HH:MM, 24-hour
RIDER_FREEZE_TIMEZONE=Asia/Karachi         # PKT; falls back to REPORT_TIMEZONE
RIDER_FREEZE_ENABLED=false                 # master switch — BOTH the guard and the sweep
RIDER_FREEZE_FINE_AMOUNT=200               # rupees per late start; a per-rider amount wins
LATE_START_CRON_ENABLED=false              # the no-show sweep only
LATE_START_CRON_SCHEDULE=35 12 * * 0,1,2,3,4,6
```

**Set the timezone explicitly in `.env`.** It defaults to `Asia/Karachi` in code, but
leaving it implicit means the rule quietly follows whatever `REPORT_TIMEZONE` happens to
be — and neither follows the server's own clock, which is the thing people assume.

`RIDER_FREEZE_ENABLED=false` is the switch for turning the feature off.
`LATE_START_CRON_ENABLED=false` only stops the sweep and would leave riders still being
refused at check-in — rarely what you want.

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
| No assigned visits today | **Frozen.** Counted in `frozenWithNoAssignedVisits`. |
| Only self-started extras assigned | **Frozen** — no longer an escape. |
| Only cancelled visits today | **Frozen** — no longer an escape. |
| Friday | Nobody is frozen, on either path. |
| Approved leave for today | That rider is not frozen. |
| Leave request still `pending` | Frozen — an unapproved request excuses nothing. |
| `delivery_man` / `employee` / warehouse roles, arbitrarily late | Never frozen. Rule is `order_taker` only. |
| Admin checks in on the rider's behalf after 12:30 | Allowed — the acting role is tested. The rider is still caught on their own next attempt. |
| Server down over the deadline | The check-in guard still freezes them when they try to start. `POST /sweep` re-runs the no-show half. |
| Sweep runs twice | One flag, **one fine**, original `frozenAt` preserved. |
| Rider's amount set to 0 | Frozen, **not fined** — no `Rs. 0` row is written. |
| Admin changes the amount while the rider is frozen | Today's outstanding fine is re-priced too; `originalAmount` keeps what it was raised at. |
| Admin changes the amount after waiving today's fine | The waived fine is left alone; only future late starts use the new amount. |
| Rider frozen mid-session | Next write returns 403; the banner appears on the next page load. No forced logout. |
| Admin unfreezes | Effective on the rider's very next request — no re-login needed, and they are NOT re-frozen for the rest of that day. The fine stays outstanding; waiving it is a separate action. |
| Pardoned rider checks in at 4pm | Allowed. The pardon covers the whole day. |
| Rider judged earlier today, by any route | Never re-judged today, whatever happened to the freeze afterwards. |
| Admin re-runs the sweep after unfreezing | The rider stays unfrozen (`skippedPardoned`). |
| Pardoned rider is late again tomorrow | Frozen again; the admin can unfreeze again, and so on. |
| Unfrozen rider is late again tomorrow | Frozen again; stale `unfrozenAt`/`unfrozenBy` are cleared. |
| Unfreezing someone not frozen | 400 `This account is not frozen`. |
| Frozen rider opens the app | Everything readable; every write refused with the stored reason. |

---

## 8. Tests

```bash
npm run test:freeze        # 46 unit tests — deadline maths, timezone, holiday, formatting, fine amounts
npm run test:freeze:flow   # 62 integration tests against in-memory MongoDB
npm run test:finance:payroll  # 30 checks — includes recovering fines from pay
```

Note `visits.flow.test.ts` sets `RIDER_FREEZE_ENABLED=false`. It drives check-in at the
real wall-clock time, so with the rule active every case in it would pass before 12:30 PKT
and fail after. The freeze's own suite controls the clock explicitly instead.

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

The fine suite proves: a freeze raises one Rs. 200 outstanding fine and names it in the
refusal, the flag and the stored reason; a repeated sweep never charges twice; a rider's
own amount is used instead of the default and `0` freezes without fining; setting an amount
re-prices today's fine but never a waived one; waiving keeps the row and leaves the freeze;
unfreezing leaves the fine; outstanding totals add up across days; and the admin queue and
banner report the same rupees the fines hold.
