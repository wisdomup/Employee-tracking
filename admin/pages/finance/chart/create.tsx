import React, { useEffect, useState } from 'react';
import { useRouter } from 'next/router';
import { toast } from 'react-toastify';
import Layout from '../../../components/Layout/Layout';
import ProtectedRoute from '../../../components/Auth/ProtectedRoute';
import LedgerForm, {
  EMPTY_LEDGER_FORM,
  LedgerFormValues,
} from '../../../components/Finance/LedgerForm';
import { financeService, AccountGroup } from '../../../services/financeService';
import styles from '../../../styles/FormPage.module.scss';

const CreateLedgerPage: React.FC = () => {
  const router = useRouter();
  const [groups, setGroups] = useState<AccountGroup[]>([]);
  const [values, setValues] = useState<LedgerFormValues>(EMPTY_LEDGER_FORM);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    financeService
      .getGroups()
      .then(setGroups)
      .catch(() => toast.error('Could not load the account groups'));
  }, []);

  // Deep-linked from the chart page with a group already chosen.
  useEffect(() => {
    const { groupId } = router.query;
    if (typeof groupId === 'string') {
      setValues((prev) => (prev.groupId ? prev : { ...prev, groupId }));
    }
  }, [router.query]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();

    if (!values.name.trim()) {
      toast.error('Give the account a name');
      return;
    }
    if (!values.groupId) {
      toast.error('Choose the group this account belongs to');
      return;
    }
    if (values.isControl && !values.subledgerType) {
      toast.error('A control account must say what it is broken down by');
      return;
    }

    setSaving(true);
    try {
      const created = await financeService.createLedger({
        name: values.name.trim(),
        code: values.code || undefined,
        groupId: values.groupId,
        description: values.description.trim() || undefined,
        openingBalance: values.openingAmount
          ? {
              amount: Number(values.openingAmount),
              asOf: values.openingAsOf || null,
            }
          : undefined,
        isControl: values.isControl,
        subledgerType: values.isControl ? values.subledgerType || null : null,
        isCashEquivalent: values.isCashEquivalent,
      });
      toast.success(`${created.code} · ${created.name} created`);
      router.push('/finance/chart');
    } catch (error: any) {
      // The server's messages name the block, the clashing account or the incoherent
      // configuration. Passing them straight through beats a generic failure.
      toast.error(error.response?.data?.message || 'Could not create the account');
    } finally {
      setSaving(false);
    }
  };

  return (
    <Layout>
      <div className={styles.container}>
        <div className={styles.header}>
          <h1>New Account</h1>
          <button className={styles.backButton} onClick={() => router.push('/finance/chart')}>
            ← Back
          </button>
        </div>

        <form onSubmit={handleSubmit} className={styles.form}>
          <LedgerForm
            groups={groups}
            values={values}
            onChange={setValues}
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
              {saving ? 'Creating…' : 'Create Account'}
            </button>
          </div>
        </form>
      </div>
    </Layout>
  );
};

export default function CreateLedgerPageWrapper() {
  return (
    <ProtectedRoute permission="finance-coa:add">
      <CreateLedgerPage />
    </ProtectedRoute>
  );
}
