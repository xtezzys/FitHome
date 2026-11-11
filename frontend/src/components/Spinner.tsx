import './Spinner.css';

/** Индикатор загрузки (docs/design.md §5). */
export function Spinner({ label = 'Загрузка…' }: { label?: string }) {
  return (
    <div className="spinner" role="status" aria-live="polite">
      <span className="spinner__circle" aria-hidden="true" />
      <span className="spinner__label">{label}</span>
    </div>
  );
}
