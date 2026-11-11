import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, waitFor, cleanup } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';

vi.mock('../../api/auth', () => ({
  login: vi.fn(),
  register: vi.fn(),
  refresh: vi.fn(),
  logout: vi.fn(),
  getMe: vi.fn(),
  updateMe: vi.fn(),
}));

import * as authApi from '../../api/auth';
import { LoginPage } from '../LoginPage';
import { AuthProvider } from '../../context/AuthContext';

/**
 * Тест потока входа (docs/testing.md §4 — формы авторизации, приоритет 2).
 * API-слой мокается: страница не зависит от сети.
 */

function renderPage() {
  return render(
    <MemoryRouter initialEntries={['/login']}>
      <AuthProvider>
        <LoginPage />
      </AuthProvider>
    </MemoryRouter>,
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  // Восстановление сессии при монтировании проваливается → unauthenticated
  vi.mocked(authApi.refresh).mockRejectedValue(new Error('Нет cookie'));
});

// Vitest без globals не делает авто-cleanup рендеров между тестами
afterEach(() => {
  cleanup();
});

describe('LoginPage', () => {
  it('рендерит форму входа с полями email и пароль', () => {
    renderPage();
    expect(screen.getByRole('heading', { name: 'FitHome' })).toBeInTheDocument();
    expect(screen.getByLabelText('Email')).toBeInTheDocument();
    expect(screen.getByLabelText('Пароль')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Войти' })).toBeInTheDocument();
  });

  it('показывает inline-ошибку при некорректном email и не отправляет запрос', async () => {
    const user = userEvent.setup();
    renderPage();

    await user.type(screen.getByLabelText('Email'), 'not-an-email');
    await user.type(screen.getByLabelText('Пароль'), 'password123');
    await user.click(screen.getByRole('button', { name: 'Войти' }));

    expect(await screen.findByText('Введите корректный email')).toBeInTheDocument();
    expect(authApi.login).not.toHaveBeenCalled();
  });

  it('успешный вход вызывает login с введёнными данными', async () => {
    vi.mocked(authApi.login).mockResolvedValue({
      user: { id: 1, email: 'user@example.com', name: 'Алексей', createdAt: '2026-11-11T10:00:00.000Z' },
      accessToken: 'token',
    });
    const user = userEvent.setup();
    renderPage();

    await user.type(screen.getByLabelText('Email'), 'user@example.com');
    await user.type(screen.getByLabelText('Пароль'), 'password123');
    await user.click(screen.getByRole('button', { name: 'Войти' }));

    await waitFor(() => {
      expect(authApi.login).toHaveBeenCalledWith('user@example.com', 'password123');
    });
  });

  it('ошибка сервера отображается в баннере (единый формат docs/api.md §1)', async () => {
    vi.mocked(authApi.login).mockRejectedValue(
      Object.assign(new Error('Неверный email или пароль'), { code: 'UNAUTHORIZED' }),
    );
    const user = userEvent.setup();
    renderPage();

    await user.type(screen.getByLabelText('Email'), 'user@example.com');
    await user.type(screen.getByLabelText('Пароль'), 'password123');
    await user.click(screen.getByRole('button', { name: 'Войти' }));

    expect(await screen.findByRole('alert')).toHaveTextContent('Неверный email или пароль');
  });
});
