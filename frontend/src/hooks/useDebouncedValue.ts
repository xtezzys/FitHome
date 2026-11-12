import { useEffect, useState } from 'react';

/**
 * Отложенное значение: обновляется через delay после последнего изменения
 * source. Используется для поиска в каталоге (docs/design.md §3.2).
 */
export function useDebouncedValue<T>(source: T, delay = 400): T {
  const [debounced, setDebounced] = useState(source);

  useEffect(() => {
    const timer = window.setTimeout(() => setDebounced(source), delay);
    return () => window.clearTimeout(timer);
  }, [source, delay]);

  return debounced;
}
