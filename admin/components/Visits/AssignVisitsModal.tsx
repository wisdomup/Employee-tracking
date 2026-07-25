import React, { useEffect, useMemo, useState } from 'react';
import { useRouter } from 'next/router';
import { format } from 'date-fns';
import { toast } from 'react-toastify';
import { visitService, Visit } from '../../services/visitService';
import { clientService, Client, formatClientSelectLabel } from '../../services/clientService';
import { employeeService, Employee } from '../../services/employeeService';
import { routeService, Route } from '../../services/routeService';
import SearchableSelect from '../UI/SearchableSelect';
import StatusBadge from '../UI/StatusBadge';
import modalStyles from '../../styles/Modal.module.scss';
import styles from '../../styles/VisitsCalendar.module.scss';

interface AssignVisitsModalProps {
  date: Date;
  existingVisits: Visit[];
  onClose: () => void;
  onAssigned: () => void;
}

const AssignVisitsModal: React.FC<AssignVisitsModalProps> = ({ date, existingVisits, onClose, onAssigned }) => {
  const router = useRouter();
  const [employees, setEmployees] = useState<Employee[]>([]);
  const [clients, setClients] = useState<Client[]>([]);
  const [routes, setRoutes] = useState<Route[]>([]);
  const [employeeId, setEmployeeId] = useState('');
  const [routeId, setRouteId] = useState('');
  const [selectedClientIds, setSelectedClientIds] = useState<Set<string>>(new Set());
  const [clientSearch, setClientSearch] = useState('');
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    employeeService.getEmployees({ isActive: true }).then(setEmployees).catch(() => {});
    clientService.getClients().then(setClients).catch(() => {});
    routeService.getRoutes().then(setRoutes).catch(() => {});
  }, []);

  const filteredClients = useMemo(() => {
    const q = clientSearch.trim().toLowerCase();
    if (!q) return clients;
    return clients.filter((c) => formatClientSelectLabel(c).toLowerCase().includes(q));
  }, [clients, clientSearch]);

  const toggleClient = (id: string) => {
    setSelectedClientIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!employeeId) {
      toast.error('Please select an employee');
      return;
    }
    if (selectedClientIds.size === 0) {
      toast.error('Please select at least one client to visit');
      return;
    }
    setSubmitting(true);
    try {
      await visitService.bulkCreateVisits({
        employeeId,
        visitDate: format(date, 'yyyy-MM-dd'),
        dealerIds: [...selectedClientIds],
        routeId: routeId || undefined,
      });
      toast.success(`Assigned ${selectedClientIds.size} visit${selectedClientIds.size !== 1 ? 's' : ''}`);
      onAssigned();
      onClose();
    } catch (error: unknown) {
      const err = error as { response?: { data?: { message?: string } } };
      toast.error(err.response?.data?.message || 'Failed to assign visits');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className={modalStyles.modalOverlay} onClick={onClose}>
      <div className={modalStyles.modalContent} onClick={(e) => e.stopPropagation()} style={{ maxWidth: 560 }}>
        <div className={modalStyles.modalHeader}>
          <h2>{format(date, 'EEEE, MMM d, yyyy')}</h2>
        </div>

        {existingVisits.length > 0 && (
          <div className={styles.existingVisitsBlock}>
            <p className={styles.existingVisitsLabel}>Already scheduled ({existingVisits.length})</p>
            <div className={styles.existingVisitsList}>
              {existingVisits.map((v) => (
                <div
                  key={v._id}
                  className={styles.existingVisitRow}
                  onClick={() => router.push(`/visits/${v._id}`)}
                >
                  <span>
                    {v.dealerId?.name || v.dealerId?.shopName || 'Client'} —{' '}
                    {v.employeeId?.username || 'Unassigned'}
                  </span>
                  <StatusBadge status={v.status} />
                </div>
              ))}
            </div>
          </div>
        )}

        <form onSubmit={handleSubmit}>
          <div className={modalStyles.formGroup}>
            <label htmlFor="assignEmployeeId">Employee *</label>
            <SearchableSelect
              id="assignEmployeeId"
              name="employeeId"
              value={employeeId}
              onChange={(e) => setEmployeeId(e.target.value)}
              placeholder="Select an employee"
              options={[
                { value: '', label: 'Select an employee' },
                ...employees.map((emp) => ({ value: emp._id, label: `${emp.username} — ${emp.role}` })),
              ]}
            />
          </div>

          <div className={modalStyles.formGroup}>
            <label htmlFor="assignRouteId">Route (optional)</label>
            <SearchableSelect
              id="assignRouteId"
              name="routeId"
              value={routeId}
              onChange={(e) => setRouteId(e.target.value)}
              placeholder="None"
              options={[{ value: '', label: 'None' }, ...routes.map((r) => ({ value: r._id, label: r.name }))]}
            />
          </div>

          <div className={modalStyles.formGroup}>
            <label>Clients to visit * ({selectedClientIds.size} selected)</label>
            <input
              type="text"
              placeholder="Search clients…"
              value={clientSearch}
              onChange={(e) => setClientSearch(e.target.value)}
              className={styles.clientSearchInput}
            />
            <div className={styles.clientList}>
              {filteredClients.map((c) => (
                <label key={c._id} className={styles.clientListItem}>
                  <input
                    type="checkbox"
                    checked={selectedClientIds.has(c._id)}
                    onChange={() => toggleClient(c._id)}
                  />
                  <span>{formatClientSelectLabel(c)}</span>
                </label>
              ))}
              {filteredClients.length === 0 && <p className={styles.emptyHint}>No matching clients</p>}
            </div>
          </div>

          <div className={modalStyles.modalActions}>
            <button type="button" className={modalStyles.cancelButton} onClick={onClose}>
              Cancel
            </button>
            <button type="submit" className={modalStyles.submitButton} disabled={submitting}>
              {submitting ? 'Assigning…' : `Assign ${selectedClientIds.size || ''} Visit${selectedClientIds.size === 1 ? '' : 's'}`}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};

export default AssignVisitsModal;
