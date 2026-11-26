import { describe, expect, it } from 'vitest';
import { parseExerciseStatsQuery, parseStatsSummaryQuery } from '../validate.js';

/** Проверяет, что парсер отклонил вход как VALIDATION_ERROR. */
function expectValidationError(fn: () => unknown): void {
  let caught: unknown;
  try {
    fn();
  } catch (err) {
    caught = err;
  }
  expect(caught).toMatchObject({ code: 'VALIDATION_ERROR' });
}

describe('parseStatsSummaryQuery', () => {
  it('без параметров возвращает пустой диапазон', () => {
    expect(parseStatsSummaryQuery({})).toEqual({ from: undefined, to: undefined });
  });

  it('передаёт from/to без преобразования', () => {
    expect(parseStatsSummaryQuery({ from: '2026-11-01', to: '2026-11-30' })).toEqual({
      from: '2026-11-01',
      to: '2026-11-30',
    });
  });

  it('допускает только одну границу', () => {
    expect(parseStatsSummaryQuery({ from: '2026-11-01' })).toEqual({
      from: '2026-11-01',
      to: undefined,
    });
    expect(parseStatsSummaryQuery({ to: '2026-11-30' })).toEqual({
      from: undefined,
      to: '2026-11-30',
    });
  });

  it('from позже to → VALIDATION_ERROR', () => {
    expectValidationError(() => parseStatsSummaryQuery({ from: '2026-12-01', to: '2026-11-01' }));
  });

  it('несуществующая календарная дата → VALIDATION_ERROR', () => {
    expectValidationError(() => parseStatsSummaryQuery({ from: '2026-02-30' }));
  });

  it('неверный формат даты → VALIDATION_ERROR', () => {
    expectValidationError(() => parseStatsSummaryQuery({ to: '30.11.2026' }));
  });

  it('не-объект query → VALIDATION_ERROR', () => {
    expectValidationError(() => parseStatsSummaryQuery(null));
    expectValidationError(() => parseStatsSummaryQuery('from=2026-11-01'));
  });
});

describe('parseExerciseStatsQuery', () => {
  it('limit по умолчанию 50', () => {
    expect(parseExerciseStatsQuery({})).toEqual({ from: undefined, to: undefined, limit: 50 });
  });

  it('принимает limit в диапазоне 1..100 (число и строка)', () => {
    expect(parseExerciseStatsQuery({ limit: 1 }).limit).toBe(1);
    expect(parseExerciseStatsQuery({ limit: '100' }).limit).toBe(100);
  });

  it('передаёт период и limit вместе', () => {
    expect(parseExerciseStatsQuery({ from: '2026-11-01', to: '2026-11-30', limit: '25' })).toEqual({
      from: '2026-11-01',
      to: '2026-11-30',
      limit: 25,
    });
  });

  it('limit вне диапазона → VALIDATION_ERROR', () => {
    expectValidationError(() => parseExerciseStatsQuery({ limit: 0 }));
    expectValidationError(() => parseExerciseStatsQuery({ limit: 101 }));
    expectValidationError(() => parseExerciseStatsQuery({ limit: 'abc' }));
    expectValidationError(() => parseExerciseStatsQuery({ limit: 1.5 }));
  });

  it('from позже to → VALIDATION_ERROR', () => {
    expectValidationError(() =>
      parseExerciseStatsQuery({ from: '2026-12-01', to: '2026-11-01', limit: 10 }),
    );
  });

  it('несуществующая дата → VALIDATION_ERROR', () => {
    expectValidationError(() => parseExerciseStatsQuery({ to: '2026-04-31' }));
  });

  it('не-объект query → VALIDATION_ERROR', () => {
    expectValidationError(() => parseExerciseStatsQuery(undefined));
  });
});
