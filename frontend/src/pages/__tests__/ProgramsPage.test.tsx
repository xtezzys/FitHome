import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';

vi.mock('../../api/programs', () => ({
  listPrograms: vi.fn(),
  getProgram: vi.fn(),
  createProgram: vi.fn(),
  updateProgram: vi.fn(),
  deleteProgram: vi.fn(),
  copyProgram: vi.fn(),
  addProgramExercise: vi.fn(),
  updateProgramExercise: vi.fn(),
  reorderProgramExercises: vi.fn(),
  removeProgramExercise: vi.fn(),
}));

vi.mock('../../api/auth', () => ({
  login: vi.fn(),
  register: vi.fn(),
  refresh: vi.fn(),
  logout: vi.fn(),
  getMe: vi.fn(),
  updateMe: vi.fn(),
}));

import * as programsApi from '../../api/programs';
import * as authApi from '../../api/auth';
import { ProgramsPage } from '../ProgramsPage';
import { AuthProvider } from '../../context/AuthContext';
import type { Program } from '../../types/program';

function makeProgram(overrides: Partial<Program> = {}): Program {
  return {
    id: 50,
    userId: 1,
    name: 'Моя программа',
    description: 'Описание',
    place: 'home',
    isActive: true,
    exercisesCount: 5,
    createdAt: '2026-11-11T10:00:00.000Z',
    ...overrides,
  };
}

function makePage(programs: Program[]) {
  return { data: programs, meta: { page: 1, limit: 12, total: programs.length } };
}

function renderPage() {
  return render(
    <MemoryRouter initialEntries={['/programs']}>
      <AuthProvider>
        <ProgramsPage />
      </AuthProvider>
    </MemoryRouter>,
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(authApi.refresh).mockResolvedValue({ accessToken: 'test-token' });
  vi.mocked(authApi.getMe).mockResolvedValue({
    id: 1,
    email: 'test@example.com',
    name: 'Тест',
    createdAt: '2026-11-11T10:00:00.000Z',
  });
});

afterEach(() => {
  cleanup();
});

describe('ProgramsPage — вкладки и списки', () => {
  it('по умолчанию показываются «Мои программы»', async () => {
    vi.mocked(programsApi.listPrograms).mockResolvedValue(makePage([makeProgram()]));
    renderPage();
    expect(await screen.findByText('Моя программа')).toBeInTheDocument();
    const calls = vi.mocked(programsApi.listPrograms).mock.calls;
      const last = calls[calls.length - 1]?.[0];
    expect(last?.scope).toBe('mine');
  });

  it('переключение на «Готовые» запрашивает scope=ready', async () => {
    vi.mocked(programsApi.listPrograms).mockResolvedValue(makePage([]));
    renderPage();
    await screen.findByText('У вас пока нет программ');

    await userEvent.click(screen.getByRole('tab', { name: 'Готовые программы' }));
    await waitFor(() => {
      const calls = vi.mocked(programsApi.listPrograms).mock.calls;
      const last = calls[calls.length - 1]?.[0];
      expect(last?.scope).toBe('ready');
    });
  });

  it('ошибка API → баннер и «Повторить»', async () => {
    vi.mocked(programsApi.listPrograms)
      .mockRejectedValueOnce(new Error('Сеть недоступна'))
      .mockResolvedValueOnce(makePage([makeProgram()]));
    renderPage();
    expect(await screen.findByRole('alert')).toHaveTextContent('Сеть недоступна');
    await userEvent.click(screen.getByRole('button', { name: 'Повторить' }));
    expect(await screen.findByText('Моя программа')).toBeInTheDocument();
  });
});

describe('ProgramsPage — мои программы', () => {
  it('карточка содержит место и количество упражнений', async () => {
    vi.mocked(programsApi.listPrograms).mockResolvedValue(makePage([makeProgram()]));
    renderPage();
    expect(await screen.findByText('Дом')).toBeInTheDocument();
    expect(screen.getByText('5 упражнений')).toBeInTheDocument();
  });

  it('создание программы через модалку → POST + переход в конструктор', async () => {
    vi.mocked(programsApi.listPrograms).mockResolvedValue(makePage([makeProgram()]));
    vi.mocked(programsApi.createProgram).mockResolvedValue(
      makeProgram({ id: 99, name: 'Новая' }),
    );
    renderPage();
    await screen.findByText('Моя программа');

    await userEvent.click(screen.getByRole('button', { name: '+ Программа' }));
    await userEvent.type(screen.getByLabelText('Название'), 'Новая');
    await userEvent.click(screen.getByRole('button', { name: 'Создать' }));

    await waitFor(() =>
      expect(programsApi.createProgram).toHaveBeenCalledWith(
        expect.objectContaining({ name: 'Новая', place: 'home' }),
      ),
    );
    expect(await screen.findByText('Программа создана')).toBeInTheDocument();
  });

  it('удаление с подтверждением → DELETE', async () => {
    vi.mocked(programsApi.listPrograms).mockResolvedValue(makePage([makeProgram()]));
    vi.mocked(programsApi.deleteProgram).mockResolvedValue(undefined);
    renderPage();
    await screen.findByText('Моя программа');

    await userEvent.click(screen.getByRole('button', { name: 'Удалить' }));
    expect(screen.getByText(/Удалить программу «Моя программа»/)).toBeInTheDocument();
    const confirmButtons = screen.getAllByRole('button', { name: 'Удалить' });
    await userEvent.click(confirmButtons[confirmButtons.length - 1]);
    await waitFor(() => expect(programsApi.deleteProgram).toHaveBeenCalledWith(50));
    expect(await screen.findByText('Программа удалена')).toBeInTheDocument();
  });

  it('пустой список «Мои» → заглушка с кнопкой создания', async () => {
    vi.mocked(programsApi.listPrograms).mockResolvedValue(makePage([]));
    renderPage();
    expect(await screen.findByText('У вас пока нет программ')).toBeInTheDocument();
    // «+ Программа» есть и в шапке, и в заглушке
    expect(screen.getAllByRole('button', { name: '+ Программа' }).length).toBe(2);
  });
});

describe('ProgramsPage — готовые программы', () => {
  const ready = makeProgram({
    id: 60,
    userId: null,
    name: 'Готовая программа',
    exercisesCount: 6,
  });

  it('карточка готовой программы с кнопкой «Копировать»', async () => {
    vi.mocked(programsApi.listPrograms).mockResolvedValue(makePage([ready]));
    renderPage();
    await screen.findByText('Готовые программы');
    await userEvent.click(screen.getByRole('tab', { name: 'Готовые программы' }));
    expect(await screen.findByText('Готовая программа')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Копировать' })).toBeInTheDocument();
  });

  it('копирование → POST /copy + уведомление + переключение на «Мои»', async () => {
    vi.mocked(programsApi.listPrograms).mockResolvedValue(makePage([ready]));
    vi.mocked(programsApi.copyProgram).mockResolvedValue(makeProgram({ id: 99, name: 'Готовая программа' }));
    renderPage();
    await userEvent.click(await screen.findByRole('tab', { name: 'Готовые программы' }));
    await userEvent.click(await screen.findByRole('button', { name: 'Копировать' }));

    await waitFor(() => expect(programsApi.copyProgram).toHaveBeenCalledWith(60));
    expect(await screen.findByText(/скопирована в ваши/)).toBeInTheDocument();
    await waitFor(() => {
      const calls = vi.mocked(programsApi.listPrograms).mock.calls;
      const last = calls[calls.length - 1]?.[0];
      expect(last?.scope).toBe('mine');
    });
  });
});
