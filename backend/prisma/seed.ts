import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { PrismaClient } from '@prisma/client';
import { normalizeName } from './stage3/normalize.js';

/**
 * Идемпотентный seed этапа 3: общие упражнения (userId = null) и готовые
 * программы (userId = null). Повторный запуск не создаёт дубликатов и не
 * меняет существующие записи.
 *
 * Особенность SQLite: @@unique([userId, name]) НЕ дедуплицирует строки с
 * userId = NULL (NULL различимы в составном уникальном индексе), поэтому
 * идемпотентность обеспечивается проверкой существования (findFirst по
 * userId: null + nameLower), а не upsert.
 *
 * Запуск: npm run db:seed [-- <DATABASE_URL>]
 */

interface ExerciseSeed {
  name: string;
  description: string;
  place: 'home' | 'outdoor' | 'gym';
  metric: 'reps' | 'reps_weight' | 'time';
  muscleGroups: string; // канонический CSV
  difficulty: 'easy' | 'medium' | 'hard';
  equipment: string | null; // канонический CSV или null
}

const EXERCISES: ExerciseSeed[] = [
  // Дом
  { name: 'Отжимания', description: 'Классические отжимания от пола, корпус прямой', place: 'home', metric: 'reps', muscleGroups: ',chest,triceps,', difficulty: 'easy', equipment: null },
  { name: 'Отжимания узким хватом', description: 'Ладони уже плеч, акцент на трицепс', place: 'home', metric: 'reps', muscleGroups: ',triceps,', difficulty: 'medium', equipment: null },
  { name: 'Приседания', description: 'Приседания с собственным весом до параллели', place: 'home', metric: 'reps', muscleGroups: ',quads,glutes,', difficulty: 'easy', equipment: null },
  { name: 'Планка', description: 'Статическое удержание корпуса на предплечьях', place: 'home', metric: 'time', muscleGroups: ',core,', difficulty: 'easy', equipment: null },
  { name: 'Планка боковая', description: 'Боковая планка с удержанием на одной руке', place: 'home', metric: 'time', muscleGroups: ',core,', difficulty: 'medium', equipment: null },
  { name: 'Выпады', description: 'Выпады вперёд с собственным весом', place: 'home', metric: 'reps', muscleGroups: ',quads,glutes,', difficulty: 'easy', equipment: null },
  { name: 'Берпи', description: 'Присед-упор-отжимание-прыжок в полном цикле', place: 'home', metric: 'time', muscleGroups: ',full_body,cardio,', difficulty: 'hard', equipment: null },
  { name: 'Скручивания', description: 'Подъёмы корпуса лёжа на спине', place: 'home', metric: 'reps', muscleGroups: ',abs,', difficulty: 'easy', equipment: null },
  { name: 'Ягодичный мостик', description: 'Подъёмы таза лёжа на спине', place: 'home', metric: 'reps', muscleGroups: ',glutes,', difficulty: 'easy', equipment: null },
  { name: 'Скакалка', description: 'Прыжки через скакалку', place: 'home', metric: 'time', muscleGroups: ',cardio,', difficulty: 'easy', equipment: ',jump_rope,' },
  { name: 'Тяга резинки к поясу', description: 'Стоя, тяга эластичной ленты к животу', place: 'home', metric: 'reps', muscleGroups: ',back,biceps,', difficulty: 'easy', equipment: ',resistance_band,' },
  // Улица
  { name: 'Подтягивания', description: 'Подтягивания прямым хватом на перекладине', place: 'outdoor', metric: 'reps', muscleGroups: ',back,biceps,', difficulty: 'hard', equipment: ',pullup_bar,' },
  { name: 'Бег', description: 'Непрерывный бег в умеренном темпе', place: 'outdoor', metric: 'time', muscleGroups: ',cardio,', difficulty: 'easy', equipment: null },
  { name: 'Отжимания на брусьях', description: 'Отжимания на брусьях, корпус слегка наклонён', place: 'outdoor', metric: 'reps', muscleGroups: ',chest,triceps,', difficulty: 'medium', equipment: ',dip_bars,' },
  { name: 'Приседания с выпрыгиванием', description: 'Прыжок вверх из нижней точки приседа', place: 'outdoor', metric: 'reps', muscleGroups: ',quads,glutes,', difficulty: 'medium', equipment: null },
  // Зал
  { name: 'Гоблет-присед', description: 'Приседания с гантелью у груди', place: 'gym', metric: 'reps_weight', muscleGroups: ',quads,glutes,', difficulty: 'easy', equipment: ',dumbbell,' },
  { name: 'Жим гантелей лёжа', description: 'Жим гантелей на горизонтальной скамье', place: 'gym', metric: 'reps_weight', muscleGroups: ',chest,triceps,', difficulty: 'medium', equipment: ',dumbbell,bench,' },
  { name: 'Тяга гантели в наклоне', description: 'Одноопорная тяга гантели к поясу', place: 'gym', metric: 'reps_weight', muscleGroups: ',back,biceps,', difficulty: 'medium', equipment: ',dumbbell,bench,' },
  { name: 'Приседания со штангой', description: 'Приседания со штангой на спине в стойке', place: 'gym', metric: 'reps_weight', muscleGroups: ',quads,glutes,', difficulty: 'medium', equipment: ',barbell,rack,' },
  { name: 'Становая тяга', description: 'Классическая становая тяга с пола', place: 'gym', metric: 'reps_weight', muscleGroups: ',back,hamstrings,', difficulty: 'hard', equipment: ',barbell,' },
  { name: 'Жим штанги стоя', description: 'Жим штанги над головой стоя', place: 'gym', metric: 'reps_weight', muscleGroups: ',shoulders,', difficulty: 'medium', equipment: ',barbell,' },
  { name: 'Тяга верхнего блока', description: 'Тяга блока к груди сидя', place: 'gym', metric: 'reps_weight', muscleGroups: ',back,biceps,', difficulty: 'easy', equipment: ',cable_machine,' },
  { name: 'Подъём гантелей на бицепс', description: 'Сгибания рук с гантелями стоя', place: 'gym', metric: 'reps_weight', muscleGroups: ',biceps,', difficulty: 'easy', equipment: ',dumbbell,' },
  { name: 'Французский жим', description: 'Разгибания рук с гантелью из-за головы', place: 'gym', metric: 'reps_weight', muscleGroups: ',triceps,', difficulty: 'medium', equipment: ',dumbbell,' },
  { name: 'Беговая дорожка', description: 'Ходьба или бег на дорожке', place: 'gym', metric: 'time', muscleGroups: ',cardio,', difficulty: 'easy', equipment: ',treadmill,' },
  { name: 'Велотренажёр', description: 'Круговая аэробная нагрузка на велотренажёре', place: 'gym', metric: 'time', muscleGroups: ',cardio,', difficulty: 'easy', equipment: ',exercise_bike,' },
];

interface ProgramSeed {
  name: string;
  description: string;
  place: 'home' | 'outdoor' | 'gym';
  items: Array<{
    exercise: string; // название упражнения из каталога
    targetSets: number;
    targetReps?: number;
    targetWeight?: number;
    targetDuration?: number;
  }>;
}

const PROGRAMS: ProgramSeed[] = [
  {
    name: 'Дом: базовый курс',
    description: 'Круговая программа с собственным весом на 4 недели, 3 тренировки в неделю',
    place: 'home',
    items: [
      { exercise: 'Отжимания', targetSets: 3, targetReps: 15 },
      { exercise: 'Приседания', targetSets: 3, targetReps: 20 },
      { exercise: 'Выпады', targetSets: 3, targetReps: 12 },
      { exercise: 'Планка', targetSets: 3, targetDuration: 40 },
      { exercise: 'Скручивания', targetSets: 3, targetReps: 20 },
    ],
  },
  {
    name: 'Дом: утренняя тонизация',
    description: 'Короткая зарядка на 15–20 минут для начала дня',
    place: 'home',
    items: [
      { exercise: 'Скакалка', targetSets: 1, targetDuration: 300 },
      { exercise: 'Берпи', targetSets: 3, targetDuration: 30 },
      { exercise: 'Отжимания', targetSets: 3, targetReps: 12 },
      { exercise: 'Планка боковая', targetSets: 2, targetDuration: 30 },
      { exercise: 'Ягодичный мостик', targetSets: 3, targetReps: 15 },
    ],
  },
  {
    name: 'Улица: кардио и турник',
    description: 'Комбинированная уличная тренировка: бег и работа на перекладине',
    place: 'outdoor',
    items: [
      { exercise: 'Бег', targetSets: 1, targetDuration: 1200 },
      { exercise: 'Подтягивания', targetSets: 3, targetReps: 8 },
      { exercise: 'Отжимания на брусьях', targetSets: 3, targetReps: 12 },
      { exercise: 'Приседания с выпрыгиванием', targetSets: 3, targetReps: 15 },
    ],
  },
  {
    name: 'Зал: все группы мышц',
    description: 'Базовая тренировка на всё тело с весовыми нагрузками',
    place: 'gym',
    items: [
      { exercise: 'Приседания со штангой', targetSets: 4, targetReps: 8, targetWeight: 40 },
      { exercise: 'Жим гантелей лёжа', targetSets: 3, targetReps: 10, targetWeight: 12 },
      { exercise: 'Тяга верхнего блока', targetSets: 3, targetReps: 12, targetWeight: 25 },
      { exercise: 'Подъём гантелей на бицепс', targetSets: 3, targetReps: 12, targetWeight: 8 },
      { exercise: 'Беговая дорожка', targetSets: 1, targetDuration: 900 },
    ],
  },
];

export async function runSeed(datasourceUrl: string): Promise<void> {
  const db = new PrismaClient({ datasourceUrl });
  try {
    let exercisesCreated = 0;
    let exercisesSkipped = 0;
    const exerciseIds = new Map<string, number>();

    for (const seed of EXERCISES) {
      const nameLower = normalizeName(seed.name);
      const existing = await db.exercise.findFirst({ where: { userId: null, nameLower } });
      if (existing) {
        exerciseIds.set(nameLower, existing.id);
        exercisesSkipped += 1;
        continue;
      }
      const created = await db.exercise.create({
        data: {
          name: seed.name,
          nameLower,
          description: seed.description,
          place: seed.place,
          metric: seed.metric,
          muscleGroups: seed.muscleGroups,
          difficulty: seed.difficulty,
          equipment: seed.equipment,
          userId: null,
        },
      });
      exerciseIds.set(nameLower, created.id);
      exercisesCreated += 1;
    }
    console.log(`[seed] упражнения: создано ${exercisesCreated}, пропущено (уже есть) ${exercisesSkipped}`);

    let programsCreated = 0;
    let programsSkipped = 0;
    let compositionAdded = 0;

    for (const program of PROGRAMS) {
      const existing = await db.program.findFirst({ where: { userId: null, name: program.name } });
      if (!existing) {
        const created = await db.program.create({
          data: {
            userId: null,
            name: program.name,
            description: program.description,
            place: program.place,
            isActive: true,
            exercises: {
              create: program.items.map((item, index) => ({
                exerciseId: exerciseIds.get(normalizeName(item.exercise)) as number,
                order: index + 1,
                targetSets: item.targetSets,
                targetReps: item.targetReps ?? null,
                targetWeight: item.targetWeight ?? null,
                targetDuration: item.targetDuration ?? null,
              })),
            },
          },
        });
        void created;
        programsCreated += 1;
        continue;
      }

      // Программа есть: дополняем только недостающие строки состава
      programsSkipped += 1;
      const existingRows = await db.programExercise.findMany({ where: { programId: existing.id } });
      const existingExerciseIds = new Set(existingRows.map((r) => r.exerciseId));
      let nextOrder = existingRows.reduce((max, r) => Math.max(max, r.order), 0);
      for (const item of program.items) {
        const exerciseId = exerciseIds.get(normalizeName(item.exercise)) as number;
        if (existingExerciseIds.has(exerciseId)) continue;
        nextOrder += 1;
        await db.programExercise.create({
          data: {
            programId: existing.id,
            exerciseId,
            order: nextOrder,
            targetSets: item.targetSets,
            targetReps: item.targetReps ?? null,
            targetWeight: item.targetWeight ?? null,
            targetDuration: item.targetDuration ?? null,
          },
        });
        compositionAdded += 1;
      }
    }
    console.log(`[seed] программы: создано ${programsCreated}, пропущено ${programsSkipped}, строк состава дополнено ${compositionAdded}`);
  } finally {
    await db.$disconnect();
  }
}

// CLI-вход: только при прямом запуске файла
const isMain = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) {
  const urlArg = process.argv[2];
  const target = urlArg ?? process.env.DATABASE_URL;
  if (!target) {
    console.error('[seed] DATABASE_URL не задан (аргумент или .env)');
    process.exit(1);
  }
  runSeed(target).then(
    () => {
      console.log('[seed] ИТОГ: PASS');
      process.exit(0);
    },
    (err) => {
      console.error('[seed] ОШИБКА:', err);
      process.exit(1);
    },
  );
}
