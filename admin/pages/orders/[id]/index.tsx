import React, { useEffect, useState } from 'react';
import { useRouter } from 'next/router';
import Layout from '../../../components/Layout/Layout';
import ProtectedRoute from '../../../components/Auth/ProtectedRoute';
import StatusBadge from '../../../components/UI/StatusBadge';
import Loader from '../../../components/UI/Loader';
import { orderService, Order } from '../../../services/orderService';
import { useAuth } from '../../../contexts/AuthContext';
import { toast } from 'react-toastify';
import { format } from 'date-fns';
import { printOrderInvoice } from '../../../utils/orderInvoicePdf';
import { employeeDisplayLabel } from '../../../utils/employeeDisplayLabel';
import ApproveOrderTermsModal from '../../../components/ApproveOrderTermsModal';
import styles from '../../../styles/DetailPage.module.scss';

const OrderDetailPage: React.FC = () => {
  const router = useRouter();
  const { id } = router.query;
  const [order, setOrder] = useState<Order | null>(null);
  const [loading, setLoading] = useState(true);
  const [printBusy, setPrintBusy] = useState(false);
  const [approveModalOpen, setApproveModalOpen] = useState(false);
  const [approveTermsDraft, setApproveTermsDraft] = useState('');
  const [approveBusy, setApproveBusy] = useState(false);
  const { user } = useAuth();
  const isAdmin = user?.role === 'admin';
  const isOrderTaker = user?.role === 'order_taker';

  useEffect(() => {
    if (id) {
      orderService
        .getOrder(id as string)
        .then(setOrder)
        .catch(() => toast.error('Failed to fetch order'))
        .finally(() => setLoading(false));
    }
  }, [id]);

  const formatInvoiceLabel = (n?: number) => {
    if (n == null || !Number.isFinite(n)) return '—';
    return `INV-${String(Math.floor(n)).padStart(6, '0')}`;
  };

  const handlePrintInvoice = async () => {
    if (!order) return;
    setPrintBusy(true);
    try {
      await printOrderInvoice(order);
    } catch {
      toast.error('Failed to generate invoice PDF');
    } finally {
      setPrintBusy(false);
    }
  };

  const openApproveModal = () => {
    if (!order) return;
    setApproveTermsDraft(order.termsAndConditions || '');
    setApproveModalOpen(true);
  };

  const closeApproveModal = () => {
    if (approveBusy) return;
    setApproveModalOpen(false);
    setApproveTermsDraft('');
  };

  const handleApproveConfirm = async () => {
    if (!order) return;
    setApproveBusy(true);
    try {
      const updatedOrder = await orderService.approveOrder(order._id, { termsAndConditions: approveTermsDraft });
      setOrder(updatedOrder);
      setApproveModalOpen(false);
      setApproveTermsDraft('');
      toast.success('Order approved');
    } catch (err: unknown) {
      const msg =
        err && typeof err === 'object' && 'response' in err
          ? (err as { response?: { data?: { message?: string } } }).response?.data?.message
          : undefined;
      toast.error(msg || 'Failed to approve order');
    } finally {
      setApproveBusy(false);
    }
  };

  if (loading) return <Layout><Loader /></Layout>;
  if (!order) return <Layout><div>Order not found</div></Layout>;

  const totalPrice = order.products?.reduce((sum, item) => sum + item.quantity * item.price, 0) ?? 0;
  const discount = order.discount ?? 0;
  const grandTotal = order.grandTotal ?? totalPrice - discount;

  return (
    <Layout>
      <div className={styles.container}>
        <div className={styles.header}>
          <h1>Order Details</h1>
          <div className={styles.headerActions}>
            {isAdmin && order.status === 'pending' && (
              <button type="button" className={styles.approveButton} onClick={openApproveModal}>
                Approve
              </button>
            )}
            <button
              type="button"
              className={styles.editButton}
              onClick={handlePrintInvoice}
              disabled={printBusy}
            >
              {printBusy ? 'Preparing…' : 'Print invoice'}
            </button>
            {(isAdmin || (isOrderTaker && order.status === 'pending')) && (
              <button className={styles.editButton} onClick={() => router.push(`/orders/${id}/edit`)}>
                Edit
              </button>
            )}
            <button className={styles.backButton} onClick={() => router.push('/orders')}>
              ← Back
            </button>
          </div>
        </div>

        <div className={styles.content}>
          <div className={styles.section}>
            <h2>Order Information</h2>
            <div className={styles.infoGrid}>
              <div className={styles.infoItem}>
                <span className={styles.label}>Order ID:</span>
                <span className={styles.value}>{order._id.toUpperCase()}</span>
              </div>
              <div className={styles.infoItem}>
                <span className={styles.label}>Invoice No#:</span>
                <span className={styles.value}>
                  {formatInvoiceLabel(order.invoiceNumber)}
                  {order.invoiceNumber == null && (
                    <span style={{ display: 'block', fontSize: '0.8125rem', color: '#6b7280', marginTop: '0.25rem' }}>
                      Run migration <code>backfill-order-invoice-numbers</code> to assign numbers to existing orders.
                    </span>
                  )}
                </span>
              </div>
              <div className={styles.infoItem}>
                <span className={styles.label}>Status:</span>
                <span className={styles.value}><StatusBadge status={order.status} /></span>
              </div>
              <div className={styles.infoItem}>
                <span className={styles.label}>Client:</span>
                <span className={styles.value}>{order.dealerId?.name || '-'}</span>
              </div>
              {order.routeId && (
                <div className={styles.infoItem}>
                  <span className={styles.label}>Route:</span>
                  <span className={styles.value}>{order.routeId?.name || '-'}</span>
                </div>
              )}
              {order.paymentType && (
                <div className={styles.infoItem}>
                  <span className={styles.label}>Payment Type:</span>
                  <span className={styles.value}>
                    {order.paymentType.charAt(0).toUpperCase() + order.paymentType.slice(1)}
                  </span>
                </div>
              )}
              {order.createdBy && (
                <div className={styles.infoItem}>
                  <span className={styles.label}>Created By:</span>
                  <span className={styles.value}>
                    {employeeDisplayLabel(order.createdBy) || '-'}
                  </span>
                </div>
              )}
              {order.status === 'approved' && order.approvedBy && (
                <div className={styles.infoItem}>
                  <span className={styles.label}>Approved By:</span>
                  <span className={styles.value}>
                    {employeeDisplayLabel(order.approvedBy) || '-'}
                  </span>
                </div>
              )}
              <div className={styles.infoItem}>
                <span className={styles.label}>Order Date:</span>
                <span className={styles.value}>
                  {order.createdAt ? format(new Date(order.createdAt), 'MMM dd, yyyy') : '-'}
                </span>
              </div>
              <div className={styles.infoItem}>
                <span className={styles.label}>Delivery Date:</span>
                <span className={styles.value}>
                  {order.deliveryDate ? format(new Date(order.deliveryDate), 'MMM dd, yyyy') : '-'}
                </span>
              </div>
              {order.description && (
                <div className={styles.infoItem}>
                  <span className={styles.label}>Description:</span>
                  <span className={styles.value}>{order.description}</span>
                </div>
              )}
            </div>
          </div>

          {isAdmin && order.termsAndConditions && (
            <div className={styles.section}>
              <h2>Invoice terms &amp; conditions</h2>
              <div
                className={`invoiceTermsRich ${styles.termsPreview}`}
                dangerouslySetInnerHTML={{ __html: order.termsAndConditions }}
              />
            </div>
          )}

          {/* Products breakdown */}
          <div className={styles.section}>
            <h2>Products</h2>
            <div style={{ overflowX: 'auto', WebkitOverflowScrolling: 'touch', marginBottom: '0.5rem' }}>
              <table style={{ width: '100%', minWidth: 600, borderCollapse: 'collapse', color: '#1f2937' }}>
                <thead>
                  <tr style={{ background: '#f9fafb', borderBottom: '2px solid #e5e7eb' }}>
                    <th style={{ padding: '0.75rem', textAlign: 'left', fontWeight: 600, color: '#374151' }}>Product</th>
                    <th style={{ padding: '0.75rem', textAlign: 'center', fontWeight: 600, color: '#374151' }}>Qty</th>
                    <th style={{ padding: '0.75rem', textAlign: 'right', fontWeight: 600, color: '#374151' }}>Unit Price</th>
                    <th style={{ padding: '0.75rem', textAlign: 'right', fontWeight: 600, color: '#374151' }}>Subtotal</th>
                  </tr>
                </thead>
                <tbody>
                  {order.products?.map((item, idx) => (
                    <tr key={idx} style={{ borderBottom: '1px solid #e5e7eb' }}>
                      <td style={{ padding: '0.75rem', color: '#1f2937' }}>
                        <span style={{ color: '#1f2937' }}>{item.productId?.name || 'Unknown Product'}</span>
                        {item.productId?.barcode && (
                          <span style={{ display: 'block', fontSize: '0.75rem', color: '#4b5563' }}>
                            {item.productId.barcode}
                          </span>
                        )}
                      </td>
                      <td style={{ padding: '0.75rem', textAlign: 'center', color: '#1f2937' }}>{item.quantity}</td>
                      <td style={{ padding: '0.75rem', textAlign: 'right', color: '#1f2937' }}>Rs. {item.price.toFixed(2)}</td>
                      <td style={{ padding: '0.75rem', textAlign: 'right', fontWeight: 500, color: '#1f2937' }}>
                        Rs. {(item.quantity * item.price).toFixed(2)}
                      </td>
                    </tr>
                  ))}
                </tbody>
                <tfoot>
                  <tr>
                    <td colSpan={3} style={{ padding: '0.75rem', textAlign: 'right', fontWeight: 600, color: '#374151' }}>
                      Subtotal:
                    </td>
                    <td style={{ padding: '0.75rem', textAlign: 'right', fontWeight: 600, color: '#1f2937' }}>
                      Rs. {totalPrice.toFixed(2)}
                    </td>
                  </tr>
                  {discount > 0 && (
                    <tr>
                      <td colSpan={3} style={{ padding: '0.75rem', textAlign: 'right', color: '#047857', fontWeight: 600 }}>
                        Discount:
                      </td>
                      <td style={{ padding: '0.75rem', textAlign: 'right', color: '#047857' }}>
                        -Rs. {discount.toFixed(2)}
                      </td>
                    </tr>
                  )}
                  <tr style={{ background: '#f9fafb', borderTop: '2px solid #e5e7eb' }}>
                    <td colSpan={3} style={{ padding: '0.75rem', textAlign: 'right', fontWeight: 700, fontSize: '1.1rem', color: '#374151' }}>
                      Grand Total:
                    </td>
                    <td style={{ padding: '0.75rem', textAlign: 'right', fontWeight: 700, fontSize: '1.1rem', color: '#1d4ed8' }}>
                      Rs. {grandTotal.toFixed(2)}
                    </td>
                  </tr>
                  {order.paidAmount !== undefined && (
                    <tr>
                      <td colSpan={3} style={{ padding: '0.75rem', textAlign: 'right', color: '#047857', fontWeight: 600 }}>
                        Paid:
                      </td>
                      <td style={{ padding: '0.75rem', textAlign: 'right', color: '#047857' }}>
                        Rs. {order.paidAmount.toFixed(2)}
                      </td>
                    </tr>
                  )}
                  {order.paidAmount !== undefined && (
                    <tr>
                      <td colSpan={3} style={{ padding: '0.75rem', textAlign: 'right', fontWeight: 600, color: grandTotal - order.paidAmount > 0 ? '#b91c1c' : '#047857' }}>
                        Balance Due:
                      </td>
                      <td style={{ padding: '0.75rem', textAlign: 'right', fontWeight: 600, color: grandTotal - order.paidAmount > 0 ? '#b91c1c' : '#047857' }}>
                        Rs. {(grandTotal - order.paidAmount).toFixed(2)}
                      </td>
                    </tr>
                  )}
                </tfoot>
              </table>
            </div>
          </div>
        </div>
      </div>
      <ApproveOrderTermsModal
        open={approveModalOpen && !!order && order.status === 'pending'}
        editorKey={order?._id}
        value={approveTermsDraft}
        onChange={setApproveTermsDraft}
        onClose={closeApproveModal}
        onApprove={handleApproveConfirm}
        busy={approveBusy}
      />
    </Layout>
  );
};

export default function OrderDetailPageWrapper() {
  return (
    <ProtectedRoute allowedRoles={['admin', 'order_taker']}>
      <OrderDetailPage />
    </ProtectedRoute>
  );
}
