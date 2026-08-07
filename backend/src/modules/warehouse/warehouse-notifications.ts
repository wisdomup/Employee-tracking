import { Types } from 'mongoose';
import { BroadcastNotificationModel } from '../../models/broadcast-notification.model';
import { UserModel } from '../../models/user.model';
import { WarehouseModel } from '../../models/warehouse.model';
import { ROLES } from '../../constants/global';

/**
 * System notifications for warehouse events, delivered through the broadcast inbox that already
 * exists — so the bell, the unread badge and the inbox modal work with no new UI plumbing.
 *
 * Every emitter is fire-and-forget: a notification failing must never fail the stock operation that
 * triggered it. Same shape as `logActivityAsync`.
 */

interface NotifyInput {
  title: string;
  description: string;
  /** Deep link the inbox renders as an "Open" button. */
  link?: string;
  recipientIds: (string | Types.ObjectId)[];
  /** Set to make the notification idempotent — a repeat with the same key is silently dropped. */
  eventKey?: string;
}

function fireAndForget(work: () => Promise<unknown>): void {
  setImmediate(() => {
    work().catch((err) => console.error('Failed to raise warehouse notification:', err));
  });
}

async function raise(input: NotifyInput): Promise<void> {
  const recipients = [...new Set(input.recipientIds.map((id) => String(id)))].filter(Boolean);
  if (recipients.length === 0) return;

  try {
    await BroadcastNotificationModel.create({
      title: input.title,
      description: input.description,
      // Always `specific_users`: recipients are resolved from the event (this warehouse's staff,
      // the admins) rather than chosen by a person, so a role-wide audience would over-notify.
      audienceType: 'specific_users',
      targetUserIds: recipients.map((id) => new Types.ObjectId(id)),
      source: 'system',
      ...(input.link ? { link: input.link } : {}),
      ...(input.eventKey ? { eventKey: input.eventKey } : {}),
      startAt: new Date(),
    });
  } catch (err) {
    // 11000 on `eventKey` means this alert already exists — exactly what the key is for.
    if (err && typeof err === 'object' && (err as { code?: number }).code === 11000) return;
    throw err;
  }
}

/** Every active admin — the approval queue is theirs. */
async function adminIds(): Promise<string[]> {
  const admins = await UserModel.find({
    role: ROLES.ADMIN,
    isActive: true,
    isTrashed: { $ne: true },
  })
    .select('_id')
    .lean();
  return admins.map((a) => String(a._id));
}

/** Staff and managers attached to a warehouse, plus company-wide managers. */
async function warehouseStaffIds(warehouseId: string | Types.ObjectId): Promise<string[]> {
  const users = await UserModel.find({
    isActive: true,
    isTrashed: { $ne: true },
    $or: [
      { warehouseId: new Types.ObjectId(String(warehouseId)) },
      // A manager with no warehouse set is company-wide, so they want to know too.
      { role: ROLES.WAREHOUSE_MANAGER, warehouseId: { $exists: false } },
    ],
  })
    .select('_id')
    .lean();
  return users.map((u) => String(u._id));
}

async function warehouseName(id: string | Types.ObjectId): Promise<string> {
  const w = await WarehouseModel.findById(id).select('name').lean();
  return w?.name ?? 'a warehouse';
}

// ---------------------------------------------------------------------------- transfers

export function notifyTransferPending(transfer: {
  _id: unknown;
  documentNo?: number;
  fromWarehouseId: unknown;
  toWarehouseId: unknown;
}): void {
  fireAndForget(async () => {
    const [from, to, admins] = await Promise.all([
      warehouseName(String(transfer.fromWarehouseId)),
      warehouseName(String(transfer.toWarehouseId)),
      adminIds(),
    ]);
    await raise({
      title: `Transfer #${transfer.documentNo ?? ''} needs approval`,
      description: `${from} wants to send stock to ${to}. Nothing moves until you approve it.`,
      link: `/warehouse/transfers/${String(transfer._id)}`,
      recipientIds: admins,
    });
  });
}

export function notifyTransferApproved(transfer: {
  _id: unknown;
  documentNo?: number;
  fromWarehouseId: unknown;
  toWarehouseId: unknown;
  createdBy: unknown;
}): void {
  fireAndForget(async () => {
    const [from, to, destinationStaff] = await Promise.all([
      warehouseName(String(transfer.fromWarehouseId)),
      warehouseName(String(transfer.toWarehouseId)),
      warehouseStaffIds(String(transfer.toWarehouseId)),
    ]);
    await raise({
      title: `Transfer #${transfer.documentNo ?? ''} approved — stock is on the way`,
      description: `Stock has left ${from} for ${to}. Confirm what actually arrives when it gets there.`,
      link: `/warehouse/transfers/${String(transfer._id)}`,
      recipientIds: [...destinationStaff, String(transfer.createdBy)],
    });
  });
}

export function notifyTransferMismatch(transfer: {
  _id: unknown;
  documentNo?: number;
  toWarehouseId: unknown;
  shortfall: number;
}): void {
  fireAndForget(async () => {
    const [to, admins] = await Promise.all([
      warehouseName(String(transfer.toWarehouseId)),
      adminIds(),
    ]);
    await raise({
      title: `Transfer #${transfer.documentNo ?? ''} arrived short`,
      description:
        `${to} received ${transfer.shortfall} piece(s) fewer than were sent. Only what arrived was ` +
        'added to their stock; the shortfall is held in transit until you decide whether to write it ' +
        'off or return it to the source.',
      link: `/warehouse/transfers/${String(transfer._id)}`,
      recipientIds: admins,
    });
  });
}

// ---------------------------------------------------------------------------- damage / claim

export function notifyDamageClaimPending(claim: {
  _id: unknown;
  documentNo?: number;
  warehouseId: unknown;
  source: string;
  clientName?: string;
  totalPieces: number;
}): void {
  fireAndForget(async () => {
    const [name, admins] = await Promise.all([
      warehouseName(String(claim.warehouseId)),
      adminIds(),
    ]);
    const kind = claim.source === 'client_claim' ? 'Client claim' : 'Internal damage';
    await raise({
      title: `${kind} #${claim.documentNo ?? ''} needs approval`,
      description:
        `${name} has flagged ${claim.totalPieces} piece(s)` +
        (claim.clientName ? ` returned by ${claim.clientName}` : '') +
        '. Stock does not move until you approve it.',
      link: `/warehouse/damage/${String(claim._id)}`,
      recipientIds: admins,
    });
  });
}

// ---------------------------------------------------------------------------- stock count

export function notifyStockCountSubmitted(count: {
  _id: unknown;
  documentNo?: number;
  warehouseId: unknown;
  differenceCount: number;
}): void {
  fireAndForget(async () => {
    const [name, admins] = await Promise.all([
      warehouseName(String(count.warehouseId)),
      adminIds(),
    ]);
    await raise({
      title: `Stock count #${count.documentNo ?? ''} submitted for ${name}`,
      description:
        count.differenceCount > 0
          ? `${count.differenceCount} product(s) differ from the system figure. Review and approve to apply the corrections.`
          : 'The physical count matches the system exactly. Approve to close it off.',
      link: `/warehouse/stock-count/${String(count._id)}`,
      recipientIds: admins,
    });
  });
}

// ---------------------------------------------------------------------------- stock levels

export function notifyLowStock(
  products: { productId: unknown; name: string; total: number; level: number }[],
): void {
  if (products.length === 0) return;
  fireAndForget(async () => {
    const admins = await adminIds();
    const worst = products.slice(0, 5).map((p) => `${p.name} (${p.total}/${p.level})`);
    await raise({
      title: `${products.length} product(s) are low on stock`,
      description:
        `Below their reorder level: ${worst.join(', ')}` +
        (products.length > 5 ? ` and ${products.length - 5} more.` : '.') +
        ' Levels are compared against total stock across all warehouses.',
      link: '/warehouse/reports?tab=stock&lowOnly=true',
      recipientIds: admins,
      // One alert per day, so a scheduled check does not re-notify every run.
      eventKey: `low-stock:${new Date().toISOString().slice(0, 10)}`,
    });
  });
}

export function notifyInsufficientStock(input: {
  warehouseId: unknown;
  productName: string;
  available: number;
  requested: number;
  salesmanName: string;
}): void {
  fireAndForget(async () => {
    const [name, admins] = await Promise.all([
      warehouseName(String(input.warehouseId)),
      adminIds(),
    ]);
    await raise({
      title: `Not enough stock at ${name}`,
      description:
        `${input.salesmanName} tried to sell ${input.requested} piece(s) of ${input.productName}, ` +
        `but ${name} only has ${input.available}. Transfer stock in, or change the order's source ` +
        'warehouse.',
      link: '/warehouse/reports?tab=stock',
      recipientIds: admins,
    });
  });
}
