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

FitHome/
│
├── README.md
├── .gitignore
│
├── docs/
│   ├── architecture.md
│   ├── database.md
│   ├── api.md
│   └── design.md
│
├── backend/
│   ├── prisma/
│   │   ├── schema.prisma
│   │   ├── migrations/
│   │   │   ├── migration_1/
│   │   │   ├── migration_2/
│   │   │   ├── migration_3/
│   │   │   ├── migration_4/
│   │   │   ├── migration_5/
│   │   │   └── migration_6_stage6_rest_sec/
│   │   └── seed.ts
│   │
│   ├── src/
│   │   ├── controllers/
│   │   │   ├── auth.controller.ts
│   │   │   ├── exercise.controller.ts
│   │   │   ├── program.controller.ts
│   │   │   ├── workout.controller.ts
│   │   │   ├── stats.controller.ts
│   │   │   └── program-share.controller.ts
│   │   │
│   │   ├── routes/
│   │   │   ├── auth.routes.ts
│   │   │   ├── exercises.routes.ts
│   │   │   ├── programs.routes.ts
│   │   │   ├── workouts.routes.ts
│   │   │   ├── stats.routes.ts
│   │   │   └── program-shares.routes.ts
│   │   │
│   │   ├── services/
│   │   │   ├── auth.service.ts
│   │   │   ├── exercise.service.ts
│   │   │   ├── program.service.ts
│   │   │   ├── workout.service.ts
│   │   │   ├── stats.service.ts
│   │   │   └── program-share.service.ts
│   │   │
│   │   ├── repositories/
│   │   │   ├── exercise.repository.ts
│   │   │   ├── program.repository.ts
│   │   │   ├── workout.repository.ts
│   │   │   ├── stats.repository.ts
│   │   │   └── program-share.repository.ts
│   │   │
│   │   ├── middlewares/
│   │   ├── types/
│   │   ├── utils/
│   │   ├── app.ts
│   │   └── server.ts
│   │
│   ├── package.json
│   └── tsconfig.json
│
└── frontend/
    ├── src/
    │   ├── api/
    │   │   ├── client.ts
    │   │   ├── auth.ts
    │   │   ├── exercises.ts
    │   │   ├── programs.ts
    │   │   ├── workouts.ts
    │   │   └── stats.ts
    │   │
    │   ├── components/
    │   ├── pages/
    │   │   ├── Login
    │   │   ├── Register
    │   │   ├── Exercises
    │   │   ├── Programs
    │   │   ├── ProgramLibrary
    │   │   └── ReceivedPrograms
    │   │
    │   ├── types/
    │   │   ├── exercise.ts
    │   │   ├── program.ts
    │   │   ├── workout.ts
    │   │   └── stats.ts
    │   │
    │   ├── App.tsx
    │   └── main.tsx
    │
    ├── package.json
    └── vite.config.ts

## Документация

Вся техническая документация находится в папке [`docs/`](docs/README.md) и является источником истины для проекта:

1. [`docs/architecture.md`](docs/architecture.md) — слоистая архитектура, схема взаимодействий, обоснование решений.
2. [`docs/database.md`](docs/database.md) — сущности БД (Users, Exercises, Programs, ProgramExercises, Workouts, WorkoutResults, UserSettings) и стратегия миграции на PostgreSQL.
3. [`docs/api.md`](docs/api.md) — контракты REST API (запросы, ответы, коды ошибок).
4. [`docs/design.md`](docs/design.md) — структура интерфейса, адаптивность, UX-потоки.
5. [`docs/testing.md`](docs/testing.md) — стратегия тестирования на Vitest.


