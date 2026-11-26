import { useCallback, useEffect, useState } from 'react';
import { AppLayout } from '../components/AppLayout';
import { Button } from '../components/Button';
import { EmptyState } from '../components/EmptyState';
import { Modal } from '../components/Modal';
import { Spinner } from '../components/Spinner';
import {
  deleteIncomingShare,
  getIncomingShare,
  listIncomingShares,
  saveSharedProgram,
} from '../api/programs';
import type { IncomingShare, IncomingShareDetail } from '../types/program';
import { METRIC_LABELS, formatTargets, label } from '../lib/labels';
import './ProgramsPage.css';
import './ProgramDetailPage.css';

/**
 * Полученные программы (этап 5): просмотр состава, сохранение независимой
 * копии в свою библиотеку, удаление передачи из списка.
 */

function errorMessage(err: unknown): string {
  return err instanceof Error ? err.message : 'Ошибка';
}

function formatDate(value: string): string {
  return new Date(value).toLocaleDateString('ru-RU');
}

export function IncomingSharesPage() {
  const [rows, setRows] = useState<IncomingShare[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [reloadKey, setReloadKey] = useState(0);
  const [detail, setDetail] = useState<IncomingShareDetail | null>(null);
  const [busyId, setBusyId] = useState<number | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  useEffect(() => {
    if (!notice) return;
    const timer = window.setTimeout(() => setNotice(null), 3000);
    return () => window.clearTimeout(timer);
  }, [notice]);

  const load = useCallback(async () => {
    setError(null);
    try {
      const result = await listIncomingShares();
      setRows(result.data);
    } catch (err) {
      setError(errorMessage(err));
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load, reloadKey]);

  const openDetail = async (shareId: number) => {
    setBusyId(shareId);
    try {
      setDetail(await getIncomingShare(shareId));
    } catch (err) {
      setNotice(errorMessage(err));
    } finally {
      setBusyId(null);
    }
  };

  const saveCopy = async (shareId: number) => {
    setBusyId(shareId);
    try {
      const copy = await saveSharedProgram(shareId);
      setNotice(`Программа «${copy.name}» сохранена в вашу библиотеку`);
      setDetail(null);
      setReloadKey((k) => k + 1);
    } catch (err) {
      setNotice(errorMessage(err));
    } finally {
      setBusyId(null);
    }
  };

  const removeShare = async (shareId: number) => {
    setBusyId(shareId);
    try {
      await deleteIncomingShare(shareId);
      setNotice('Передача удалена из списка');
      setDetail(null);
      setReloadKey((k) => k + 1);
    } catch (err) {
      setNotice(errorMessage(err));
    } finally {
      setBusyId(null);
    }
  };

  return (
    <AppLayout>
      <div className="programs">
        <header className="programs__header">
          <h1 className="programs__title">Полученные программы</h1>
        </header>

        {notice && (
          <p className="programs__notice" role="status">
            {notice}
          </p>
        )}

        {error && (
          <div className="programs__error" role="alert">
            <p>{error}</p>
            <Button variant="secondary" onClick={() => setReloadKey((k) => k + 1)}>
              Повторить
            </Button>
          </div>
        )}

        {!rows && !error && <Spinner label="Загрузка полученных программ…" />}

        {rows && rows.length === 0 && (
          <EmptyState
            title="Полученных программ нет"
            hint="Когда другой пользователь отправит вам программу, она появится здесь"
          />
        )}

        {rows && rows.length > 0 && (
          <ul className="programs__shares">
            {rows.map((row) => (
              <li key={row.id} className="programs__share">
                <div>
                  <strong>{row.programName}</strong>
                  <p className="programs__hint">
                    От: {row.fromUserName} · {formatDate(row.createdAt)} ·{' '}
                    {row.status === 'saved' ? 'сохранена' : 'ожидает'}
                  </p>
                </div>
                <div className="programs__actions">
                  <Button
                    variant="secondary"
                    onClick={() => void openDetail(row.id)}
                    loading={busyId === row.id}
                  >
                    Просмотр
                  </Button>
                  {row.status !== 'saved' && (
                    <Button onClick={() => void saveCopy(row.id)} loading={busyId === row.id}>
                      Сохранить
                    </Button>
                  )}
                  <Button variant="danger" onClick={() => void removeShare(row.id)}>
                    Убрать
                  </Button>
                </div>
              </li>
            ))}
          </ul>
        )}
      </div>

      {detail && (
        <Modal title={detail.program.name} onClose={() => setDetail(null)}>
          <div className="modal__body">
            <p className="programs__hint">Автор: {detail.fromUserName}</p>
            {detail.program.description && <p>{detail.program.description}</p>}
            {detail.program.exercises && detail.program.exercises.length > 0 ? (
              <ul className="constructor__list">
                {detail.program.exercises.map((pe) => (
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
            ) : (
              <EmptyState title="В программе нет упражнений" />
            )}
            <div className="programs__actions">
              <Button variant="secondary" onClick={() => setDetail(null)}>
                Закрыть
              </Button>
              {detail.status !== 'saved' && (
                <Button
                  onClick={() => void saveCopy(detail.shareId)}
                  loading={busyId === detail.shareId}
                >
                  Сохранить к себе
                </Button>
              )}
            </div>
          </div>
        </Modal>
      )}
    </AppLayout>
  );
}
