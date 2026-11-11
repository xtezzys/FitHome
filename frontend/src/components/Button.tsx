import type { ButtonHTMLAttributes, ReactNode } from 'react';
import './Button.css';

/**
 * Кнопка дизайн-системы FitHome (docs/design.md §5).
 * Варианты: primary (акцент #A3E635), secondary, danger.
 * Высота не менее 44 px — крупные цели управления (docs/design.md §1.2).
 */

interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: 'primary' | 'secondary' | 'danger';
  /** Состояние загрузки: показываем Spinner и блокируем нажатия. */
  loading?: boolean;
  children: ReactNode;
}

export function Button({
  variant = 'primary',
  loading = false,
  disabled,
  className,
  children,
  ...rest
}: ButtonProps) {
  const classes = ['btn', `btn--${variant}`, className].filter(Boolean).join(' ');
  return (
    <button className={classes} disabled={disabled || loading} {...rest}>
      {loading && <span className="btn__spinner" aria-hidden="true" />}
      {children}
    </button>
  );
}
