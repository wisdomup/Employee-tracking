# Warehouse & Stock Management

How stock actually works in Lightspeed Go, and the handful of rules you have to know before
touching any of it.

Before this module, stock was a single number per product (`Product.quantity`) and there was no
purchases module at all — the only way stock went up was an admin typing a number into the product
form. Now stock lives per warehouse, split into buckets, behind an append-only ledger.

---

## The three things that will bite you

### 1. `Product.quantity` is a derived mirror. Never write it.

It equals `Σ WarehouseStock.sellable` across every warehouse, and is recomputed after every
movement. It exists so that everything written before this module — the order stock check, all five
`stock-reports`, the products list, the dashboard — keeps working untouched.

Only `stock-ledger.service.ts#syncProductQuantityMirror` may write it. The products create/update
schemas no longer accept `quantity`, and `products.service.ts` strips it defensively, because the
admin edit form used to re-send the figure it read at page load: saving a description twenty minutes
later reset stock to a stale number. That was the worst drift path in the app.

### 2. All stock movement goes through one function.

`backend/src/modules/warehouse/stock-ledger.service.ts#applyStockMovements` is the only place
allowed to touch `WarehouseStock` or `Product.quantity`. Calling it gets you:

- **Non-negative stock** — a guarded `$inc` with `{ [bucket]: { $gte: qty } }`, not a read-then-write
  check. This is why the balance document exists at all: that predicate needs a materialised number
  on one document, so a ledger-only design would race.
- **All-or-nothing multi-line application** — if line 5 of 5 fails, lines 1–4 are compensated back.
- **Replay safety** — a unique `idempotencyKey` per ledger row.
- **An audit row per bucket change**, with actor, reason and business date.
- **The mirror and the weighted-average cost** kept in step.

If you find yourself reaching for `WarehouseStockModel.updateOne`, add a movement type instead.

### 3. The idempotency key is what replaces a transaction.

Production is Atlas, so transactions work — but migrations default to standalone localhost and
`mongodb-memory-server` is standalone, so a transactional path would be untestable. Hence
`utils/mongo-session.ts#withOptionalTransaction`: use a session when the deployment has one, fall
back to compensation when it does not. **Correctness lives in the compensating path.** Do not write
anything that only works inside a transaction.

The key is `refType:refId[:scope]:type:warehouseId:productId:bucket`. Note the discriminator is
(warehouse, product, bucket), *not* `refLine` — lines are merged by exactly that triple, and an
earlier version keyed on `refLine` made every multi-line movement collide with itself and look like
a replay. Use `idempotencyScope` when one document legitimately moves stock more than once
(`approve`, `receive`, `cancel`, `update:<updatedAt>`).

---

## Buckets

Per `(warehouseId, productId)`, one `WarehouseStock` document holds three numbers:

| Bucket | Meaning |
|---|---|
| `sellable` | Good stock, ready to sell. This is what the mirror sums. |
| `damaged` | Damaged or claimed, set aside, not for sale. |
| `inTransit` | Left this warehouse on an approved transfer, not yet received anywhere. |

Stock is always counted in **pieces**, never cartons — a carton can have missing or extra pieces. The
ledger rejects non-integer deltas outright.

### Invariants

Two equalities must hold at all times:

```
A.  Product.quantity           === Σ WarehouseStock.sellable   (across all warehouses)
B.  WarehouseStock[bucket]     === Σ StockMovement.delta       (for that warehouse+product+bucket)
```

`GET /api/warehouse/maintenance/integrity` checks both, the daily cron logs a violation, and
`npm run reconcile:stock` reports and repairs. A non-empty result means some write path bypassed the
ledger service. **A is repairable** (the mirror is derived). **B is not auto-repaired** — a balance
that disagrees with its own ledger needs a human, and overwriting either number destroys the
evidence.

---

## Flows

### Stock In

Deliberately not a purchase order: no supplier master, no approval step, `supplierName` is free
text. Every receipt lands in the **Main** warehouse and stock is transferred out from there. The
document number is allocated *after* the stock moves, so a failed receipt never punches a permanent
gap in the printed series.

#### The three exits from a wrong receipt

All three are guarded by the same `$inc` predicate, so **any of them is refused once the pieces
have been sold or transferred out of Main** — there is nothing left to take back, and the correct
answer is to raise a damage claim or a new receipt rather than rewrite history.

| Exit | Who | What happens |
|---|---|---|
| **Cancel** | admin, `warehouse_manager` | Stock reversed, row kept and marked `cancelled` with a reason. |
| **Edit** | admin only | Lines replaced, ledger reversed and re-posted, document number unchanged. |
| **Delete** | admin only | Stock reversed, row trashed and gone from every list and report. |

**Edit is a reverse-and-repost, not a quantity diff.** Moving only the difference per product is
the obvious implementation and it is wrong the moment a *rate* changes: the weighted average is
rebuilt from the live `stock_in` rows, so leaving the original row in place would keep the wrong
rate weighting the cost for ever. Reversing every original row — each carrying its `reversalOf`
pointer — drops them all out of the average, and the new rows enter it at the corrected rates. A
quantity-only edit takes the same path.

It is necessarily **two ledger calls**. `normaliseLines` merges lines by
(warehouse, product, bucket) regardless of type, so a −10 reversal and a +12 re-post of the same
product inside one call would collapse into a single +2 row and lose the reversal pointer. The
reversal goes first, because it is the one that can legitimately fail; if the re-post then fails
anyway, the original lines are put back under an `edit-restore:` scope before the error surfaces.
The idempotency scope carries the receipt's pre-edit `updatedAt`, which is unique per edit and
identical across retries of the same one.

**The rollback must burn the stamp.** A restored attempt saves nothing, so `updatedAt` has not
moved and a retry would reuse the same scope — at which point `edit-reverse:<stamp>` is a *replay*,
short-circuits, and moves no stock, while the re-apply lands on top of the pieces the rollback just
put back and doubles them. `lastEditFailedAt` is written for exactly this reason (the audit value
is a bonus): saving it moves `updatedAt` on, so the retry reverses for real. A genuinely
double-submitted *successful* edit still short-circuits as it should. Both directions are pinned by
`warehouse.flow.test.ts`.

One consequence for the shared ledger helper: `findPostedMovementIds` now sorts by `_id`. A
document used to post one row per (product, bucket), so the map it builds had a single candidate;
a receipt that can be edited posts several against the same `refId`, and without the sort the
winner was whichever row the query planner happened to return first.

**Delete is a soft delete.** Every `StockMovement` this receipt made references it by `refId`, so
dropping the document would leave the audit trail pointing at nothing. `isTrashed` hides it from
the list, the reports and the slip; the ledger stays explainable.

`editCount`, `lastEditedBy`, `lastEditedAt` and `editReason` on the receipt record the correction
trail, and the reason is mandatory on edit — the old figures were already printed on a slip that
went out with the goods.

### Transfers — stock leaves the source at APPROVAL

This is the design decision worth remembering. Between approval and receipt the goods are on a
truck, so they must not be sellable anywhere: approval moves `sellable → inTransit` at the source. If
the source only decremented at receipt, an order routed there could consume pieces that had
physically gone.

| Step | Source | Destination |
|---|---|---|
| create | — | — |
| admin approve | `sellable −q`, `inTransit +q` | — |
| received == sent | `inTransit −received` | `sellable +received` → `completed` |
| received < sent | `inTransit −received`, shortfall **stays parked** | `sellable +received` → `mismatch` |
| received > sent | **rejected** — it would create stock from nothing | |
| resolve `write_off` | `inTransit −diff` | — |
| resolve `return_to_source` | `inTransit −diff`, `sellable +diff` | — |

A shortfall is never absorbed silently. It sits in the source's `inTransit` bucket until an admin
decides, which makes unresolved losses a queryable list rather than a rounding error.

Known cost: approved-but-unreceived stock drops out of the mirror, so a long transfer can trip a
spurious low-stock alert. The Stock on Hand report shows the `inTransit` column so it is explainable.

### Damage / Claim

Creating an entry moves **no stock**. Only an admin approval moves pieces `sellable → damaged`; a
rejection changes nothing. Approval also refuses when `approverId === createdBy`, because approval is
the only control on a write-off — the one operation that makes stock disappear without a sale.

`internal_damage` has no client. `client_claim` requires `clientName`, because the damage report
exists to answer who returned the goods.

### Stock count — the one deliberate deviation from the spec

The spec says approval "updates system stock to match the physical count". Taken literally that would
erase every sale, transfer and receipt between submission and approval.

So each line stores `systemSellable`/`systemDamaged` **as at submission**, and approval applies the
**delta** (`counted − systemAtSubmission`). Any line whose live figure moved in the meantime is
returned in `drift` and surfaced on the approval screen — the intervening movements are real, and so
is the counter's variance.

A partial count stores the products it covered and the approval loop iterates *that* list, never the
product catalogue, so an uncounted product is not read as "zero".

### Sales

The source warehouse is resolved from the salesman's `address.city`, matched against
`Warehouse.cityKey` through the same `normalizeCityKey` the region-sales dashboard uses. Precedence:
`User.warehouseId` → city match → Main. Resolution never returns "nowhere"; a blank or unmatched city
falls back to Main and says why, and two warehouses in one city is treated as a configuration error
(deterministic pick, plus a flag) rather than a silent first-match.

Only an admin can override it, and changing it on a live order is a compensating pair of movements
(reverse at the old warehouse, take from the new one) in a single ledger call — so total stock never
changes even if the second leg is short.

Stock is still consumed at `pending`, as it was before this module. That was left alone deliberately:
changing when stock is taken is a behaviour change for the sales team, not a warehouse concern.

### Returns

A plain `return` credits **sellable** — nothing is wrong with the goods. A `damage` return credits
**damaged** with no sellable leg (the goods came back from the client and were never in our sellable
stock) and also mints an already-approved `client_claim` `DamageClaim` linked by `linkedReturnId`.
Without that bridge, client damage would only ever appear in the returns module and never in the
damage/claim report.

Note the migration does **not** backfill historic damage returns into the damaged bucket: they never
touched `Product.quantity`, so those pieces do not exist in stock, and creating them would invent
inventory. The damage report therefore shows two eras.

---

## Costing

`Product.purchasePrice` is now the running **weighted-average cost**, maintained by Stock In. It is
still the P&L cost basis and still admin-only in API responses.

The authoritative writer is `averageCostFromReceipts` — `Σ(qty × rate) / Σ(qty)` over every live
receipt — not the incremental formula. That form is order-independent and stays correct after a
receipt is cancelled, whereas folding the incremental formula backwards is not invertible once later
receipts have landed.

Only `opening_stock` and `stock_in` movements may carry a `unitCost`; `applyStockMovements` rejects it
on anything else. That is what structurally guarantees transfers, sales, damage write-offs and count
adjustments can never shift the average.

Edge cases worth knowing: a zero-rate line is excluded from the weighting (a free sample would
otherwise crater the average), an unpriced opening balance is *replaced* by the first real receipt
rather than averaged against, and a positive count adjustment enters at the existing average.

**Order lines snapshot `unitCost` when the stock moves.** Without it, the P&L would multiply by the
live average — which now changes on every goods receipt — so last month's reported profit would move
whenever someone booked a delivery. The P&L aggregation prefers the snapshot and falls back to the
live lookup for legacy rows.

---

## Roles and scoping

| Role | Scope |
|---|---|
| `admin` | Everything, including every approval. |
| `warehouse_manager` | Scoped to `User.warehouseId` if set; **company-wide if not**. Can cancel documents. |
| `warehouse_staff` | Always scoped to `User.warehouseId`. Raises documents, never approves them. |

`warehouse-scope.ts` fails **closed**: a `warehouse_staff` account with no `warehouseId` is locked
out of the module rather than handed every warehouse. This is the deliberate opposite of
`resolveCityScope` in `users.service.ts`, which fails open — that one governs a read-only client
list, this one governs stock writes.

`admin/utils/permissions.ts` has no backend counterpart. Route-level truth lives in each
`*.routes.ts`, and anything needing "…but only at YOUR warehouse" is additionally scoped inside the
service. Frontend gating is UX only.

Admin-only permission keys (`transfers:approve`, `damage:approve`, `stock-count:approve`,
`warehouses:manage`, `opening-stock:manage`, `stock:set-low-level`, `orders:set-source-warehouse`)
appear in **no** permission Set — `can()` returns true for `admin` before consulting any Set, so
`can(role, 'transfers:approve')` is an exact admin test and pages express that through `can()`
instead of hardcoding a role comparison.

---

## Operational notes

### Going live

```bash
npm run migrate:warehouse-bootstrap              # dry run — reports, changes nothing
npm run migrate:warehouse-bootstrap -- --apply   # write
```

Take a database snapshot first. The migration is re-runnable (`$setOnInsert` on the balances, a
unique `idempotencyKey` per opening movement) but not undoable — the opening movements it writes are
the audit trail.

The one rule to have in mind while reading it: `Main.sellable = coalesce(Product.quantity, 0)` is the
*post-decrement* figure, so pre-existing open orders are treated as **already consumed**. They get
stamped with Main and write no movement. Writing one would double-count them.

### Ongoing

- `npm run reconcile:stock` — drift report; `-- --apply` rebuilds the mirror.
- `GET /api/warehouse/maintenance/integrity` — the same check over HTTP.
- The daily cron (`jobs/low-stock.cron.ts`, `LOW_STOCK_CRON_*`) raises low-stock notifications and
  logs any integrity drift.

### Low-stock level

Reuses `Product.survivalQuantity`, compared against total sellable stock **across all warehouses**,
because the spec is explicit that it is one figure per product. A consequence worth knowing: a
product can be fine company-wide while one warehouse is empty. The per-warehouse picture is on
Warehouse → Reports → Stock on Hand.

### Notifications

System events reuse `BroadcastNotification` with `source: 'system'` and a deep `link`, so the existing
inbox bell works with no new UI. They are a log, not a message someone composed — the API refuses to
edit or delete them. `eventKey` makes recurring alerts idempotent (one low-stock notice per day).

---

## Report overlap with `/stock-reports`

The two report pages answer different questions and are both kept:

- `/stock-reports` is **sales-side** (`Order`/`Return`-derived), admin-only, and exposes P&L.
  Its `damage` tab is dealer *return* damage — renamed "Return Damage" to distinguish it — and its
  `current` tab now shows the all-warehouse total.
- `/warehouse/reports` is **ledger-side**, visible to warehouse staff and managers for their own
  warehouse, and covers stock on hand, movement history, transfers, damage/claim, monthly count and
  valuation.

`getCurrentStockReport.onHoldQty` is computed across all orders regardless of warehouse, and stock is
consumed at `pending`, so "on hold" was already decorative before this module. It is left alone.

---

## Things left open

1. **`rate: 0` on a Stock In line** — free sample or fat finger? Currently excluded from cost
   weighting. The cleaner answer is `rate > 0` required plus an explicit `isFreeSample` flag.
2. **The legacy damage report** double-counts against the new one for anyone comparing them (mitigated
   by `linkedReturnId` and the tab rename). Retiring it, or repointing P&L at `DamageClaim`, is a
   decision for the client.
3. **Opening stock has no unlock** — correct a mistake by cancelling the entry, which frees the
   one-time slot.
4. **Best sellers** also exists on `/reports` via `dashboardService.getReports({viewBy:'item'})`. If a
   `warehouseId` filter is added there, the warehouse valuation tab could link across instead.
5. **Legacy order restores concentrate in Main** — cancelling a pre-migration order returns stock to a
   *resolved* warehouse, not where the goods physically came from, because there was no per-warehouse
   notion at the time.
