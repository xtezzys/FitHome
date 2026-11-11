import { describe, it, expect } from 'vitest';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import App from '../App';

// React 18 требует явного включения act-окружения в тестовой среде
(globalThis as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true;

/**
 * Smoke-тест этапа 1 (docs/testing.md §7):
 * приложение собирается и рендерится без ошибок в jsdom.
 */
describe('App', () => {
  it('рендерится и показывает название приложения', () => {
    const container = document.createElement('div');
    document.body.appendChild(container);

    let root: Root | undefined;
    act(() => {
      root = createRoot(container);
      root.render(<App />);
    });

    expect(container.querySelector('h1')?.textContent).toBe('FitHome');

    act(() => {
      root?.unmount();
    });
    container.remove();
  });
});
