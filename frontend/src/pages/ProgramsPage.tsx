import { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { AppLayout } from '../components/AppLayout';
import { Button } from '../components/Button';
import { EmptyState } from '../components/EmptyState';
import { Modal } from '../components/Modal';
import { Pagination } from '../components/Pagination';
import { ProgramCard } from '../components/ProgramCard';
import { Select } from '../components/Select';
import { TextField } from '../components/TextField';
import { Spinner } from '../components/Spinner';
import {
  copyProgram,
  createProgram,
  deleteProgram,
  listPrograms,
} from '../api/programs';
import type { Paginated } from '../types/exercise';
import type { Program, ProgramInput } from '../types/program';
import { PLACE_LABELS } from '../lib/labels';
import { useAuth } from '../context/AuthContext';
import './ProgramsPage.css';

/**
 * Каталог программ (docs/design.md §3.2): вкладки «Мои» / «Готовые»,
 * карточки, копирование готовых в аккаунт, CRUD собственных программ.
 */

const PAGE_SIZE = 12;

type Scope = 'mine' | 'ready';
type LoadState =
  | { status: 'loading' }
  | { status: 'ready'; data: Paginated<Program> }
  | { status: 'error'; message: string };

function errorMessage(err: unknown): string {
  return err instanceof Error ? err.message : 'Ошибка загрузки';
}

export function ProgramsPage() {
  const { user } = useAuth();
  const [scope, setScope] = useState<Scope>('mine');
  const [page, setPage] = useState(1);
  const [state, setState] = useState<LoadState>({ status: 'loading' });
  const [reloadKey, setReloadKey] = useState(0);

  // Создание программы
  const [creating, setCreating] = useState(false);
  const [form, setForm] = useState<ProgramInput>({ name: '', description: '', place: 'home' });
  const [formError, setFormError] = useState<string | null>(null);
  const [formSaving, setFormSaving] = useState(false);

  // Удаление / копирование
  const [deleting, setDeleting] = useState<Program | null>(null);
  const [deleteBusy, setDeleteBusy] = useState(false);
  const [copyingId, setCopyingId] = useState<number | null>(null);

  const [notice, setNotice] = useState<string | null>(null);
  useEffect(() => {
    if (!notice) return;
    const timer = window.setTimeout(() => setNotice(null), 3000);
    return () => window.clearTimeout(timer);
  }, [notice]);

  const load = useCallback(async () => {
    setState({ status: 'loading' });
    try {
      const data = await listPrograms({ scope, page, limit: PAGE_SIZE });
      setState({ status: 'ready', data });
    } catch (err) {
      setState({ status: 'error', message: errorMessage(err) });
    }
  }, [scope, page]);

  useEffect(() => {
    void load();
  }, [load, reloadKey]);

  const switchScope = (next: Scope) => {
    setScope(next);
    setPage(1);
  };

  const submitCreate = async () => {
    setFormSaving(true);
    setFormError(null);
    try {
      const created = await createProgram(form);
      setCreating(false);
      setNotice('Программа создана');
      // Переходим в конструктор новой программы
      window.location.assign(`/programs/${created.id}`);
    } catch (err) {
      setFormError(errorMessage(err));
      setFormSaving(false);
    }
  };

  const confirmDelete = async () => {
    if (!deleting) return;
    setDeleteBusy(true);
    try {
      await deleteProgram(deleting.id);
      setNotice('Программа удалена');
      setDeleting(null);
      setReloadKey((k) => k + 1);
    } catch (err) {
      setNotice(errorMessage(err));
      setDeleting(null);
    } finally {
      setDeleteBusy(false);
    }
  };

  const doCopy = async (program: Program) => {
    setCopyingId(program.id);
    try {
      const copied = await copyProgram(program.id);
      setNotice(`Программа «${copied.name}» скопирована в ваши`);
      setScope('mine');
      setPage(1);
      setReloadKey((k) => k + 1);
    } catch (err) {
      setNotice(errorMessage(err));
    } finally {
      setCopyingId(null);
    }
  };

  return (
    <AppLayout>
      <div className="programs">
        <header className="programs__header">
          <h1 className="programs__title">Программы</h1>
          {scope === 'mine' && <Button onClick={() => setCreating(true)}>+ Программа</Button>}
        </header>

        <div className="programs__tabs" role="tablist" aria-label="Тип программ">
          <button
            type="button"
            role="tab"
            aria-selected={scope === 'mine'}
            className={`programs__tab${scope === 'mine' ? ' programs__tab--active' : ''}`}
            onClick={() => switchScope('mine')}
          >
            Мои программы
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={scope === 'ready'}
            className={`programs__tab${scope === 'ready' ? ' programs__tab--active' : ''}`}
            onClick={() => switchScope('ready')}
          >
            Готовые программы
          </button>
        </div>

        {notice && (
          <p className="programs__notice" role="status">
            {notice}
          </p>
        )}

        {state.status === 'loading' && <Spinner label="Загрузка программ…" />}

        {state.status === 'error' && (
          <div className="programs__error" role="alert">
            <p>{state.message}</p>
            <Button variant="secondary" onClick={() => setReloadKey((k) => k + 1)}>
              Повторить
            </Button>
          </div>
        )}

        {state.status === 'ready' && state.data.data.length === 0 && (
          <EmptyState
            title={scope === 'mine' ? 'У вас пока нет программ' : 'Каталог готовых программ пуст'}
            hint={
              scope === 'mine'
                ? 'Создайте программу или скопируйте готовую из каталога'
                : undefined
            }
          >
            {scope === 'mine' && <Button onClick={() => setCreating(true)}>+ Программа</Button>}
          </EmptyState>
        )}

        {state.status === 'ready' && state.data.data.length > 0 && (
          <>
            <div className="programs__grid">
              {state.data.data.map((program) => {
                const own = program.userId !== null;
                return (
                  <ProgramCard key={program.id} program={program}>
                    {own ? (
                      <>
                        <Link to={`/programs/${program.id}`} className="programs__link">
                          <Button>Открыть</Button>
                        </Link>
                        <Button variant="danger" onClick={() => setDeleting(program)}>
                          Удалить
                        </Button>
                      </>
                    ) : (
                      <>
                        <Button variant="secondary" onClick={() => void doCopy(program)} loading={copyingId === program.id}>
                          Копировать
                        </Button>
                        {user && (
                          <span className="programs__hint">Скопируйте, чтобы редактировать и проходить</span>
                        )}
                      </>
                    )}
                  </ProgramCard>
                );
              })}
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

      {creating && (
        <Modal title="Новая программа" onClose={() => setCreating(false)}>
          <div className="modal__body">
            {formError && (
              <p className="programs__form-error" role="alert">
                {formError}
              </p>
            )}
            <TextField
              label="Название"
              value={form.name}
              onChange={(event) => setForm({ ...form, name: event.target.value })}
            />
            <TextField
              label="Описание"
              value={form.description ?? ''}
              onChange={(event) => setForm({ ...form, description: event.target.value })}
            />
            <Select
              label="Место тренировок"
              value={form.place}
              options={Object.entries(PLACE_LABELS).map(([value, text]) => ({ value, label: text }))}
              onChange={(value) => setForm({ ...form, place: value })}
            />
            <Button onClick={() => void submitCreate()} loading={formSaving}>
              Создать
            </Button>
          </div>
        </Modal>
      )}

      {deleting && (
        <Modal title="Удаление программы" onClose={() => setDeleting(null)}>
          <div className="modal__body">
            <p className="programs__form-error-text">
              Удалить программу «{deleting.name}»? Она исчезнет из списка, история тренировок
              сохранится.
            </p>
            <div className="programs__actions">
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
