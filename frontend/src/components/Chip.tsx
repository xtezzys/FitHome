import './Chip.css';

/**
 * Фильтр-чип (docs/design.md §5): переключатель фильтров каталога.
 * aria-pressed для доступности (docs/design.md §7).
 */

interface ChipProps {
  label: string;
  active?: boolean;
  onClick: () => void;
}

export function Chip({ label, active = false, onClick }: ChipProps) {
  return (
    <button
      type="button"
      className={`chip${active ? ' chip--active' : ''}`}
      onClick={onClick}
      aria-pressed={active}
    >
      {label}
    </button>
  );
}
