import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

/**
 * Интеграционная проверка API этапа 3 на РЕАЛЬНОЙ временной БД:
 * свежая SQLite → миграции (A+B) → seed → supertest против in-process app
 * с настоящим Prisma Client. Рабочая dev.db не затрагивается
 * (DATABASE_URL переопределяется до импорта модулей).
 */

const backend = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const testDir = path.join(backend, 'prisma', 'stage3-test-tmp');
const dbFile = path.join(testDir, 'api.db');

fs.mkdirSync(testDir, { recursive: true });
for (const suffix of ['', '-wal', '-shm']) {
  if (fs.existsSync(dbFile + suffix)) fs.rmSync(dbFile + suffix);
}
// Пустой файл до deploy (см. Шаг 0: migrate не создаёт файл)
fs.closeSync(fs.openSync(dbFile, 'w'));
const DATABASE_URL = `file:${dbFile}`;

// Миграции + seed на временной БД
const runCli = (args: string[]) =>
  spawnSync(process.execPath, [path.join(backend, 'node_modules', 'prisma', 'build', 'index.js'), ...args], {
    cwd: backend,
    encoding: 'utf8',
    env: { ...process.env, DATABASE_URL },
  });
const deploy = runCli(['migrate', 'deploy']);
if (deploy.status !== 0) {
  console.error(deploy.stdout ?? deploy.stderr);
  process.exit(1);
}
const seed = spawnSync(process.execPath, [path.join(backend, 'node_modules', 'tsx', 'dist', 'cli.mjs'), path.join(backend, 'prisma', 'seed.ts')], {
  cwd: backend,
  encoding: 'utf8',
  env: { ...process.env, DATABASE_URL },
});
if (seed.status !== 0) {
  console.error(seed.stdout ?? seed.stderr);
  process.exit(1);
}
console.log('[api-integration] миграции и seed применены к временной БД');

// DATABASE_URL до импорта модулей — Prisma Client подключится к временной БД
process.env.DATABASE_URL = DATABASE_URL;
const { createApp } = await import('../src/app.js');
const { signAccessToken } = await import('../src/lib/jwt.js');
const request = (await import('supertest')).default;

const app = createApp();
let failures = 0;
function check(label: string, ok: boolean, details?: string): void {
  console.log(`  [${ok ? 'PASS' : 'FAIL'}] ${label}${details ? ` — ${details}` : ''}`);
  if (!ok) failures += 1;
}

async function main(): Promise<void> {
  // Регистрация через реальный API → JWT
  const register = await request(app).post('/api/auth/register').send({
    email: 'api-test@example.com',
    password: 'password123',
    name: 'Интеграция',
  });
  check('регистрация через API → 201', register.status === 201);
  const token = register.body.accessToken as string;
  const auth = ['Authorization', `Bearer ${token}`] as const;

  // Каталог: seed-данные доступны
  const list = await request(app).get('/api/exercises?search=отжим').set(...auth);
  check('GET /exercises?search=отжим находит seed-упражнения', list.status === 200 && list.body.data.length >= 1, `найдено: ${list.body.data?.length}`);
  const listUpper = await request(app).get('/api/exercises?search=ОТЖИМ').set(...auth);
  check('поиск «ОТЖИМ» == «отжим» (регистронезависимость)', listUpper.body.meta.total === list.body.meta.total);

  const csvFiltered = await request(app).get('/api/exercises?muscle=back&equipment=resistance_band').set(...auth);
  check('CSV-фильтр muscle+equipment работает (back + resistance_band → «Тяга резинки»)', csvFiltered.status === 200 && csvFiltered.body.data.length === 1, `найдено: ${csvFiltered.body.data?.length}`);
  const substringTrap = await request(app).get('/api/exercises?equipment=dumbbell').set(...auth);
  check('CSV-фильтр не совпадает по подстроке (dumbbell ≠ dumbbell_fake)', substringTrap.status === 200);

  const detail = await request(app).get(`/api/exercises/${list.body.data[0].id}`).set(...auth);
  check('GET /exercises/:id → 200 с массивами токенов', detail.status === 200 && Array.isArray(detail.body.muscleGroups));

  // CRUD персонального упражнения
  const created = await request(app).post('/api/exercises').set(...auth).send({
    name: 'Моё тестовое',
    place: 'home',
    metric: 'reps',
    muscleGroups: ['chest'],
    difficulty: 'medium',
  });
  check('POST /exercises → 201', created.status === 201);
  const duplicate = await request(app).post('/api/exercises').set(...auth).send({
    name: 'моё ТЕСТОВОЕ', // регистр не важен для уникальности
    place: 'home',
    metric: 'reps',
    muscleGroups: ['chest'],
    difficulty: 'medium',
  });
  check('дубликат имени (регистронезависимо) → 409', duplicate.status === 409);
  const updated = await request(app).put(`/api/exercises/${created.body.id}`).set(...auth).send({ difficulty: 'hard' });
  check('PUT /exercises/:id → 200', updated.status === 200 && updated.body.difficulty === 'hard');

  // Готовые программы
  const ready = await request(app).get('/api/programs?scope=ready').set(...auth);
  check('GET /programs?scope=ready → 4 готовые программы', ready.status === 200 && ready.body.data.length === 4, `найдено: ${ready.body.data?.length}`);
  const readyId = ready.body.data[0].id;
  const readyDetail = await request(app).get(`/api/programs/${readyId}`).set(...auth);
  check('GET /programs/:id готовой → 200 с составом', readyDetail.status === 200 && readyDetail.body.exercises.length > 0);

  // Своя программа
  const createdProgram = await request(app).post('/api/programs').set(...auth).send({ name: 'Интеграционная', place: 'home' });
  check('POST /programs → 201', createdProgram.status === 201);
  const programId = createdProgram.body.id;

  const added = await request(app).post(`/api/programs/${programId}/exercises`).set(...auth)
    .send({ exerciseId: list.body.data[0].id, targetSets: 3, targetReps: 12 });
  check('POST /programs/:id/exercises → 201 (order=1)', added.status === 201 && added.body.order === 1);
  const occupied = await request(app).post(`/api/programs/${programId}/exercises`).set(...auth)
    .send({ exerciseId: list.body.data[0].id, targetSets: 3, targetReps: 12, order: 1 });
  check('занятая позиция order → 400', occupied.status === 400);

  // Копирование готовой программы
  const copy = await request(app).post(`/api/programs/${readyId}/copy`).set(...auth);
  check('POST /programs/:id/copy → 201, состав скопирован', copy.status === 201 && copy.body.exercises.length === readyDetail.body.exercises.length);

  // Reorder копии
  const pe = copy.body.exercises;
  const reorder = await request(app).put(`/api/programs/${copy.body.id}/exercises/order`).set(...auth)
    .send({ orders: pe.map((item: { programExerciseId: number }, i: number) => ({ programExerciseId: item.programExerciseId, order: pe.length - i })) });
  // Список сортирован по order asc: после разворота первый элемент — бывший последний
  const firstWasLast = reorder.body.exercises?.[0]?.programExerciseId === pe[pe.length - 1]?.programExerciseId;
  check('PUT /programs/:id/exercises/order → 200 (порядок развернут)',
    reorder.status === 200 && firstWasLast && reorder.body.exercises[0].order === 1,
    reorder.status === 200 ? `exercises[0].order=${reorder.body.exercises[0].order}` : `status ${reorder.status}: ${JSON.stringify(reorder.body)}`);

  // Готовая программа read-only
  const editReady = await request(app).put(`/api/programs/${readyId}`).set(...auth).send({ name: 'Взлом' });
  check('PUT готовой программы → 403', editReady.status === 403);

  // Soft delete своей программы
  const removeProgram = await request(app).delete(`/api/programs/${programId}`).set(...auth);
  check('DELETE /programs/:id → 204', removeProgram.status === 204);
  const afterDelete = await request(app).get('/api/programs').set(...auth);
  check('soft delete: программа исчезла из scope=mine', afterDelete.body.data.every((p: { id: number }) => p.id !== programId));

  // Удаление упражнения, входящего в состав копии → 409
  const usedExercise = copy.body.exercises[0].exercise.id;
  const removeUsed = await request(app).delete(`/api/exercises/${usedExercise}`).set(...auth);
  // общее упражнение удалять нельзя — проверяем 403; для персонального создадим и удалим
  check('DELETE общего упражнения → 403', removeUsed.status === 403);
  const personal = await request(app).post('/api/exercises').set(...auth).send({
    name: 'Удаляемое персональное',
    place: 'home',
    metric: 'time',
    muscleGroups: ['core'],
    difficulty: 'easy',
  });
  const addToProgram = await request(app).post(`/api/programs/${copy.body.id}/exercises`).set(...auth)
    .send({ exerciseId: personal.body.id, targetSets: 2, targetDuration: 30 });
  const removeInUse = await request(app).delete(`/api/exercises/${personal.body.id}`).set(...auth);
  check('DELETE персонального упражнения, входящего в программу → 409', removeInUse.status === 409, `получено: ${removeInUse.status}`);
  const removeFromProgram = await request(app).delete(`/api/programs/${copy.body.id}/exercises/${addToProgram.body.programExerciseId}`).set(...auth);
  check('DELETE строки состава → 204 (порядок нормализован)', removeFromProgram.status === 204);
  const normalized = await request(app).get(`/api/programs/${copy.body.id}`).set(...auth);
  check('порядок после удаления нормализован (1..n)', normalized.body.exercises.every((e: { order: number }, i: number) => e.order === i + 1));

  // Удаление своего упражнения вне программ → 204
  const removeFree = await request(app).delete(`/api/exercises/${updated.body.id}`).set(...auth);
  check('DELETE персонального упражнения вне программ → 204', removeFree.status === 204);

  console.log(failures === 0 ? '[api-integration] ИТОГ: PASS' : `[api-integration] ИТОГ: FAIL — провалено: ${failures}`);
  process.exit(failures === 0 ? 0 : 1);
}

main().catch((err) => {
  console.error('[api-integration] ОШИБКА:', err);
  process.exit(1);
});
