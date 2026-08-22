# User Roles &amp; Permissions

The admin-editable permission matrix: roles × modules × actions, plus a separate per-report
access layer.

> Scope note: this applies to the **`Employee-tracking`** repo only (`admin/` + `backend/`).
> The sibling `tracking-backend` project is legacy and must not be modified.

---

## 1. What replaced what

Permissions used to be hardcoded in two places that could disagree, and did:

| Before | After |
| --- | --- |
| `requireRoles('admin', 'order_taker')` at 223 route call sites | `requirePermission('orders:edit')`, resolved from the database |
| Per-role `Set`s in `admin/utils/permissions.ts` | `GET /api/permissions/me`, resolved by the same code as the backend |
| A single `role` string per user | `roles: string[]`, with `role` kept as the primary |
| Reports gated by role, or not at all | 48 individually-grantable reports |

The disagreement was not theoretical, and it was not small. An automated parity check
(§9) found the two models differed on **119 endpoint/role pairs**. The admin panel granted
`warehouse_manager` the `stock-in:cancel`, `transfers:cancel` and `damage:cancel` permissions
while every one of those backend routes required admin — the buttons rendered and returned 403.

The seed mirrors the **backend guards**, because those are what actually decided access.

---

## 2. Roles

Six roles ship. **Code identifiers are unchanged**; only the display names are the Seetrack
ones. Renaming `order_taker` would have touched 36 guards and every user record for no
functional gain.

| Display name | Code role | What they do |
| --- | --- | --- |
| Admin | `admin` | Everything. Not editable — see §6 |
| Manager / Dept Head | `sales_manager` | Supervises field staff via `managerId`; analytics and targets |
| Warehouse Manager | `warehouse_manager` | Company-wide warehouse operations |
| **Salesman** | `order_taker` | Route visits, geofenced check-in/out, books orders in-shop |
| **Rider / Delivery Boy** | `delivery_man` | Delivery, cash collection, recovery, settlement — **and** order-taking |
| Warehouse Staff | `warehouse_staff` | Day-to-day stock work at one warehouse |
| *(legacy)* | `employee` | Hidden from the picker. Existing accounts keep working; new self-registrations land here with the minimum |

Accountant arrives with the Finance module.

### "Rider" means two different people in this codebase

Worth knowing before reading anything else here. `RiderBottomNav.tsx` serves `delivery_man`,
while [visit-checkin-checkout-flow.md](visit-checkin-checkout-flow.md) and the freeze module
both call `order_taker` "the rider", and `GET /collections/riders` returns `delivery_man`s.

They are genuinely different jobs:

| | Salesman `order_taker` | Rider `delivery_man` |
| --- | --- | --- |
| Daily loop | Route visits → GPS check-in within 150 m → timed stay → checkout with photos | Assigned orders → packed → delivered → cash → recovery → settlement |
| Handles cash | No | Yes |
| Late-start freeze | **Yes**, 12:30 PM deadline | Never |

### Rider order-taking

The requirement "a rider can take orders too" is seeded as `orders:view/add/edit` on
`delivery_man` — the order-booking subset, deliberately **not** the salesman's visit flow.
Riders gain no visit permissions beyond what they already had, so they are not running
geofenced route visits and are not swept by the late-start freeze. Widen the seed if riders
are meant to run routes as well.

This is the **only** deliberate grant in the whole migration. Everything else preserves
existing access exactly, and the parity test in §9 enforces that.

---

## 3. The two-layer rule

The matrix answers exactly one question: *may this role touch this module with this action at
all?*

It does **not** replace the state and ownership guards in the services. "Only while pending",
"own visit only", "not yet approved" all still run afterwards and can still refuse. Both layers
must pass.

A Salesman granted `orders:edit` still cannot edit a delivered, invoiced order, because the
order service refuses it for reasons that have nothing to do with roles. Folding those rules
into the matrix would hand Admin a checkbox that appears to permit rewriting invoiced history.

---

## 4. Catalogue

`backend/src/constants/permissions.ts` is the single source of truth for both sides.

**27 modules × 5 actions = 108 valid cells** (not 135: actions a module does not support are
excluded). Actions are View / Add / Edit / Delete / Change.

Cells for unsupported actions render as greyed `n/a`, never as unchecked boxes — an Admin must
be able to tell "not allowed" from "cannot be allowed".

### The warehouse split

The warehouse is five modules (`warehouse`, `stock-in`, `transfers`, `damage`, `stock-count`),
not one. With a single module, "receive a transfer" and "approve a write-off" would collapse
into the same `change` tick, and warehouse staff need receive — so granting it would silently
let a storeman approve their own damage claims.

**Known limit of the five-action model.** Within one document type, approve / receive / cancel
are all `change` and cannot be separated by the matrix alone. Where that distinction carries
money, the route keeps `requireAdmin()`:

- `approveTransfer`, `rejectTransfer`, `resolveTransferMismatch`, `cancelTransfer`
- `approveDamageClaim`, `rejectDamageClaim`
- `approveStockCount`, `rejectStockCount`
- every collection correction and void, and `receiveSettlement`
- `adminCreate` on attendance (raising a record for someone else)

---

## 5. Reports

**48 reports across six surfaces**, each individually grantable:

| Surface | Count |
| --- | --- |
| `/reports` — dashboard KPI drill-downs | 9 |
| `/analytics` — performance drill-downs | 24 |
| `/warehouse/reports` | 6 |
| `/stock-reports` | 5 |
| `/collection` | 3 |
| `/region-sales` | 1 |

Report ids **must** match the `metric` values the drill-down endpoints accept —
`requireReportFrom` builds the id straight from the query parameter, so a metric missing from
the catalogue is a report only Admin can ever open. `npm run test:permissions` asserts the two
lists agree in both directions.

### View-only, everywhere

No export, print or download on any report, for any role including Admin. The CSV/PDF control
was removed from `components/UI/Table.tsx` rather than flag-disabled, so it cannot be switched
back on by accident. The `export*` props remain accepted-and-ignored because ~20 pages pass them.

**Operational documents are not reports** and keep their print path:

- Order invoice — `pages/orders/[id]/index.tsx`
- Warehouse stock-in / transfer / damage slips
- The product catalog download

Riders and warehouse staff hand those to customers on paper.

**The honest limit:** this removes the button, not the data. The report APIs still return JSON
to anyone with a valid token and browser dev tools. Closing that means removing the server-side
export endpoints — a separate, deliberate decision that has not been made.

---

## 6. Resolution order

`backend/src/services/access-control.service.ts`:

1. **`admin`** → everything, without touching the database.
2. **One role** → that role's policy.
3. **Two or more roles** → the active `PermissionProfile` whose combination matches exactly.
4. **Two or more roles, no matching profile** → **the primary role's policy only.**

Step 4 needs the explanation. The obvious fallbacks are both wrong: unioning the roles is the
auto-merge the requirement forbids, and denying everything locks out a real person because an
admin has not finished a configuration screen. Falling back to the primary role grants strictly
no more than a single-role user would, and leaves the person able to work. It warns in the
server log, flags `needsProfile` on role assignment, lists the gap on the admin screen, and
shows the affected user a banner.

### Why admin has no policy

A matrix able to revoke access to the matrix editor is a lockout waiting to happen. `admin`
short-circuits before any policy is read, `savePolicy` refuses `subjectKey: 'admin'`, and
`/settings/permissions` is `allowedRoles={['admin']}` rather than gated on a cell it controls.

### Why profiles rather than merged roles

Six roles produce 57 combinations at 108 cells each. A literal per-combination table is ~6,000
checkboxes nobody fills in, so those sets would sit empty and lock people out — the requirement
defeating itself. A profile is the same manual control expressed once instead of once per user:
Admin defines the combination, sets its matrix by hand, and assigns it wherever that mix occurs.
Nothing is merged automatically, which is the part that mattered.

---

## 7. Caching

Policies are read on every authenticated request and written a few times a month, so the whole
set is held in memory and dropped on write (`invalidateAccessCache()`).

The 60-second TTL is a backstop, not the mechanism: PM2 runs several workers, and a save
invalidates only the worker that handled it. If this ever moves behind more than a couple of
workers, replace the TTL with pub/sub invalidation rather than shortening it — a shorter TTL
just moves cost onto every request.

Within a request, `req.access` memoises the resolution so several guards on one route do not
re-resolve identically.

---

## 8. Bootstrap and seeding

`runAccessBootstrapOnStart()` runs **before the HTTP port is bound**. This is a safety net, not
an optimisation: the resolver returns "no permissions" for a role with no policy, so a process
booting against an empty collection locks out every non-admin with correct-looking 403s. That
can happen on a fresh database, a restored pre-feature backup, or a dropped collection.

The seed mirrors **exactly what each role could do before this change**, so the deploy changes
nobody's access and any later difference is a bug with a known-good baseline.

Existing policies are never overwritten — an admin's hand-tuned matrix survives every redeploy.

```bash
npm run seed:access            # fill gaps only
npm run seed:access -- --force # reset roles to shipped defaults (discards hand-tuning)
```

`ACCESS_BOOTSTRAP_ON_START=false` skips the boot-time run.

### The baseline grant

`GET /products`, `/categories`, `/catalogs` and the attendance check-in/out/note routes had **no
role guard at all** — any authenticated user could reach them. Putting a permission in front
without seeding it everywhere would have revoked access on deploy, so those keys are granted to
every role in `BASELINE_PERMISSIONS`. Admin can untick them; the point is that the starting
state matches today.

---

## 9. Testing

Three suites, cheapest first. All three run as part of `npm test`.

```bash
npm run test:permissions          # static: catalogue, seed and every route guard
npm run test:permissions:parity   # nobody gained or lost access vs. before the migration
npm run test:permissions:flow     # end-to-end against an in-memory MongoDB
```

### `test:permissions` — static (20 checks)

Reads source files, no database. Catalogue internally consistent; the seed references only real
modules and reports; every `requirePermission` / `requireReport` key in every route file exists;
no route still uses `requireRoles`; the drill-down metric lists and the report catalogue agree
in **both** directions; and the admin panel's `LEGACY_KEYS` map points at things that exist.

That last one matters more than it looks. A legacy mapping aimed at a key the catalogue lacks
fails silently and permanently — `can()` returns false for everyone but Admin, nothing throws,
nothing logs, the feature simply never appears.

### `test:permissions:parity` — the regression net (228 endpoints)

Compares who could reach each endpoint **before** the migration — frozen in
`pre-migration-access.json`, taken from the route files at the commit prior — against who can
reach it now, resolving the new guard through the seeded matrix. Both directions must be empty
apart from the entries in `INTENTIONAL`.

This is the check that justifies the whole "nothing changes on deploy" claim, and it is not
decorative. Its first run on the hand-written seed found **83 lost endpoints and 36 gained**.
See §13.

Do not regenerate the fixture to make a failing test pass. A difference is either a regression
or a deliberate change that belongs in `INTENTIONAL` with a reason.

### `test:permissions:flow` — behaviour (35 checks)

Real service functions against `mongodb-memory-server`. Seeding and re-seeding, admin bypass,
single-role resolution, the multi-role fallback, profile matching (including reversed order and
supersets), cache invalidation on save, full-replacement saves, the `role`/`roles` hook in both
directions, the backfill, and profile lifecycle.

One check exists purely to catch a language trap: `delete` collides with `Map.prototype.delete`
and with Mongoose's document `.delete()`. If either leaked through the resolver, `grant.delete`
would read as a function — truthy — and hand every role the delete permission on every module
they touch.

---

## 10. API

| Method | Path | Who |
| --- | --- | --- |
| `GET` | `/api/permissions/me` | any authenticated user — their own resolved grants |
| `GET` | `/api/permissions/catalogue` | admin |
| `GET`/`PUT` | `/api/permissions/roles/:role` | admin |
| `GET` | `/api/permissions/profiles` | admin |
| `POST` | `/api/permissions/profiles` | admin |
| `GET` | `/api/permissions/profiles/uncovered` | admin |
| `GET`/`PUT` | `/api/permissions/profiles/:id` | admin |
| `PATCH` | `/api/permissions/profiles/:id/active` | admin |
| `DELETE` | `/api/permissions/profiles/:id` | admin |
| `PUT` | `/api/permissions/users/:userId/roles` | admin |

`PUT` on a policy is a **full replacement**, not a patch: anything absent from `permissions` is
turned off. The editor always sends the complete grid, so a partial update would make unticking
a box mean nothing.

> **Route ordering:** `/profiles/uncovered` is registered **before** `/profiles/:id`. Moving it
> below would make Express parse `"uncovered"` as a profile id.

---

## 11. Frontend

`admin/utils/permissions.ts` no longer decides anything — it holds what the server resolved.

`can(role, key)` keeps its old signature (the role argument is ignored) so the 45 existing call
sites did not have to change in one commit, and `LEGACY_KEYS` translates the old vocabulary
(`orders:edit-pending`, `dealers:fix-location`, `stock:adjust`) to the new `module:action`
names. New code should use `can(undefined, key)` or `canViewReport(id)`.

`ProtectedRoute` gained `permission`, `report` and `reportPrefix` props. It waits for
`accessLoading` before deciding — treating "not loaded yet" as "denied" would bounce every
gated page to login on a hard refresh.

### Page gates

**44 pages gate on a permission, 9 on a report, 9 are open to any signed-in role, and 6 keep a
hardcoded `allowedRoles={['admin']}`.**

Those last six are listed in `ADMIN_ONLY_PAGES` in `permissions.rules.test.ts`, and the test
fails if any other page appears with a hardcoded role list. That guard matters: a page gated on
a role list is a page the matrix **cannot open**. Tick the permission, the sidebar shows the
link, the API allows the call — and the page still bounces the user to the dashboard.

`/dashboard` stays open to every signed-in role on purpose. It is where `ProtectedRoute` sends
anyone it refuses, so gating it on a permission would make a denied user bounce in a loop.

### Action buttons

Add / Edit / Delete controls are gated on their own cell, not on the page gate. Before this,
pages assumed "if you can open the screen you can do everything on it" — true when the page
gate was a role list matched to the backend, false the moment view / add / edit / delete became
separately grantable. Unticking "Orders → Add" worked (the API refused) but looked broken: the
button was still there and the click bounced.

Raw `user?.role === '…'` checks that remain are **data scoping**, not permission — "show me my
own visits", "filter the list to this rider". Those are correct as role checks and the backend
scopes the same way.

---

## 12. What the test pass found

The three suites in §9 were written after the implementation was "done". They found seven real
defects. Recording them because each one was invisible in the diff.

| # | Defect | Effect if shipped |
| --- | --- | --- |
| 1 | The seed was written from the frontend's permission Sets | **83 endpoints lost access, 36 gained.** The two models disagreed far more than expected |
| 2 | Approving an approval mapped to `approvals:edit` | A salesman could approve their own leave requests — they hold `edit` for their own un-approved ones |
| 3 | `GET /dashboard/stats` gated on the baseline `dashboard:view` | Company-wide totals — every employee, client and order — published to every role including riders |
| 4 | Correcting a shop's pin mapped to `dealers:edit` | Salesmen and riders handed the full dealer edit form: phone, category, route, active status |
| 5 | Opening stock reads gated on `warehouse:view` | Financial setup data exposed to warehouse staff; it was admin-only |
| 6 | `user.pre('validate')` always took `role` from `roles[0]` | Changing someone's primary role via the employee form silently reverted, with no error |
| 7 | Report tabs filtered in a `useMemo` with `[]` deps | Grants arrive after mount, so the memo ran against an empty set and **every tab vanished permanently** |

Two more were design faults rather than bugs:

- Multi-report pages gated on one arbitrary report from their surface, so a role granted only
  Profit &amp; Loss could not open the page containing it. Fixed with `reportPrefix`.
- The sidebar filtered against an empty grant set for one paint, so every user — admins
  included — watched the menu appear a beat late.

Two collapsed cells forced a genuine choice, and both were resolved toward the restrictive
side and recorded in the parity test's `INTENTIONAL` list:

- `GET /approvals/:id` had **no guard at all** — any authenticated user could read anyone's
  leave request by guessing an id — while the list beside it was admin + salesman only. One
  `approvals:view` cell now covers both.
- `warehouse:view` now spans the warehouse directory *and* `/stock/movements` and the last
  purchase rate, which is what the company paid. Sales managers had the former and not the
  latter. They lose the directory, which no UI ever showed them.

---

## 13. Known gaps

- **Create-employee** assigns a single primary role. Extra roles are added on the edit screen.
- **No audit trail on permission changes.** `AccessPolicy.updatedBy` is stored, but nothing
  writes an activity-log entry. For a permissions system "who granted this, and when" is
  usually the first question asked after something goes wrong.
- **The frontend's grants are fetched once per session.** Change someone's roles while they are
  signed in and the backend refuses their writes immediately — correctly — but their UI keeps
  offering the buttons until they refresh. Re-fetching `/permissions/me` on window focus would
  close it.
- **Swagger descriptions are stale.** Many still read "[Admin]" or "403 Forbidden — admin role
  required" on routes that are now matrix-driven. Cosmetic, but misleading to anyone reading
  `/api/docs`.
- **Admin-only form FIELDS are still role checks.** A handful of forms (orders create/edit,
  returns edit, approvals edit) hide individual inputs behind `isAdmin`. That is field-level
  visibility rather than module access, and the five-action model has no cell for it.
- **`settings` module** has no backend routes; it gates admin-panel screens only, and is
  exempted in the orphan check in `permissions.rules.test.ts`.
- **No browser-level per-role walkthrough.** The three suites cover the catalogue, the access
  parity and the resolver's behaviour against a real database. Signing in as each role and
  clicking through every screen is still manual, and is the remaining way to catch a screen
  that reads a permission the parity test cannot see.
- **The parity fixture is a point-in-time snapshot.** It records access as of the commit
  before the migration. Once new endpoints are added it covers less of the surface; that is
  fine and expected, but it means the test protects the migration, not the codebase forever.
