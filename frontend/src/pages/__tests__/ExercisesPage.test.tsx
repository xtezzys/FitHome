import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';

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

import * as exercisesApi from '../../api/exercises';
import * as authApi from '../../api/auth';
import { ExercisesPage } from '../ExercisesPage';
import { AuthProvider } from '../../context/AuthContext';
import { MUSCLE_LABELS } from '../../lib/labels';
import type { Exercise, Paginated } from '../../types/exercise';

const USER_ID = 1;

function makeExercise(overrides: Partial<Exercise> = {}): Exercise {
  return {
    id: 10,
    name: 'Отжимания',
    description: 'Классические отжимания',
    place: 'home',
    metric: 'reps',
    muscleGroups: ['chest', 'triceps'],
    difficulty: 'easy',
    equipment: [],
    userId: null,
    createdAt: '2026-11-11T10:00:00.000Z',
    ...overrides,
  };
}

function makePage(items: Exercise[]): Paginated<Exercise> {
  return { data: items, meta: { page: 1, limit: 12, total: items.length } };
}

function renderPage() {
  return render(
    <MemoryRouter initialEntries={['/exercises']}>
      <AuthProvider>
        <ExercisesPage />
      </AuthProvider>
    </MemoryRouter>,
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  // Пользователь авторизован: refresh и getMe успешны (userId = 1)
  vi.mocked(authApi.refresh).mockResolvedValue({ accessToken: 'test-token' });
  vi.mocked(authApi.getMe).mockResolvedValue({
    id: USER_ID,
    email: 'test@example.com',
    name: 'Тест',
    createdAt: '2026-11-11T10:00:00.000Z',
  });
});

afterEach(() => {
  cleanup();
});

describe('ExercisesPage — каталог', () => {
  it('загружает и рендерит карточки упражнений', async () => {
    vi.mocked(exercisesApi.listExercises).mockResolvedValue(makePage([makeExercise()]));
    renderPage();
    expect(await screen.findByText('Отжимания')).toBeInTheDocument();
    expect(screen.getAllByText('Повторения').length).toBeGreaterThan(0);
    expect(screen.getAllByText('Легко').length).toBeGreaterThan(0);
    expect(screen.getAllByText('Дом').length).toBeGreaterThan(0);
  });

  it('пустой результат → заглушка «Ничего не найдено»', async () => {
    vi.mocked(exercisesApi.listExercises).mockResolvedValue(makePage([]));
    renderPage();
    expect(await screen.findByText('Ничего не найдено')).toBeInTheDocument();
  });

  it('ошибка API → баннер с кнопкой «Повторить», повтор успешен', async () => {
    vi.mocked(exercisesApi.listExercises)
      .mockRejectedValueOnce(new Error('Сеть недоступна'))
      .mockResolvedValueOnce(makePage([makeExercise()]));
    renderPage();
    expect(await screen.findByRole('alert')).toHaveTextContent('Сеть недоступна');
    await userEvent.click(screen.getByRole('button', { name: 'Повторить' }));
    expect(await screen.findByText('Отжимания')).toBeInTheDocument();
  });

  it('поиск: после debounce запрос уходит с параметром search', async () => {
    vi.mocked(exercisesApi.listExercises).mockResolvedValue(makePage([]));
    renderPage();
    await screen.findByText('Ничего не найдено');

    await userEvent.type(screen.getByLabelText('Поиск по названию'), 'отжим');
    await waitFor(
      () => {
        const calls = vi.mocked(exercisesApi.listExercises).mock.calls;
        const last = calls[calls.length - 1]?.[0];
        expect(last?.search).toBe('отжим');
      },
      { timeout: 1500 },
    );
  });

  it('фильтр по месту: клик по чипу «Дом» → place=home в запросе', async () => {
    vi.mocked(exercisesApi.listExercises).mockResolvedValue(makePage([]));
    renderPage();
    await screen.findByText('Ничего не найдено');

    await userEvent.click(screen.getByRole('button', { name: 'Дом' }));
    await waitFor(() => {
      const calls = vi.mocked(exercisesApi.listExercises).mock.calls;
        const last = calls[calls.length - 1]?.[0];
      expect(last?.place).toBe('home');
    });
  });

  it('фильтр по сложности → difficulty в запросе', async () => {
    vi.mocked(exercisesApi.listExercises).mockResolvedValue(makePage([]));
    renderPage();
    await screen.findByText('Ничего не найдено');

    await userEvent.click(screen.getByRole('button', { name: 'Сложно' }));
    await waitFor(() => {
      const calls = vi.mocked(exercisesApi.listExercises).mock.calls;
        const last = calls[calls.length - 1]?.[0];
      expect(last?.difficulty).toBe('hard');
    });
  });

  it('фильтр по мышцам: токен из словаря попадает в запрос', async () => {
    vi.mocked(exercisesApi.listExercises).mockResolvedValue(makePage([]));
    renderPage();
    await screen.findByText('Ничего не найдено');

    await userEvent.click(screen.getByRole('button', { name: 'Грудь' }));
    await waitFor(() => {
      const calls = vi.mocked(exercisesApi.listExercises).mock.calls;
        const last = calls[calls.length - 1]?.[0];
      expect(last?.muscle).toEqual(['chest']);
    });
  });

  it('пагинация: страница меняется, фильтры сохраняются', async () => {
    const items = Array.from({ length: 12 }, (_, i) => makeExercise({ id: i + 1, name: `Упражнение ${i + 1}` }));
    vi.mocked(exercisesApi.listExercises).mockResolvedValue({
      data: items,
      meta: { page: 1, limit: 12, total: 30 },
    });
    renderPage();
    await screen.findByText('Упражнение 1');

    await userEvent.click(screen.getByRole('button', { name: 'Вперёд →' }));
    await waitFor(() => {
      const calls = vi.mocked(exercisesApi.listExercises).mock.calls;
        const last = calls[calls.length - 1]?.[0];
      expect(last?.page).toBe(2);
      expect(last?.place).toBeUndefined(); // фильтры не заданы — сохраняются как есть
    });
  });
});

describe('ExercisesPage — детали и CRUD', () => {
  it('клик по карточке открывает детали с мышцами и инвентарём', async () => {
    vi.mocked(exercisesApi.listExercises).mockResolvedValue(
      makePage([makeExercise({ equipment: ['dumbbell'] })]),
    );
    renderPage();
    await userEvent.click(await screen.findByText('Отжимания'));
    expect(screen.getByRole('dialog', { name: 'Отжимания' })).toBeInTheDocument();
    expect(screen.getAllByText(/Грудь/).length).toBeGreaterThan(0);
    expect(screen.getAllByText(/Гантели/).length).toBeGreaterThan(0);
  });

  it('общее упражнение не показывает кнопки Изменить/Удалить', async () => {
    vi.mocked(exercisesApi.listExercises).mockResolvedValue(makePage([makeExercise({ userId: null })]));
    renderPage();
    await userEvent.click(await screen.findByText('Отжимания'));
    expect(screen.queryByRole('button', { name: 'Изменить' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Удалить' })).not.toBeInTheDocument();
  });

  it('своё упражнение показывает Изменить/Удалить; удаление с подтверждением → DELETE', async () => {
    vi.mocked(exercisesApi.listExercises).mockResolvedValue(
      makePage([makeExercise({ userId: USER_ID, name: 'Моё', id: 20 })]),
    );
    vi.mocked(exercisesApi.deleteExercise).mockResolvedValue(undefined);
    renderPage();
    await userEvent.click(await screen.findByText('Моё'));
    await userEvent.click(screen.getByRole('button', { name: 'Удалить' }));
    expect(screen.getByText(/Удалить «Моё»/)).toBeInTheDocument();
    const confirmButtons = screen.getAllByRole('button', { name: 'Удалить' });
    await userEvent.click(confirmButtons[confirmButtons.length - 1]);
    await waitFor(() => expect(exercisesApi.deleteExercise).toHaveBeenCalledWith(20));
    expect(await screen.findByText('Упражнение удалено')).toBeInTheDocument();
  });

  it('409 при удалении используемого упражнения показывается в уведомлении', async () => {
    vi.mocked(exercisesApi.listExercises).mockResolvedValue(
      makePage([makeExercise({ userId: USER_ID, name: 'Моё', id: 20 })]),
    );
    vi.mocked(exercisesApi.deleteExercise).mockRejectedValue(
      new Error('Упражнение используется в программах или результатах тренировок'),
    );
    renderPage();
    await userEvent.click(await screen.findByText('Моё'));
    await userEvent.click(screen.getByRole('button', { name: 'Удалить' }));
    const confirmButtons = screen.getAllByRole('button', { name: 'Удалить' });
    await userEvent.click(confirmButtons[confirmButtons.length - 1]);
    expect(await screen.findByText(/используется в программах/)).toBeInTheDocument();
  });

  it('создание упражнения: форма → POST, уведомление об успехе', async () => {
    vi.mocked(exercisesApi.listExercises).mockResolvedValue(makePage([]));
    vi.mocked(exercisesApi.createExercise).mockResolvedValue(makeExercise({ userId: USER_ID }));
    renderPage();
    await screen.findByText('Ничего не найдено');

    await userEvent.click(screen.getAllByRole('button', { name: '+ Упражнение' })[0]);
    await userEvent.type(screen.getByLabelText('Название'), 'Новое упражнение');
    await userEvent.click(screen.getByRole('button', { name: 'Создать' }));

    await waitFor(() => expect(exercisesApi.createExercise).toHaveBeenCalled());
    expect(await screen.findByText('Упражнение создано')).toBeInTheDocument();
  });

  it('ошибка создания (409) показывается в форме', async () => {
    vi.mocked(exercisesApi.listExercises).mockResolvedValue(makePage([]));
    vi.mocked(exercisesApi.createExercise).mockRejectedValue(
      new Error('Упражнение с таким названием уже есть у пользователя'),
    );
    renderPage();
    await screen.findByText('Ничего не найдено');

    await userEvent.click(screen.getAllByRole('button', { name: '+ Упражнение' })[0]);
    await userEvent.type(screen.getByLabelText('Название'), 'Дубль');
    await userEvent.click(screen.getByRole('button', { name: 'Создать' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('уже есть у пользователя');
  });

  it('редактирование своего упражнения → PUT', async () => {
    vi.mocked(exercisesApi.listExercises).mockResolvedValue(
      makePage([makeExercise({ userId: USER_ID, id: 20 })]),
    );
    vi.mocked(exercisesApi.updateExercise).mockResolvedValue(makeExercise({ userId: USER_ID }) as never);
    renderPage();
    await userEvent.click(await screen.findByText('Отжимания'));
    await userEvent.click(screen.getByRole('button', { name: 'Изменить' }));
    const nameInput = screen.getByLabelText('Название');
    await userEvent.clear(nameInput);
    await userEvent.type(nameInput, 'Отжимания с опорой');
    await userEvent.click(screen.getByRole('button', { name: 'Сохранить' }));
    await waitFor(() =>
      expect(exercisesApi.updateExercise).toHaveBeenCalledWith(20, expect.objectContaining({ name: 'Отжимания с опорой' })),
    );
    expect(await screen.findByText('Упражнение обновлено')).toBeInTheDocument();
  });
});


function makeItems(from: number, count: number): Exercise[] {
  return Array.from({ length: count }, (_, i) =>
    makeExercise({ id: from + i, name: `Упражнение ${from + i}`, userId: null }),
  );
}

describe('ExercisesPage — вкладки Все / Базовые / Мои', () => {

  it('по умолчанию активна вкладка «Все», запрос со scope=all', async () => {
    vi.mocked(exercisesApi.listExercises).mockResolvedValue(makePage(makeItems(1, 1)));
    renderPage();
    expect(await screen.findByText('Упражнение 1')).toBeInTheDocument();
    expect(screen.getByRole('tab', { name: 'Все' })).toHaveAttribute('aria-selected', 'true');
    const callsL = vi.mocked(exercisesApi.listExercises).mock.calls;
    const last = callsL[callsL.length - 1]?.[0];
    expect(last?.scope).toBe('all');
  });

  it('вкладка «Базовые» → scope=shared в запросе', async () => {
    vi.mocked(exercisesApi.listExercises).mockResolvedValue(makePage(makeItems(1, 1)));
    renderPage();
    await screen.findByText('Упражнение 1');
    await userEvent.click(screen.getByRole('tab', { name: 'Базовые' }));
    await waitFor(() => {
      const callsL = vi.mocked(exercisesApi.listExercises).mock.calls;
    const last = callsL[callsL.length - 1]?.[0];
      expect(last?.scope).toBe('shared');
    });
  });

  it('вкладка «Мои» → scope=mine и сброс страницы на первую', async () => {
    vi.mocked(exercisesApi.listExercises).mockResolvedValue({
      data: makeItems(1, 12),
      meta: { page: 1, limit: 12, total: 30 },
    });
    renderPage();
    await screen.findByText('Упражнение 1');
    await userEvent.click(screen.getByRole('button', { name: 'Вперёд →' }));
    await waitFor(() => {
      const callsL = vi.mocked(exercisesApi.listExercises).mock.calls;
    const last = callsL[callsL.length - 1]?.[0];
      expect(last?.page).toBe(2);
    });

    await userEvent.click(screen.getByRole('tab', { name: 'Мои' }));
    await waitFor(() => {
      const calls = vi.mocked(exercisesApi.listExercises).mock.calls;
      const last = calls[calls.length - 1]?.[0];
      expect(last?.scope).toBe('mine');
      expect(last?.page).toBe(1);
    });
  });

  it('пустые «Мои» → своя заглушка', async () => {
    vi.mocked(exercisesApi.listExercises).mockResolvedValue(makePage([]));
    renderPage();
    await screen.findByText('Ничего не найдено');
    await userEvent.click(screen.getByRole('tab', { name: 'Мои' }));
    expect(await screen.findByText('У вас пока нет своих упражнений')).toBeInTheDocument();
  });

  it('вкладка «Базовые» — только общие упражнения (фронт передаёт scope, фильтрует backend)', async () => {
    const shared = makeExercise({ id: 1, userId: null, name: 'Базовое' });
    // Вкладка «Базовые»: backend вернул только общие
    vi.mocked(exercisesApi.listExercises).mockResolvedValue(makePage([shared]));
    renderPage();
    await userEvent.click(await screen.findByRole('tab', { name: 'Базовые' }));
    expect(await screen.findByText('Базовое')).toBeInTheDocument();
    // Backend отфильтровал: персональных в ответе нет
    expect(screen.queryByText('Своё')).not.toBeInTheDocument();
  });
});

describe('ExercisesPage — сохранение прокрутки при пагинации', () => {
  it('во время загрузки следующей страницы карточки остаются в DOM', async () => {
    const first = makeItems(1, 12);
    const second = makeItems(13, 12);
    let resolveSecond: (value: Paginated<Exercise>) => void = () => {};
    vi.mocked(exercisesApi.listExercises)
      .mockResolvedValueOnce({ data: first, meta: { page: 1, limit: 12, total: 24 } })
      .mockImplementationOnce(
        () =>
          new Promise<Paginated<Exercise>>((resolve) => {
            resolveSecond = resolve;
          }),
      );
    renderPage();
    await screen.findByText('Упражнение 1');

    await userEvent.click(screen.getByRole('button', { name: 'Вперёд →' }));
    // Список не схлопнулся: карточки первой страницы всё ещё в DOM
    expect(screen.getByText('Упражнение 1')).toBeInTheDocument();
    expect(screen.getByText('Упражнение 12')).toBeInTheDocument();

    resolveSecond({ data: second, meta: { page: 2, limit: 12, total: 24 } });
    await waitFor(() => expect(screen.getByText('Упражнение 13')).toBeInTheDocument());
  });

  it('позиция прокрутки восстанавливается после смены страницы (scrollY = 640)', async () => {
    vi.mocked(exercisesApi.listExercises)
      .mockResolvedValueOnce({ data: makeItems(1, 12), meta: { page: 1, limit: 12, total: 24 } })
      .mockResolvedValueOnce({ data: makeItems(13, 12), meta: { page: 2, limit: 12, total: 24 } });
    // Имитируем прокрутку пользователя до пагинации
    Object.defineProperty(window, 'scrollY', { configurable: true, value: 640 });
    const scrollToSpy = vi.spyOn(window, 'scrollTo').mockImplementation(() => {});
    renderPage();
    await screen.findByText('Упражнение 1');

    await userEvent.click(screen.getByRole('button', { name: 'Вперёд →' }));
    await waitFor(() => expect(scrollToSpy).toHaveBeenCalledWith(0, 640));
    // Восстановление однократное — нет циклов прокрутки
    expect(scrollToSpy.mock.calls.length).toBeLessThanOrEqual(2);

    Object.defineProperty(window, 'scrollY', { configurable: true, value: 0 });
    scrollToSpy.mockRestore();
  });

  it('пагинация не прокручивает страницу к началу (нет scrollTo(0, 0))', async () => {
    vi.mocked(exercisesApi.listExercises).mockResolvedValue({
      data: makeItems(1, 12),
      meta: { page: 1, limit: 12, total: 24 },
    });
    Object.defineProperty(window, 'scrollY', { configurable: true, value: 480 });
    const scrollToSpy = vi.spyOn(window, 'scrollTo').mockImplementation(() => {});
    renderPage();
    await screen.findByText('Упражнение 1');
    await userEvent.click(screen.getByRole('button', { name: 'Вперёд →' }));
    await waitFor(() => {
      const calls = vi.mocked(exercisesApi.listExercises).mock.calls;
      expect(calls[calls.length - 1]?.[0]?.page).toBe(2);
    });
    expect(scrollToSpy).not.toHaveBeenCalledWith(0, 0);
    Object.defineProperty(window, 'scrollY', { configurable: true, value: 0 });
    scrollToSpy.mockRestore();
  });

  it('чипы каждого фильтра лежат в отдельном контейнере — переносы от одной левой границы', async () => {
    vi.mocked(exercisesApi.listExercises).mockResolvedValue(makePage([makeExercise()]));
    const { container } = renderPage();
    await screen.findByText('Отжимания');

    const boxes = container.querySelectorAll('.catalog__filter-chips');
    expect(boxes.length).toBe(4); // Место, Сложность, Мышцы, Инвентарь

    const muscles = boxes[2];
    const chips = muscles.querySelectorAll('.chip');
    expect(chips.length).toBe(Object.keys(MUSCLE_LABELS).length);
    // Все чипы — прямые дети одного flex-контейнера (перенос выравнивается слева)
    chips.forEach((chip) => expect(chip.parentElement).toBe(muscles));
  });
});

describe('ExercisesPage — без технических меток', () => {
  it('raw-токен инвентаря не отображается в карточке', async () => {
    vi.mocked(exercisesApi.listExercises).mockResolvedValue(
      makePage([makeExercise({ equipment: ['exercise_bike'] })]),
    );
    renderPage();
    await screen.findByText('Отжимания');
    expect(screen.queryByText('exercise_bike')).not.toBeInTheDocument();
  });

  it('raw-токены мышц не отображаются (русские подписи вместо них)', async () => {
    vi.mocked(exercisesApi.listExercises).mockResolvedValue(makePage([makeExercise()]));
    renderPage();
    await screen.findByText('Отжимания');
    expect(screen.queryByText('chest')).not.toBeInTheDocument();
    expect(screen.getAllByText('Грудь').length).toBeGreaterThan(0);
  });
});
