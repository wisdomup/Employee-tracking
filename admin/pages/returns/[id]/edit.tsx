import React, { useState, useEffect, useRef } from 'react';
import { useRouter } from 'next/router';
import Layout from '../../../components/Layout/Layout';
import ProtectedRoute from '../../../components/Auth/ProtectedRoute';
import Loader from '../../../components/UI/Loader';
import { returnService, getReturnImageUrl } from '../../../services/returnService';
import { clientService, Client } from '../../../services/clientService';
import { productService, Product } from '../../../services/productService';
import { useAuth } from '../../../contexts/AuthContext';
import { toast } from 'react-toastify';
import styles from '../../../styles/FormPage.module.scss';

interface LineItem {
  productId: string;
  quantity: number;
  price: number;
}

const EditReturnPage: React.FC = () => {
  const router = useRouter();
  const { id } = router.query;
  const [pageLoading, setPageLoading] = useState(true);
  const [loading, setLoading] = useState(false);
  const { user } = useAuth();
  const isAdmin = user?.role === 'admin';
  const [clients, setClients] = useState<Client[]>([]);
  const [products, setProducts] = useState<Product[]>([]);
  const [invoiceFile, setInvoiceFile] = useState<File | null>(null);
  const [invoicePreview, setInvoicePreview] = useState<string>('');
  const [existingInvoiceUrl, setExistingInvoiceUrl] = useState<string>('');
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [lineItems, setLineItems] = useState<LineItem[]>([
    { productId: '', quantity: 1, price: 0 },
  ]);
  const [formData, setFormData] = useState({
    clientId: '',
    returnType: 'return' as 'return' | 'damage',
    status: 'pending' as 'pending' | 'approved' | 'picked' | 'completed',
    amount: '',
    returnReason: '',
  });
  const [isLocked, setIsLocked] = useState(false);

  useEffect(() => {
    clientService.getClients().then(setClients).catch(() => {});
    productService.getProducts().then(setProducts).catch(() => {});
  }, []);

  useEffect(() => {
    if (!id) return;
    returnService
      .getReturn(id as string)
      .then((data) => {
        if (user?.role === 'order_taker' && user?.id) {
          const creatorId =
            data.createdBy == null
              ? ''
              : typeof data.createdBy === 'object' && data.createdBy !== null && '_id' in data.createdBy
                ? String((data.createdBy as { _id: string })._id)
                : String(data.createdBy);
          if (creatorId !== user.id) {
            toast.error('You can only edit returns you created');
            router.push('/returns');
            return;
          }
        }
        if (user?.role === 'order_taker' && data.status !== 'pending') {
          toast.error('You can only edit pending returns');
          router.push(`/returns/${id}`);
          return;
        }
        if (data.status === 'completed') {
          setIsLocked(true);
          toast.info('Completed returns are locked and cannot be edited');
        }
        setFormData({
          clientId:
            typeof data.dealerId === 'object' && data.dealerId != null
              ? data.dealerId._id ?? ''
              : String(data.dealerId ?? ''),
          returnType: data.returnType ?? 'return',
          status: data.status ?? 'pending',
          amount: data.amount != null ? String(data.amount) : '',
          returnReason: data.returnReason ?? '',
        });

        if (Array.isArray(data.products) && data.products.length > 0) {
          setLineItems(
            data.products.map((p: any) => ({
              productId:
                typeof p.productId === 'object' && p.productId != null
                  ? p.productId._id ?? ''
                  : String(p.productId ?? ''),
              quantity: p.quantity ?? 1,
              price: p.price ?? 0,
            })),
          );
        }

        if (data.invoiceImage) {
          setExistingInvoiceUrl(getReturnImageUrl(data.invoiceImage));
        }
      })
      .catch(() => toast.error('Failed to load return'))
      .finally(() => setPageLoading(false));
  }, [id, user?.id, user?.role]);

  const handleChange = (
    e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>,
  ) => {
    const { name, value } = e.target;
    setFormData((prev) => ({ ...prev, [name]: value }));
  };

  const handleInvoiceChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setInvoiceFile(file);
    const reader = new FileReader();
    reader.onload = (ev) => setInvoicePreview(ev.target?.result as string);
    reader.readAsDataURL(file);
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

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (isLocked) {
      toast.error('Completed returns are locked and cannot be edited');
      return;
    }
    if (!formData.clientId) {
      toast.error('Please select a client');
      return;
    }
    const validItems = lineItems.filter((item) => item.productId);
    if (validItems.length === 0) {
      toast.error('Please add at least one product');
      return;
    }

    setLoading(true);
    try {
      await returnService.updateReturn(id as string, {
        dealerId: formData.clientId,
        returnType: formData.returnType,
        status: formData.status,
        products: validItems.map((item) => ({
          productId: item.productId,
          quantity: item.quantity,
          price: item.price,
        })),
        invoiceImage: invoiceFile || undefined,
        amount: formData.amount ? parseFloat(formData.amount) : undefined,
        returnReason: formData.returnReason || undefined,
      });
      toast.success('Return updated successfully');
      router.push(`/returns/${id}`);
    } catch (error: any) {
      toast.error(error.response?.data?.message || 'Failed to update return');
    } finally {
      setLoading(false);
    }
  };

  if (pageLoading) return <Layout><Loader /></Layout>;

  const displayInvoice = invoicePreview || existingInvoiceUrl;

  return (
    <Layout>
      <div className={styles.container}>
        <div className={styles.header}>
          <h1>Edit Return / Damage</h1>
          <button
            className={styles.backButton}
            onClick={() => router.push(`/returns/${id}`)}
          >
            ← Back
          </button>
        </div>

        <form onSubmit={handleSubmit} className={styles.form}>
          {isAdmin && (
            <div className={styles.formGroup}>
              <label htmlFor="status">Status *</label>
              <select
                id="status"
                name="status"
                value={formData.status}
                onChange={handleChange}
                required
                className={styles.select}
              >
                <option value="pending">Pending</option>
                <option value="approved">Approved</option>
                <option value="picked">Picked</option>
                <option value="completed">Completed</option>
              </select>
            </div>
          )}

          {/* Client */}
          <div className={styles.formGroup}>
            <label htmlFor="clientId">Client *</label>
            <select
              id="clientId"
              name="clientId"
              value={formData.clientId}
              onChange={handleChange}
              required
              className={styles.select}
            >
              <option value="">Select a client</option>
              {clients.map((d) => (
                <option key={d._id} value={d._id}>
                  {d.name} — {d.phone}
                </option>
              ))}
            </select>
          </div>

          {/* Return Type */}
          <div className={styles.formGroup}>
            <label htmlFor="returnType">Return Type *</label>
            <select
              id="returnType"
              name="returnType"
              value={formData.returnType}
              onChange={handleChange}
              required
              className={styles.select}
            >
              <option value="return">Return</option>
              <option value="damage">Damage</option>
            </select>
          </div>

          {/* Invoice Image */}
          <div className={styles.formGroup}>
            <label>Invoice Image</label>
            <div
              style={{
                border: '2px dashed #d1d5db',
                borderRadius: 8,
                padding: '1rem',
                cursor: 'pointer',
                textAlign: 'center',
                background: '#f9fafb',
              }}
              onClick={() => fileInputRef.current?.click()}
            >
              {displayInvoice ? (
                <img
                  src={displayInvoice}
                  alt="Invoice preview"
                  style={{ maxHeight: 200, maxWidth: '100%', borderRadius: 4 }}
                />
              ) : (
                <div style={{ color: '#6b7280', fontSize: '0.875rem' }}>
                  <div style={{ fontSize: '2rem', marginBottom: 4 }}>📷</div>
                  Click to upload invoice image
                  <div style={{ fontSize: '0.75rem', marginTop: 4 }}>PNG, JPG up to 5MB</div>
                </div>
              )}
            </div>
            <input
              ref={fileInputRef}
              type="file"
              accept="image/*"
              onChange={handleInvoiceChange}
              style={{ display: 'none' }}
            />
            {invoicePreview && (
              <button
                type="button"
                onClick={() => {
                  setInvoiceFile(null);
                  setInvoicePreview('');
                  if (fileInputRef.current) fileInputRef.current.value = '';
                }}
                style={{
                  marginTop: '0.5rem',
                  background: 'none',
                  border: 'none',
                  color: '#ef4444',
                  cursor: 'pointer',
                  fontSize: '0.875rem',
                }}
              >
                × Remove new image (keep existing)
              </button>
            )}
          </div>

          {/* Products Line Items */}
          <div style={{ marginBottom: '1.5rem' }}>
            <div
              style={{
                display: 'flex',
                justifyContent: 'space-between',
                alignItems: 'center',
                marginBottom: '0.75rem',
              }}
            >
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
            <div style={{ overflowX: 'auto', WebkitOverflowScrolling: 'touch', marginBottom: '0.5rem' }}>
              <table
                style={{
                  width: '100%',
                  minWidth: 600,
                  borderCollapse: 'collapse',
                  fontSize: '0.875rem',
                  color: '#1f2937',
                }}
              >
                <thead>
                  <tr style={{ background: '#f9fafb' }}>
                    <th style={{ padding: '0.5rem', textAlign: 'left', fontWeight: 600, color: '#374151', borderBottom: '1px solid #e5e7eb' }}>
                      Product
                    </th>
                    <th style={{ padding: '0.5rem', textAlign: 'left', fontWeight: 600, color: '#374151', borderBottom: '1px solid #e5e7eb', width: 100 }}>
                      Qty
                    </th>
                    <th style={{ padding: '0.5rem', textAlign: 'left', fontWeight: 600, color: '#374151', borderBottom: '1px solid #e5e7eb', width: 130 }}>
                      Unit Price
                    </th>
                    <th style={{ padding: '0.5rem', textAlign: 'right', fontWeight: 600, color: '#374151', borderBottom: '1px solid #e5e7eb', width: 110 }}>
                      Subtotal
                    </th>
                    <th style={{ width: 40, borderBottom: '1px solid #e5e7eb' }} />
                  </tr>
                </thead>
                <tbody>
                  {lineItems.map((item, idx) => (
                    <tr key={idx}>
                      <td style={{ padding: '0.5rem' }}>
                        <select
                          value={item.productId}
                          onChange={(e) => handleLineItemChange(idx, 'productId', e.target.value)}
                          className={styles.select}
                          style={{ margin: 0 }}
                        >
                          <option value="">Select product</option>
                          {products.map((p) => (
                            <option key={p._id} value={p._id}>
                              {p.name} ({p.barcode})
                            </option>
                          ))}
                        </select>
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
                      <td style={{ padding: '0.5rem' }}>
                        <input
                          type="number"
                          value={item.price}
                          onChange={(e) => handleLineItemChange(idx, 'price', e.target.value)}
                          className={styles.input}
                          style={{ margin: 0 }}
                          min={0}
                          step="0.01"
                        />
                      </td>
                      <td style={{ padding: '0.5rem', textAlign: 'right', fontWeight: 500 }}>
                        Rs. {(item.quantity * item.price).toFixed(2)}
                      </td>
                      <td style={{ padding: '0.5rem', textAlign: 'center' }}>
                        <button
                          type="button"
                          onClick={() => removeLineItem(idx)}
                          style={{
                            background: 'none',
                            border: 'none',
                            color: '#ef4444',
                            cursor: 'pointer',
                            fontSize: '1.125rem',
                            lineHeight: 1,
                          }}
                        >
                          ×
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
                <tfoot>
                  <tr style={{ background: '#f9fafb' }}>
                    <td colSpan={3} style={{ padding: '0.5rem', textAlign: 'right', fontWeight: 700, color: '#374151' }}>
                      Products Total:
                    </td>
                    <td style={{ padding: '0.5rem', textAlign: 'right', fontWeight: 700, color: '#1d4ed8' }}>
                      Rs. {lineItems.reduce((s, i) => s + i.quantity * i.price, 0).toFixed(2)}
                    </td>
                    <td />
                  </tr>
                </tfoot>
              </table>
            </div>
          </div>

          {/* Total Amount */}
          <div className={styles.formGroup}>
            <label htmlFor="amount">Total Return Amount</label>
            <input
              type="number"
              id="amount"
              name="amount"
              value={formData.amount}
              onChange={handleChange}
              className={styles.input}
              min={0}
              step="0.01"
              placeholder="Enter total return amount"
            />
          </div>

          {/* Reason */}
          <div className={styles.formGroup}>
            <label htmlFor="returnReason">Reason</label>
            <textarea
              id="returnReason"
              name="returnReason"
              value={formData.returnReason}
              onChange={handleChange}
              className={styles.textarea}
              rows={3}
              placeholder="Describe the reason for the return or damage"
            />
          </div>

          <div className={styles.formActions}>
            <button
              type="button"
              className={styles.cancelButton}
              onClick={() => router.push(`/returns/${id}`)}
            >
              Cancel
            </button>
            <button type="submit" className={styles.submitButton} disabled={loading || isLocked}>
              {isLocked ? 'Locked (Completed)' : loading ? 'Saving...' : 'Save Changes'}
            </button>
          </div>
        </form>
      </div>
    </Layout>
  );
};

export default function EditReturnPageWrapper() {
  return (
    <ProtectedRoute allowedRoles={['admin', 'order_taker']}>
      <EditReturnPage />
    </ProtectedRoute>
  );
}
