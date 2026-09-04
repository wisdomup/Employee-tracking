import React, { useEffect, useState } from 'react';
import { useRouter } from 'next/router';
import { toast } from 'react-toastify';
import Layout from '../../../../components/Layout/Layout';
import ProtectedRoute from '../../../../components/Auth/ProtectedRoute';
import Loader from '../../../../components/UI/Loader';
import LedgerForm, {
  EMPTY_LEDGER_FORM,
  LedgerFormValues,
} from '../../../../components/Finance/LedgerForm';
import {
  financeService,
  AccountGroup,
  Ledger,
  SubledgerType,
} from '../../../../services/financeService';
import styles from '../../../../styles/FormPage.module.scss';
import finance from '../../../../styles/Finance.module.scss';

const EditLedgerPage: React.FC = () => {
  const router = useRouter();
  const { id } = router.query;

  const [groups, setGroups] = useState<AccountGroup[]>([]);
  const [ledger, setLedger] = useState<Ledger | null>(null);
  const [values, setValues] = useState<LedgerFormValues>(EMPTY_LEDGER_FORM);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (typeof id !== 'string') return;
    let cancelled = false;

    (async () => {
      setLoading(true);
      try {
        const [groupData, ledgerData] = await Promise.all([
          financeService.getGroups(),
          financeService.getLedger(id),
        ]);
        if (cancelled) return;
        setGroups(groupData);
        setLedger(ledgerData);
        setValues({
          name: ledgerData.name,
          code: ledgerData.code,
          groupId: ledgerData.groupId,
          description: ledgerData.description ?? '',
          openingAmount:
            ledgerData.openingBalance.amount !== 0
              ? String(ledgerData.openingBalance.amount)
              : '',
          openingAsOf: ledgerData.openingBalance.asOf
            ? ledgerData.openingBalance.asOf.slice(0, 10)
            : '',
          isControl: ledgerData.isControl,
          subledgerType: (ledgerData.subledgerType ?? '') as SubledgerType | '',
          isCashEquivalent: ledgerData.isCashEquivalent,
        });
      } catch (error: any) {
        toast.error(error.response?.data?.message || 'Could not load this account');
        router.push('/finance/chart');
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [id, router]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (typeof id !== 'string' || !ledger) return;

    if (!values.name.trim()) {
      toast.error('Give the account a name');
      return;
    }
    if (values.isControl && !values.subledgerType) {
      toast.error('A control account must say what it is broken down by');
      return;
    }

    // Only send what actually changed. Sending the whole form would trip the server's
    // history guards on fields the user never touched — an unchanged opening balance on a
    // posted account would be refused as an edit.
    const patch: Record<string, unknown> = {};
    if (values.name.trim() !== ledger.name) patch.name = values.name.trim();
    if (values.code !== ledger.code) patch.code = values.code;
    if (values.groupId !== ledger.groupId) patch.groupId = values.groupId;
    if ((values.description || '') !== (ledger.description ?? '')) {
      patch.description = values.description;
    }
    if (values.isControl !== ledger.isControl) patch.isControl = values.isControl;
    if ((values.subledgerType || null) !== (ledger.subledgerType ?? null)) {
      patch.subledgerType = values.subledgerType || null;
    }
    if (values.isCashEquivalent !== ledger.isCashEquivalent) {
      patch.isCashEquivalent = values.isCashEquivalent;
    }

    const nextOpeningAmount = values.openingAmount ? Number(values.openingAmount) : 0;
    const nextOpeningAsOf = values.openingAsOf || null;
    const currentAsOf = ledger.openingBalance.asOf
      ? ledger.openingBalance.asOf.slice(0, 10)
      : null;
    if (
      nextOpeningAmount !== ledger.openingBalance.amount
      || nextOpeningAsOf !== currentAsOf
    ) {
      patch.openingBalance = { amount: nextOpeningAmount, asOf: nextOpeningAsOf };
    }

    if (Object.keys(patch).length === 0) {
      toast.info('Nothing changed');
      return;
    }

    setSaving(true);
    try {
      const updated = await financeService.updateLedger(id, patch);
      toast.success(`${updated.code} · ${updated.name} saved`);
      router.push('/finance/chart');
    } catch (error: any) {
      toast.error(error.response?.data?.message || 'Could not save this account');
    } finally {
      setSaving(false);
    }
  };

  if (loading) {
    return (
      <Layout>
        <Loader />
      </Layout>
    );
  }

  return (
    <Layout>
      <div className={styles.container}>
        <div className={styles.header}>
          <h1>
            {ledger?.code} · {ledger?.name}
          </h1>
          <button className={styles.backButton} onClick={() => router.push('/finance/chart')}>
            ← Back
          </button>
        </div>

        {ledger?.isSystem && (
          <div className={`${finance.banner} ${finance.bannerInfo}`}>
            <span className={finance.bannerTitle}>The posting engine uses this account</span>
            Rename it and re-code it freely — the engine looks accounts up by their role, not by
            their code. It cannot be deleted or moved to a group of a different type.
          </div>
        )}

        {ledger && Math.abs(ledger.naturalBalance) > 0.005 && (
          <div className={`${finance.banner} ${finance.bannerInfo}`}>
            <span className={finance.bannerTitle}>This account has entries posted to it</span>
            Its type, control setting and opening balance are locked. Changing any of them would
            restate figures that have already been reported.
          </div>
        )}

        <form onSubmit={handleSubmit} className={styles.form}>
          <LedgerForm
            groups={groups}
            values={values}
            onChange={setValues}
            existing={ledger}
            disabled={saving}
          />

          <div className={styles.formActions}>
            <button
              type="button"
              className={styles.cancelButton}
              onClick={() => router.push('/finance/chart')}
            >
              Cancel
            </button>
            <button type="submit" className={styles.submitButton} disabled={saving}>
              {saving ? 'Saving…' : 'Save Changes'}
            </button>
          </div>
        </form>
      </div>
    </Layout>
  );
};

export default function EditLedgerPageWrapper() {
  return (
    <ProtectedRoute permission="finance-coa:edit">
      <EditLedgerPage />
    </ProtectedRoute>
  );
}
