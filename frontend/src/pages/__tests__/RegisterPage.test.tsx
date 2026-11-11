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
import { RegisterPage } from '../RegisterPage';
import { AuthProvider } from '../../context/AuthContext';

/**
 * Тест потока регистрации (docs/design.md §6.1): форма → POST /api/auth/register.
 */

function renderPage() {
  return render(
    <MemoryRouter initialEntries={['/register']}>
      <AuthProvider>
        <RegisterPage />
      </AuthProvider>
    </MemoryRouter>,
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(authApi.refresh).mockRejectedValue(new Error('Нет cookie'));
});

// Vitest без globals не делает авто-cleanup рендеров между тестами
afterEach(() => {
  cleanup();
});

describe('RegisterPage', () => {
  it('рендерит форму регистрации с полями имя, email и пароль', () => {
    renderPage();
    expect(screen.getByLabelText('Имя')).toBeInTheDocument();
    expect(screen.getByLabelText('Email')).toBeInTheDocument();
    expect(screen.getByLabelText('Пароль')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Создать аккаунт' })).toBeInTheDocument();
  });

  it('короткий пароль → inline-ошибка, запрос не отправляется', async () => {
    const user = userEvent.setup();
    renderPage();

    await user.type(screen.getByLabelText('Имя'), 'Алексей');
    await user.type(screen.getByLabelText('Email'), 'user@example.com');
    await user.type(screen.getByLabelText('Пароль'), 'short');
    await user.click(screen.getByRole('button', { name: 'Создать аккаунт' }));

    expect(
      await screen.findByText('Пароль должен содержать от 8 до 72 символов'),
    ).toBeInTheDocument();
    expect(authApi.register).not.toHaveBeenCalled();
  });

  it('успешная регистрация вызывает register с нормализованными данными', async () => {
    vi.mocked(authApi.register).mockResolvedValue({
      user: { id: 1, email: 'user@example.com', name: 'Алексей', createdAt: '2026-11-11T10:00:00.000Z' },
      accessToken: 'token',
    });
    const user = userEvent.setup();
    renderPage();

    await user.type(screen.getByLabelText('Имя'), 'Алексей');
    await user.type(screen.getByLabelText('Email'), '  user@example.com  ');
    await user.type(screen.getByLabelText('Пароль'), 'password123');
    await user.click(screen.getByRole('button', { name: 'Создать аккаунт' }));

    await waitFor(() => {
      expect(authApi.register).toHaveBeenCalledWith('user@example.com', 'password123', 'Алексей');
    });
  });

  it('дубликат email → 409-ошибка сервера в баннере', async () => {
    vi.mocked(authApi.register).mockRejectedValue(
      Object.assign(new Error('Пользователь с таким email уже зарегистрирован'), { code: 'CONFLICT' }),
    );
    const user = userEvent.setup();
    renderPage();

    await user.type(screen.getByLabelText('Имя'), 'Алексей');
    await user.type(screen.getByLabelText('Email'), 'user@example.com');
    await user.type(screen.getByLabelText('Пароль'), 'password123');
    await user.click(screen.getByRole('button', { name: 'Создать аккаунт' }));

    expect(await screen.findByRole('alert')).toHaveTextContent(
      'Пользователь с таким email уже зарегистрирован',
    );
  });
});
