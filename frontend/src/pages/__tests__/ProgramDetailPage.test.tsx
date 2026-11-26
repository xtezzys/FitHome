import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes } from 'react-router-dom';

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

vi.mock('../../api/exercises', () => ({
  listExercises: vi.fn(),
  getExercise: vi.fn(),
  createExercise: vi.fn(),
  updateExercise: vi.fn(),
  deleteExercise: vi.fn(),
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
import * as exercisesApi from '../../api/exercises';
import * as authApi from '../../api/auth';
import { ProgramDetailPage } from '../ProgramDetailPage';
import { AuthProvider } from '../../context/AuthContext';
import type { Exercise } from '../../types/exercise';
import type { Program } from '../../types/program';

function makeExercise(overrides: Partial<Exercise> = {}): Exercise {
  return {
    id: 100,
    name: 'Отжимания',
    description: null,
    place: 'home',
    metric: 'reps',
    muscleGroups: ['chest'],
    difficulty: 'easy',
    equipment: [],
    userId: null,
    createdAt: '2026-11-11T10:00:00.000Z',
    ...overrides,
  };
}

function makeProgram(overrides: Partial<Program> = {}): Program {
  const ex = makeExercise();
  return {
    id: 50,
    userId: 1,
    name: 'Моя программа',
    description: 'Описание',
    place: 'home',
    isActive: true,
    isPublic: false,
    publishedAt: null,
    authorName: null,
    createdAt: '2026-11-11T10:00:00.000Z',
    exercises: [
      {
        programExerciseId: 500,
        order: 1,
        targetSets: 3,
        targetReps: 15,
        targetWeight: null,
        targetDuration: null,
        restSec: 90,
        exercise: ex,
      },
      {
        programExerciseId: 501,
        order: 2,
        targetSets: 2,
        targetReps: null,
        targetWeight: null,
        targetDuration: 30,
        restSec: 60,
        exercise: makeExercise({ id: 101, name: 'Планка', metric: 'time' }),
      },
    ],
    ...overrides,
  };
}

function renderPage(program?: Program) {
  if (program) vi.mocked(programsApi.getProgram).mockResolvedValue(program);
  return render(
    <MemoryRouter initialEntries={['/programs/50']}>
      <AuthProvider>
        <Routes>
          <Route path="/programs/:id" element={<ProgramDetailPage />} />
        </Routes>
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

describe('ProgramDetailPage — загрузка', () => {
  it('рендерит программу с составом и целевыми нагрузками', async () => {
    renderPage(makeProgram());
    expect(await screen.findByText('Моя программа')).toBeInTheDocument();
    expect(screen.getByText(/3 × 15/)).toBeInTheDocument();
    expect(screen.getByText(/3 × 15 · отдых 90 с/)).toBeInTheDocument();
    expect(screen.getByText(/Время · 2 × 30 сек · отдых 60 с/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '+ Из каталога' })).toBeInTheDocument();
  });

  it('чужая программа (403) → баннер ошибки без конструктора', async () => {
    vi.mocked(programsApi.getProgram).mockRejectedValue(new Error('Программа принадлежит другому пользователю'));
    renderPage();
    expect(await screen.findByRole('alert')).toHaveTextContent('Программа принадлежит другому пользователю');
    expect(screen.queryByRole('button', { name: '+ Из каталога' })).not.toBeInTheDocument();
  });
});

describe('ProgramDetailPage — параметры программы', () => {
  it('сохранение шапки → PUT updateProgram + уведомление', async () => {
    vi.mocked(programsApi.updateProgram).mockResolvedValue(makeProgram());
    renderPage(makeProgram());
    const nameInput = await screen.findByLabelText('Название программы');
    await userEvent.clear(nameInput);
    await userEvent.type(nameInput, 'Обновлённая программа');
    await userEvent.click(screen.getByRole('button', { name: 'Сохранить программу' }));

    await waitFor(() =>
      expect(programsApi.updateProgram).toHaveBeenCalledWith(
        50,
        expect.objectContaining({ name: 'Обновлённая программа' }),
      ),
    );
    expect(await screen.findByText('Программа сохранена')).toBeInTheDocument();
  });
});

describe('ProgramDetailPage — добавление из каталога', () => {
  it('модалка каталога: поиск и добавление упражнения → POST', async () => {
    vi.mocked(exercisesApi.listExercises).mockResolvedValue({
      data: [makeExercise()],
      meta: { page: 1, limit: 20, total: 1 },
    });
    renderPage(makeProgram());
    await screen.findByText('Состав программы');
    await userEvent.click(screen.getByRole('button', { name: '+ Из каталога' }));

    const modal = await screen.findByRole('dialog', { name: 'Добавление упражнения из каталога' });
    expect(modal).toBeInTheDocument();
    // «Отжимания» есть и в составе программы — проверяем внутри модалки
    expect(within(modal).getAllByText('Отжимания').length).toBeGreaterThan(0);

    vi.mocked(exercisesApi.listExercises).mockResolvedValue({
      data: [makeExercise({ id: 200, name: 'Скакалка' })],
      meta: { page: 1, limit: 20, total: 1 },
    });
    await userEvent.type(within(modal).getByLabelText('Поиск по названию'), 'скак');
    await waitFor(() => expect(within(modal).getByText('Скакалка')).toBeInTheDocument());

    await userEvent.click(within(modal).getByRole('button', { name: 'Добавить' }));
    await waitFor(() =>
      expect(programsApi.addProgramExercise).toHaveBeenCalledWith(
        50,
        expect.objectContaining({ exerciseId: 200 }),
      ),
    );
    expect(await screen.findByText(/добавлено в программу/)).toBeInTheDocument();
  });
});

describe('ProgramDetailPage — цели упражнения', () => {
  it('редактирование целей: подходы/повторения → PUT updateProgramExercise', async () => {
    vi.mocked(programsApi.updateProgramExercise).mockResolvedValue(makeProgram().exercises![0]);
    renderPage(makeProgram());
    await screen.findByText('Состав программы');

    const item = screen.getByText('Отжимания').closest('li') as HTMLElement;
    await userEvent.click(within(item).getByRole('button', { name: 'Цели' }));
    const sets = screen.getByLabelText('Подходы');
    await userEvent.clear(sets);
    await userEvent.type(sets, '4');
    const reps = screen.getByLabelText('Повторения');
    await userEvent.clear(reps);
    await userEvent.type(reps, '20');
    const saveButtons = screen.getAllByRole('button', { name: 'Сохранить' });
    await userEvent.click(saveButtons[saveButtons.length - 1]);

    await waitFor(() =>
      expect(programsApi.updateProgramExercise).toHaveBeenCalledWith(
        50,
        500,
        expect.objectContaining({ targetSets: 4, targetReps: 20 }),
      ),
    );
    expect(await screen.findByText('Цели обновлены')).toBeInTheDocument();
  });
});

describe('ProgramDetailPage — порядок и удаление', () => {
  it('стрелка ↓ на первой строке → reorder с новыми позициями', async () => {
    vi.mocked(programsApi.reorderProgramExercises).mockResolvedValue(makeProgram());
    renderPage(makeProgram());
    await screen.findByText('Состав программы');

    const item = screen.getByText('Отжимания').closest('li') as HTMLElement;
    await userEvent.click(within(item).getByRole('button', { name: 'Переместить Отжимания ниже' }));
    await waitFor(() =>
      expect(programsApi.reorderProgramExercises).toHaveBeenCalledWith(50, [
        { programExerciseId: 500, order: 2 },
        { programExerciseId: 501, order: 1 },
      ]),
    );
  });

  it('стрелка ↑ на первой строке заблокирована', async () => {
    renderPage(makeProgram());
    await screen.findByText('Состав программы');
    const item = screen.getByText('Отжимания').closest('li') as HTMLElement;
    expect(within(item).getByRole('button', { name: 'Переместить Отжимания выше' })).toBeDisabled();
  });

  it('удаление строки состава с подтверждением → DELETE', async () => {
    vi.mocked(programsApi.removeProgramExercise).mockResolvedValue(undefined);
    renderPage(makeProgram());
    await screen.findByText('Состав программы');

    const item = screen.getByText('Отжимания').closest('li') as HTMLElement;
    await userEvent.click(within(item).getByRole('button', { name: 'Удалить' }));
    expect(screen.getByText(/Убрать упражнение из программы/)).toBeInTheDocument();
    const confirmButtons = screen.getAllByRole('button', { name: 'Удалить' });
    await userEvent.click(confirmButtons[confirmButtons.length - 1]);
    await waitFor(() => expect(programsApi.removeProgramExercise).toHaveBeenCalledWith(50, 500));
    expect(await screen.findByText('Упражнение удалено из программы')).toBeInTheDocument();
  });
});

describe('ProgramDetailPage — ошибки', () => {
  it('ошибка добавления упражнения показывается в модалке', async () => {
    vi.mocked(exercisesApi.listExercises).mockResolvedValue({
      data: [makeExercise()],
      meta: { page: 1, limit: 20, total: 1 },
    });
    vi.mocked(programsApi.addProgramExercise).mockRejectedValue(
      new Error('Персональное упражнение другого пользователя недоступно'),
    );
    renderPage(makeProgram());
    await screen.findByText('Состав программы');
    await userEvent.click(screen.getByRole('button', { name: '+ Из каталога' }));
    const modal = await screen.findByRole('dialog', { name: 'Добавление упражнения из каталога' });
    await within(modal).findByText('Отжимания');
    await userEvent.click(within(modal).getByRole('button', { name: 'Добавить' }));
    expect(within(modal).getByRole('alert')).toHaveTextContent('недоступно');
  });
});
