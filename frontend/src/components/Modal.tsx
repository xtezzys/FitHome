import { useEffect, type ReactNode } from 'react';
import './Modal.css';

/**
 * Модальное окно (docs/design.md §5): создание/редактирование упражнений,
 * просмотр деталей, подтверждение удаления.
 * Закрытие: Esc, клик по подложке, кнопка «×».
 */

interface ModalProps {
  title: string;
  onClose: () => void;
  children: ReactNode;
}

export function Modal({ title, onClose, children }: ModalProps) {
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  return (
    <div
      className="modal"
      role="dialog"
      aria-modal="true"
      aria-label={title}
      onClick={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <div className="modal__content">
        <header className="modal__header">
          <h2 className="modal__title">{title}</h2>
          <button type="button" className="modal__close" onClick={onClose} aria-label="Закрыть">
            ×
          </button>
        </header>
        {children}
      </div>
    </div>
  );
}
