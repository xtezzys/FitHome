import type { ReactNode } from 'react';
import { NavLink } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import { Button } from './Button';
import './AppLayout.css';

/**
 * Общий каркас страниц этапа 3 (docs/design.md §2): шапка с логотипом,
 * навигация (Каталог / Программы) и выход из аккаунта.
 * Адаптивность: ≥360 px — вертикальное меню, ≥768 px — горизонтальная шапка.
 */

interface AppLayoutProps {
  children: ReactNode;
}

export function AppLayout({ children }: AppLayoutProps) {
  const { user, logout, status } = useAuth();

  return (
    <div className="layout">
      <header className="layout__header">
        <NavLink to="/" className="layout__logo">
          FitHome
        </NavLink>
        <nav className="layout__nav" aria-label="Основная навигация">
          <NavLink to="/exercises" className={({ isActive }) => `layout__link${isActive ? ' layout__link--active' : ''}`}>
            Упражнения
          </NavLink>
          <NavLink to="/programs" className={({ isActive }) => `layout__link${isActive ? ' layout__link--active' : ''}`}>
            Программы
          </NavLink>
          <NavLink to="/library" className={({ isActive }) => `layout__link${isActive ? ' layout__link--active' : ''}`}>
            Библиотека
          </NavLink>
          <NavLink to="/programs/incoming" className={({ isActive }) => `layout__link${isActive ? ' layout__link--active' : ''}`}>
            Полученные
          </NavLink>
        </nav>
        <div className="layout__user">
          <span className="layout__username">{user?.name}</span>
          <Button variant="secondary" onClick={() => void logout()} loading={status === 'loading'}>
            Выйти
          </Button>
        </div>
      </header>
      <main className="layout__main">{children}</main>
    </div>
  );
}
