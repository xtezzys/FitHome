import { useCallback, useEffect, useState } from 'react';
import { AppLayout } from '../components/AppLayout';
import { Button } from '../components/Button';
import { Chip } from '../components/Chip';
import { EmptyState } from '../components/EmptyState';
import { ExerciseCard } from '../components/ExerciseCard';
import { Modal } from '../components/Modal';
import { Pagination } from '../components/Pagination';
import { Select } from '../components/Select';
import { TextField } from '../components/TextField';
import { Spinner } from '../components/Spinner';
import {
  createExercise,
  deleteExercise,
  listExercises,
  updateExercise,
} from '../api/exercises';
import type { Exercise, ExerciseInput, Paginated } from '../types/exercise';
import {
  DIFFICULTY_LABELS,
  EQUIPMENT_LABELS,
  METRIC_LABELS,
  MUSCLE_LABELS,
  PLACE_LABELS,
  label,
} from '../lib/labels';
import { useDebouncedValue } from '../hooks/useDebouncedValue';
import { useAuth } from '../context/AuthContext';
import './ExercisesPage.css';

/**
 * Каталог упражнений (docs/design.md §3.2): поиск, фильтры (место, мышцы,
 * инвентарь, сложность), пагинация, детали, CRUD персональных упражнений.
 * Фильтры хранятся в состоянии — при смене страницы сохраняются.
 */

const PAGE_SIZE = 12;

const EMPTY_FORM: ExerciseInput = {
  name: '',
  description: '',
  place: 'home',
  metric: 'reps',
  muscleGroups: [],
  difficulty: 'easy',
  equipment: [],
};

type LoadState =
  | { status: 'loading' }
  | { status: 'ready'; data: Paginated<Exercise> }
  | { status: 'error'; message: string };

function errorMessage(err: unknown): string {
  return err instanceof Error ? err.message : 'Ошибка загрузки';
}

export function ExercisesPage() {
  const { user } = useAuth();

  // Фильтры
  const [searchInput, setSearchInput] = useState('');
  const search = useDebouncedValue(searchInput, 400);
  const [place, setPlace] = useState<string | null>(null);
  const [difficulty, setDifficulty] = useState<string | null>(null);
  const [muscle, setMuscle] = useState<string[]>([]);
  const [equipment, setEquipment] = useState<string[]>([]);
  const [page, setPage] = useState(1);

  // Данные
  const [state, setState] = useState<LoadState>({ status: 'loading' });
  const [reloadKey, setReloadKey] = useState(0);

  // Модальные окна
  const [formMode, setFormMode] = useState<'closed' | 'create' | { edit: Exercise }>('closed');
  const [form, setForm] = useState<ExerciseInput>(EMPTY_FORM);
  const [formError, setFormError] = useState<string | null>(null);
  const [formSaving, setFormSaving] = useState(false);
  const [detail, setDetail] = useState<Exercise | null>(null);
  const [deleting, setDeleting] = useState<Exercise | null>(null);
  const [deleteBusy, setDeleteBusy] = useState(false);

  // Уведомление об успешном действии
  const [notice, setNotice] = useState<string | null>(null);
  useEffect(() => {
    if (!notice) return;
    const timer = window.setTimeout(() => setNotice(null), 3000);
    return () => window.clearTimeout(timer);
  }, [notice]);

  const load = useCallback(async () => {
    setState({ status: 'loading' });
    try {
      const data = await listExercises({
        page,
        limit: PAGE_SIZE,
        place: place ?? undefined,
        difficulty: difficulty ?? undefined,
        muscle: muscle.length > 0 ? muscle : undefined,
        equipment: equipment.length > 0 ? equipment : undefined,
        search: search || undefined,
      });
      setState({ status: 'ready', data });
    } catch (err) {
      setState({ status: 'error', message: errorMessage(err) });
    }
  }, [page, place, difficulty, muscle, equipment, search]);

  useEffect(() => {
    void load();
  }, [load, reloadKey]);

  // Смена фильтров сбрасывает страницу на первую
  useEffect(() => {
    setPage(1);
  }, [place, difficulty, muscle, equipment, search]);

  const toggleMuscle = (token: string) =>
    setMuscle((prev) => (prev.includes(token) ? prev.filter((t) => t !== token) : [...prev, token]));
  const toggleEquipment = (token: string) =>
    setEquipment((prev) => (prev.includes(token) ? prev.filter((t) => t !== token) : [...prev, token]));

  const openCreate = () => {
    setForm(EMPTY_FORM);
    setFormError(null);
    setFormMode('create');
  };

  const openEdit = (exercise: Exercise) => {
    setForm({
      name: exercise.name,
      description: exercise.description ?? '',
      place: exercise.place,
      metric: exercise.metric,
      muscleGroups: exercise.muscleGroups,
      difficulty: exercise.difficulty,
      equipment: exercise.equipment,
    });
    setFormError(null);
    setFormMode({ edit: exercise });
  };

  const submitForm = async () => {
    setFormSaving(true);
    setFormError(null);
    try {
      if (formMode === 'create') {
        await createExercise(form);
        setNotice('Упражнение создано');
      } else if (typeof formMode === 'object') {
        await updateExercise(formMode.edit.id, form);
        setNotice('Упражнение обновлено');
      }
      setFormMode('closed');
      setReloadKey((k) => k + 1);
    } catch (err) {
      setFormError(errorMessage(err));
    } finally {
      setFormSaving(false);
    }
  };

  const confirmDelete = async () => {
    if (!deleting) return;
    setDeleteBusy(true);
    try {
      await deleteExercise(deleting.id);
      setNotice('Упражнение удалено');
      setDeleting(null);
      setReloadKey((k) => k + 1);
    } catch (err) {
      setNotice(errorMessage(err)); // 409 «используется в программах» и др.
      setDeleting(null);
    } finally {
      setDeleteBusy(false);
    }
  };

  const muscleKeys = Object.keys(MUSCLE_LABELS);
  const equipmentKeys = Object.keys(EQUIPMENT_LABELS);

  return (
    <AppLayout>
      <div className="catalog">
        <header className="catalog__header">
          <h1 className="catalog__title">Упражнения</h1>
          <Button onClick={openCreate}>+ Упражнение</Button>
        </header>

        {notice && (
          <p className="catalog__notice" role="status">
            {notice}
          </p>
        )}

        <TextField
          label="Поиск по названию"
          value={searchInput}
          onChange={(event) => setSearchInput(event.target.value)}
          placeholder="Например: отжимания"
        />

        <section className="catalog__filters" aria-label="Фильтры">
          <div className="catalog__filter-group">
            <span className="catalog__filter-label">Место</span>
            {Object.entries(PLACE_LABELS).map(([token, caption]) => (
              <Chip
                key={token}
                label={caption}
                active={place === token}
                onClick={() => setPlace(place === token ? null : token)}
              />
            ))}
          </div>
          <div className="catalog__filter-group">
            <span className="catalog__filter-label">Сложность</span>
            {Object.entries(DIFFICULTY_LABELS).map(([token, caption]) => (
              <Chip
                key={token}
                label={caption}
                active={difficulty === token}
                onClick={() => setDifficulty(difficulty === token ? null : token)}
              />
            ))}
          </div>
          <div className="catalog__filter-group">
            <span className="catalog__filter-label">Мышцы</span>
            {muscleKeys.map((token) => (
              <Chip
                key={token}
                label={MUSCLE_LABELS[token]}
                active={muscle.includes(token)}
                onClick={() => toggleMuscle(token)}
              />
            ))}
          </div>
          <div className="catalog__filter-group">
            <span className="catalog__filter-label">Инвентарь</span>
            {equipmentKeys.map((token) => (
              <Chip
                key={token}
                label={EQUIPMENT_LABELS[token]}
                active={equipment.includes(token)}
                onClick={() => toggleEquipment(token)}
              />
            ))}
          </div>
        </section>

        {state.status === 'loading' && <Spinner label="Загрузка каталога…" />}

        {state.status === 'error' && (
          <div className="catalog__error" role="alert">
            <p>{state.message}</p>
            <Button variant="secondary" onClick={() => setReloadKey((k) => k + 1)}>
              Повторить
            </Button>
          </div>
        )}

        {state.status === 'ready' && state.data.data.length === 0 && (
          <EmptyState
            title="Ничего не найдено"
            hint="Измените фильтры или создайте собственное упражнение"
          >
            <Button onClick={openCreate}>+ Упражнение</Button>
          </EmptyState>
        )}

        {state.status === 'ready' && state.data.data.length > 0 && (
          <>
            <div className="catalog__grid">
              {state.data.data.map((exercise) => (
                <ExerciseCard key={exercise.id} exercise={exercise} onOpen={setDetail} />
              ))}
            </div>
            <Pagination
              page={state.data.meta.page}
              limit={state.data.meta.limit}
              total={state.data.meta.total}
              onPageChange={setPage}
            />
          </>
        )}
      </div>

      {formMode !== 'closed' && (
        <Modal
          title={formMode === 'create' ? 'Новое упражнение' : `Редактирование: ${formMode.edit.name}`}
          onClose={() => setFormMode('closed')}
        >
          <div className="modal__body">
            {formError && (
              <p className="catalog__form-error" role="alert">
                {formError}
              </p>
            )}
            <TextField
              label="Название"
              value={form.name}
              onChange={(event) => setForm({ ...form, name: event.target.value })}
            />
            <TextField
              label="Описание и техника"
              value={form.description ?? ''}
              onChange={(event) => setForm({ ...form, description: event.target.value })}
            />
            <Select
              label="Место тренировок"
              value={form.place}
              options={Object.entries(PLACE_LABELS).map(([value, text]) => ({ value, label: text }))}
              onChange={(value) => setForm({ ...form, place: value })}
            />
            <Select
              label="Метрика"
              value={form.metric}
              options={Object.entries(METRIC_LABELS).map(([value, text]) => ({ value, label: text }))}
              onChange={(value) => setForm({ ...form, metric: value })}
            />
            <Select
              label="Сложность"
              value={form.difficulty}
              options={Object.entries(DIFFICULTY_LABELS).map(([value, text]) => ({ value, label: text }))}
              onChange={(value) => setForm({ ...form, difficulty: value })}
            />
            <fieldset className="catalog__fieldset">
              <legend>Мышцы</legend>
              <div className="catalog__chips">
                {muscleKeys.map((token) => (
                  <Chip
                    key={token}
                    label={MUSCLE_LABELS[token]}
                    active={form.muscleGroups.includes(token)}
                    onClick={() =>
                      setForm({
                        ...form,
                        muscleGroups: form.muscleGroups.includes(token)
                          ? form.muscleGroups.filter((t) => t !== token)
                          : [...form.muscleGroups, token],
                      })
                    }
                  />
                ))}
              </div>
            </fieldset>
            <fieldset className="catalog__fieldset">
              <legend>Инвентарь</legend>
              <div className="catalog__chips">
                {equipmentKeys.map((token) => (
                  <Chip
                    key={token}
                    label={EQUIPMENT_LABELS[token]}
                    active={form.equipment?.includes(token) ?? false}
                    onClick={() =>
                      setForm({
                        ...form,
                        equipment: form.equipment?.includes(token)
                          ? form.equipment.filter((t) => t !== token)
                          : [...(form.equipment ?? []), token],
                      })
                    }
                  />
                ))}
              </div>
            </fieldset>
            <Button onClick={() => void submitForm()} loading={formSaving}>
              {formMode === 'create' ? 'Создать' : 'Сохранить'}
            </Button>
          </div>
        </Modal>
      )}

      {detail && (
        <Modal title={detail.name} onClose={() => setDetail(null)}>
          <div className="modal__body">
            <div className="catalog__detail-badges">
              <span className="badge badge--metric">{label(METRIC_LABELS, detail.metric)}</span>
              <span className="badge">{label(PLACE_LABELS, detail.place)}</span>
            </div>
            {detail.description && <p className="catalog__detail-text">{detail.description}</p>}
            <p className="catalog__detail-text">
              <strong>Мышцы:</strong> {detail.muscleGroups.map((t) => label(MUSCLE_LABELS, t)).join(', ') || '—'}
            </p>
            <p className="catalog__detail-text">
              <strong>Инвентарь:</strong> {detail.equipment.map((t) => label(EQUIPMENT_LABELS, t)).join(', ') || 'не требуется'}
            </p>
            {detail.userId === user?.id && (
              <div className="catalog__detail-actions">
                <Button
                  variant="secondary"
                  onClick={() => {
                    setDetail(null);
                    openEdit(detail);
                  }}
                >
                  Изменить
                </Button>
                <Button
                  variant="danger"
                  onClick={() => {
                    setDetail(null);
                    setDeleting(detail);
                  }}
                >
                  Удалить
                </Button>
              </div>
            )}
          </div>
        </Modal>
      )}

      {deleting && (
        <Modal title="Удаление упражнения" onClose={() => setDeleting(null)}>
          <div className="modal__body">
            <p className="catalog__detail-text">
              Удалить «{deleting.name}»? Действие необратимо. Упражнения, входящие в программы
              или результаты тренировок, удалить нельзя.
            </p>
            <div className="catalog__detail-actions">
              <Button variant="secondary" onClick={() => setDeleting(null)}>
                Отмена
              </Button>
              <Button variant="danger" onClick={() => void confirmDelete()} loading={deleteBusy}>
                Удалить
              </Button>
            </div>
          </div>
        </Modal>
      )}
    </AppLayout>
  );
}
