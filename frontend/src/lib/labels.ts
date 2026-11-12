/**
 * Русские подписи перечислений каталога (docs/database.md §2.3).
 * Ключи — канонические токены backend.
 */

export const PLACE_LABELS: Record<string, string> = {
  home: 'Дом',
  outdoor: 'Улица',
  gym: 'Зал',
};

export const METRIC_LABELS: Record<string, string> = {
  reps: 'Повторения',
  reps_weight: 'Повторения + вес',
  time: 'Время',
};

export const DIFFICULTY_LABELS: Record<string, string> = {
  easy: 'Легко',
  medium: 'Средне',
  hard: 'Сложно',
};

export const MUSCLE_LABELS: Record<string, string> = {
  chest: 'Грудь',
  back: 'Спина',
  shoulders: 'Плечи',
  biceps: 'Бицепс',
  triceps: 'Трицепс',
  quads: 'Квадрицепс',
  hamstrings: 'Задняя поверхность бедра',
  glutes: 'Ягодицы',
  abs: 'Пресс',
  core: 'Кор',
  calves: 'Икры',
  full_body: 'Всё тело',
  cardio: 'Кардио',
  other: 'Другое',
};

export const EQUIPMENT_LABELS: Record<string, string> = {
  dumbbell: 'Гантели',
  kettlebell: 'Гиря',
  barbell: 'Штанга',
  bench: 'Скамья',
  rack: 'Стойка',
  cable_machine: 'Блочный тренажёр',
  resistance_band: 'Резиновая лента',
  jump_rope: 'Скакалка',
  pullup_bar: 'Турник',
  dip_bars: 'Брусья',
  treadmill: 'Беговая дорожка',
  exercise_bike: 'Велотренажёр',
  mat: 'Коврик',
};

/** Подпись токена из словаря; неизвестный токен выводится как есть. */
export function label(map: Record<string, string>, token: string): string {
  return map[token] ?? token;
}

/** Целевая нагрузка в виде «3 × 15», «3 × 15 × 40 кг» или «3 × 40 сек». */
export function formatTargets(target: {
  targetSets: number;
  targetReps: number | null;
  targetWeight: number | null;
  targetDuration: number | null;
}): string {
  if (target.targetDuration !== null) {
    return `${target.targetSets} × ${target.targetDuration} сек`;
  }
  if (target.targetWeight !== null) {
    return `${target.targetSets} × ${target.targetReps} × ${target.targetWeight} кг`;
  }
  return `${target.targetSets} × ${target.targetReps ?? '—'}`;
}
