import { useId } from 'react';
import './Select.css';

/**
 * Выпадающий список дизайн-системы (docs/design.md §5): место, метрика, сложность.
 */

interface SelectProps {
  label: string;
  value: string;
  options: Array<{ value: string; label: string }>;
  onChange: (value: string) => void;
}

export function Select({ label, value, options, onChange }: SelectProps) {
  const id = useId();
  return (
    <div className="select-field">
      <label htmlFor={id} className="select-field__label">
        {label}
      </label>
      <select
        id={id}
        className="select-field__control"
        value={value}
        onChange={(event) => onChange(event.target.value)}
      >
        {options.map((option) => (
          <option key={option.value} value={option.value}>
            {option.label}
          </option>
        ))}
      </select>
    </div>
  );
}
