import React from 'react';
import DatePicker from 'react-datepicker';
import 'react-datepicker/dist/react-datepicker.css';
import styles from '../../styles/ListPage.module.scss';

interface DatePickerFilterProps {
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  id?: string;
  title?: string;
  /** When true, wrapper and input take full width of parent (e.g. in forms). */
  fullWidth?: boolean;
  disableMaxWidth?: boolean;
}

const DatePickerFilter: React.FC<DatePickerFilterProps> = ({
  value,
  onChange,
  placeholder = 'Select date',
  id,
  title,
  fullWidth = false,
  disableMaxWidth = false,
}) => {
  const dateValue = value ? new Date(value + 'T12:00:00') : null;
  const useFullWidth = fullWidth || disableMaxWidth;

  return (
    <div
      style={{
        ...(useFullWidth ? { width: '100%' } : { maxWidth: 160 }),
      }}
      className={useFullWidth ? 'date-picker-full-width' : undefined}
    >
      <DatePicker
        id={id}
        selected={dateValue}
        onChange={(date: Date | null) => {
          if (!date) {
            onChange('');
            return;
          }
          const y = date.getFullYear();
          const m = String(date.getMonth() + 1).padStart(2, '0');
          const d = String(date.getDate()).padStart(2, '0');
          onChange(`${y}-${m}-${d}`);
        }}
        dateFormat="MMM d, yyyy"
        placeholderText={placeholder}
        title={title}
        className={styles.searchInput}
        isClearable
        showMonthDropdown
        showYearDropdown
        dropdownMode="select"
      />
    </div>
  );
};

export default DatePickerFilter;
