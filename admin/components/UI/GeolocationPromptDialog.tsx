import React from 'react';
import modalStyles from '../../styles/Modal.module.scss';
import type { GeolocationDialogVariant } from '../../hooks/useGeolocationPicker';

interface GeolocationPromptDialogProps {
  variant: GeolocationDialogVariant;
  onClose: () => void;
  onConsentContinue: () => void;
}

const GeolocationPromptDialog: React.FC<GeolocationPromptDialogProps> = ({
  variant,
  onClose,
  onConsentContinue,
}) => {
  if (variant === 'none') return null;

  const handleBackdrop = (e: React.MouseEvent) => {
    if (e.target === e.currentTarget) onClose();
  };

  if (variant === 'consent') {
    return (
      <div className={modalStyles.modalOverlay} onClick={handleBackdrop} role="presentation">
        <div
          className={modalStyles.modalContent}
          onClick={(e) => e.stopPropagation()}
          role="dialog"
          aria-modal="true"
          aria-labelledby="geo-consent-title"
        >
          <div className={modalStyles.modalHeader}>
            <h2 id="geo-consent-title">Use your location?</h2>
          </div>
          <p style={{ margin: 0, color: '#4b5563', lineHeight: 1.5 }}>
            We will fill latitude and longitude from your current position. After you continue, your
            browser will ask whether to allow location for this site — choose <strong>Allow</strong> so
            we can read your coordinates.
          </p>
          <div className={modalStyles.modalActions}>
            <button type="button" className={modalStyles.cancelButton} onClick={onClose}>
              Cancel
            </button>
            <button type="button" className={modalStyles.submitButton} onClick={onConsentContinue}>
              Continue
            </button>
          </div>
        </div>
      </div>
    );
  }

  if (variant === 'blocked') {
    return (
      <div className={modalStyles.modalOverlay} onClick={handleBackdrop} role="presentation">
        <div
          className={modalStyles.modalContent}
          onClick={(e) => e.stopPropagation()}
          role="dialog"
          aria-modal="true"
          aria-labelledby="geo-blocked-title"
        >
          <div className={modalStyles.modalHeader}>
            <h2 id="geo-blocked-title">Location access is off</h2>
          </div>
          <p style={{ margin: 0, color: '#4b5563', lineHeight: 1.5 }}>
            This site can’t read your location until you allow it. Open your browser’s site settings
            for this page (usually the lock or info icon in the address bar), find <strong>Location</strong>,
            and set it to <strong>Allow</strong>. Then use &quot;Use current location&quot; again, or enter
            coordinates manually.
          </p>
          <div className={modalStyles.modalActions}>
            <button type="button" className={modalStyles.submitButton} onClick={onClose}>
              OK
            </button>
          </div>
        </div>
      </div>
    );
  }

  /* unsupported */
  return (
    <div className={modalStyles.modalOverlay} onClick={handleBackdrop} role="presentation">
      <div
        className={modalStyles.modalContent}
        onClick={(e) => e.stopPropagation()}
        role="dialog"
        aria-modal="true"
        aria-labelledby="geo-unsupported-title"
      >
        <div className={modalStyles.modalHeader}>
          <h2 id="geo-unsupported-title">Location not available</h2>
        </div>
        <p style={{ margin: 0, color: '#4b5563', lineHeight: 1.5 }}>
          Your browser does not support geolocation, or it is disabled. Enter latitude and longitude
          manually, or try another browser.
        </p>
        <div className={modalStyles.modalActions}>
          <button type="button" className={modalStyles.submitButton} onClick={onClose}>
            OK
          </button>
        </div>
      </div>
    </div>
  );
};

export default GeolocationPromptDialog;
