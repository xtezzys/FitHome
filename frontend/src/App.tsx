import { BrowserRouter, Navigate, Route, Routes } from 'react-router-dom';
import { AuthProvider, useAuth } from './context/AuthContext';
import { Spinner } from './components/Spinner';
import { LoginPage } from './pages/LoginPage';
import { RegisterPage } from './pages/RegisterPage';
import { DashboardPage } from './pages/DashboardPage';
import { ExercisesPage } from './pages/ExercisesPage';
import { ProgramsPage } from './pages/ProgramsPage';
import { ProgramDetailPage } from './pages/ProgramDetailPage';
import { LibraryPage } from './pages/LibraryPage';
import { IncomingSharesPage } from './pages/IncomingSharesPage';
import './App.css';

/**
 * Корневой компонент SPA (docs/design.md §2).
 * Маршруты: /login и /register — публичные, / — защищённый.
 * Пока сессия восстанавливается — показываем индикатор загрузки.
 */

/** Перенаправляет неавторизованных на /login. */
function RequireAuth({ children }: { children: React.ReactNode }) {
  const { status } = useAuth();
  if (status === 'loading') {
    return (
      <div className="app-loading">
        <h1 className="app-loading__logo">FitHome</h1>
        <Spinner label="Восстановление сессии…" />
      </div>
    );
  }
  if (status === 'unauthenticated') {
    return <Navigate to="/login" replace />;
  }
  return children;
}

/** Публичные маршруты недоступны авторизованному пользователю. */
function RedirectIfAuthed({ children }: { children: React.ReactNode }) {
  const { status } = useAuth();
  if (status === 'authenticated') {
    return <Navigate to="/" replace />;
  }
  return children;
}

function App() {
  return (
    <BrowserRouter>
      <AuthProvider>
        <Routes>
          <Route
            path="/login"
            element={
              <RedirectIfAuthed>
                <LoginPage />
              </RedirectIfAuthed>
            }
          />
          <Route
            path="/register"
            element={
              <RedirectIfAuthed>
                <RegisterPage />
              </RedirectIfAuthed>
            }
          />
          <Route
            path="/"
            element={
              <RequireAuth>
                <DashboardPage />
              </RequireAuth>
            }
          />
          {/* Этап 3: каталог упражнений и программы (docs/design.md §2) */}
          <Route
            path="/exercises"
            element={
              <RequireAuth>
                <ExercisesPage />
              </RequireAuth>
            }
          />
          <Route
            path="/programs"
            element={
              <RequireAuth>
                <ProgramsPage />
              </RequireAuth>
            }
          />
          <Route
            path="/programs/:id"
            element={
              <RequireAuth>
                <ProgramDetailPage />
              </RequireAuth>
            }
          />
          {/* Этап 5: публичная библиотека и полученные программы */}
          <Route
            path="/library"
            element={
              <RequireAuth>
                <LibraryPage />
              </RequireAuth>
            }
          />
          <Route
            path="/programs/incoming"
            element={
              <RequireAuth>
                <IncomingSharesPage />
              </RequireAuth>
            }
          />
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </AuthProvider>
    </BrowserRouter>
  );
}

export default App;
