import React, { useCallback, useMemo } from 'react';
import Select, {
  type SingleValue,
  type StylesConfig,
  type GroupBase,
} from 'react-select';
import styles from './SearchableSelect.module.scss';

export type SearchableSelectOption = { value: string; label: string };

export type SearchableSelectProps = {
  options: SearchableSelectOption[];
  value: string;
  onChange?: (e: React.ChangeEvent<HTMLSelectElement>) => void;
  name?: string;
  id?: string;
  placeholder?: string;
  disabled?: boolean;
  className?: string;
  style?: React.CSSProperties;
  /** When true, user can clear selection (emits value ""). Default false. */
  isClearable?: boolean;
  'aria-label'?: string;
  title?: string;
};

function emitSelectLikeChange(
  name: string,
  nextValue: string,
  onChange?: (e: React.ChangeEvent<HTMLSelectElement>) => void,
) {
  if (!onChange) return;
  const target = { name, value: nextValue } as unknown as EventTarget & HTMLSelectElement;
  onChange({
    target,
    currentTarget: target,
  } as React.ChangeEvent<HTMLSelectElement>);
}

/* Menus use menuPortalTarget=document.body, so they are NOT under .wrap — these inline styles always apply. */
const selectStyles: StylesConfig<SearchableSelectOption, false, GroupBase<SearchableSelectOption>> = {
  menuPortal: (base) => ({ ...base, zIndex: 10000 }),
  menu: (base) => ({
    ...base,
    backgroundColor: '#ffffff',
    border: '1px solid #e5e7eb',
    borderRadius: 8,
    boxShadow: '0 12px 32px rgba(15, 23, 42, 0.18)',
    marginTop: 4,
    marginBottom: 4,
    overflow: 'hidden',
  }),
  menuList: (base) => ({
    ...base,
    backgroundColor: '#ffffff',
    maxHeight: 280,
    padding: '4px 0',
  }),
  option: (base, state) => ({
    ...base,
    backgroundColor: state.isSelected
      ? 'var(--admin-primary, #0ea5e9)'
      : state.isFocused
        ? 'var(--admin-primary-muted, #e0f2fe)'
        : '#ffffff',
    color: state.isSelected ? '#ffffff' : '#111827',
    cursor: 'pointer',
    padding: '10px 12px',
    fontSize: 'max(16px, 1rem)',
    lineHeight: 1.45,
  }),
};

/**
 * Searchable single-select (react-select). Fires the same onChange shape as
 * &lt;select&gt; so existing handleChange(e) / e.target.value patterns keep working.
 */
const SearchableSelect: React.FC<SearchableSelectProps> = ({
  options,
  value,
  onChange,
  name = '',
  id,
  placeholder = 'Select…',
  disabled,
  className,
  style,
  isClearable = false,
  'aria-label': ariaLabel,
  title,
}) => {
  const selected = useMemo(() => {
    return options.find((o) => o.value === value) ?? null;
  }, [options, value]);

  const handleChange = useCallback(
    (opt: SingleValue<SearchableSelectOption>) => {
      const next = opt?.value ?? '';
      emitSelectLikeChange(name, next, onChange);
    },
    [name, onChange],
  );

  return (
    <div
      className={`${styles.wrap}${className ? ` ${className}` : ''}`}
      style={style}
      title={title}
    >
      <Select<SearchableSelectOption, false>
        inputId={id}
        instanceId={id || name || undefined}
        classNamePrefix="adminSelect"
        options={options}
        value={selected}
        onChange={handleChange}
        placeholder={placeholder}
        isDisabled={disabled}
        isClearable={isClearable}
        isSearchable
        noOptionsMessage={() => 'No matches'}
        menuPortalTarget={typeof document !== 'undefined' ? document.body : null}
        menuPosition="fixed"
        styles={selectStyles}
        unstyled
        classNames={{
          control: (state) =>
            [
              'adminSelect__control',
              state.isFocused && 'adminSelect__control--is-focused',
              state.isDisabled && 'adminSelect__control--is-disabled',
            ]
              .filter(Boolean)
              .join(' '),
          placeholder: () => 'adminSelect__placeholder',
          input: () => 'adminSelect__input',
          valueContainer: () => 'adminSelect__value-container',
          singleValue: () => 'adminSelect__single-value',
          indicatorsContainer: () => 'adminSelect__indicators',
          dropdownIndicator: () => 'adminSelect__dropdown-indicator',
          indicatorSeparator: () => 'adminSelect__indicator-separator',
          clearIndicator: () => 'adminSelect__clear-indicator',
          menu: () => 'adminSelect__menu',
          menuList: () => 'adminSelect__menu-list',
          option: (state) =>
            [
              'adminSelect__option',
              state.isFocused && 'adminSelect__option--is-focused',
              state.isSelected && 'adminSelect__option--is-selected',
            ]
              .filter(Boolean)
              .join(' '),
        }}
        aria-label={ariaLabel}
      />
    </div>
  );
};

export default SearchableSelect;
