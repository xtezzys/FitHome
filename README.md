# FitHome

FitHome — современное адаптивное веб-приложение для планирования домашних тренировок, тренировок на улице и в спортивном зале.

## Стек технологий

| Слой | Технология |
|---|---|
| Frontend | React 18 + TypeScript + Vite |
| Стилизация | CSS (переменные, модульная структура) |
| Backend | Node.js + Express + TypeScript |
| База данных | SQLite (готовность к переходу на PostgreSQL) |
| ORM | Prisma |
| Авторизация | JWT (access + refresh) |
| Тестирование | Vitest |

## Структура проекта

```
FitHome/
├── docs/                  # Техническая документация
│   ├── architecture.md    # Архитектура приложения
│   ├── database.md        # Схема базы данных
│   ├── api.md             # REST API эндпоинты
│   ├── design.md          # Описание интерфейса
│   └── testing.md         # План тестирования
├── backend/               # API-сервер (Express + Prisma)
└── frontend/              # SPA-клиент (React + Vite)
```

## Документация

Вся техническая документация находится в папке [`docs/`](docs/README.md) и является источником истины для проекта:

1. [`docs/architecture.md`](docs/architecture.md) — слоистая архитектура, схема взаимодействий, обоснование решений.
2. [`docs/database.md`](docs/database.md) — сущности БД (Users, Exercises, Programs, ProgramExercises, Workouts, WorkoutResults, UserSettings) и стратегия миграции на PostgreSQL.
3. [`docs/api.md`](docs/api.md) — контракты REST API (запросы, ответы, коды ошибок).
4. [`docs/design.md`](docs/design.md) — структура интерфейса, адаптивность, UX-потоки.
5. [`docs/testing.md`](docs/testing.md) — стратегия тестирования на Vitest.

## Требования

- Node.js >= 20
- npm >= 10

## Запуск

### Backend

```bash
cd backend
npm install
cp .env.example .env         # настроить DATABASE_URL, JWT_SECRET
npx prisma migrate dev       # создать и применить миграцию
npm run dev                  # http://localhost:4000
```

### Frontend

```bash
cd frontend
npm install
npm run dev                  # http://localhost:5173
```

## Тесты

```bash
cd backend && npm test
cd frontend && npm test
```

## Статус проекта

Этап 1 — подготовка архитектуры и скелета проекта (выполнен).
Этап 2 — авторизация и управление пользователями (выполнен): регистрация, вход/выход,
JWT access + refresh с ротацией и отзывом сессий, httpOnly refresh-cookie, bcrypt,
middleware защиты API, редактирование профиля, страницы Login/Register.
Следующие этапы: CRUD-модули упражнений и программ, интерфейс планирования тренировок.
