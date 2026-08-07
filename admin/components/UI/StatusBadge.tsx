import React from 'react';
import styles from './StatusBadge.module.scss';

type Status =
  | 'pending'
  | 'not_assigned'
  | 'to_do'
  | 'in_progress'
  | 'checked_in'
  | 'completed'
  | 'active'
  | 'inactive'
  | 'approved'
  | 'rejected'
  | 'todo'
  | 'incomplete'
  | 'cancelled'
  | string;

interface StatusBadgeProps {
  status: Status;
}

const StatusBadge: React.FC<StatusBadgeProps> = ({ status }) => {
  const getStatusClass = () => {
    switch (status) {
      case 'pending':
      case 'to_do':
      case 'todo':
        return styles.toDo;
      case 'not_assigned':
        return styles.notAssigned;
      case 'in_progress':
        return styles.inProgress;
      case 'checked_in':
        return styles.checkedIn;
      case 'skipped':
        return styles.skipped;
      case 'completed':
        return styles.completed;
      case 'active':
      case 'approved':
      case 'confirmed':
      case 'packed':
      // Warehouse: a posted receipt is committed, sellable stock is good stock.
      case 'posted':
      case 'sellable':
        return styles.active;
      case 'inactive':
      case 'rejected':
      case 'cancelled':
      // Warehouse: damaged/claim stock is set aside and not for sale.
      case 'damaged':
        return styles.inactive;
      case 'dispatched':
      // Warehouse: an approved transfer is in flight until the destination confirms.
      case 'in_transit':
        return styles.inProgress;
      case 'delivered':
      case 'received':
        return styles.completed;
      // A quantity mismatch needs an admin to look at it — it is not a failure.
      case 'mismatch':
      case 'internal_damage':
        return styles.skipped;
      case 'client_claim':
        return styles.checkedIn;
      case 'incomplete':
      // System-generated notifications, as opposed to admin-authored ones.
      case 'system':
        return styles.notAssigned;
      default:
        return '';
    }
  };

  const getStatusText = () => {
    switch (status) {
      case 'not_assigned':
        return 'Not Assigned';
      case 'to_do':
        return 'To Do';
      case 'todo':
        return 'To Do';
      case 'in_progress':
        return 'In Progress';
      case 'checked_in':
        return 'Checked In';
      case 'skipped':
        return 'Skipped';
      case 'pending':
        return 'Pending';
      case 'in_transit':
        return 'In Transit';
      case 'mismatch':
        return 'Qty Mismatch';
      case 'internal_damage':
        return 'Internal Damage';
      case 'client_claim':
        return 'Client Claim';
      default:
        return status.charAt(0).toUpperCase() + status.slice(1).replace(/_/g, ' ');
    }
  };

  return (
    <span className={`${styles.statusBadge} ${getStatusClass()}`}>{getStatusText()}</span>
  );
};

export default StatusBadge;
