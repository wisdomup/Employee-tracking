/**
 * Purchase cost (`purchasePrice`) is admin-only in API responses.
 * Controllers call these helpers before `res.json(...)` for non-admin roles.
 */

export function shouldExposeProductPurchasePrice(role: string | undefined): boolean {
  return role === 'admin';
}

function toPlainObject(doc: unknown): Record<string, unknown> {
  if (!doc || typeof doc !== 'object') return {};
  const d = doc as { toObject?: () => Record<string, unknown> };
  if (typeof d.toObject === 'function') {
    return d.toObject();
  }
  return { ...(doc as Record<string, unknown>) };
}

export function serializeProductForRole(
  doc: unknown,
  role: string | undefined,
): Record<string, unknown> {
  const plain = toPlainObject(doc);
  if (shouldExposeProductPurchasePrice(role)) return plain;
  const { purchasePrice: _omit, ...rest } = plain;
  return rest;
}

export function serializeProductsForRole(
  docs: unknown[],
  role: string | undefined,
): Record<string, unknown>[] {
  return docs.map((p) => serializeProductForRole(p, role));
}

export function serializeOrderForRole(doc: unknown, role: string | undefined): Record<string, unknown> {
  const order = toPlainObject(doc);
  if (shouldExposeProductPurchasePrice(role)) return order;
  if (!Array.isArray(order.products)) return order;
  order.products = order.products.map((line: unknown) => {
    if (!line || typeof line !== 'object') return line;
    const l = { ...(line as Record<string, unknown>) };
    const pid = l.productId;
    if (pid && typeof pid === 'object' && !Array.isArray(pid)) {
      l.productId = serializeProductForRole(pid, role);
    }
    return l;
  });
  return order;
}

export function serializeOrdersForRole(
  docs: unknown[],
  role: string | undefined,
): Record<string, unknown>[] {
  return docs.map((o) => serializeOrderForRole(o, role));
}

export function serializeReturnForRole(doc: unknown, role: string | undefined): Record<string, unknown> {
  const ret = toPlainObject(doc);
  if (shouldExposeProductPurchasePrice(role)) return ret;
  if (!Array.isArray(ret.products)) return ret;
  ret.products = ret.products.map((line: unknown) => {
    if (!line || typeof line !== 'object') return line;
    const l = { ...(line as Record<string, unknown>) };
    const pid = l.productId;
    if (pid && typeof pid === 'object' && !Array.isArray(pid)) {
      l.productId = serializeProductForRole(pid, role);
    }
    return l;
  });
  return ret;
}

export function serializeReturnsForRole(
  docs: unknown[],
  role: string | undefined,
): Record<string, unknown>[] {
  return docs.map((r) => serializeReturnForRole(r, role));
}
