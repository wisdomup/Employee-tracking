# Visit Check-In / Checkout Flow

Reference for the rider visit lifecycle: geofenced check-in, timed checkout, the
30-minute overstay flag, and the per-shop photo gallery.

> Scope note: this applies to the **`Employee-tracking`** repo only (`admin/` + `backend/`).
> The sibling `tracking-backend` project is legacy and must not be modified.

---

## 1. Why this changed

Riders used to mark a visit `completed` straight from a status dropdown. Nothing proved
they had ever been at the shop. The flow is now two gated steps:

```
todo / in_progress  ──[Check In]──►  checked_in  ──[Complete & Checkout]──►  completed
                     GPS within                    shop photo + selfie
                     150 m of shop                 + GPS, duration measured
                                                            │
                                                            ├─► >30 min ⇒ overstayFlagged
                                                            │
                                                            └─► optional shop photos + notes
                                                                (client photo gallery)
```

A rider **cannot** reach `completed` without passing through `checked_in`.

---

## 2. Status model

| Status | Meaning |
| --- | --- |
| `todo` | Scheduled, not started |
| `in_progress` | Rider is en route (optional; not required) |
| `checked_in` | **New.** Rider verified on-site by GPS; the clock is running |
| `completed` | Checked out with photos; duration recorded |
| `incomplete` | Rolled over unfinished by the nightly cron |
| `cancelled` | Called off |

---

## 3. Business rules

All rules live in **`backend/src/modules/visits/visits.rules.ts`** as pure functions with
no database access, so they are unit-testable in isolation.

| Constant | Value | Meaning |
| --- | --- | --- |
| `CHECK_IN_RADIUS_METRES` | `150` | Max distance from the shop to check in |
| `VISIT_DURATION_LIMIT_MINUTES` | `30` | Allowed time at the shop before flagging |

- `haversineMetres()` / `evaluateCheckInProximity()` — geofence maths.
- `checkInGuard(status)` — blocks double check-in, and check-in on
  completed / cancelled / incomplete visits.
- `completeGuard(status, isAdmin)` — a **non-admin must be `checked_in`**. Admins may
  complete from any non-completed state (back-office correction).
- `evaluateVisitDuration(checkedInAt, completedAt)` — returns `{ durationMinutes, overstay }`.
  - No `checkedInAt` ⇒ `durationMinutes: null`, never flagged (admin completion).
  - Exactly 30 min is **not** flagged; the limit is inclusive. 31 min is flagged.
  - Seconds round to the nearest minute.
  - A checkout earlier than the check-in clamps to `0` rather than going negative.

Changing the radius or the time limit means editing those two constants. The admin UI
mirrors them from `admin/services/visitService.ts` — keep both sides in sync.

---

## 4. Data model — `backend/src/models/visit.model.ts`

| Field | Type | Notes |
| --- | --- | --- |
| `checkedInAt` | `Date` | Check-in time |
| `checkedInLatitude` / `checkedInLongitude` | `Number` | Where the rider checked in |
| `completedAt` | `Date` | **Checkout** time |
| `durationMinutes` | `Number` | Minutes between check-in and checkout |
| `overstayFlagged` | `Boolean` | `true` when the stay exceeded the limit |
| `completionImages` | `[{ type: 'shop' \| 'selfie', url }]` | Mandatory proof at checkout |
| `galleryImages` | `[{ url, caption? }]` | **Optional** extra shop photos (max 10) |
| `visitNotes` | `String` | **Optional** description (max 2000 chars) |
| `galleryUpdatedAt` | `Date` | When the gallery entry was last saved |

Indexes added:

```js
{ overstayFlagged: 1, isTrashed: 1, completedAt: -1 }  // admin flag review
{ dealerId: 1, galleryUpdatedAt: -1 }                   // shop gallery lookups
```

### How the gallery is linked

Gallery data lives **on the visit**, which already references both parties:

```
Visit ──dealerId──► Dealer (the shop)
      ──employeeId─► User   (the rider who captured it)
```

So every photo and note is automatically attributed to a shop *and* a rider, with no
extra join table. `findDealerGallery(dealerId)` populates both.

---

## 5. API

| Method | Path | Who | Purpose |
| --- | --- | --- | --- |
| `PATCH` | `/api/visits/:id/check-in` | own visit | Body `{ latitude, longitude }`. 400 if outside 150 m, with the actual distance in the message |
| `PATCH` | `/api/visits/:id/complete` | own visit, must be `checked_in` | Body `{ latitude, longitude, completionImages }`. Computes duration + flag |
| `PATCH` | `/api/visits/:id/gallery` | own **completed** visit | Body `{ galleryImages?, visitNotes? }` |
| `GET` | `/api/visits/gallery?dealerId=` | any authed role | Shop gallery, newest first, rider populated |
| `GET` | `/api/visits/last?dealerId=` | any authed role | Most recent **completed** visit plus `daysAgo` |
| `GET` | `/api/visits?overstayFlagged=true` | admin | Only flagged visits |

> **Route ordering:** `GET /gallery` and `GET /last` are registered **before** `GET /:id` in
> `visits.routes.ts`. Moving either below would make Express parse `"gallery"` / `"last"` as a
> visit id.

### "Last visit" counts only `completed`

That is the only status meaning a rider physically checked in and checked out at the shop — a
`todo` visit that was generated by the cron and never worked is not a visit as far as the
shopkeeper is concerned. The age is counted in **calendar days**, not elapsed hours, so a checkout
at 23:00 yesterday reads as "yesterday" rather than "0 days ago", which is how both the rider and
the admin would say it. A shop that has never been visited returns `{ visit: null, daysAgo: null }`
— a normal answer, not a 404.

### Bypass that was closed

`PUT /api/visits/:id` previously let the status-only roles set `checked_in` or
`completed` directly, skipping the geofence entirely. Those roles are now restricted to
`in_progress`; the two verified endpoints above are the only way to reach the other
states. See `STATUS_ONLY_ROLES` in `visits.controller.ts`.

---

## 6. Admin visibility of the flag

When a visit exceeds the limit the backend does two things:

1. Sets `overstayFlagged: true` and `durationMinutes` on the visit.
2. Writes an activity log with `action: 'flagged'` and
   `meta: { reason: 'overstay', durationMinutes, limitMinutes, checkedInAt, completedAt }`,
   attributed to the rider's `employeeId`.

`'flagged'` was added to the `ActivityAction` enum in `activity-log.model.ts`. That type
had been **duplicated** inside `activity-logs.service.ts`; the duplicate was deleted and
the service now imports the single definition. Adding a new action to only one of the two
copies would have failed validation silently at runtime.

Surfaced in the UI at:

- **Visit detail** — red "Overstay flagged" banner naming the rider and the minutes, plus
  a "Time At Store" row.
- **Visits list** — ⚠️ Overstay badge beside the status, a "Time At Store" column, and an
  "Overstay flagged only" filter checkbox.
- **Rider's own screens** — a live counter (ticks every 30 s) that turns red past the
  limit and warns that the visit will be flagged.

---

## 7. Rider UI — `admin/pages/visits/[id]/edit.tsx`

The `order_taker` branch is a step-based flow, not a status dropdown:

- **Step 1 · Check in at the store** — shown for `todo` / `in_progress`. Captures GPS and
  calls the check-in endpoint. Rejection surfaces the real distance from the backend.
- **Step 2 · Complete the visit** — shown for `checked_in`. Live elapsed-time chip,
  camera-only shop photo + selfie, GPS captured on submit.
- **Step 3 · Shop photos & description (optional)** — opens automatically after a
  successful checkout. Up to 10 photos with thumbnails and per-photo remove, a 2000-char
  description, and **Skip** / **Save & Finish**. Reachable again later from the completed
  state via "Add shop photos & notes".

Admins keep the full edit form with the whole status list.

> **Gotcha:** the check-in and complete responses are *not* fully populated (no nested
> dealer/route/employee documents). The page re-fetches after each mutation instead of
> assigning the response to state — assigning it directly blanks the client and route names.

---

## 8. Where the gallery shows up

- **Client detail** (`admin/pages/clients/[id]/index.tsx`) — "Shop Photo Gallery" section,
  one card per entry with the rider's name, the timestamp, the notes, the photos, and a
  link back to the originating visit. The same page opens with a **Last Visit** banner
  (date, gap in plain words, rider, route), amber once the shop has gone more than a
  fortnight without one.
- **Visit detail** — "Shop Photos & Notes" for that single visit.

---

## 9. Tests

No test framework was configured, so tests are plain `ts-node` scripts using Node's
built-in `assert`. They exit non-zero on the first failure.

```bash
npm test               # both suites
npm run test:visits    # pure rules, no database
npm run test:visits:flow  # full flow against a throwaway in-memory MongoDB
npm run test:dashboard    # "last visit" + the dashboard cards that count visits
```

- **`visits.rules.test.ts`** — 24 assertions over the geofence maths, the status state
  machine, and the duration/flag boundaries (29 / 30 / 31 min, rounding, negative clamp).
- **`visits.flow.test.ts`** — integration test driving the real service functions against
  `mongodb-memory-server`, asserting on what is actually persisted: geofence rejection,
  ownership checks, "cannot complete without checking in", duration + flag values, the
  `overstayFlagged` filter, and gallery attribution to shop and rider.

`mongodb-memory-server` was added as a devDependency for this. It downloads a MongoDB
binary (~400 MB) on first run and caches it in `~/.cache/mongodb-binaries`; the first run
is therefore slow. Tests never touch the real database.

`src/**/*.test.ts` is excluded from `tsconfig.json` so tests stay out of `dist/`.

---

## 10. Deploying to existing data

The new fields are all optional, so no migration is required. Visits completed before
this change simply have no `checkedInAt`, `durationMinutes`, or `overstayFlagged`, and the
UI renders `-` for them. New indexes are created by Mongoose on startup.
