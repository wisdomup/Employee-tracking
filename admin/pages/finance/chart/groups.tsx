import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { useRouter } from 'next/router';
import { toast } from 'react-toastify';
import Layout from '../../../components/Layout/Layout';
import ProtectedRoute from '../../../components/Auth/ProtectedRoute';
import Loader from '../../../components/UI/Loader';
import FinanceNav from '../../../components/Finance/FinanceNav';
import { can } from '../../../utils/permissions';
import {
  financeService,
  AccountGroup,
  AccountType,
  ACCOUNT_TYPES,
  ACCOUNT_TYPE_HELP,
  CODE_BLOCK_HINT,
} from '../../../services/financeService';
import listStyles from '../../../styles/ListPage.module.scss';
import formStyles from '../../../styles/FormPage.module.scss';
import styles from '../../../styles/Finance.module.scss';

/**
 * Account groups — the shape of the chart, as against the accounts in it.
 *
 * Editing happens inline rather than on a separate page. A group has four fields, and the whole
 * job here is seeing the tree while rearranging it; bouncing to a form and back loses that.
 */

const TYPE_LABEL: Record<AccountType, string> = {
  asset: 'Asset',
  liability: 'Liability',
  equity: 'Equity',
  income: 'Income',
  expense: 'Expense',
};

interface DraftGroup {
  name: string;
  code: string;
  accountType: AccountType | '';
  parentGroupId: string;
  sortOrder: string;
}

const EMPTY_DRAFT: DraftGroup = {
  name: '',
  code: '',
  accountType: '',
  parentGroupId: '',
  sortOrder: '',
};

const GroupsPage: React.FC = () => {
  const router = useRouter();
  const [groups, setGroups] = useState<AccountGroup[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [draft, setDraft] = useState<DraftGroup>(EMPTY_DRAFT);
  const [showCreate, setShowCreate] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      setGroups(await financeService.getGroups());
    } catch (error: any) {
      toast.error(error.response?.data?.message || 'Could not load the account groups');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const parentOf = useMemo(
    () => new Map(groups.map((g) => [g._id, g])),
    [groups],
  );

  /** The type a new group will take: inherited from the parent, chosen only at the top level. */
  const draftInheritedType: AccountType | '' = draft.parentGroupId
    ? parentOf.get(draft.parentGroupId)?.accountType ?? ''
    : draft.accountType;

  const startEdit = (group: AccountGroup) => {
    setShowCreate(false);
    setEditingId(group._id);
    setDraft({
      name: group.name,
      code: group.code,
      accountType: group.accountType,
      parentGroupId: group.parentGroupId ? String(group.parentGroupId) : '',
      sortOrder: String(group.sortOrder ?? 0),
    });
  };

  const cancel = () => {
    setEditingId(null);
    setShowCreate(false);
    setDraft(EMPTY_DRAFT);
  };

  const handleCreate = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!draft.name.trim()) return toast.error('Give the group a name');
    if (!draft.code) return toast.error('Give the group a code');
    if (!draft.parentGroupId && !draft.accountType) {
      return toast.error('A top-level group needs an account type');
    }

    setSaving(true);
    try {
      await financeService.createGroup({
        name: draft.name.trim(),
        code: draft.code,
        // Sent only for a root group. A child inherits, and sending a type that disagrees is
        // refused by the server rather than silently ignored.
        accountType: draft.parentGroupId ? undefined : (draft.accountType as AccountType),
        parentGroupId: draft.parentGroupId || null,
        sortOrder: draft.sortOrder ? Number(draft.sortOrder) : undefined,
      });
      toast.success(`Group ${draft.code} created`);
      cancel();
      load();
    } catch (error: any) {
      toast.error(error.response?.data?.message || 'Could not create the group');
    } finally {
      setSaving(false);
    }
  };

  const handleUpdate = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!editingId) return;
    const original = parentOf.get(editingId);
    if (!original) return;

    const patch: Record<string, unknown> = {};
    if (draft.name.trim() !== original.name) patch.name = draft.name.trim();
    if (draft.code !== original.code) patch.code = draft.code;
    if (Number(draft.sortOrder || 0) !== (original.sortOrder ?? 0)) {
      patch.sortOrder = Number(draft.sortOrder || 0);
    }
    if (Object.keys(patch).length === 0) {
      toast.info('Nothing changed');
      return;
    }

    setSaving(true);
    try {
      await financeService.updateGroup(editingId, patch);
      toast.success('Group saved');
      cancel();
      load();
    } catch (error: any) {
      toast.error(error.response?.data?.message || 'Could not save the group');
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async (group: AccountGroup) => {
    const ok = window.confirm(
      `Delete the group "${group.name}"? It must already be empty of accounts and sub-groups.`,
    );
    if (!ok) return;
    try {
      await financeService.deleteGroup(group._id);
      toast.success(`Group "${group.name}" deleted`);
      load();
    } catch (error: any) {
      toast.error(error.response?.data?.message || 'Could not delete the group');
    }
  };

  const handleToggle = async (group: AccountGroup) => {
    try {
      await financeService.setGroupStatus(group._id, !group.isActive);
      toast.success(group.isActive ? 'Group deactivated' : 'Group reactivated');
      load();
    } catch (error: any) {
      toast.error(error.response?.data?.message || 'Could not change the status');
    }
  };

  const typeHint = draftInheritedType ? CODE_BLOCK_HINT[draftInheritedType] : null;

  return (
    <Layout>
      <div className={listStyles.container}>
        <div className={listStyles.header}>
          <h1>Account Groups</h1>
          <div style={{ display: 'flex', gap: '0.5rem', flexWrap: 'wrap' }}>
            <button
              className={listStyles.addButton}
              style={{ background: '#fff', color: '#111827', border: '1px solid #e5e7eb' }}
              onClick={() => router.push('/finance/chart')}
            >
              ← Chart of Accounts
            </button>
            {can(undefined, 'finance-coa:add') && (
              <button
                className={listStyles.addButton}
                onClick={() => {
                  setEditingId(null);
                  setDraft(EMPTY_DRAFT);
                  setShowCreate(true);
                }}
              >
                + Add Group
              </button>
            )}
          </div>
        </div>

        <FinanceNav />

        <div className={`${styles.banner} ${styles.bannerInfo}`}>
          <span className={styles.bannerTitle}>How the tree works</span>
          A top-level group carries the account type. Everything beneath it inherits that type
          and cannot disagree, because a group sitting on the wrong statement would appear on no
          statement at all. Groups nest four levels deep.
        </div>

        {(showCreate || editingId) && (
          <form
            onSubmit={editingId ? handleUpdate : handleCreate}
            className={formStyles.form}
            style={{ marginBottom: '1.25rem' }}
          >
            <h2 style={{ margin: '0 0 1rem', fontSize: '1.05rem' }}>
              {editingId ? 'Edit group' : 'New group'}
            </h2>

            {!editingId && (
              <div className={formStyles.formGroup}>
                <label htmlFor="parentGroupId">Sits inside</label>
                <select
                  id="parentGroupId"
                  className={formStyles.select}
                  value={draft.parentGroupId}
                  disabled={saving}
                  onChange={(e) =>
                    setDraft({ ...draft, parentGroupId: e.target.value, accountType: '' })
                  }
                >
                  <option value="">Nothing — this is a top-level group</option>
                  {groups
                    .filter((g) => g.isActive && g.depth < 4)
                    .map((g) => (
                      <option key={g._id} value={g._id}>
                        {' '.repeat((g.depth - 1) * 3)}
                        {g.code} · {g.name}
                      </option>
                    ))}
                </select>
              </div>
            )}

            {!editingId && !draft.parentGroupId && (
              <div className={formStyles.formGroup}>
                <label htmlFor="accountType">Account type *</label>
                <select
                  id="accountType"
                  className={formStyles.select}
                  value={draft.accountType}
                  disabled={saving}
                  onChange={(e) =>
                    setDraft({ ...draft, accountType: e.target.value as AccountType | '' })
                  }
                  required
                >
                  <option value="">Choose…</option>
                  {ACCOUNT_TYPES.map((t) => (
                    <option key={t} value={t}>
                      {TYPE_LABEL[t]}
                    </option>
                  ))}
                </select>
                {draft.accountType && (
                  <p className={formStyles.hint}>{ACCOUNT_TYPE_HELP[draft.accountType]}</p>
                )}
              </div>
            )}

            {editingId && (
              <p className={styles.readonlyNote} style={{ marginBottom: '1rem' }}>
                A group&apos;s type and its parent cannot be changed here. Both decide where every
                account beneath it is reported.
              </p>
            )}

            <div className={formStyles.formRow}>
              <div className={formStyles.formGroup}>
                <label htmlFor="groupName">Name *</label>
                <input
                  id="groupName"
                  type="text"
                  className={formStyles.input}
                  value={draft.name}
                  disabled={saving}
                  onChange={(e) => setDraft({ ...draft, name: e.target.value })}
                  placeholder="e.g. Current Assets"
                  required
                />
              </div>

              <div className={formStyles.formGroup}>
                <label htmlFor="groupCode">Code *</label>
                <input
                  id="groupCode"
                  type="text"
                  inputMode="numeric"
                  className={formStyles.input}
                  value={draft.code}
                  disabled={saving}
                  onChange={(e) =>
                    setDraft({ ...draft, code: e.target.value.replace(/[^\d]/g, '').slice(0, 4) })
                  }
                  placeholder="1100"
                  required
                />
                {typeHint && (
                  <p className={formStyles.hint}>
                    Four digits, in the {draftInheritedType} block: {typeHint}.
                  </p>
                )}
              </div>

              <div className={formStyles.formGroup}>
                <label htmlFor="sortOrder">Order</label>
                <input
                  id="sortOrder"
                  type="number"
                  className={formStyles.input}
                  value={draft.sortOrder}
                  disabled={saving}
                  onChange={(e) => setDraft({ ...draft, sortOrder: e.target.value })}
                  placeholder="10"
                />
                <p className={formStyles.hint}>
                  Where it sits among its siblings. A balance sheet is read in a conventional
                  order, not alphabetically.
                </p>
              </div>
            </div>

            <div className={formStyles.formActions}>
              <button type="button" className={formStyles.cancelButton} onClick={cancel}>
                Cancel
              </button>
              <button type="submit" className={formStyles.submitButton} disabled={saving}>
                {saving ? 'Saving…' : editingId ? 'Save Group' : 'Create Group'}
              </button>
            </div>
          </form>
        )}

        <div className={listStyles.listCard}>
          <div className={listStyles.listCardBody}>
            {loading ? (
              <Loader />
            ) : (
              <div className={styles.tree}>
                {groups.map((group) => (
                  <div
                    key={group._id}
                    className={`${styles.treeRow} ${group.isActive ? '' : styles.treeInactive}`}
                    style={{
                      paddingLeft: `${0.625 + (group.depth - 1) * 1.125}rem`,
                      cursor: 'default',
                    }}
                  >
                    <span className={styles.code}>{group.code}</span>
                    <span className={styles.treeName}>
                      {group.name}
                      {group.isSystem && (
                        <span
                          className={`${styles.flag} ${styles.flagSystem}`}
                          style={{ marginLeft: '0.5rem' }}
                          title="Part of the standard chart. Cannot be deleted."
                        >
                          Standard
                        </span>
                      )}
                      {!group.isActive && <span className={styles.flag}>Inactive</span>}
                    </span>
                    <span
                      className={`${styles.typeChip} ${styles[`type_${group.accountType}`]}`}
                    >
                      {TYPE_LABEL[group.accountType]}
                    </span>
                    <div className={listStyles.actions}>
                      {can(undefined, 'finance-coa:edit') && (
                        <button
                          className={listStyles.editButton}
                          onClick={() => startEdit(group)}
                        >
                          Edit
                        </button>
                      )}
                      {can(undefined, 'finance-coa:change') && (
                        <button
                          className={listStyles.approveButton}
                          onClick={() => handleToggle(group)}
                        >
                          {group.isActive ? 'Deactivate' : 'Reactivate'}
                        </button>
                      )}
                      {can(undefined, 'finance-coa:delete') && !group.isSystem && (
                        <button
                          className={listStyles.deleteButton}
                          onClick={() => handleDelete(group)}
                        >
                          Delete
                        </button>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      </div>
    </Layout>
  );
};

export default function GroupsPageWrapper() {
  return (
    <ProtectedRoute permission="finance-coa:view">
      <GroupsPage />
    </ProtectedRoute>
  );
}
