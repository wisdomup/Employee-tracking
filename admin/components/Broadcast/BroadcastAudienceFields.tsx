import React from 'react';
import {
  BroadcastAudienceType,
  BROADCAST_AUDIENCE_LABELS,
} from '../../services/broadcastNotificationService';
import styles from '../../styles/FormPage.module.scss';

interface EmployeeOption {
  _id: string;
  username: string;
}

interface Props {
  audienceType: BroadcastAudienceType;
  targetUserIds: string[];
  onAudienceTypeChange: (v: BroadcastAudienceType) => void;
  onTargetUserIdsChange: (ids: string[]) => void;
  employeeOptions: EmployeeOption[];
}

const AUDIENCE_ORDER: BroadcastAudienceType[] = [
  'all',
  'all_employees',
  'role_order_taker',
  'role_delivery_man',
  'role_warehouse_manager',
  'specific_users',
];

const BroadcastAudienceFields: React.FC<Props> = ({
  audienceType,
  targetUserIds,
  onAudienceTypeChange,
  onTargetUserIdsChange,
  employeeOptions,
}) => {
  const handleAudienceSelect = (e: React.ChangeEvent<HTMLSelectElement>) => {
    const v = e.target.value as BroadcastAudienceType;
    onAudienceTypeChange(v);
    if (v !== 'specific_users') {
      onTargetUserIdsChange([]);
    }
  };

  const toggleUser = (id: string) => {
    if (targetUserIds.includes(id)) {
      onTargetUserIdsChange(targetUserIds.filter((x) => x !== id));
    } else {
      onTargetUserIdsChange([...targetUserIds, id]);
    }
  };

  return (
    <>
      <div className={styles.formGroup}>
        <label htmlFor="audienceType">Audience *</label>
        <select
          id="audienceType"
          name="audienceType"
          value={audienceType}
          onChange={handleAudienceSelect}
          required
          className={styles.select}
        >
          {AUDIENCE_ORDER.map((key) => (
            <option key={key} value={key}>
              {BROADCAST_AUDIENCE_LABELS[key]}
            </option>
          ))}
        </select>
      </div>
      {audienceType === 'specific_users' && (
        <div className={styles.formGroup}>
          <label>Employees *</label>
          <p style={{ fontSize: '0.85rem', color: '#6b7280', margin: '0 0 0.5rem' }}>
            Select one or more active employees (admins are not listed).
          </p>
          <div
            style={{
              maxHeight: 220,
              overflowY: 'auto',
              border: '1px solid #e5e7eb',
              borderRadius: 8,
              padding: '0.5rem 0.75rem',
            }}
          >
            {employeeOptions.length === 0 ? (
              <span style={{ color: '#9ca3af', fontSize: '0.875rem' }}>No employees available.</span>
            ) : (
              employeeOptions.map((emp) => (
                <label
                  key={emp._id}
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: 8,
                    padding: '6px 0',
                    cursor: 'pointer',
                    fontSize: '0.9rem',
                  }}
                >
                  <input
                    type="checkbox"
                    checked={targetUserIds.includes(emp._id)}
                    onChange={() => toggleUser(emp._id)}
                  />
                  {emp.username}
                </label>
              ))
            )}
          </div>
        </div>
      )}
    </>
  );
};

export default BroadcastAudienceFields;
