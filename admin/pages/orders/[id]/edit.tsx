import React, { useState, useEffect } from 'react';
import dynamic from 'next/dynamic';
import { useRouter } from 'next/router';
import Layout from '../../../components/Layout/Layout';
import ProtectedRoute from '../../../components/Auth/ProtectedRoute';
import { orderService, Order } from '../../../services/orderService';
import { clientService, Client, formatClientSelectLabel, getClientAssignedRouteId } from '../../../services/clientService';
import { routeService, Route } from '../../../services/routeService';
import { productService, Product } from '../../../services/productService';
import { useAuth } from '../../../contexts/AuthContext';
import { toast } from 'react-toastify';
import Loader from '../../../components/UI/Loader';
import DatePickerFilter from '../../../components/UI/DatePickerFilter';
import SearchableSelect from '../../../components/UI/SearchableSelect';
import styles from '../../../styles/FormPage.module.scss';

const OrderTermsEditor = dynamic(() => import('../../../components/OrderTermsEditor'), { ssr: false });

interface LineItem {
  productId: string;
  quantity: number;
  price: number;
}

const EditOrderPage: React.FC = () => {
  const router = useRouter();
  const { id } = router.query;
  const [loading, setLoading] = useState(false);
  const [fetchLoading, setFetchLoading] = useState(true);
  const { user } = useAuth();
  const isAdmin = user?.role === 'admin';
  const [termsHtml, setTermsHtml] = useState('');
  const [clients, setClients] = useState<Client[]>([]);
  const [routes, setRoutes] = useState<Route[]>([]);
  const [products, setProducts] = useState<Product[]>([]);
  const [lineItems, setLineItems] = useState<LineItem[]>([{ productId: '', quantity: 1, price: 0 }]);
  const [originalLineItems, setOriginalLineItems] = useState<LineItem[]>([]);
  const [formData, setFormData] = useState({
    clientId: '',
    routeId: '',
    status: 'pending' as Order['status'],
    paymentType: '' as '' | 'online' | 'adjustment' | 'cash' | 'credit',
    discount: '',
    paidAmount: '',
    description: '',
    deliveryDate: '',
  });

  useEffect(() => {
    clientService.getClients().then(setClients).catch(() => {});
    routeService.getRoutes().then(setRoutes).catch(() => {});
    productService.getProducts().then(setProducts).catch(() => {});
  }, []);

  useEffect(() => {
    if (id) fetchOrder();
  }, [id]);

  const fetchOrder = async () => {
    try {
      const data: Order = await orderService.getOrder(id as string);
      const clientId =
        typeof data.dealerId === 'object' && data.dealerId != null
          ? (data.dealerId as { _id?: string })._id ?? ''
          : String(data.dealerId ?? '');
      const routeId =
        typeof data.routeId === 'object' && data.routeId != null
          ? (data.routeId as { _id?: string })._id ?? ''
          : String(data.routeId ?? '');
      const items: LineItem[] = Array.isArray(data.products) && data.products.length > 0
        ? data.products.map((p: { productId: any; quantity: number; price: number }) => ({
            productId: typeof p.productId === 'object' && p.productId != null ? (p.productId as { _id: string })._id : String(p.productId ?? ''),
            quantity: p.quantity ?? 1,
            price: typeof p.price === 'number' ? p.price : 0,
          }))
        : [{ productId: '', quantity: 1, price: 0 }];
      if (user?.role === 'order_taker' && data.status !== 'pending') {
        toast.error('You can only edit pending orders');
        router.push(`/orders/${id}`);
        return;
      }

      setFormData({
        clientId,
        routeId,
        status: data.status ?? 'pending',
        paymentType: (data.paymentType ?? '') as '' | 'online' | 'adjustment' | 'cash' | 'credit',
        discount: data.discount !== undefined ? data.discount.toString() : '',
        paidAmount: data.paidAmount !== undefined ? data.paidAmount.toString() : '',
        description: data.description || '',
        deliveryDate: data.deliveryDate ? data.deliveryDate.slice(0, 10) : '',
      });
      setTermsHtml(data.termsAndConditions || '');
      // Keep separate object references so delta checks compare against an immutable baseline.
      const initialLineItems = items.map((item) => ({ ...item }));
      const initialOriginalLineItems = items.map((item) => ({ ...item }));
      setLineItems(initialLineItems);
      setOriginalLineItems(initialOriginalLineItems);
    } catch (error) {
      toast.error('Failed to fetch order');
    } finally {
      setFetchLoading(false);
    }
  };

  const handleChange = (
    e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>,
  ) => {
    const { name, value } = e.target;
    setFormData((prev) => ({ ...prev, [name]: value }));
  };

  const handleClientChange = (e: React.ChangeEvent<HTMLSelectElement>) => {
    const clientId = e.target.value;
    const client = clients.find((c) => c._id === clientId);
    setFormData((prev) => ({
      ...prev,
      clientId,
      routeId: getClientAssignedRouteId(client),
    }));
  };

  const handleLineItemChange = (index: number, field: keyof LineItem, value: string | number) => {
    const updated = [...lineItems];
    if (field === 'quantity' || field === 'price') {
      updated[index][field] = Number(value);
    } else {
      updated[index][field] = value as string;
      if (field === 'productId') {
        const product = products.find((p) => p._id === value);
        if (product?.salePrice) updated[index].price = product.salePrice;
      }
    }
    setLineItems(updated);
  };

  const addLineItem = () => setLineItems([...lineItems, { productId: '', quantity: 1, price: 0 }]);
  const removeLineItem = (index: number) => {
    if (lineItems.length === 1) return;
    setLineItems(lineItems.filter((_, i) => i !== index));
  };

  const totalPrice = lineItems.reduce((sum, item) => sum + item.quantity * item.price, 0);
  const discount = parseFloat(formData.discount) || 0;
  const grandTotal = totalPrice - discount;

  const getStockForProduct = (productId: string) => {
    const p = products.find((x) => x._id === productId);
    return p?.quantity ?? 0;
  };

  const aggregateByProduct = (items: LineItem[]) => {
    const map = new Map<string, number>();
    for (const item of items) {
      if (!item.productId) continue;
      map.set(item.productId, (map.get(item.productId) ?? 0) + item.quantity);
    }
    return map;
  };

  const getAdditionalRequiredForProduct = (productId: string) => {
    const currentMap = aggregateByProduct(lineItems);
    const originalMap = aggregateByProduct(originalLineItems);
    const currentQty = currentMap.get(productId) ?? 0;
    const originalQty = originalMap.get(productId) ?? 0;
    return Math.max(0, currentQty - originalQty);
  };
  const getTotalOrderedForProduct = (productId: string) =>
    lineItems
      .filter((item) => item.productId === productId)
      .reduce((sum, item) => sum + item.quantity, 0);
  const getRemainingForProduct = (productId: string) => {
    const stock = getStockForProduct(productId);
    const additionalRequired = getAdditionalRequiredForProduct(productId);
    return stock - additionalRequired;
  };
  const getStockExceededError = (): { name: string; stock: number; ordered: number } | null => {
    const currentMap = aggregateByProduct(lineItems);
    const originalMap = aggregateByProduct(originalLineItems);
    const allProductIds = new Set<string>([
      ...currentMap.keys(),
      ...originalMap.keys(),
    ]);

    for (const productId of allProductIds) {
      const currentQty = currentMap.get(productId) ?? 0;
      const originalQty = originalMap.get(productId) ?? 0;
      const additionalRequired = Math.max(0, currentQty - originalQty);
      const stock = getStockForProduct(productId);
      if (additionalRequired > stock) {
        const product = products.find((p) => p._id === productId);
        return { name: product?.name ?? 'Unknown product', stock, ordered: additionalRequired };
      }
    }
    return null;
  };
  const stockExceeded = getStockExceededError();

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!formData.clientId) {
      toast.error('Please select a client');
      return;
    }
    const validItems = lineItems.filter((item) => item.productId);
    if (validItems.length === 0) {
      toast.error('Please add at least one product');
      return;
    }
    const exceeded = getStockExceededError();
    if (exceeded) {
      toast.error(
        `"${exceeded.name}" exceeds available stock. Stock: ${exceeded.stock}, additional required: ${exceeded.ordered}. Please reduce the quantity.`
      );
      return;
    }
    setLoading(true);
    try {
      await orderService.updateOrder(id as string, {
        dealerId: formData.clientId,
        routeId: formData.routeId,
        status: formData.status,
        paymentType: formData.paymentType || undefined,
        products: validItems.map((item) => ({
          productId: item.productId,
          quantity: item.quantity,
          price: item.price,
        })),
        discount: discount || undefined,
        paidAmount: formData.paidAmount ? parseFloat(formData.paidAmount) : undefined,
        description: formData.description || undefined,
        deliveryDate: formData.deliveryDate || undefined,
        ...(isAdmin ? { termsAndConditions: termsHtml } : {}),
      });
      toast.success('Order updated successfully');
      router.push(`/orders/${id}`);
    } catch (error: any) {
      toast.error(error.response?.data?.message || 'Failed to update order');
    } finally {
      setLoading(false);
    }
  };

  if (fetchLoading) return <Layout><Loader /></Layout>;

  return (
    <Layout>
      <div className={styles.container}>
        <div className={styles.header}>
          <h1>Edit Order</h1>
          <button className={styles.backButton} onClick={() => router.push(`/orders/${id}`)}>
            ← Back
          </button>
        </div>
        <form onSubmit={handleSubmit} className={styles.form}>
          <div className={styles.formGroup}>
            <label htmlFor="clientId">Client *</label>
            <SearchableSelect
              id="clientId"
              name="clientId"
              value={formData.clientId}
              onChange={handleClientChange}
              className={styles.select}
              placeholder="Select a client"
              options={[
                { value: '', label: 'Select a client' },
                ...clients.map((d) => ({ value: d._id, label: formatClientSelectLabel(d) })),
              ]}
            />
          </div>

          <div className={styles.formGroup}>
            <label htmlFor="routeId">Route</label>
            <p style={{ margin: '0 0 0.5rem', fontSize: '0.8125rem', color: '#6b7280' }}>
              Filled automatically from the client&apos;s assigned route; you can change it or clear it.
            </p>
            <SearchableSelect
              id="routeId"
              name="routeId"
              value={formData.routeId}
              onChange={handleChange}
              className={styles.select}
              placeholder="None"
              options={[
                { value: '', label: 'None' },
                ...routes.map((r) => ({ value: r._id, label: r.name })),
              ]}
            />
          </div>

          <div style={{ marginBottom: '1.5rem' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '0.75rem' }}>
              <label style={{ fontWeight: 600, color: '#374151' }}>Products *</label>
              <button
                type="button"
                onClick={addLineItem}
                className={styles.cancelButton}
                style={{ padding: '0.375rem 0.75rem', fontSize: '0.875rem' }}
              >
                + Add Row
              </button>
            </div>
            <div className={styles.desktopOnly} style={{ overflowX: 'auto', WebkitOverflowScrolling: 'touch', marginBottom: '0.5rem' }}>
              <table style={{ width: '100%', minWidth: 720, borderCollapse: 'collapse', fontSize: '0.875rem', color: '#1f2937' }}>
                <thead>
                  <tr style={{ background: '#f9fafb' }}>
                    <th style={{ padding: '0.5rem', textAlign: 'left', fontWeight: 600, color: '#374151', borderBottom: '1px solid #e5e7eb' }}>Product</th>
                    <th style={{ padding: '0.5rem', textAlign: 'left', fontWeight: 600, color: '#374151', borderBottom: '1px solid #e5e7eb', width: 180 }}>Stock / Remaining</th>
                    <th style={{ padding: '0.5rem', textAlign: 'left', fontWeight: 600, color: '#374151', borderBottom: '1px solid #e5e7eb', width: 100 }}>Qty</th>
                    <th style={{ padding: '0.5rem', textAlign: 'left', fontWeight: 600, color: '#374151', borderBottom: '1px solid #e5e7eb', width: 120 }}>Unit Price</th>
                    <th style={{ padding: '0.5rem', textAlign: 'right', fontWeight: 600, color: '#374151', borderBottom: '1px solid #e5e7eb', width: 100 }}>Subtotal</th>
                    <th style={{ width: 40, borderBottom: '1px solid #e5e7eb' }} />
                  </tr>
                </thead>
                <tbody>
                  {lineItems.map((item, idx) => {
                    const stock = item.productId ? getStockForProduct(item.productId) : null;
                    const totalOrdered = item.productId ? getTotalOrderedForProduct(item.productId) : 0;
                    const remaining = item.productId ? getRemainingForProduct(item.productId) : null;
                    return (
                      <tr key={idx}>
                        <td style={{ padding: '0.5rem' }}>
                          <SearchableSelect
                            name={`productId-${idx}`}
                            value={item.productId}
                            onChange={(e) => handleLineItemChange(idx, 'productId', e.target.value)}
                            className={styles.select}
                            style={{ margin: 0 }}
                            placeholder="Select product"
                            options={[
                              { value: '', label: 'Select product' },
                              ...products.map((p) => ({
                                value: p._id,
                                label: `${p.name} (${p.barcode})`,
                              })),
                            ]}
                          />
                        </td>
                        <td style={{ padding: '0.5rem', fontSize: '0.8125rem', color: '#374151', verticalAlign: 'top' }}>
                          {item.productId ? (
                            <div>
                              <div>Stock: <strong>{stock}</strong></div>
                              <div style={{ marginTop: 2 }}>Ordered in this order: <strong>{totalOrdered}</strong></div>
                              <div style={{ marginTop: 2 }}>
                                Additional needed: <strong>{getAdditionalRequiredForProduct(item.productId)}</strong>
                              </div>
                              <div style={{ marginTop: 2, color: remaining !== null && remaining < 0 ? '#b91c1c' : '#047857', fontWeight: 500 }}>
                                {remaining !== null && remaining < 0 ? `Exceeds stock by ${Math.abs(remaining)}` : `Remaining after: ${remaining}`}
                              </div>
                            </div>
                          ) : (
                            '—'
                          )}
                        </td>
                        <td style={{ padding: '0.5rem' }}>
                          <input
                            type="number"
                            value={item.quantity}
                            onChange={(e) => handleLineItemChange(idx, 'quantity', e.target.value)}
                            className={styles.input}
                            style={{ margin: 0 }}
                            min={1}
                          />
                        </td>
                        <td style={{ padding: '0.5rem', color: '#1f2937' }}>
                          <span style={{ fontWeight: 500 }}>Rs. {item.price.toFixed(2)}</span>
                        </td>
                        <td style={{ padding: '0.5rem', textAlign: 'right', fontWeight: 500, color: '#1f2937' }}>
                          Rs. {(item.quantity * item.price).toFixed(2)}
                        </td>
                        <td style={{ padding: '0.5rem', textAlign: 'center' }}>
                          <button
                            type="button"
                            onClick={() => removeLineItem(idx)}
                            style={{ background: 'none', border: 'none', color: '#ef4444', cursor: 'pointer', fontSize: '1.125rem', lineHeight: 1 }}
                          >
                            ×
                          </button>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
                <tfoot style={{ color: '#1f2937' }}>
                  <tr>
                    <td colSpan={4} style={{ padding: '0.5rem', textAlign: 'right', fontWeight: 600, color: '#374151' }}>Total:</td>
                    <td style={{ padding: '0.5rem', textAlign: 'right', fontWeight: 700, color: '#1f2937' }}>Rs. {totalPrice.toFixed(2)}</td>
                    <td />
                  </tr>
                  {discount > 0 && (
                    <tr>
                      <td colSpan={4} style={{ padding: '0.5rem', textAlign: 'right', color: '#047857', fontWeight: 600 }}>Discount:</td>
                      <td style={{ padding: '0.5rem', textAlign: 'right', color: '#047857' }}>-Rs. {discount.toFixed(2)}</td>
                      <td />
                    </tr>
                  )}
                  <tr style={{ background: '#f9fafb' }}>
                    <td colSpan={4} style={{ padding: '0.5rem', textAlign: 'right', fontWeight: 700, color: '#374151' }}>Grand Total:</td>
                    <td style={{ padding: '0.5rem', textAlign: 'right', fontWeight: 700, color: '#1d4ed8' }}>Rs. {grandTotal.toFixed(2)}</td>
                    <td />
                  </tr>
                </tfoot>
              </table>
            </div>
            <div className={styles.mobileOnly}>
              <div className={styles.lineItemCards}>
                {lineItems.map((item, idx) => {
                  const stock = item.productId ? getStockForProduct(item.productId) : null;
                  const totalOrdered = item.productId ? getTotalOrderedForProduct(item.productId) : 0;
                  const remaining = item.productId ? getRemainingForProduct(item.productId) : null;
                  return (
                    <div key={idx} className={styles.lineItemCard}>
                      <div>
                        <label className={styles.lineItemFieldLabel}>Product</label>
                        <SearchableSelect
                          name={`mobile-productId-${idx}`}
                          value={item.productId}
                          onChange={(e) => handleLineItemChange(idx, 'productId', e.target.value)}
                          className={styles.select}
                          style={{ margin: 0 }}
                          placeholder="Select product"
                          options={[
                            { value: '', label: 'Select product' },
                            ...products.map((p) => ({
                              value: p._id,
                              label: `${p.name} (${p.barcode})`,
                            })),
                          ]}
                        />
                      </div>
                      <div>
                        <label className={styles.lineItemFieldLabel}>Qty</label>
                        <input
                          type="number"
                          value={item.quantity}
                          onChange={(e) => handleLineItemChange(idx, 'quantity', e.target.value)}
                          className={styles.input}
                          style={{ margin: 0 }}
                          min={1}
                        />
                      </div>
                      <div className={styles.lineItemMeta}>
                        <div>
                          Unit Price: <strong>Rs. {item.price.toFixed(2)}</strong>
                        </div>
                        <div>
                          Subtotal: <strong>Rs. {(item.quantity * item.price).toFixed(2)}</strong>
                        </div>
                        {item.productId ? (
                          <>
                            <div>
                              Stock: <strong>{stock}</strong>
                            </div>
                            <div>
                              Ordered in this order: <strong>{totalOrdered}</strong>
                            </div>
                            <div>
                              Additional needed: <strong>{getAdditionalRequiredForProduct(item.productId)}</strong>
                            </div>
                            <div
                              style={{
                                color: remaining !== null && remaining < 0 ? '#b91c1c' : '#047857',
                                fontWeight: 500,
                              }}
                            >
                              {remaining !== null && remaining < 0
                                ? `Exceeds stock by ${Math.abs(remaining)}`
                                : `Remaining after: ${remaining}`}
                            </div>
                          </>
                        ) : (
                          <div>Stock info: —</div>
                        )}
                      </div>
                      <div className={styles.lineItemActions}>
                        <button
                          type="button"
                          onClick={() => removeLineItem(idx)}
                          className={styles.lineItemRemoveButton}
                        >
                          Remove Row
                        </button>
                      </div>
                    </div>
                  );
                })}
              </div>
              <div className={styles.lineItemTotals}>
                <div>
                  <span>Total</span>
                  <strong>Rs. {totalPrice.toFixed(2)}</strong>
                </div>
                {discount > 0 && (
                  <div>
                    <span>Discount</span>
                    <strong>-Rs. {discount.toFixed(2)}</strong>
                  </div>
                )}
                <div className={styles.lineItemGrandTotal}>
                  <span>Grand Total</span>
                  <strong>Rs. {grandTotal.toFixed(2)}</strong>
                </div>
              </div>
            </div>
          </div>

          {isAdmin && (
            <div className={styles.formGroup}>
              <label htmlFor="status">Status *</label>
              <SearchableSelect
                id="status"
                name="status"
                value={formData.status}
                onChange={handleChange}
                className={styles.select}
                placeholder="Status"
                options={[
                  { value: 'pending', label: 'Pending' },
                  { value: 'approved', label: 'Approved' },
                  { value: 'packed', label: 'Packed (ready for delivery)' },
                  { value: 'dispatched', label: 'Dispatched (out for delivery)' },
                  { value: 'delivered', label: 'Delivered' },
                  { value: 'cancelled', label: 'Cancelled' },
                ]}
              />
            </div>
          )}

          <div className={styles.formGroup}>
            <label htmlFor="paymentType">Payment Type</label>
            <SearchableSelect
              id="paymentType"
              name="paymentType"
              value={formData.paymentType}
              onChange={handleChange}
              className={styles.select}
              placeholder="— Select payment type —"
              options={[
                { value: '', label: '— Select payment type —' },
                { value: 'online', label: 'Online' },
                { value: 'adjustment', label: 'Adjustment' },
                { value: 'cash', label: 'Cash' },
                { value: 'credit', label: 'Credit' },
              ]}
            />
          </div>

          <div className={styles.formRow}>
            <div className={styles.formGroup}>
              <label htmlFor="discount">Discount</label>
              <input
                type="number"
                id="discount"
                name="discount"
                value={formData.discount}
                onChange={handleChange}
                className={styles.input}
                min={0}
                step="0.01"
                placeholder="0.00"
              />
            </div>
            <div className={styles.formGroup}>
              <label htmlFor="paidAmount">Paid Amount</label>
              <input
                type="number"
                id="paidAmount"
                name="paidAmount"
                value={formData.paidAmount}
                onChange={handleChange}
                className={styles.input}
                min={0}
                step="0.01"
                placeholder="0.00"
              />
            </div>
          </div>

          <div className={styles.formGroup}>
            <label htmlFor="deliveryDate">Delivery Date</label>
            <DatePickerFilter
              id="deliveryDate"
              value={formData.deliveryDate}
              onChange={(value) => setFormData((prev) => ({ ...prev, deliveryDate: value }))}
              placeholder="Select delivery date"
              title="Delivery Date"
              fullWidth
            />
          </div>

          <div className={styles.formGroup}>
            <label htmlFor="description">Description</label>
            <textarea
              id="description"
              name="description"
              value={formData.description}
              onChange={handleChange}
              className={styles.textarea}
              rows={3}
            />
          </div>

          {isAdmin && (
            <div className={styles.formGroup}>
              <label>Invoice terms &amp; conditions (optional)</label>
              <p style={{ margin: '0 0 0.5rem', fontSize: '0.8125rem', color: '#6b7280' }}>
                Shown on the printed invoice when provided.
              </p>
              <OrderTermsEditor key={String(id)} value={termsHtml} onChange={setTermsHtml} />
            </div>
          )}

          <div className={styles.formActions}>
            <button type="button" className={styles.cancelButton} onClick={() => router.push(`/orders/${id}`)}>
              Cancel
            </button>
            <button
              type="submit"
              className={styles.submitButton}
              disabled={loading || !!stockExceeded}
              title={stockExceeded ? `Reduce quantity for "${stockExceeded.name}" (stock: ${stockExceeded.stock})` : undefined}
            >
              {loading ? 'Updating...' : stockExceeded ? 'Reduce quantity to update order' : 'Update Order'}
            </button>
          </div>
        </form>
      </div>
    </Layout>
  );
};

export default function EditOrderPageWrapper() {
  return (
    <ProtectedRoute allowedRoles={['admin', 'order_taker']}>
      <EditOrderPage />
    </ProtectedRoute>
  );
}
