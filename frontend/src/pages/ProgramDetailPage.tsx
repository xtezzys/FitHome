import { useCallback, useEffect, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { AppLayout } from '../components/AppLayout';
import { Button } from '../components/Button';
import { EmptyState } from '../components/EmptyState';
import { Modal } from '../components/Modal';
import { Select } from '../components/Select';
import { TextField } from '../components/TextField';
import { Spinner } from '../components/Spinner';
import {
  addProgramExercise,
  copyProgram,
  getProgram,
  removeProgramExercise,
  reorderProgramExercises,
  shareProgram,
  updateProgram,
  updateProgramExercise,
} from '../api/programs';
import { listExercises as listAllExercises } from '../api/exercises';
import type { Exercise, Paginated } from '../types/exercise';
import type { Program, ProgramInput } from '../types/program';
import { METRIC_LABELS, PLACE_LABELS, formatTargets, label } from '../lib/labels';
import { useDebouncedValue } from '../hooks/useDebouncedValue';
import { useAuth } from '../context/AuthContext';
import './ProgramDetailPage.css';

/**
 * Конструктор программы (docs/design.md §3.3): название/описание/место,
 * состав с целями (подходы × повторы/вес/время по метрике), добавление
 * из каталога, удаление и изменение порядка (кнопки ↑/↓ — надёжно
 * работают на мобильных, HTML5 DnD не поддерживает touch).
 */

type LoadState =
  | { status: 'loading' }
  | { status: 'ready'; program: Program }
  | { status: 'error'; message: string };

function errorMessage(err: unknown): string {
  return err instanceof Error ? err.message : 'Ошибка';
}

export function ProgramDetailPage() {
  const { id } = useParams();
  const programId = Number(id);
  const { user } = useAuth();

  const [state, setState] = useState<LoadState>({ status: 'loading' });
  const [reloadKey, setReloadKey] = useState(0);
  const [notice, setNotice] = useState<string | null>(null);
  useEffect(() => {
    if (!notice) return;
    const timer = window.setTimeout(() => setNotice(null), 3000);
    return () => window.clearTimeout(timer);
  }, [notice]);

  // Редактирование шапки программы
  const [header, setHeader] = useState<ProgramInput>({ name: '', description: '', place: 'home' });
  const [savingHeader, setSavingHeader] = useState(false);
  const [headerError, setHeaderError] = useState<string | null>(null);

  // Добавление упражнения из каталога
  const [adding, setAdding] = useState(false);
  const [pickerSearchInput, setPickerSearchInput] = useState('');
  const pickerSearch = useDebouncedValue(pickerSearchInput, 400);
  const [pickerData, setPickerData] = useState<Paginated<Exercise> | null>(null);
  const [pickerBusyId, setPickerBusyId] = useState<number | null>(null);
  const [pickerError, setPickerError] = useState<string | null>(null);

  // Изменение целей строки состава
  const [editingPeId, setEditingPeId] = useState<number | null>(null);
  const [targetDraft, setTargetDraft] = useState<{
    targetSets: number;
    targetReps: number | null;
    targetWeight: number | null;
    targetDuration: number | null;
    restSec: number;
  }>({ targetSets: 3, targetReps: null, targetWeight: null, targetDuration: null, restSec: 90 });
  const [rowError, setRowError] = useState<string | null>(null);
  const [rowBusy, setRowBusy] = useState(false);

  // Удаление строки состава
  const [deletingPeId, setDeletingPeId] = useState<number | null>(null);
  const [reorderBusy, setReorderBusy] = useState(false);

  // Этап 5: публикация, отправка, сохранение публичной копии
  const [publishing, setPublishing] = useState(false);
  const [sharing, setSharing] = useState(false);
  const [shareEmail, setShareEmail] = useState('');
  const [shareError, setShareError] = useState<string | null>(null);
  const [sharingBusy, setSharingBusy] = useState(false);
  const [savingCopy, setSavingCopy] = useState(false);

  const isOwner =
    state.status === 'ready' &&
    state.program.userId !== null &&
    state.program.userId === user?.id;

  const load = useCallback(async () => {
    if (!Number.isInteger(programId) || programId < 1) {
      setState({ status: 'error', message: 'Некорректный идентификатор программы' });
      return;
    }
    setState({ status: 'loading' });
    try {
      const program = await getProgram(programId);
      setHeader({ name: program.name, description: program.description ?? '', place: program.place });
      setState({ status: 'ready', program });
    } catch (err) {
      setState({ status: 'error', message: errorMessage(err) });
    }
  }, [programId]);

  useEffect(() => {
    void load();
  }, [load, reloadKey]);

  // Каталог в модалке добавления
  useEffect(() => {
    if (!adding) return;
    let cancelled = false;
    listAllExercises({ search: pickerSearch || undefined, limit: 20 })
      .then((data) => {
        if (!cancelled) {
          setPickerData(data);
          setPickerError(null);
        }
      })
      .catch((err) => {
        if (!cancelled) setPickerError(errorMessage(err));
      });
    return () => {
      cancelled = true;
    };
  }, [adding, pickerSearch]);

  const saveHeader = async () => {
    setSavingHeader(true);
    setHeaderError(null);
    try {
      await updateProgram(programId, header);
      setNotice('Программа сохранена');
      setReloadKey((k) => k + 1);
    } catch (err) {
      setHeaderError(errorMessage(err));
    } finally {
      setSavingHeader(false);
    }
  };

  const togglePublic = async () => {
    if (state.status !== 'ready') return;
    setPublishing(true);
    try {
      await updateProgram(programId, { isPublic: !state.program.isPublic });
      setNotice(state.program.isPublic ? 'Программа снята с публикации' : 'Программа опубликована');
      setReloadKey((k) => k + 1);
    } catch (err) {
      setNotice(errorMessage(err));
    } finally {
      setPublishing(false);
    }
  };

  const submitShare = async () => {
    setSharingBusy(true);
    setShareError(null);
    try {
      await shareProgram(programId, shareEmail.trim());
      setSharing(false);
      setShareEmail('');
      setNotice('Программа отправлена');
    } catch (err) {
      setShareError(errorMessage(err));
    } finally {
      setSharingBusy(false);
    }
  };

  const savePublicCopy = async () => {
    setSavingCopy(true);
    try {
      const copy = await copyProgram(programId);
      setNotice(`Программа сохранена: «${copy.name}»`);
    } catch (err) {
      setNotice(errorMessage(err));
    } finally {
      setSavingCopy(false);
    }
  };

  const addFromCatalog = async (exercise: Exercise) => {
    setPickerBusyId(exercise.id);
    setPickerError(null);
    try {
      // Цели по умолчанию соответствуют метрике: reps → 3×10; reps_weight → 3×10×10кг; time → 3×30сек
      const defaults =
        exercise.metric === 'time'
          ? { targetSets: 3, targetReps: null, targetWeight: null, targetDuration: 30 }
          : exercise.metric === 'reps_weight'
            ? { targetSets: 3, targetReps: 10, targetWeight: 10, targetDuration: null }
            : { targetSets: 3, targetReps: 10, targetWeight: null, targetDuration: null };
      await addProgramExercise(programId, { exerciseId: exercise.id, ...defaults });
      setNotice(`«${exercise.name}» добавлено в программу`);
      setAdding(false);
      setPickerSearchInput('');
      setReloadKey((k) => k + 1);
    } catch (err) {
      setPickerError(errorMessage(err));
    } finally {
      setPickerBusyId(null);
    }
  };

  const startEditTargets = (pe: {
    programExerciseId: number;
    targetSets: number;
    targetReps: number | null;
    targetWeight: number | null;
    targetDuration: number | null;
    restSec: number;
  }) => {
    setRowError(null);
    setEditingPeId(pe.programExerciseId);
    setTargetDraft({
      targetSets: pe.targetSets,
      targetReps: pe.targetReps,
      targetWeight: pe.targetWeight,
      targetDuration: pe.targetDuration,
      restSec: pe.restSec,
    });
  };

  const saveTargets = async (peId: number, metric: string) => {
    setRowBusy(true);
    setRowError(null);
    try {
      await updateProgramExercise(programId, peId, targetDraft);
      void metric;
      setNotice('Цели обновлены');
      setEditingPeId(null);
      setReloadKey((k) => k + 1);
    } catch (err) {
      setRowError(errorMessage(err));
    } finally {
      setRowBusy(false);
    }
  };

  const confirmDeletePe = async () => {
    if (deletingPeId === null) return;
    setRowBusy(true);
    try {
      await removeProgramExercise(programId, deletingPeId);
      setNotice('Упражнение удалено из программы');
      setDeletingPeId(null);
      setReloadKey((k) => k + 1);
    } catch (err) {
      setNotice(errorMessage(err));
      setDeletingPeId(null);
    } finally {
      setRowBusy(false);
    }
  };

  const move = async (index: number, direction: -1 | 1) => {
    const program = state.status === 'ready' ? state.program : null;
    if (!program || !program.exercises) return;
    const target = index + direction;
    if (target < 0 || target >= program.exercises.length) return;
    setReorderBusy(true);
    try {
      // Новые позиции: меняем местами два элемента, остальным — прежние позиции
      const orders = program.exercises.map((pe, i) => {
        if (i === index) return { programExerciseId: pe.programExerciseId, order: target + 1 };
        if (i === target) return { programExerciseId: pe.programExerciseId, order: index + 1 };
        return { programExerciseId: pe.programExerciseId, order: i + 1 };
      });
      await reorderProgramExercises(programId, orders);
      setReloadKey((k) => k + 1);
    } catch (err) {
      setNotice(errorMessage(err));
    } finally {
      setReorderBusy(false);
    }
  };

  return (
    <AppLayout>
      <div className="constructor">
        <Link to="/programs" className="constructor__back">
          ← К программам
        </Link>

        {state.status === 'loading' && <Spinner label="Загрузка программы…" />}

        {state.status === 'error' && (
          <div className="constructor__error" role="alert">
            <p>{state.message}</p>
            <Button variant="secondary" onClick={() => void load()}>
              Повторить
            </Button>
            <Link to="/programs" className="constructor__back">
              К списку программ
            </Link>
          </div>
        )}

        {state.status === 'ready' && (
          <>
            <div className="constructor__header">
              <h1 className="constructor__title">{state.program.name}</h1>
              <span className="constructor__place">{label(PLACE_LABELS, state.program.place)}</span>
            </div>

            {isOwner && (
              <div className="programs__actions">
                <Button variant="secondary" onClick={() => void togglePublic()} loading={publishing}>
                  {state.program.isPublic ? 'Снять с публикации' : 'Опубликовать'}
                </Button>
                <Button variant="secondary" onClick={() => setSharing(true)}>
                  Поделиться
                </Button>
                {state.program.isPublic && (
                  <span className="programs__hint">Программа в публичной библиотеке</span>
                )}
              </div>
            )}
            {!isOwner && (
              <p className="programs__hint">
                Публичная программа автора {state.program.authorName ?? '—'}
              </p>
            )}

            {notice && (
              <p className="constructor__notice" role="status">
                {notice}
              </p>
            )}

            {isOwner && (
              <>
            <section className="constructor__card" aria-label="Параметры программы">
              {headerError && (
                <p className="constructor__error-text" role="alert">
                  {headerError}
                </p>
              )}
              <TextField
                label="Название программы"
                value={header.name}
                onChange={(event) => setHeader({ ...header, name: event.target.value })}
              />
              <TextField
                label="Описание"
                value={header.description ?? ''}
                onChange={(event) => setHeader({ ...header, description: event.target.value })}
              />
              <Select
                label="Место тренировок"
                value={header.place}
                options={Object.entries(PLACE_LABELS).map(([value, text]) => ({ value, label: text }))}
                onChange={(value) => setHeader({ ...header, place: value })}
              />
              <Button onClick={() => void saveHeader()} loading={savingHeader}>
                Сохранить программу
              </Button>
            </section>

            <section className="constructor__card" aria-label="Состав программы">
              <div className="constructor__composition-header">
                <h2 className="constructor__subtitle">Состав программы</h2>
                <Button onClick={() => setAdding(true)}>+ Из каталога</Button>
              </div>

              {(!state.program.exercises || state.program.exercises.length === 0) && (
                <EmptyState title="Программа пуста" hint="Добавьте упражнения из каталога">
                  <Button onClick={() => setAdding(true)}>+ Из каталога</Button>
                </EmptyState>
              )}

              <ul className="constructor__list">
                {state.program.exercises?.map((pe, index) => {
                  const metric = pe.exercise.metric;
                  const editing = editingPeId === pe.programExerciseId;
                  return (
                    <li key={pe.programExerciseId} className="constructor__item">
                      <div className="constructor__item-main">
                        <span className="constructor__item-order">{pe.order}</span>
                        <div className="constructor__item-info">
                          <span className="constructor__item-name">{pe.exercise.name}</span>
                          <span className="constructor__item-targets">
                            {label(METRIC_LABELS, metric)} · {formatTargets(pe)}
                          </span>
                        </div>
                        <div className="constructor__item-controls">
                          <button
                            type="button"
                            className="constructor__arrow"
                            onClick={() => void move(index, -1)}
                            disabled={index === 0 || reorderBusy}
                            aria-label={`Переместить ${pe.exercise.name} выше`}
                          >
                            ↑
                          </button>
                          <button
                            type="button"
                            className="constructor__arrow"
                            onClick={() => void move(index, 1)}
                            disabled={index === (state.program.exercises?.length ?? 0) - 1 || reorderBusy}
                            aria-label={`Переместить ${pe.exercise.name} ниже`}
                          >
                            ↓
                          </button>
                          <button
                            type="button"
                            className="constructor__mini"
                            onClick={() => startEditTargets(pe)}
                          >
                            Цели
                          </button>
                          <button
                            type="button"
                            className="constructor__mini constructor__mini--danger"
                            onClick={() => setDeletingPeId(pe.programExerciseId)}
                          >
                            Удалить
                          </button>
                        </div>
                      </div>
                      {editing && (
                        <div className="constructor__targets">
                          {rowError && (
                            <p className="constructor__error-text" role="alert">
                              {rowError}
                            </p>
                          )}
                          <label className="constructor__target-field">
                            Подходы
                            <input
                              type="number"
                              min={1}
                              max={20}
                              value={targetDraft.targetSets}
                              onChange={(event) =>
                                setTargetDraft({ ...targetDraft, targetSets: Number(event.target.value) })
                              }
                            />
                          </label>
                          {metric !== 'time' && (
                            <label className="constructor__target-field">
                              Повторения
                              <input
                                type="number"
                                min={1}
                                value={targetDraft.targetReps ?? ''}
                                onChange={(event) =>
                                  setTargetDraft({
                                    ...targetDraft,
                                    targetReps: event.target.value === '' ? null : Number(event.target.value),
                                  })
                                }
                              />
                            </label>
                          )}
                          {metric === 'reps_weight' && (
                            <label className="constructor__target-field">
                              Вес, кг
                              <input
                                type="number"
                                min={0}
                                step={0.5}
                                value={targetDraft.targetWeight ?? ''}
                                onChange={(event) =>
                                  setTargetDraft({
                                    ...targetDraft,
                                    targetWeight: event.target.value === '' ? null : Number(event.target.value),
                                  })
                                }
                              />
                            </label>
                          )}
                          {metric === 'time' && (
                            <label className="constructor__target-field">
                              Время, сек
                              <input
                                type="number"
                                min={1}
                                value={targetDraft.targetDuration ?? ''}
                                onChange={(event) =>
                                  setTargetDraft({
                                    ...targetDraft,
                                    targetDuration: event.target.value === '' ? null : Number(event.target.value),
                                  })
                                }
                              />
                            </label>
                          )}
                          <label className="constructor__target-field">
                            Перерыв, сек
                            <input
                              type="number"
                              min={0}
                              max={3600}
                              value={targetDraft.restSec}
                              onChange={(event) =>
                                setTargetDraft({
                                  ...targetDraft,
                                  restSec: Number(event.target.value),
                                })
                              }
                            />
                          </label>
                          <div className="constructor__targets-actions">
                            <Button onClick={() => void saveTargets(pe.programExerciseId, metric)} loading={rowBusy}>
                              Сохранить
                            </Button>
                            <Button variant="secondary" onClick={() => setEditingPeId(null)}>
                              Отмена
                            </Button>
                          </div>
                        </div>
                      )}
                    </li>
                  );
                })}
              </ul>
            </section>
              </>
            )}

            {!isOwner && (
              <section className="constructor__card" aria-label="Публичная программа">
                {state.program.description && <p>{state.program.description}</p>}
                {!state.program.exercises || state.program.exercises.length === 0 ? (
                  <EmptyState title="В программе нет упражнений" />
                ) : (
                  <ul className="constructor__list">
                    {state.program.exercises.map((pe) => (
                      <li key={pe.programExerciseId} className="constructor__item">
                        <div className="constructor__item-main">
                          <span className="constructor__item-order">{pe.order}</span>
                          <div className="constructor__item-info">
                            <span className="constructor__item-name">{pe.exercise.name}</span>
                            <span className="constructor__item-targets">
                              {label(METRIC_LABELS, pe.exercise.metric)} · {formatTargets(pe)}
                            </span>
                          </div>
                        </div>
                      </li>
                    ))}
                  </ul>
                )}
                <Button onClick={() => void savePublicCopy()} loading={savingCopy}>
                  Сохранить к себе
                </Button>
              </section>
            )}
          </>
        )}
      </div>

      {adding && (
        <Modal title="Добавление упражнения из каталога" onClose={() => setAdding(false)}>
          <div className="modal__body">
            <TextField
              label="Поиск по названию"
              value={pickerSearchInput}
              onChange={(event) => setPickerSearchInput(event.target.value)}
            />
            {pickerError && (
              <p className="constructor__error-text" role="alert">
                {pickerError}
              </p>
            )}
            {!pickerData && <Spinner label="Загрузка каталога…" />}
            {pickerData && pickerData.data.length === 0 && <EmptyState title="Ничего не найдено" />}
            {pickerData && (
              <ul className="constructor__picker">
                {pickerData.data.map((exercise) => (
                  <li key={exercise.id} className="constructor__picker-item">
                    <span className="constructor__picker-name">{exercise.name}</span>
                    <span className="constructor__picker-metric">{label(METRIC_LABELS, exercise.metric)}</span>
                    <Button
                      variant="secondary"
                      onClick={() => void addFromCatalog(exercise)}
                      loading={pickerBusyId === exercise.id}
                    >
                      Добавить
                    </Button>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </Modal>
      )}

      {deletingPeId !== null && (
        <Modal title="Удаление упражнения" onClose={() => setDeletingPeId(null)}>
          <div className="modal__body">
            <p>Убрать упражнение из программы? Порядок оставшихся пересчитается автоматически.</p>
            <div className="programs__actions">
              <Button variant="secondary" onClick={() => setDeletingPeId(null)}>
                Отмена
              </Button>
              <Button variant="danger" onClick={() => void confirmDeletePe()} loading={rowBusy}>
                Удалить
              </Button>
            </div>
          </div>
        </Modal>
      )}

      {sharing && (
        <Modal title="Отправить программу" onClose={() => setSharing(false)}>
          <div className="modal__body">
            {shareError && (
              <p className="constructor__error-text" role="alert">
                {shareError}
              </p>
            )}
            <TextField
              label="Email получателя"
              value={shareEmail}
              onChange={(event) => setShareEmail(event.target.value)}
            />
            <div className="programs__actions">
              <Button variant="secondary" onClick={() => setSharing(false)}>
                Отмена
              </Button>
              <Button onClick={() => void submitShare()} loading={sharingBusy}>
                Отправить
              </Button>
            </div>
          </div>
        </Modal>
      )}

    </AppLayout>
  );
}
