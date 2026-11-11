import { useAuth } from '../context/AuthContext';
import { Button } from '../components/Button';
import './DashboardPage.css';

/**
 * Дашборд (docs/design.md §3.1) — на этапе 2 заглушка: приветствие,
 * подтверждение авторизованной сессии и выход из аккаунта.
 * Карточки программ и сводка недели — этапы 3–4.
 */
export function DashboardPage() {
  const { user, logout, status } = useAuth();

  return (
    <div className="dashboard">
      <header className="dashboard__header">
        <h1 className="dashboard__logo">FitHome</h1>
        <Button variant="secondary" onClick={() => void logout()} loading={status === 'loading'}>
          Выйти
        </Button>
      </header>

      <main className="dashboard__main">
        <div className="dashboard__card">
          {user ? (
            <>
              <h2>Привет, {user.name}!</h2>
              <p>
                Вы вошли как <strong>{user.email}</strong>. Каталог упражнений, программы и
                история тренировок появятся на следующих этапах.
              </p>
            </>
          ) : (
            <h2>Загрузка профиля…</h2>
          )}
        </div>
      </main>
    </div>
  );
}
