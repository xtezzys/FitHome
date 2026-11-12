# REST API FitHome

> Статус: Этап 1 — контракты эндпоинтов. Все эндпоинты, кроме `/api/health` и авторизации, требуют JWT (см. [architecture.md](architecture.md#5-авторизация-jwt)).

## 1. Общие положения

- **Base URL:** `http://localhost:4000/api` (настраивается через `PORT` backend и `VITE_API_BASE_URL` frontend).
- **Формат:** JSON (`Content-Type: application/json`).
- **Авторизация:** заголовок `Authorization: Bearer <access-токен>` на всех защищённых эндпоинтах.
- **Версионирование:** префикс `/api`; при несовместимых изменениях появится `/api/v1`.
- **Коды ответов:** `2xx` — успех, `4xx` — ошибка клиента, `5xx` — ошибка сервера.

### Формат ошибок

Все ошибки возвращаются в едином формате:

```json
{
  "error": {
    "code": "VALIDATION_ERROR",
    "message": "Человекочитаемое описание ошибки"
  }
}
```

| Код | HTTP | Когда возникает |
|---|---|---|
| `VALIDATION_ERROR` | 400 | Не пройдена валидация тела/параметров |
| `UNAUTHORIZED` | 401 | Нет токена или он просрочен |
| `FORBIDDEN` | 403 | Ресурс принадлежит другому пользователю |
| `NOT_FOUND` | 404 | Ресурс не найден |
| `CONFLICT` | 409 | Дубликат (например, email или название упражнения) |
| `INTERNAL_ERROR` | 500 | Непредвиденная ошибка сервера |

### Пагинация

Списковые эндпоинты (`GET /api/workouts`) поддерживают `?page=1&limit=20` (лимит по умолчанию 20, максимум 100):

```json
{ "data": [ ... ], "meta": { "page": 1, "limit": 20, "total": 45 } }
```

## 2. Авторизация — `/api/auth`

| Метод | Путь | Описание |
|---|---|---|
| POST | `/api/auth/register` | Регистрация: создаёт User + UserSettings |
| POST | `/api/auth/login` | Вход: выдаёт access-токен + refresh-cookie |
| POST | `/api/auth/refresh` | Обновление access-токена по refresh-cookie (ротация) |
| POST | `/api/auth/logout` | Выход: очищает refresh-cookie |
| GET | `/api/auth/me` | Текущий пользователь |

### POST `/api/auth/register`

```json
// Запрос
{ "email": "user@example.com", "password": "min8chars", "name": "Алексей" }
```

```json
// 201 Created
{ "user": { "id": 1, "email": "user@example.com", "name": "Алексей" },
  "accessToken": "eyJ..." }
// + Set-Cookie: refreshToken=...; HttpOnly; SameSite=Lax; Path=/api/auth (Secure — в production, см. architecture.md §5)
// При регистрации также создаётся UserSettings со значениями по умолчанию (см. database.md §2.2)
// В refresh_tokens хранится только SHA-256-хеш токена (см. database.md §2.8)
```

Ошибки: `400 VALIDATION_ERROR` (невалидный email/пароль), `409 CONFLICT` (email занят).

### POST `/api/auth/login`

```json
// Запрос
{ "email": "user@example.com", "password": "min8chars" }
// 200 OK → { "user": {...}, "accessToken": "eyJ..." } + refresh-cookie
// 401 UNAUTHORIZED — неверные учётные данные (сообщение не раскрывает, что именно неверно)
```

### POST `/api/auth/refresh`

Тело запроса не требуется — refresh-токен берётся из httpOnly cookie.

```json
// 200 OK → { "accessToken": "eyJ..." } + новая refresh-cookie (ротация)
// 401 UNAUTHORIZED — cookie отсутствует или refresh-токен невалиден
```

### POST `/api/auth/logout`

```json
// 204 No Content + Set-Cookie: refreshToken=; Max-Age=0
```

### GET `/api/auth/me`

```json
// 200 OK
{ "id": 1, "email": "user@example.com", "name": "Алексей", "createdAt": "2026-11-11T10:00:00.000Z" }
// 401 UNAUTHORIZED — нет/просрочен access-токен
```

### PUT `/api/auth/me`

Редактирование профиля (этап 2). Требуется `Authorization: Bearer`.

```json
// Запрос: имя и/или смена пароля. Смена пароля требует текущий пароль;
// после смены все refresh-сессии отзываются — на других устройствах нужен повторный вход.
{ "name": "Лёша" }
{ "name": "Лёша", "currentPassword": "oldpass12", "newPassword": "newpass123" }
```

```json
// 200 OK → обновлённый профиль
{ "id": 1, "email": "user@example.com", "name": "Лёша", "createdAt": "2026-11-11T10:00:00.000Z" }
// 400 VALIDATION_ERROR — пустое имя / короткий новый пароль / нет currentPassword
// 401 UNAUTHORIZED — неверный текущий пароль
```

## 3. Упражнения — `/api/exercises`

Возвращает общие упражнения (`userId = null`) **и** персональные упражнения текущего пользователя.

| Метод | Путь | Описание |
|---|---|---|
| GET | `/api/exercises` | Список (фильтры: `?page&limit&place&muscle&difficulty&equipment&metric&search`) |
| GET | `/api/exercises/:id` | Одно упражнение |
| POST | `/api/exercises` | Создать персональное упражнение |
| PUT | `/api/exercises/:id` | Изменить своё упражнение (общие — нельзя) |
| DELETE | `/api/exercises/:id` | Удалить своё (запрещено при наличии результатов/программ — см. database.md §3) |

### GET `/api/exercises`

Параметр `scope` (`all` по умолчанию | `shared` — только базовые | `mine` — только свои).
Фильтры: `place` (`home|outdoor|gym`), `muscle` (любое из значений, any-match),
`difficulty` (`easy|medium|hard`), `equipment` (точное совпадение целого токена —
CSV хранится в каноническом формате database.md §2.3), `metric`, `search` (поиск
по `nameLower`, регистронезависим для кириллицы), `page`/`limit` (лимит ≤ 100).

```json
// 200 OK
{ "data": [
  { "id": 1, "name": "Отжимания", "description": "Классические отжимания от пола",
    "place": "home", "metric": "reps", "muscleGroups": ["chest", "triceps"],
    "difficulty": "easy", "equipment": [],
    "userId": null }
], "meta": { "page": 1, "limit": 20, "total": 34 } }
```

### POST `/api/exercises`

```json
// Запрос — все поля обязательны, кроме description
{ "name": "Тяга резинки к поясу", "description": "Стоя, тяга к животу",
  "place": "home", "metric": "reps", "muscleGroups": ["back", "biceps"],
  "difficulty": "easy", "equipment": ["resistance_band"] }
// 201 Created → объект упражнения с userId текущего пользователя
// 409 CONFLICT — упражнение с таким именем уже есть у пользователя
```

## 4. Программы — `/api/programs`

| Метод | Путь | Описание |
|---|---|---|
| GET | `/api/programs` | `?scope=mine` (по умолчанию) \| `ready` — каталог готовых; фильтры `?place&isActive&page&limit` |
| GET | `/api/programs/:id` | Программа с составом (ProgramExercise + Exercise); готовая — доступна всем на чтение |
| POST | `/api/programs` | Создать программу |
| PUT | `/api/programs/:id` | Изменить название/описание/место (только владелец) |
| DELETE | `/api/programs/:id` | Soft delete: `isActive = false` (только владелец) |
| POST | `/api/programs/:id/copy` | Клонировать готовую/свою программу в аккаунт (одна транзакция) |
| POST | `/api/programs/:id/exercises` | Добавить упражнение (цели по метрике; разрешены общие и свои упражнения) |
| PUT | `/api/programs/:id/exercises/:programExerciseId` | Изменить цели упражнения |
| PUT | `/api/programs/:id/exercises/order` | Пакетная перестановка порядка: `{ "orders": [{ "programExerciseId": 11, "order": 2 }] }` |
| DELETE | `/api/programs/:id/exercises/:programExerciseId` | Убрать упражнение из программы (+ нормализация order) |

### GET `/api/programs/:id`

```json
// 200 OK
{
  "id": 5, "name": "Ключевой курс", "description": "Домашняя программа на 4 недели",
  "place": "home", "isActive": true, "userId": 1,
  "exercises": [
    { "programExerciseId": 11, "order": 1, "targetSets": 3, "targetReps": 15,
      "targetWeight": null, "targetDuration": null,
      "exercise": { "id": 1, "name": "Отжимания", "metric": "reps", "place": "home",
                    "muscleGroups": ["chest", "triceps"], "userId": null } }
  ]
}
// 403 FORBIDDEN — программа другого пользователя
// 404 NOT_FOUND
```

### POST `/api/programs/:id/exercises`

```json
// Запрос
{ "exerciseId": 1, "order": 2, "targetSets": 3, "targetReps": 15, "targetWeight": null, "targetDuration": null }
// 201 Created → объект ProgramExercise
// 400 VALIDATION_ERROR — order занят или не соответствует метрике упражнения (database.md §3)
```

## 5. Тренировки — `/api/workouts`

| Метод | Путь | Описание |
|---|---|---|
| GET | `/api/workouts` | История (`?page=1&limit=20&place=home&from=2026-01-01&to=2026-12-31`) |
| GET | `/api/workouts/:id` | Тренировка с результатами |
| POST | `/api/workouts` | Зафиксировать тренировку (+ WorkoutResult, одна транзакция) |
| PUT | `/api/workouts/:id` | Изменить заметки/дату |
| DELETE | `/api/workouts/:id` | Удалить тренировку (результаты каскадно) |

### POST `/api/workouts`

```json
// Запрос
{
  "programId": 5,
  "place": "home",
  "performedAt": "2026-11-11T18:00:00.000Z",
  "notes": "Чувствую себя хорошо",
  "results": [
    { "exerciseId": 1, "sets": 3, "reps": 15, "weight": null, "duration": null, "notes": null },
    { "exerciseId": 2, "sets": 3, "reps": 12, "weight": 40.5, "duration": null }
  ]
}
// 201 Created → объект Workout с results
// 400 VALIDATION_ERROR — пустой results, упражнение не существует
```

### GET `/api/workouts`

```json
// 200 OK
{ "data": [
  { "id": 42, "programId": 5, "place": "home",
    "performedAt": "2026-11-11T18:00:00.000Z", "notes": "Чувствую себя хорошо",
    "results": [ { "id": 100, "exerciseId": 1, "exerciseName": "Отжимания",
                   "sets": 3, "reps": 15, "weight": null, "duration": null } ] }
], "meta": { "page": 1, "limit": 20, "total": 87 } }
```

## 6. Статистика — `/api/stats`

| Метод | Путь | Описание |
|---|---|---|
| GET | `/api/stats/summary` | Сводка: количество тренировок за период, суммарные подходы/повторы, объём веса |
| GET | `/api/stats/exercises/:exerciseId` | Прогресс по упражнению: динамика веса/повторов по тренировкам |

```json
// GET /api/stats/summary?from=2026-11-01&to=2026-11-30 → 200 OK
{ "workoutsCount": 12, "totalSets": 216, "totalReps": 2480,
  "totalWeight": 18960.5, "byPlace": { "home": 8, "gym": 3, "outdoor": 1 } }
```

## 7. Настройки — `/api/settings`

| Метод | Путь | Описание |
|---|---|---|
| GET | `/api/settings` | Свои настройки (создаются при регистрации) |
| PUT | `/api/settings` | Обновить настройки |

```json
// GET /api/settings → 200 OK
{ "unit": "kg", "theme": "system", "reminderTime": "18:30", "reminderEnabled": true }

// PUT /api/settings — запрос: любое подмножество изменяемых полей
{ "unit": "lb", "theme": "dark", "reminderTime": "19:00", "reminderEnabled": false }
// 200 OK → обновлённый объект
// 400 VALIDATION_ERROR — недопустимое значение unit/theme или формат reminderTime
```

## 8. Здоровье сервиса

| Метод | Путь | Описание |
|---|---|---|
| GET | `/api/health` | Статус API (без авторизации). Реализован на этапе 1 |

```json
// 200 OK
{ "status": "ok", "timestamp": "2026-11-11T18:00:00.000Z" }
```

## 9. Сводная таблица

| № | Метод | Путь | Auth | Реализация |
|---|---|---|---|---|
| 1 | GET | `/api/health` | — | Этап 1 (уже в `routes/index.ts`) |
| 2 | POST | `/api/auth/register` | — | Этап 2 |
| 3 | POST | `/api/auth/login` | — | Этап 2 |
| 4 | POST | `/api/auth/refresh` | cookie | Этап 2 |
| 5 | POST | `/api/auth/logout` | — | Этап 2 |
| 6 | GET | `/api/auth/me` | JWT | Этап 2 |
| 7–11 | GET/POST/PUT/DELETE | `/api/exercises…` (5 эндпоинтов) | JWT | Этап 3 |
| 12–21 | GET/POST/PUT/DELETE | `/api/programs…` (10 эндпоинтов, включая copy и order) | JWT | Этап 3 |
| 22–26 | GET/POST/PUT/DELETE | `/api/workouts…` | JWT | Этап 4 |
| 27–28 | GET | `/api/stats…` | JWT | Этап 4 |
| 29–30 | GET/PUT | `/api/settings…` | JWT | Этап 5 |

Этапы реализации соответствуют плану в [architecture.md §9](architecture.md#9-план-развития-этапы-2).
