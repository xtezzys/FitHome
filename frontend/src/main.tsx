import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import App from './App';
import './styles/variables.css';

/**
 * Точка входа SPA (docs/architecture.md §2).
 * Роутинг и auth-контекст добавляются на этапе 2.
 */
createRoot(document.getElementById('root') as HTMLElement).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
