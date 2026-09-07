import React, { useEffect, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/router';
import Layout from '../../../components/Layout/Layout';
import ProtectedRoute from '../../../components/Auth/ProtectedRoute';
import StatusBadge from '../../../components/UI/StatusBadge';
import Loader from '../../../components/UI/Loader';
import { orderService, Order, OrderProduct } from '../../../services/orderService';
import { useAuth } from '../../../contexts/AuthContext';
import { toast } from 'react-toastify';
import { format } from 'date-fns';
import { printOrderInvoice } from '../../../utils/orderInvoicePdf';
import { employeeDisplayLabel } from '../../../utils/employeeDisplayLabel';
import ApproveOrderTermsModal from '../../../components/ApproveOrderTermsModal';
import SearchableSelect from '../../../components/UI/SearchableSelect';
import {
  warehouseService,
  Warehouse,
  warehouseSelectOptions,
} from '../../../services/warehouseService';
import { getApiErrorMessage } from '../../../utils/apiError';
import DataExportButton from '../../../components/UI/DataExportButton';
import type { TableExportColumn } from '../../../utils/tableExport';
import MapView, { Marker } from '../../../components/Map/MapView';
import PostedEntries from '../../../components/Finance/PostedEntries';
import { haversineDistanceKm } from '../../../utils/geo';
import styles from '../../../styles/DetailPage.module.scss';
import modalStyles from '../../../styles/Modal.module.scss';
import { withDefaultInvoiceTerms } from '../../../utils/defaultInvoiceTerms';

/** Six decimals — about 0.1 m, finer than any phone fix, so nothing real is rounded away. */
function formatCoords(lat: number, lng: number): string {
  return `${lat.toFixed(6)}, ${lng.toFixed(6)}`;
}

function mapsPointUrl(lat: number, lng: number): string {
  return `https://www.google.com/maps?q=${lat},${lng}`;
}

function formatDistance(metres: number): string {
  return metres >= 1000 ? `${(metres / 1000).toFixed(2)} km` : `${Math.round(metres)} m`;
}

/** Below this the two pins are the same point to any GPS; used only to spot a genuine re-pin. */
const PIN_MOVE_EPSILON_DEGREES = 0.00001;

const OrderDetailPage: React.FC = () => {
  const router = useRouter();
  const { id } = router.query;
  const [order, setOrder] = useState<Order | null>(null);
  const [loading, setLoading] = useState(true);
  const [printBusy, setPrintBusy] = useState(false);
  const [approveModalOpen, setApproveModalOpen] = useState(false);
  const [approveTermsDraft, setApproveTermsDraft] = useState('');
  const [approveBusy, setApproveBusy] = useState(false);
  const [warehouses, setWarehouses] = useState<Warehouse[]>([]);
  const [warehouseModalOpen, setWarehouseModalOpen] = useState(false);
  const [warehouseDraft, setWarehouseDraft] = useState('');
  const [warehouseBusy, setWarehouseBusy] = useState(false);
  const { user } = useAuth();
  const isAdmin = user?.role === 'admin';
  const isOrderTaker = user?.role === 'order_taker';

  // Once the goods have shipped or the order is cancelled there is no live reservation to move.
  const canChangeWarehouse = order ? !['delivered', 'cancelled'].includes(order.status) : false;

  useEffect(() => {
    if (id) {
      orderService
        .getOrder(id as string)
        .then(setOrder)
        .catch(() => toast.error('Failed to fetch order'))
        .finally(() => setLoading(false));
    }
  }, [id]);

  useEffect(() => {
    if (!isAdmin) return;
    warehouseService.getWarehouses({ isActive: true }).then(setWarehouses).catch(() => {});
  }, [isAdmin]);

  const handleChangeWarehouse = async () => {
    if (!order || !warehouseDraft) return;
    setWarehouseBusy(true);
    try {
      const updated = await orderService.setSourceWarehouse(order._id, warehouseDraft);
      setOrder(updated);
      toast.success('Source warehouse changed — the reservation moved with it');
      setWarehouseModalOpen(false);
    } catch (err) {
      // The API refuses when the new warehouse is short, so the stock never goes negative.
      toast.error(getApiErrorMessage(err, 'Failed to change the source warehouse'));
    } finally {
      setWarehouseBusy(false);
    }
  };

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
    setApproveTermsDraft(withDefaultInvoiceTerms(order.termsAndConditions));
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

  const lineDiscountOf = (item: { quantity: number; price: number; discount?: number }) =>
    Math.min(Math.max(item.discount ?? 0, 0), item.quantity * item.price);
  const totalPrice = order.products?.reduce((sum, item) => sum + item.quantity * item.price, 0) ?? 0;
  const itemsDiscountTotal =
    order.products?.reduce((sum, item) => sum + lineDiscountOf(item), 0) ?? 0;
  const discount = order.discount ?? 0;
  const grandTotal = order.grandTotal ?? totalPrice - itemsDiscountTotal - discount;

  // --- Punch location trail -------------------------------------------------------------
  const numberOrNull = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) ? v : null);
  const punchLat = numberOrNull(order.punchedLatitude);
  const punchLng = numberOrNull(order.punchedLongitude);
  const dealer = typeof order.dealerId === 'object' && order.dealerId ? order.dealerId : null;
  const liveClientLat = numberOrNull(dealer?.latitude);
  const liveClientLng = numberOrNull(dealer?.longitude);
  const snapClientLat = numberOrNull(order.clientLatitudeAtPunch);
  const snapClientLng = numberOrNull(order.clientLongitudeAtPunch);
  // The snapshot wins: it is the pin the stored distance was measured against. Falling back to
  // the live pin only helps orders punched before the snapshot existed.
  const clientPinIsSnapshot = snapClientLat != null && snapClientLng != null;
  const clientLat = clientPinIsSnapshot ? snapClientLat : liveClientLat;
  const clientLng = clientPinIsSnapshot ? snapClientLng : liveClientLng;
  const livePinMoved =
    clientPinIsSnapshot &&
    liveClientLat != null &&
    liveClientLng != null &&
    (Math.abs(liveClientLat - snapClientLat!) > PIN_MOVE_EPSILON_DEGREES ||
      Math.abs(liveClientLng - snapClientLng!) > PIN_MOVE_EPSILON_DEGREES);
  const punchDistanceMetres =
    numberOrNull(order.punchDistanceMetres) ??
    // Older orders carry the two points but no stored distance; the same great-circle formula
    // the server uses gives the identical answer.
    (punchLat != null && punchLng != null && clientLat != null && clientLng != null
      ? haversineDistanceKm(punchLat, punchLng, clientLat, clientLng) * 1000
      : null);
  const punchMarkers: Marker[] = [];
  if (clientLat != null && clientLng != null) {
    punchMarkers.push({
      lat: clientLat,
      lng: clientLng,
      type: 'client',
      label: dealer?.shopName || dealer?.name || 'Client',
      pinIcon: 'blue',
    });
  }
  if (punchLat != null && punchLng != null) {
    punchMarkers.push({
      lat: punchLat,
      lng: punchLng,
      type: 'completion',
      label: `Order taker — ${employeeDisplayLabel(order.createdBy) || 'unknown'}`,
      pinIcon: 'red',
    });
  }

  /** The Products table as exportable data — same rows, columns and totals as on screen. */
  const productExportColumns: TableExportColumn[] = [
    {
      key: 'product',
      title: 'Product',
      exportValue: (row) => (row as OrderProduct).productId?.name || 'Unknown Product',
    },
    {
      key: 'barcode',
      title: 'Barcode',
      exportValue: (row) => (row as OrderProduct).productId?.barcode || '',
    },
    { key: 'quantity', title: 'Qty', exportValue: (row) => String((row as OrderProduct).quantity) },
    {
      key: 'price',
      title: 'Unit Price',
      exportValue: (row) => (row as OrderProduct).price.toFixed(2),
    },
    {
      key: 'subtotal',
      title: 'Subtotal',
      exportValue: (row) => {
        const r = row as OrderProduct;
        return (r.quantity * r.price).toFixed(2);
      },
    },
  ];
  const productExportTotalRow = ['Grand Total', '', '', '', grandTotal.toFixed(2)];

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
                <span className={styles.value}>
                  {typeof order.dealerId === 'object' && order.dealerId?._id ? (
                    <Link
                      href={`/clients/${order.dealerId._id}`}
                      style={{ color: 'var(--admin-primary)', textDecoration: 'underline' }}
                    >
                      {order.dealerId?.name || '-'}
                    </Link>
                  ) : (
                    order.dealerId?.name || '-'
                  )}
                </span>
              </div>
              <div className={styles.infoItem}>
                <span className={styles.label}>Shop Name:</span>
                <span className={styles.value}>
                  {(typeof order.dealerId === 'object' && order.dealerId?.shopName?.trim()) || '-'}
                </span>
              </div>
              {order.routeId && (
                <div className={styles.infoItem}>
                  <span className={styles.label}>Route:</span>
                  <span className={styles.value}>{order.routeId?.name || '-'}</span>
                </div>
              )}
              <div className={styles.infoItem}>
                <span className={styles.label}>Source Warehouse:</span>
                <span className={styles.value}>
                  {order.warehouseId?.name || '-'}
                  {/* Changing it moves the reservation between warehouses, so it is admin-only and
                      only while the stock consequence is still live. */}
                  {isAdmin && canChangeWarehouse && (
                    <button
                      type="button"
                      className={styles.editButton}
                      style={{ marginLeft: '0.5rem', padding: '0.15rem 0.5rem', fontSize: '0.75rem' }}
                      onClick={() => setWarehouseModalOpen(true)}
                    >
                      Change
                    </button>
                  )}
                </span>
              </div>
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

          <div className={styles.section}>
            <h2>Punch location</h2>
            {punchLat == null || punchLng == null ? (
              <p style={{ margin: 0, color: '#6b7280', fontSize: '0.875rem' }}>
                No location was recorded when this order was punched. Orders punched by an order
                taker always carry one; admin-entered and older orders may not.
              </p>
            ) : (
              <>
                <div className={styles.infoGrid}>
                  <div className={styles.infoItem}>
                    <span className={styles.label}>Order taker was at:</span>
                    <span className={styles.value}>
                      {formatCoords(punchLat, punchLng)}{' '}
                      <a
                        href={mapsPointUrl(punchLat, punchLng)}
                        target="_blank"
                        rel="noreferrer"
                        style={{ color: 'var(--admin-primary)', textDecoration: 'underline' }}
                      >
                        Open in Maps
                      </a>
                    </span>
                  </div>
                  <div className={styles.infoItem}>
                    <span className={styles.label}>Client location:</span>
                    <span className={styles.value}>
                      {clientLat == null || clientLng == null ? (
                        'No map pin on this client'
                      ) : (
                        <>
                          {formatCoords(clientLat, clientLng)}{' '}
                          <a
                            href={mapsPointUrl(clientLat, clientLng)}
                            target="_blank"
                            rel="noreferrer"
                            style={{ color: 'var(--admin-primary)', textDecoration: 'underline' }}
                          >
                            Open in Maps
                          </a>
                          {/* The snapshot is what the distance was measured against; say so when the
                              client has since been re-pinned somewhere else. */}
                          {clientPinIsSnapshot && livePinMoved && (
                            <span style={{ display: 'block', fontSize: '0.8125rem', color: '#6b7280' }}>
                              Pin as it was when the order was punched; the client has been re-pinned
                              since.
                            </span>
                          )}
                        </>
                      )}
                    </span>
                  </div>
                  <div className={styles.infoItem}>
                    <span className={styles.label}>Distance apart:</span>
                    <span className={styles.value}>
                      {punchDistanceMetres == null ? (
                        '-'
                      ) : (
                        <>
                          {formatDistance(punchDistanceMetres)}
                          <span style={{ display: 'block', fontSize: '0.8125rem', color: '#6b7280' }}>
                            Straight-line distance, not road distance.
                          </span>
                        </>
                      )}
                    </span>
                  </div>
                  <div className={styles.infoItem}>
                    <span className={styles.label}>Punched at:</span>
                    <span className={styles.value}>
                      {order.createdAt ? format(new Date(order.createdAt), 'MMM dd, yyyy HH:mm') : '-'}
                    </span>
                  </div>
                </div>
                {punchMarkers.length > 0 && <MapView markers={punchMarkers} height="320px" />}
              </>
            )}
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
            <div className={styles.sectionHeadRow}>
              <h2>Products</h2>
              <DataExportButton
                columns={productExportColumns}
                rows={order.products ?? []}
                fileName={`order-${order.invoiceNumber ?? order._id}-products`}
                pdfTitle={`Order ${order.invoiceNumber ? `#${order.invoiceNumber}` : order._id} — Products`}
                grandTotalRow={productExportTotalRow}
              />
            </div>
            <div style={{ overflowX: 'auto', WebkitOverflowScrolling: 'touch', marginBottom: '0.5rem' }}>
              <table style={{ width: '100%', minWidth: 600, borderCollapse: 'collapse', color: '#1f2937' }}>
                <thead>
                  <tr style={{ background: '#f9fafb', borderBottom: '2px solid #e5e7eb' }}>
                    <th style={{ padding: '0.75rem', textAlign: 'left', fontWeight: 600, color: '#374151' }}>Product</th>
                    <th style={{ padding: '0.75rem', textAlign: 'center', fontWeight: 600, color: '#374151' }}>Qty</th>
                    <th style={{ padding: '0.75rem', textAlign: 'right', fontWeight: 600, color: '#374151' }}>Unit Price</th>
                    <th style={{ padding: '0.75rem', textAlign: 'right', fontWeight: 600, color: '#374151' }}>Discount</th>
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
                      <td style={{ padding: '0.75rem', textAlign: 'right', color: '#047857' }}>
                        {lineDiscountOf(item) > 0 ? `-Rs. ${lineDiscountOf(item).toFixed(2)}` : '—'}
                      </td>
                      <td style={{ padding: '0.75rem', textAlign: 'right', fontWeight: 500, color: '#1f2937' }}>
                        Rs. {(item.quantity * item.price - lineDiscountOf(item)).toFixed(2)}
                      </td>
                    </tr>
                  ))}
                </tbody>
                <tfoot>
                  <tr>
                    <td colSpan={4} style={{ padding: '0.75rem', textAlign: 'right', fontWeight: 600, color: '#374151' }}>
                      Subtotal:
                    </td>
                    <td style={{ padding: '0.75rem', textAlign: 'right', fontWeight: 600, color: '#1f2937' }}>
                      Rs. {totalPrice.toFixed(2)}
                    </td>
                  </tr>
                  {itemsDiscountTotal > 0 && (
                    <tr>
                      <td colSpan={4} style={{ padding: '0.75rem', textAlign: 'right', color: '#047857', fontWeight: 600 }}>
                        Item Discounts:
                      </td>
                      <td style={{ padding: '0.75rem', textAlign: 'right', color: '#047857' }}>
                        -Rs. {itemsDiscountTotal.toFixed(2)}
                      </td>
                    </tr>
                  )}
                  {discount > 0 && (
                    <tr>
                      <td colSpan={4} style={{ padding: '0.75rem', textAlign: 'right', color: '#047857', fontWeight: 600 }}>
                        Order Discount:
                      </td>
                      <td style={{ padding: '0.75rem', textAlign: 'right', color: '#047857' }}>
                        -Rs. {discount.toFixed(2)}
                      </td>
                    </tr>
                  )}
                  <tr style={{ background: '#f9fafb', borderTop: '2px solid #e5e7eb' }}>
                    <td colSpan={4} style={{ padding: '0.75rem', textAlign: 'right', fontWeight: 700, fontSize: '1.1rem', color: '#374151' }}>
                      Grand Total:
                    </td>
                    <td style={{ padding: '0.75rem', textAlign: 'right', fontWeight: 700, fontSize: '1.1rem', color: '#1d4ed8' }}>
                      Rs. {grandTotal.toFixed(2)}
                    </td>
                  </tr>
                  {order.paidAmount !== undefined && (
                    <tr>
                      <td colSpan={4} style={{ padding: '0.75rem', textAlign: 'right', color: '#047857', fontWeight: 600 }}>
                        Paid:
                      </td>
                      <td style={{ padding: '0.75rem', textAlign: 'right', color: '#047857' }}>
                        Rs. {order.paidAmount.toFixed(2)}
                      </td>
                    </tr>
                  )}
                  {order.paidAmount !== undefined && (
                    <tr>
                      <td colSpan={4} style={{ padding: '0.75rem', textAlign: 'right', fontWeight: 600, color: grandTotal - order.paidAmount > 0 ? '#b91c1c' : '#047857' }}>
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

      {warehouseModalOpen && order && (
        <div
          className={modalStyles.modalOverlay}
          role="presentation"
          onClick={() => {
            if (!warehouseBusy) setWarehouseModalOpen(false);
          }}
        >
          <div
            className={modalStyles.modalContent}
            role="dialog"
            aria-modal="true"
            aria-label="Change source warehouse"
            onClick={(e) => e.stopPropagation()}
          >
            <div className={modalStyles.modalHeader}>
              <h2>Change source warehouse</h2>
            </div>
            <p style={{ margin: '0 0 16px', color: '#4b5563', fontSize: 14, lineHeight: 1.5 }}>
              The stock reserved for this order goes back to{' '}
              <strong>{order.warehouseId?.name ?? 'the current warehouse'}</strong> and is taken from
              the one you pick instead. Total stock does not change. If the new warehouse does not
              have enough, the change is refused.
            </p>

            <div className={modalStyles.formGroup}>
              <label htmlFor="warehouseDraft">New source warehouse</label>
              <SearchableSelect
                id="warehouseDraft"
                name="warehouseDraft"
                value={warehouseDraft}
                onChange={(e) => setWarehouseDraft(e.target.value)}
                placeholder="Select warehouse"
                options={[
                  { value: '', label: 'Select warehouse' },
                  ...warehouseSelectOptions(
                    warehouses.filter((w) => w._id !== String(order.warehouseId?._id ?? '')),
                  ),
                ]}
              />
            </div>

            <div className={modalStyles.modalActions}>
              <button
                type="button"
                className={modalStyles.cancelButton}
                onClick={() => setWarehouseModalOpen(false)}
                disabled={warehouseBusy}
              >
                Cancel
              </button>
              <button
                type="button"
                className={modalStyles.submitButton}
                onClick={handleChangeWarehouse}
                disabled={warehouseBusy || !warehouseDraft}
              >
                {warehouseBusy ? 'Moving…' : 'Change warehouse'}
              </button>
            </div>
          </div>

          {/* Renders nothing until this order has actually posted something, so it does not sit
              empty on every order while automatic posting is still being switched on. */}
          <PostedEntries sourceId={String(order._id)} title="What this order did to the accounts" />
        </div>
      )}
    </Layout>
  );
};

export default function OrderDetailPageWrapper() {
  return (
    <ProtectedRoute permission="orders:view">
      <OrderDetailPage />
    </ProtectedRoute>
  );
}
