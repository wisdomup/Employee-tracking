import React, { useState, useEffect } from 'react';
import { useRouter } from 'next/router';
import Layout from '../../../components/Layout/Layout';
import ProtectedRoute from '../../../components/Auth/ProtectedRoute';
import {
  visitService,
  Visit,
  VisitCompletionImage,
  VisitGalleryImage,
  getVisitCompletionImageUrl,
  CHECK_IN_RADIUS_METRES,
  VISIT_DURATION_LIMIT_MINUTES,
  VISIT_COMPLETION_THRESHOLD_PERCENT,
} from '../../../services/visitService';
import { ImageUpload } from '../../../components/UI/ImageUpload';
import { useAuth } from '../../../contexts/AuthContext';
import { toast } from 'react-toastify';
import { format } from 'date-fns';
import Loader from '../../../components/UI/Loader';
import StatusBadge from '../../../components/UI/StatusBadge';
import styles from '../../../styles/FormPage.module.scss';
import SearchableSelect from '../../../components/UI/SearchableSelect';
import SkipVisitModal from '../../../components/Visits/SkipVisitModal';

/** Most extra shop photos a rider may attach after checkout (matches the backend cap). */
const MAX_GALLERY_IMAGES = 10;

const GEO_OPTIONS: PositionOptions = {
  enableHighAccuracy: true,
  timeout: 20_000,
  maximumAge: 0,
};

function requestCurrentPosition(): Promise<GeolocationPosition> {
  return new Promise((resolve, reject) => {
    if (!navigator.geolocation) {
      reject(new Error('Geolocation is not supported by this browser'));
      return;
    }
    navigator.geolocation.getCurrentPosition(resolve, reject, GEO_OPTIONS);
  });
}

/** Pull a human-readable message out of an axios-style error. */
function extractApiMessage(error: unknown): string | null {
  if (error && typeof error === 'object' && 'response' in error) {
    return (error as { response?: { data?: { message?: string } } }).response?.data?.message ?? null;
  }
  return null;
}

const EditVisitPage: React.FC = () => {
  const router = useRouter();
  const { id } = router.query;
  const [visit, setVisit] = useState<Visit | null>(null);
  const [loading, setLoading] = useState(false);
  const [checkingIn, setCheckingIn] = useState(false);
  const [fetchLoading, setFetchLoading] = useState(true);
  const [formData, setFormData] = useState({
    visitDate: '',
    status: 'todo',
  });
  const { user } = useAuth();
  const isOrderTaker = user?.role === 'order_taker';
  const [latitude, setLatitude] = useState<number | null>(null);
  const [longitude, setLongitude] = useState<number | null>(null);
  const [locationError, setLocationError] = useState<string | null>(null);
  const [locationLoading, setLocationLoading] = useState(false);
  const [shopImageUrl, setShopImageUrl] = useState('');
  const [selfieImageUrl, setSelfieImageUrl] = useState('');
  // Post-checkout shop documentation (optional extra photos + description).
  const [showGalleryStep, setShowGalleryStep] = useState(false);
  const [galleryImages, setGalleryImages] = useState<VisitGalleryImage[]>([]);
  const [visitNotes, setVisitNotes] = useState('');
  const [savingGallery, setSavingGallery] = useState(false);
  /** Bumped after each upload so the ImageUpload slot resets for the next photo. */
  const [galleryUploadKey, setGalleryUploadKey] = useState(0);
  const [showSkipModal, setShowSkipModal] = useState(false);

  useEffect(() => {
    if (!id || !user) return;
    fetchVisit();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id, user?.role]);

  const fetchVisit = async () => {
    try {
      const data: Visit = await visitService.getVisit(id as string);
      setVisit(data);
      setFormData({
        visitDate: data.visitDate ? data.visitDate.slice(0, 10) : '',
        status: data.status,
      });
      setGalleryImages(data.galleryImages ?? []);
      setVisitNotes(data.visitNotes ?? '');
    } catch (error) {
      toast.error('Failed to fetch visit');
    } finally {
      setFetchLoading(false);
    }
  };

  // While checked in, tick every 30s so the rider sees their elapsed time at the store.
  const [nowTick, setNowTick] = useState(() => Date.now());
  useEffect(() => {
    if (visit?.status !== 'checked_in') return;
    const timer = window.setInterval(() => setNowTick(Date.now()), 30_000);
    return () => window.clearInterval(timer);
  }, [visit?.status]);

  const elapsedMinutes =
    visit?.checkedInAt != null
      ? Math.max(0, Math.floor((nowTick - new Date(visit.checkedInAt).getTime()) / 60_000))
      : null;

  const handleChange = (
    e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>,
  ) => {
    const { name, value } = e.target;
    setFormData((prev) => ({ ...prev, [name]: value }));
  };

  const handleGetLocation = () => {
    if (!navigator.geolocation) {
      setLocationError('Geolocation is not supported by your browser');
      return;
    }
    setLocationError(null);
    setLocationLoading(true);
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        setLatitude(pos.coords.latitude);
        setLongitude(pos.coords.longitude);
        setLocationLoading(false);
      },
      () => {
        setLocationError('Could not get location. You can enter coordinates manually.');
        setLocationLoading(false);
      },
      { enableHighAccuracy: true },
    );
  };

  // ---- Rider (order_taker) flow: check in at the store, then complete/checkout ----

  const handleCheckIn = async () => {
    setCheckingIn(true);
    let pos: GeolocationPosition;
    try {
      pos = await requestCurrentPosition();
    } catch {
      toast.error('Could not get your location. Allow location access for this site and try again.');
      setCheckingIn(false);
      return;
    }
    try {
      await visitService.checkInVisit(id as string, {
        latitude: pos.coords.latitude,
        longitude: pos.coords.longitude,
      });
      // Re-fetch rather than using the response: the check-in payload is not fully
      // populated, so assigning it directly would blank the client/route names.
      await fetchVisit();
      toast.success('Checked in at the store. Complete the visit when you are done.');
    } catch (error) {
      toast.error(
        extractApiMessage(error) ||
          'Could not check in. Make sure you are at the store and location is enabled.',
      );
    } finally {
      setCheckingIn(false);
    }
  };

  const handleRiderComplete = async () => {
    if (!shopImageUrl || !selfieImageUrl) {
      toast.error('To complete the visit, add a shop photo and a selfie.');
      return;
    }
    setLoading(true);
    let pos: GeolocationPosition;
    try {
      pos = await requestCurrentPosition();
    } catch {
      toast.error('Could not get your location. Allow location access for this site and try again.');
      setLoading(false);
      return;
    }
    try {
      const completionImages: VisitCompletionImage[] = [
        { type: 'shop', url: shopImageUrl },
        { type: 'selfie', url: selfieImageUrl },
      ];
      await visitService.completeVisit(id as string, {
        latitude: pos.coords.latitude,
        longitude: pos.coords.longitude,
        completionImages,
      });
      // Re-fetch for the fully populated visit (and the computed duration / flag).
      await fetchVisit();
      toast.success('Checked out. Visit completed.');
      // Stay on the page so the rider can optionally document the shop.
      setShowGalleryStep(true);
    } catch (error) {
      toast.error(extractApiMessage(error) || 'Failed to complete visit');
    } finally {
      setLoading(false);
    }
  };

  const handleAddGalleryImage = (url: string) => {
    if (!url) return;
    setGalleryImages((prev) =>
      prev.length >= MAX_GALLERY_IMAGES ? prev : [...prev, { url }],
    );
    setGalleryUploadKey((k) => k + 1);
  };

  const handleRemoveGalleryImage = (index: number) => {
    setGalleryImages((prev) => prev.filter((_, i) => i !== index));
  };

  const handleSaveGallery = async () => {
    if (galleryImages.length === 0 && !visitNotes.trim()) {
      toast.info('Nothing to save — add a photo or a description first.');
      return;
    }
    setSavingGallery(true);
    try {
      await visitService.updateVisitGallery(id as string, {
        galleryImages,
        visitNotes: visitNotes.trim(),
      });
      toast.success('Shop photos and notes saved');
      router.push(`/visits/${id}`);
    } catch (error) {
      toast.error(extractApiMessage(error) || 'Failed to save shop photos');
    } finally {
      setSavingGallery(false);
    }
  };

  // ---- Admin flow: full edit form ----

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    const isCompleting = formData.status === 'completed' && !visit?.completedAt;
    if (isCompleting) {
      if (!shopImageUrl || !selfieImageUrl) {
        toast.error('To mark as completed, add a shop photo and a selfie.');
        return;
      }
      if (latitude == null || longitude == null) {
        toast.error('To mark as completed, please provide location, shop image, and selfie.');
        return;
      }
    }
    setLoading(true);
    try {
      if (isCompleting) {
        const completionImages: VisitCompletionImage[] = [
          { type: 'shop', url: shopImageUrl },
          { type: 'selfie', url: selfieImageUrl },
        ];
        await visitService.completeVisit(id as string, {
          latitude: latitude as number,
          longitude: longitude as number,
          completionImages,
        });
        toast.success('Visit marked as completed');
        router.push(`/visits/${id}`);
      } else {
        const clientId =
          typeof visit?.dealerId === 'string'
            ? visit.dealerId
            : (visit?.dealerId as { _id?: string })?._id ?? visit?.dealerId;
        const employeeId =
          typeof visit?.employeeId === 'string'
            ? visit.employeeId
            : (visit?.employeeId as { _id?: string })?._id ?? visit?.employeeId;
        if (!clientId || !employeeId) {
          toast.error('Visit data is missing client or employee. Cannot update.');
          setLoading(false);
          return;
        }
        await visitService.updateVisit(id as string, {
          dealerId: clientId,
          employeeId,
          visitDate: formData.visitDate || undefined,
          status: formData.status as Visit['status'],
        });
        toast.success('Visit updated successfully');
        router.push('/visits');
      }
    } catch (error: unknown) {
      toast.error(extractApiMessage(error) || 'Failed to update visit');
    } finally {
      setLoading(false);
    }
  };

  if (fetchLoading) return <Layout><Loader /></Layout>;

  const clientName = visit?.dealerId?.name ?? '-';
  const routeName = visit?.routeId?.name ?? '-';
  const employeeName =
    visit?.employeeId?.username ?? visit?.employeeId?.userID ?? '-';

  // ============================= RIDER (order_taker) VIEW =============================
  if (isOrderTaker) {
    const status = visit?.status;
    return (
      <Layout>
        <div className={styles.container}>
          <div className={styles.header}>
            <h1>Visit</h1>
            <button className={styles.backButton} onClick={() => router.push('/visits')}>
              ← Back
            </button>
          </div>

          <div className={styles.form}>
            <div className={styles.formGroup}>
              <label>Visit details</label>
              <div
                style={{
                  display: 'grid',
                  gap: '0.5rem',
                  fontSize: '0.875rem',
                  color: '#374151',
                  marginBottom: '0.5rem',
                }}
              >
                <div><strong>Client:</strong> {clientName}</div>
                <div><strong>Route:</strong> {routeName}</div>
                <div><strong>Employee:</strong> {employeeName}</div>
                <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                  <strong>Status:</strong> <StatusBadge status={(status ?? 'todo') as Visit['status']} />
                </div>
                {visit?.checkedInAt && (
                  <div>
                    <strong>Checked in at:</strong>{' '}
                    {format(new Date(visit.checkedInAt), 'MMM dd, yyyy hh:mm a')}
                  </div>
                )}
              </div>
            </div>

            {/* Step 1 — must check in before completing */}
            {(status === 'todo' || status === 'in_progress') && (
              <div className={styles.formGroup}>
                <label>Step 1 · Check in at the store</label>
                <p style={{ color: '#6b7280', fontSize: '0.875rem', marginBottom: '0.75rem' }}>
                  You must check in at the store before you can complete this visit. When you tap
                  <strong> Check In</strong>, your current location is captured and must be within
                  ~{CHECK_IN_RADIUS_METRES} metres of the store (allow location access if prompted).
                </p>
                <div style={{ display: 'flex', gap: '0.5rem', flexWrap: 'wrap' }}>
                  <button
                    type="button"
                    className={styles.submitButton}
                    onClick={handleCheckIn}
                    disabled={checkingIn}
                  >
                    {checkingIn ? 'Checking in…' : 'Check In at Store'}
                  </button>
                  <button
                    type="button"
                    className={styles.cancelButton}
                    onClick={() => setShowSkipModal(true)}
                  >
                    Skip this visit
                  </button>
                </div>
                <p style={{ color: '#9ca3af', fontSize: '0.75rem', marginTop: '0.5rem' }}>
                  You must complete at least {VISIT_COMPLETION_THRESHOLD_PERCENT}% of today&apos;s
                  visits. Skipping too many is reported to your supervisor.
                </p>
              </div>
            )}

            {status === 'skipped' && (
              <div className={styles.formGroup}>
                <div
                  style={{
                    padding: '0.75rem',
                    borderRadius: '0.5rem',
                    background: '#fef3c7',
                    border: '1px solid #fde68a',
                    color: '#92400e',
                    fontSize: '0.9375rem',
                  }}
                >
                  <strong>Skipped.</strong>{' '}
                  {visit?.skippedAt && `On ${format(new Date(visit.skippedAt), 'MMM dd, hh:mm a')}. `}
                  {visit?.skipReason && `Reason: ${visit.skipReason}`}
                </div>
              </div>
            )}

            {/* Step 2 — after check-in, complete / checkout */}
            {status === 'checked_in' && (
              <>
                <div className={styles.formGroup}>
                  <label>Step 2 · Complete the visit</label>
                  {elapsedMinutes != null && (
                    <div
                      style={{
                        display: 'flex',
                        alignItems: 'center',
                        gap: '0.5rem',
                        padding: '0.625rem 0.75rem',
                        marginBottom: '0.5rem',
                        borderRadius: '0.5rem',
                        fontSize: '0.875rem',
                        background: elapsedMinutes > VISIT_DURATION_LIMIT_MINUTES ? '#fef2f2' : '#f0f9ff',
                        color: elapsedMinutes > VISIT_DURATION_LIMIT_MINUTES ? '#b91c1c' : '#0369a1',
                        border: `1px solid ${
                          elapsedMinutes > VISIT_DURATION_LIMIT_MINUTES ? '#fecaca' : '#bae6fd'
                        }`,
                      }}
                    >
                      <strong>{elapsedMinutes} min</strong>
                      <span>
                        {elapsedMinutes > VISIT_DURATION_LIMIT_MINUTES
                          ? `at this store — over the ${VISIT_DURATION_LIMIT_MINUTES} min limit. This visit will be flagged for admin review.`
                          : `at this store — ${VISIT_DURATION_LIMIT_MINUTES} min allowed.`}
                      </span>
                    </div>
                  )}
                  <p style={{ color: '#6b7280', fontSize: '0.875rem', marginBottom: '0.5rem' }}>
                    You are checked in. When you finish, take a shop photo and a selfie, then tap
                    <strong> Complete &amp; Checkout</strong>. Your location is captured automatically.
                  </p>
                </div>
                <div className={styles.formGroup}>
                  <ImageUpload
                    label="Shop image"
                    category="completions"
                    value={shopImageUrl}
                    onChange={setShopImageUrl}
                    cameraOnly
                  />
                </div>
                <div className={styles.formGroup}>
                  <ImageUpload
                    label="Selfie (employee)"
                    category="completions"
                    value={selfieImageUrl}
                    onChange={setSelfieImageUrl}
                    cameraOnly
                    preferredFacingMode="user"
                  />
                </div>
                <div className={styles.formActions}>
                  <button
                    type="button"
                    className={styles.cancelButton}
                    onClick={() => router.push(`/visits/${id}`)}
                  >
                    Cancel
                  </button>
                  <button
                    type="button"
                    className={styles.submitButton}
                    onClick={handleRiderComplete}
                    disabled={loading}
                  >
                    {loading ? 'Completing…' : 'Complete & Checkout'}
                  </button>
                </div>
              </>
            )}

            {status === 'completed' && (
              <>
                <div className={styles.formGroup}>
                  <div
                    style={{
                      padding: '0.75rem',
                      borderRadius: '0.5rem',
                      background: '#ecfdf5',
                      border: '1px solid #a7f3d0',
                      color: '#065f46',
                      fontSize: '0.9375rem',
                    }}
                  >
                    <strong>Checked out.</strong> This visit is completed
                    {visit?.completedAt
                      ? ` at ${format(new Date(visit.completedAt), 'hh:mm a')}`
                      : ''}
                    {visit?.durationMinutes != null && ` · ${visit.durationMinutes} min at the store`}.
                  </div>
                  {visit?.overstayFlagged && (
                    <div
                      style={{
                        marginTop: '0.5rem',
                        padding: '0.75rem',
                        borderRadius: '0.5rem',
                        background: '#fef2f2',
                        border: '1px solid #fecaca',
                        color: '#b91c1c',
                        fontSize: '0.875rem',
                      }}
                    >
                      This visit took longer than the {VISIT_DURATION_LIMIT_MINUTES} minute limit and has
                      been flagged for admin review.
                    </div>
                  )}
                </div>

                {/* Step 3 — optional shop documentation, kept open right after checkout */}
                {showGalleryStep || galleryImages.length > 0 || visitNotes ? (
                  <>
                    <div className={styles.formGroup}>
                      <label>Step 3 · Shop photos &amp; description (optional)</label>
                      <p style={{ color: '#6b7280', fontSize: '0.875rem', marginBottom: '0.5rem' }}>
                        Add any extra photos of the shop and a short description. These are saved to this
                        client&apos;s photo gallery under your name, so the office can see what you recorded.
                      </p>

                      {galleryImages.length > 0 && (
                        <div
                          style={{
                            display: 'flex',
                            gap: '0.75rem',
                            flexWrap: 'wrap',
                            marginBottom: '0.75rem',
                          }}
                        >
                          {galleryImages.map((img, idx) => (
                            <div key={`${img.url}-${idx}`} style={{ position: 'relative' }}>
                              <img
                                src={getVisitCompletionImageUrl(img.url)}
                                alt={`Shop photo ${idx + 1}`}
                                style={{
                                  width: 110,
                                  height: 110,
                                  objectFit: 'cover',
                                  borderRadius: '0.5rem',
                                  border: '2px solid #e5e7eb',
                                }}
                              />
                              <button
                                type="button"
                                aria-label={`Remove shop photo ${idx + 1}`}
                                onClick={() => handleRemoveGalleryImage(idx)}
                                style={{
                                  position: 'absolute',
                                  top: 4,
                                  right: 4,
                                  width: 24,
                                  height: 24,
                                  borderRadius: '50%',
                                  border: 'none',
                                  background: 'rgba(0,0,0,0.65)',
                                  color: '#fff',
                                  cursor: 'pointer',
                                  lineHeight: 1,
                                }}
                              >
                                ✕
                              </button>
                            </div>
                          ))}
                        </div>
                      )}

                      {galleryImages.length < MAX_GALLERY_IMAGES ? (
                        <ImageUpload
                          key={galleryUploadKey}
                          label={galleryImages.length === 0 ? 'Add a shop photo' : 'Add another photo'}
                          category="completions"
                          value=""
                          onChange={handleAddGalleryImage}
                        />
                      ) : (
                        <p style={{ color: '#6b7280', fontSize: '0.875rem' }}>
                          Maximum of {MAX_GALLERY_IMAGES} photos reached.
                        </p>
                      )}
                    </div>

                    <div className={styles.formGroup}>
                      <label htmlFor="visitNotes">Description</label>
                      <textarea
                        id="visitNotes"
                        className={styles.input}
                        rows={4}
                        maxLength={2000}
                        value={visitNotes}
                        onChange={(e) => setVisitNotes(e.target.value)}
                        placeholder="Anything useful about this shop — stock levels, owner feedback, condition, etc."
                        style={{ resize: 'vertical', fontFamily: 'inherit' }}
                      />
                      <span style={{ fontSize: '0.75rem', color: '#9ca3af' }}>
                        {visitNotes.length}/2000
                      </span>
                    </div>

                    <div className={styles.formActions}>
                      <button
                        type="button"
                        className={styles.cancelButton}
                        onClick={() => router.push(`/visits/${id}`)}
                      >
                        Skip
                      </button>
                      <button
                        type="button"
                        className={styles.submitButton}
                        onClick={handleSaveGallery}
                        disabled={savingGallery}
                      >
                        {savingGallery ? 'Saving…' : 'Save & Finish'}
                      </button>
                    </div>
                  </>
                ) : (
                  <div className={styles.formActions}>
                    <button
                      type="button"
                      className={styles.cancelButton}
                      onClick={() => setShowGalleryStep(true)}
                    >
                      Add shop photos &amp; notes
                    </button>
                    <button
                      type="button"
                      className={styles.submitButton}
                      onClick={() => router.push(`/visits/${id}`)}
                    >
                      View visit details
                    </button>
                  </div>
                )}
              </>
            )}

            {showSkipModal && (
              <SkipVisitModal
                visitId={id as string}
                clientName={clientName}
                onClose={() => setShowSkipModal(false)}
                onSkipped={() => {
                  setShowSkipModal(false);
                  fetchVisit();
                }}
              />
            )}

            {(status === 'incomplete' || status === 'cancelled') && (
              <div className={styles.formGroup}>
                <p style={{ color: '#6b7280', fontSize: '0.9375rem' }}>
                  This visit is {status.replace(/_/g, ' ')} and can no longer be checked in or completed.
                </p>
              </div>
            )}
          </div>
        </div>
      </Layout>
    );
  }

  // ============================= ADMIN VIEW =============================
  const visitStatusSelectOptions = [
    { value: 'todo', label: 'To Do' },
    { value: 'in_progress', label: 'In Progress' },
    { value: 'checked_in', label: 'Checked In' },
    { value: 'completed', label: 'Completed' },
    { value: 'incomplete', label: 'Incomplete' },
    { value: 'cancelled', label: 'Cancelled' },
  ];

  return (
    <Layout>
      <div className={styles.container}>
        <div className={styles.header}>
          <h1>Edit Visit</h1>
          <button className={styles.backButton} onClick={() => router.push('/visits')}>
            ← Back
          </button>
        </div>
        <form onSubmit={handleSubmit} className={styles.form}>
          <div className={styles.formGroup}>
            <label htmlFor="visitDate">Visit Date</label>
            <input
              type="date"
              id="visitDate"
              name="visitDate"
              value={formData.visitDate}
              onChange={handleChange}
              className={styles.input}
            />
          </div>
          <div className={styles.formGroup}>
            <label htmlFor="status">Status *</label>
            <SearchableSelect
              id="status"
              name="status"
              value={formData.status}
              onChange={handleChange}
              className={styles.select}
              placeholder="Status"
              options={visitStatusSelectOptions}
            />
          </div>

          {formData.status === 'completed' && !visit?.completedAt && (
            <>
              <div className={styles.formGroup}>
                <label>Completion details</label>
                <p style={{ color: '#6b7280', fontSize: '0.875rem', marginBottom: '0.5rem' }}>
                  To mark this visit as completed, provide your current location, a shop image, and a
                  selfie.
                </p>
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.5rem', marginBottom: '0.5rem' }}>
                  <button
                    type="button"
                    className={styles.submitButton}
                    onClick={handleGetLocation}
                    disabled={locationLoading}
                  >
                    {locationLoading ? 'Getting location…' : 'Get my location'}
                  </button>
                  {latitude != null && longitude != null && (
                    <span style={{ fontSize: '0.875rem' }}>
                      Lat: {latitude.toFixed(6)}, Lng: {longitude.toFixed(6)}
                    </span>
                  )}
                </div>
                {locationError && (
                  <span
                    style={{
                      fontSize: '0.875rem',
                      color: '#dc2626',
                      display: 'block',
                      marginBottom: '0.5rem',
                    }}
                  >
                    {locationError}
                  </span>
                )}
                <div style={{ display: 'flex', gap: '0.5rem', flexWrap: 'wrap' }}>
                  <input
                    type="number"
                    step="any"
                    placeholder="Latitude"
                    value={latitude ?? ''}
                    onChange={(e) => setLatitude(e.target.value ? Number(e.target.value) : null)}
                    className={styles.input}
                    style={{ maxWidth: 140 }}
                  />
                  <input
                    type="number"
                    step="any"
                    placeholder="Longitude"
                    value={longitude ?? ''}
                    onChange={(e) => setLongitude(e.target.value ? Number(e.target.value) : null)}
                    className={styles.input}
                    style={{ maxWidth: 140 }}
                  />
                </div>
              </div>
              <div className={styles.formGroup}>
                <ImageUpload
                  label="Shop image"
                  category="completions"
                  value={shopImageUrl}
                  onChange={setShopImageUrl}
                />
              </div>
              <div className={styles.formGroup}>
                <ImageUpload
                  label="Selfie (employee)"
                  category="completions"
                  value={selfieImageUrl}
                  onChange={setSelfieImageUrl}
                />
              </div>
            </>
          )}

          {formData.status === 'completed' && visit?.completedAt && (
            <p style={{ color: '#6b7280', fontSize: '0.875rem' }}>
              This visit is already completed. You can change the visit date above and save.
            </p>
          )}

          <div className={styles.formActions}>
            <button type="button" className={styles.cancelButton} onClick={() => router.push('/visits')}>
              Cancel
            </button>
            <button type="submit" className={styles.submitButton} disabled={loading}>
              {loading ? 'Updating...' : 'Update Visit'}
            </button>
          </div>
        </form>
      </div>
    </Layout>
  );
};

export default function EditVisitPageWrapper() {
  return (
    <ProtectedRoute allowedRoles={['admin', 'order_taker']}>
      <EditVisitPage />
    </ProtectedRoute>
  );
}
