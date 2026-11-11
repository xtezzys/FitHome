import { useId, type InputHTMLAttributes, type LabelHTMLAttributes } from 'react';
import './TextField.css';

/**
 * Поле ввода с валидацией и сообщением об ошибке (docs/design.md §5).
 * Семантическая связка label ↔ input через htmlFor/id (docs/design.md §7).
 */

interface TextFieldProps extends InputHTMLAttributes<HTMLInputElement> {
  label: string;
  labelProps?: LabelHTMLAttributes<HTMLLabelElement>;
  error?: string | null;
  type?: 'text' | 'email' | 'password';
}

export function TextField({ label, labelProps, error, id, ...rest }: TextFieldProps) {
  const generatedId = useId();
  const inputId = id ?? generatedId;
  const errorId = `${inputId}-error`;

  return (
    <div className="text-field">
      <label htmlFor={inputId} className="text-field__label" {...labelProps}>
        {label}
      </label>
      <input
        id={inputId}
        className={`text-field__input${error ? ' text-field__input--invalid' : ''}`}
        aria-invalid={error ? true : undefined}
        aria-describedby={error ? errorId : undefined}
        {...rest}
      />
      {error && (
        <p id={errorId} className="text-field__error" role="alert">
          {error}
        </p>
      )}
    </div>
  );
}
