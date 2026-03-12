import React from 'react';
import styles from './StatusBadge.module.scss';

type Status =
  | 'pending'
  | 'not_assigned'
  | 'to_do'
  | 'in_progress'
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
      case 'completed':
        return styles.completed;
      case 'active':
      case 'approved':
        return styles.active;
      case 'inactive':
      case 'rejected':
      case 'cancelled':
        return styles.inactive;
      case 'confirmed':
      case 'packed':
        return styles.active;
      case 'dispatched':
        return styles.inProgress;
      case 'delivered':
        return styles.completed;
      case 'incomplete':
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
      case 'pending':
        return 'Pending';
      default:
        return status.charAt(0).toUpperCase() + status.slice(1).replace(/_/g, ' ');
    }
  };

  return (
    <span className={`${styles.statusBadge} ${getStatusClass()}`}>{getStatusText()}</span>
  );
};

export default StatusBadge;
