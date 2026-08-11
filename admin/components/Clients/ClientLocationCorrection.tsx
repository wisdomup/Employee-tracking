import React, { useCallback, useState } from 'react';
import { toast } from 'react-toastify';
import MapPicker from '../Map/MapPicker';
import GeolocationPromptDialog from '../UI/GeolocationPromptDialog';
import { useGeolocationPicker } from '../../hooks/useGeolocationPicker';
import { clientService, Client } from '../../services/clientService';
import styles from './ClientLocationCorrection.module.scss';

interface Props {
  client: Client;
  /** Receives the updated client so the page can re-render without a refetch. */
  onSaved: (updated: Client) => void;
  onClose: () => void;
}

type AddressForm = {
  street: string;
  city: string;
  state: string;
  country: string;
  postalCode: string;
};

function toAddressForm(address: Client['address']): AddressForm {
  return {
    street: address?.street ?? '',
    city: address?.city ?? '',
    state: address?.state ?? '',
    country: address?.country ?? '',
    postalCode: address?.postalCode ?? '',
  };
}

/**
 * The field-staff correction dialog: the pin and the postal address, nothing else.
 *
 * An order taker standing outside the shop is the only person who can see that the pin is on
 * the wrong street, so they get a write path — but a narrow one. Phone, category, route and
 * status remain on the full admin edit form.
 */
const ClientLocationCorrection: React.FC<Props> = ({ client, onSaved, onClose }) => {
  const [address, setAddress] = useState<AddressForm>(() => toAddressForm(client.address));
  const [latitude, setLatitude] = useState<number>(client.latitude ?? 0);
  const [longitude, setLongitude] = useState<number>(client.longitude ?? 0);
  const [saving, setSaving] = useState(false);

  const applyCoords = useCallback((lat: number, lng: number) => {
    setLatitude(lat);
    setLongitude(lng);
  }, []);

  const { locationLoading, geoVariant, openPicker, confirmConsent, closeDialog } =
    useGeolocationPicker(applyCoords);

  const handleAddressChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const { name, value } = e.target;
    setAddress((prev) => ({ ...prev, [name]: value }));
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!latitude && !longitude) {
      toast.error('Pick the shop location on the map first.');
      return;
    }
    setSaving(true);
    try {
      const updated = await clientService.updateClientLocation(client._id, {
        latitude,
        longitude,
        address,
      });
      toast.success('Client location updated');
      onSaved(updated);
      onClose();
    } catch (error: any) {
      toast.error(error?.response?.data?.message || 'Failed to update client location');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className={styles.overlay} role="dialog" aria-modal="true" aria-label="Correct client location">
      <div className={styles.dialog}>
        <div className={styles.header}>
          <div>
            <h2 className={styles.title}>Correct Location &amp; Address</h2>
            <p className={styles.subtitle}>
              {client.shopName || client.name} — only the map pin and the address are changed.
            </p>
          </div>
          <button type="button" className={styles.closeButton} onClick={onClose} aria-label="Close">
            ×
          </button>
        </div>

        <form className={styles.body} onSubmit={handleSubmit}>
          <div className={styles.mapActions}>
            <button
              type="button"
              className={styles.secondaryButton}
              onClick={() => void openPicker()}
              disabled={locationLoading}
            >
              {locationLoading ? 'Locating…' : 'Use my current location'}
            </button>
            <span className={styles.coords}>
              {latitude || longitude
                ? `${latitude.toFixed(6)}, ${longitude.toFixed(6)}`
                : 'No pin set'}
            </span>
          </div>

          <MapPicker
            latitude={latitude}
            longitude={longitude}
            onLocationSelect={applyCoords}
            height="300px"
          />
          <p className={styles.hint}>Tap the map to move the pin to the correct spot.</p>

          <div className={styles.fieldGrid}>
            <label className={styles.field}>
              <span>Street</span>
              <input name="street" value={address.street} onChange={handleAddressChange} />
            </label>
            <label className={styles.field}>
              <span>City</span>
              <input name="city" value={address.city} onChange={handleAddressChange} />
            </label>
            <label className={styles.field}>
              <span>State</span>
              <input name="state" value={address.state} onChange={handleAddressChange} />
            </label>
            <label className={styles.field}>
              <span>Country</span>
              <input name="country" value={address.country} onChange={handleAddressChange} />
            </label>
            <label className={styles.field}>
              <span>Postal code</span>
              <input name="postalCode" value={address.postalCode} onChange={handleAddressChange} />
            </label>
          </div>

          <div className={styles.actions}>
            <button type="button" className={styles.cancelButton} onClick={onClose} disabled={saving}>
              Cancel
            </button>
            <button type="submit" className={styles.submitButton} disabled={saving}>
              {saving ? 'Saving…' : 'Save Correction'}
            </button>
          </div>
        </form>
      </div>

      <GeolocationPromptDialog
        variant={geoVariant}
        onConsentContinue={confirmConsent}
        onClose={closeDialog}
      />
    </div>
  );
};

export default ClientLocationCorrection;
