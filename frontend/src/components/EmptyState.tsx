import type { ReactNode } from 'react';
import './EmptyState.css';

/**
 * Заглушка пустых списков (docs/design.md §5): «Создайте первую программу»,
 * «Ничего не найдено» — с необязательным действием.
 */

interface EmptyStateProps {
  title: string;
  hint?: string;
  children?: ReactNode;
}

export function EmptyState({ title, hint, children }: EmptyStateProps) {
  return (
    <div className="empty-state">
      <p className="empty-state__title">{title}</p>
      {hint && <p className="empty-state__hint">{hint}</p>}
      {children && <div className="empty-state__actions">{children}</div>}
    </div>
  );
}
