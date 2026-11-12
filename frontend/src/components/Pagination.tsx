import './Pagination.css';

/**
 * Пагинация списков (docs/api.md §1): предыдущая/следующая + позиция.
 * Фильтры сохраняются в состоянии страницы — меняется только номер.
 */

interface PaginationProps {
  page: number;
  limit: number;
  total: number;
  onPageChange: (page: number) => void;
}

export function Pagination({ page, limit, total, onPageChange }: PaginationProps) {
  const totalPages = Math.max(1, Math.ceil(total / limit));
  if (totalPages <= 1) return null;

  return (
    <nav className="pagination" aria-label="Постраничная навигация">
      <button
        type="button"
        className="pagination__button"
        onClick={() => onPageChange(page - 1)}
        disabled={page <= 1}
      >
        ← Назад
      </button>
      <span className="pagination__info">
        Стр. {page} из {totalPages}
      </span>
      <button
        type="button"
        className="pagination__button"
        onClick={() => onPageChange(page + 1)}
        disabled={page >= totalPages}
      >
        Вперёд →
      </button>
    </nav>
  );
}
