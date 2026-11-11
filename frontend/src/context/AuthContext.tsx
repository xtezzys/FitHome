import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import type { User } from '../types/user';
import * as authApi from '../api/auth';
import { setAccessToken, clearAccessToken } from '../api/client';

/**
 * Глобальное auth-состояние SPA (docs/architecture.md §4).
 *
 * При старте восстанавливает сессию прозрачно для пользователя:
 * access-токен живёт только в памяти и теряется при перезагрузке,
 * поэтому выполняется POST /api/auth/refresh по httpOnly cookie,
 * затем GET /api/auth/me. Пароли и токены нигде не сохраняются
 * в localStorage/sessionStorage.
 */

type AuthStatus = 'loading' | 'authenticated' | 'unauthenticated';

interface AuthContextValue {
  user: User | null;
  status: AuthStatus;
  /** Ошибка последнего действия (вход/регистрация/выход). */
  error: string | null;
  login(email: string, password: string): Promise<boolean>;
  register(email: string, password: string, name: string): Promise<boolean>;
  logout(): Promise<void>;
}

const AuthContext = createContext<AuthContextValue | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [status, setStatus] = useState<AuthStatus>('loading');
  const [error, setError] = useState<string | null>(null);

  // Восстановление сессии при монтировании: refresh-cookie → access-токен → профиль
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const { accessToken } = await authApi.refresh();
        if (cancelled) return;
        setAccessToken(accessToken);
        const me = await authApi.getMe();
        if (cancelled) return;
        setUser(me);
        setStatus('authenticated');
      } catch {
        if (cancelled) return;
        clearAccessToken();
        setStatus('unauthenticated');
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const value = useMemo<AuthContextValue>(
    () => ({
      user,
      status,
      error,
      async login(email, password) {
        setError(null);
        try {
          const result = await authApi.login(email, password);
          setAccessToken(result.accessToken);
          setUser(result.user);
          setStatus('authenticated');
          return true;
        } catch (err) {
          setError(err instanceof Error ? err.message : 'Ошибка входа');
          return false;
        }
      },
      async register(email, password, name) {
        setError(null);
        try {
          const result = await authApi.register(email, password, name);
          setAccessToken(result.accessToken);
          setUser(result.user);
          setStatus('authenticated');
          return true;
        } catch (err) {
          setError(err instanceof Error ? err.message : 'Ошибка регистрации');
          return false;
        }
      },
      async logout() {
        setError(null);
        try {
          await authApi.logout();
        } catch {
          // Сетевые ошибки при выходе не блокируют локальное завершение сессии
        }
        clearAccessToken();
        setUser(null);
        setStatus('unauthenticated');
      },
    }),
    [user, status, error],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

/** Хук доступа к auth-состоянию. */
export function useAuth(): AuthContextValue {
  const context = useContext(AuthContext);
  if (!context) {
    throw new Error('useAuth должен использоваться внутри AuthProvider');
  }
  return context;
}
