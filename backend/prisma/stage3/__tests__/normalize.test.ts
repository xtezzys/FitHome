import { describe, expect, it } from 'vitest';
import { canonToken, csvHasToken, isCanonicalCsv, normalizeCsv, normalizeName } from '../normalize.js';

/**
 * Unit-тесты канонической нормализации этапа 3 (docs/database.md §2.3):
 * кириллический поиск через JS toLowerCase и CSV с точным совпадением токенов.
 */

describe('normalizeName', () => {
  it('приводит кириллицу к нижнему регистру (String.toLowerCase)', () => {
    expect(normalizeName('Отжимания')).toBe('отжимания');
    expect(normalizeName('ПОДТЯГИВАНИЯ')).toBe('подтягивания');
    expect(normalizeName('Приседания со Штангой')).toBe('приседания со штангой');
  });

  it('обрезает пробелы', () => {
    expect(normalizeName('  Планка  ')).toBe('планка');
  });

  it('латиница тоже нормализуется', () => {
    expect(normalizeName('Push-Ups')).toBe('push-ups');
  });
});

describe('normalizeCsv', () => {
  it('нормализует «грязный» CSV: trim, lowercase, пустые и дубликаты', () => {
    expect(normalizeCsv('Chest, , TRICEPS ,chest')).toBe(',chest,triceps,');
  });

  it('собирает канонический формат с ограничивающими запятыми', () => {
    expect(normalizeCsv('quads, glutes')).toBe(',quads,glutes,');
    expect(normalizeCsv('core')).toBe(',core,');
  });

  it('замещает пробелы внутри токена подчёркиванием', () => {
    expect(normalizeCsv('resistance band,  Dumbbell ')).toBe(',resistance_band,dumbbell,');
  });

  it('сохраняет неизвестные токены (вне словаря) — данные не теряются', () => {
    expect(normalizeCsv('chest, mystery_muscle')).toBe(',chest,mystery_muscle,');
  });

  it('null/пустая строка → null', () => {
    expect(normalizeCsv(null)).toBeNull();
    expect(normalizeCsv(undefined)).toBeNull();
    expect(normalizeCsv('')).toBeNull();
    expect(normalizeCsv(' , , ')).toBeNull();
  });

  it('единственный токен без повторов остаётся без изменений', () => {
    expect(normalizeCsv(',core,')).toBe(',core,');
  });
});

describe('csvHasToken', () => {
  const csv = ',chest,triceps,';

  it('точное совпадение целого токена', () => {
    expect(csvHasToken(csv, 'chest')).toBe(true);
    expect(csvHasToken(csv, 'CHEST')).toBe(true);
    expect(csvHasToken(csv, 'triceps')).toBe(true);
  });

  it('substring другого токена не совпадает', () => {
    expect(csvHasToken(',bench_press,', 'bench')).toBe(false);
    expect(csvHasToken(',dumbbell,', 'dumbbells')).toBe(false);
  });

  it('null/пустой CSV не совпадает ни с чем', () => {
    expect(csvHasToken(null, 'chest')).toBe(false);
    expect(csvHasToken(undefined, 'chest')).toBe(false);
  });
});

describe('isCanonicalCsv', () => {
  it('канонические значения валидны', () => {
    expect(isCanonicalCsv(',chest,triceps,')).toBe(true);
    expect(isCanonicalCsv(',core,')).toBe(true);
    expect(isCanonicalCsv(null)).toBe(true);
    expect(isCanonicalCsv(undefined)).toBe(true);
  });

  it('не-канонические значения отклоняются', () => {
    expect(isCanonicalCsv('chest, triceps')).toBe(false);
    expect(isCanonicalCsv('chest')).toBe(false);
    expect(isCanonicalCsv(',,')).toBe(false);
    expect(isCanonicalCsv(',Chest,')).toBe(false);
    expect(isCanonicalCsv(',chest,,triceps,')).toBe(false);
  });
});

describe('canonToken', () => {
  it('trim + lowercase + пробел → подчёркивание', () => {
    expect(canonToken('  Resistance Band ')).toBe('resistance_band');
  });
});
