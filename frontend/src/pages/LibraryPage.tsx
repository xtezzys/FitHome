import { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { AppLayout } from '../components/AppLayout';
import { Button } from '../components/Button';
import { EmptyState } from '../components/EmptyState';
import { Pagination } from '../components/Pagination';
import { ProgramCard } from '../components/ProgramCard';
import { Select } from '../components/Select';
import { TextField } from '../components/TextField';
import { Spinner } from '../components/Spinner';
import { copyProgram, listPublicPrograms } from '../api/programs';
import type { Paginated } from '../types/exercise';
import type { Program } from '../types/program';
import { PLACE_LABELS } from '../lib/labels';
import { useDebouncedValue } from '../hooks/useDebouncedValue';
import './ProgramsPage.css';

/**
 * Публичная библиотека программ (этап 5): только добровольно опубликованные
 * программы, поиск по названию, фильтр по месту, сохранение независимой копии.
 */

const PAGE_SIZE = 12;

type LoadState =
  | { status: 'loading' }
  | { status: 'ready'; data: Paginated<Program> }
  | { status: 'error'; message: string };

function errorMessage(err: unknown): string {
  return err instanceof Error ? err.message : 'Ошибка загрузки';
}

export function LibraryPage() {
  const [searchInput, setSearchInput] = useState('');
  const search = useDebouncedValue(searchInput, 400);
  const [place, setPlace] = useState('');
  const [page, setPage] = useState(1);
  const [state, setState] = useState<LoadState>({ status: 'loading' });
  const [reloadKey, setReloadKey] = useState(0);
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
      const data = await listPublicPrograms({
        page,
        limit: PAGE_SIZE,
        place: place || undefined,
        search: search || undefined,
      });
      setState({ status: 'ready', data });
    } catch (err) {
      setState({ status: 'error', message: errorMessage(err) });
    }
  }, [page, place, search]);

  useEffect(() => {
    void load();
  }, [load, reloadKey]);

  const doCopy = async (program: Program) => {
    setCopyingId(program.id);
    try {
      const copied = await copyProgram(program.id);
      setNotice(`Программа «${copied.name}» сохранена в вашу библиотеку`);
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
          <h1 className="programs__title">Публичная библиотека</h1>
        </header>

        <div className="programs__actions">
          <TextField
            label="Поиск по названию"
            value={searchInput}
            onChange={(event) => {
              setSearchInput(event.target.value);
              setPage(1);
            }}
          />
          <Select
            label="Место тренировок"
            value={place}
            options={[
              { value: '', label: 'Все места' },
              ...Object.entries(PLACE_LABELS).map(([value, text]) => ({ value, label: text })),
            ]}
            onChange={(value) => {
              setPlace(value);
              setPage(1);
            }}
          />
        </div>

        {notice && (
          <p className="programs__notice" role="status">
            {notice}
          </p>
        )}

        {state.status === 'loading' && <Spinner label="Загрузка библиотеки…" />}

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
            title="Публичных программ пока нет"
            hint="Опубликуйте свою программу в конструкторе — она появится здесь"
          />
        )}

        {state.status === 'ready' && state.data.data.length > 0 && (
          <>
            <div className="programs__grid">
              {state.data.data.map((program) => (
                <ProgramCard key={program.id} program={program}>
                  <Link to={`/programs/${program.id}`} className="programs__link">
                    <Button variant="secondary">Открыть</Button>
                  </Link>
                  <Button
                    onClick={() => void doCopy(program)}
                    loading={copyingId === program.id}
                  >
                    Сохранить
                  </Button>
                </ProgramCard>
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
    </AppLayout>
  );
}
