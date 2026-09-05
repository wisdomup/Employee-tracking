import React, { useState } from 'react';
import { toast } from 'react-toastify';
import { writeOffRiderCash } from '../../services/financeService';
import { getApiErrorMessage } from '../../utils/apiError';
import { formatRs } from '../../utils/formatCurrency';
import formStyles from '../../styles/FormPage.module.scss';
import styles from '../../styles/Finance.module.scss';

/**
 * Accepting that money a rider was carrying is not coming back.
 *
 * Deliberately not a quick action beside the Receive buttons. Confirming a rider handed cash
 * over is routine; deciding they never will is not, and the two should not sit a click apart.
 *
 * The system never absorbs a shortfall on its own — when a settlement is corrected downwards the
 * difference stays on the rider's balance until somebody does this. That is the point: a system
 * that quietly writes off cash is one nobody can use to ask where the money went.
 */

interface RiderBalanceShape {
  cash: { inHand: number };
  online: { outstanding: number };
}

interface Props {
  riderId: string;
  balance: RiderBalanceShape | null;
  onCancel: () => void;
  onDone: () => void;
}

const RiderCashWriteOffPanel: React.FC<Props> = ({ riderId, balance, onCancel, onDone }) => {
  const [mode, setMode] = useState<'cash' | 'online'>('cash');
  const [amount, setAmount] = useState('');
  const [reason, setReason] = useState('');
  const [saving, setSaving] = useState(false);

  /*
   * Only a rider's own screen loads their balance; an admin's does not. Showing 0 in that case
   * would read as "this rider is carrying nothing", which is a different and wrong claim. The
   * server caps the amount at what they actually hold either way, so the honest thing is to say
   * the figure is not to hand rather than invent one.
   */
  const held = balance
    ? mode === 'cash'
      ? balance.cash.inHand
      : balance.online.outstanding
    : null;

  const submit = async () => {
    if (!riderId) {
      toast.error('Choose a rider first');
      return;
    }
    const value = Number(amount);
    if (!Number.isFinite(value) || value <= 0) {
      toast.error('Enter an amount greater than zero');
      return;
    }
    if (reason.trim().length < 3) {
      toast.error('Say why this is being written off');
      return;
    }

    // Named, with the figure in it. A confirmation that does not state the amount is one people
    // click through.
    if (
      !window.confirm(
        `Write off ${formatRs(value)} of ${mode} that this rider was carrying?\n\n`
          + 'This records it as a loss to the business. It cannot be undone except by a reversal.',
      )
    ) {
      return;
    }

    setSaving(true);
    try {
      await writeOffRiderCash({ riderId, mode, amount: value, reason: reason.trim() });
      toast.success('Written off, and recorded against this rider');
      setAmount('');
      setReason('');
      onDone();
    } catch (error) {
      toast.error(getApiErrorMessage(error, 'Could not write this off'));
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className={formStyles.form} style={{ marginBottom: '1.25rem' }}>
      <div className={`${styles.banner} ${styles.bannerBad}`}>
        <span className={styles.bannerTitle}>This records money as lost</span>
        Use it only when a shortfall has been confirmed and the rider is not going to hand it
        over. It reduces what they owe and books the difference as a loss to the business, with
        your name and reason attached.
      </div>

      {!riderId && (
        <p className={styles.readonlyNote}>
          Choose a rider in the filter above first, so the amount can be checked against what they
          are actually carrying.
        </p>
      )}

      <div className={formStyles.formRow}>
        <div className={formStyles.formGroup}>
          <label htmlFor="writeOffMode">What kind</label>
          <select
            id="writeOffMode"
            className={formStyles.select}
            value={mode}
            disabled={saving}
            onChange={(e) => setMode(e.target.value as 'cash' | 'online')}
          >
            <option value="cash">Cash</option>
            <option value="online">Online payments</option>
          </select>
          <p className={formStyles.hint}>
            {held !== null
              ? `This rider is currently carrying ${formatRs(held)} of ${mode}.`
              : 'The amount is checked against what this rider is actually carrying when you save.'}
          </p>
        </div>

        <div className={formStyles.formGroup}>
          <label htmlFor="writeOffAmount">How much</label>
          <input
            id="writeOffAmount"
            type="number"
            step="0.01"
            min="0"
            className={formStyles.input}
            value={amount}
            disabled={saving}
            onChange={(e) => setAmount(e.target.value)}
            placeholder="0.00"
          />
          <p className={formStyles.hint}>
            Cannot be more than they are carrying — that would leave the business owing them.
          </p>
        </div>
      </div>

      <div className={formStyles.formGroup}>
        <label htmlFor="writeOffReason">Why *</label>
        <input
          id="writeOffReason"
          type="text"
          className={formStyles.input}
          value={reason}
          disabled={saving}
          onChange={(e) => setReason(e.target.value)}
          placeholder="e.g. Cash stolen, police report filed"
        />
        <p className={formStyles.hint}>
          Recorded permanently against this rider and shown in the accounts.
        </p>
      </div>

      <div className={formStyles.formActions}>
        <button type="button" className={formStyles.cancelButton} onClick={onCancel}>
          Cancel
        </button>
        <button
          type="button"
          className={formStyles.submitButton}
          disabled={saving || !riderId}
          onClick={submit}
        >
          {saving ? 'Recording…' : 'Write It Off'}
        </button>
      </div>
    </div>
  );
};

export default RiderCashWriteOffPanel;
