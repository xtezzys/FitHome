# Шаг 0 — эксперименты миграции этапа 3

> Статус: выполнен. Все эксперименты проведены на изолированных временных БД
> (`backend/prisma/stage0/tmp/`), основная база (`prisma/dev.db`) не затронута.
> Окружение: Prisma CLI 6.19.3 = @prisma/client 6.19.3 (проверено), Node v26.13.0, macOS arm64.

## 1. Цель

Эмпирическая проверка свойств Prisma 6.19.3 + SQLite, на которых построен план
миграции этапа 3 ([план этапа 3](architecture.md#9-план-развития-этапы-2)):
`PRAGMA defer_foreign_keys` в интерактивной транзакции и в миграциях Prisma Migrate,
поведение rebuild таблиц с FK-детьми, детерминизм Decimal-сериализации REAL,
WAL checkpoint перед бэкапом, сплит операторов migration.sql.

## 2. Изоляция

- Все экспериментальные БД создаются только в `backend/prisma/stage0/tmp/`;
  [`helpers.ts`](../backend/prisma/stage0/helpers.ts) содержит `assertIsolated`,
  отклоняющий любой путь вне этого каталога.
- Probe-клиент генерируется в `prisma/stage0/generated` (не в `node_modules`),
  схема — `prisma/stage0/probe.prisma` с `env("PROBE_DATABASE_URL")`.
- Prisma CLI вызывается с `--schema prisma/stage0/probe.prisma` (или его временной
  копией) и `PROBE_DATABASE_URL` — переменная `DATABASE_URL` основной базы не читается
  схемой пробы.
- Проверка после всех прогонов: в `prisma/dev.db` — только миграция `20261111191107_init_auth`
  (применена до начала Шага 0), таблицы основной схемы; артефактов Шага 0 (`_new_*`,
  `_pe_park`, probe-таблицы) нет.

## 3. Порядок запуска

```bash
cd backend
npm run stage0:generate   # генерация probe-клиента в prisma/stage0/generated
npm run stage0:run        # все эксперименты последовательно + сводка
# по отдельности: npx tsx prisma/stage0/<script>.ts
```

## 4. Эксперименты: критерии и результаты

### E-2 — детерминизм Decimal-сериализации REAL (`e2-decimal.ts`)

Критерии: checksum (сериализатор V1, [`checksum.ts`](../backend/prisma/stage0/checksum.ts))
идентичен при повторном чтении в новом процессе и на копии файла БД; копия проходит
`integrity_check` и `foreign_key_check`.

**Результат: PASS.** Хеш `86c6987d…0610348` одинаков в трёх чтениях (первый процесс,
новый процесс, копия файла). Значения: `40.50`, `0.1`, `0.00001`, `0.000001`,
`123456789.123`, `-12.250`, `3.0`, `40.5` (raw REAL), NULL.

### E-A — интерактивная транзакция (`ea-transaction.ts`)

Критерии: `PRAGMA defer_foreign_keys=ON` действует; `foreign_key_check` работает внутри
транзакции и детектирует сироту; throw откатывает транзакцию атомарно (DDL и данные).

**Результат: PASS, с двумя критическими находками:**

1. **Наивный rebuild роняет COMMIT.** `DROP` родителя с детьми при `defer_foreign_keys=ON`
   не падает на месте (implicit DELETE записывает отложенные нарушения), но COMMIT
   завершается `P2003 Foreign key constraint failed`: записанные нарушения **не
   сбрасываются** повторным созданием родителя через `RENAME` (проверено, `UPDATE`
   дочерних строк `SET x = x` тоже не помогает). Решение — **«парковка» детей**:
   `CREATE _pe_park → INSERT SELECT → DELETE детей → rebuild → re-INSERT → DROP _pe_park`.
   С парковкой COMMIT проходит, дети возвращаются с теми же id и ссылками.
2. `foreign_key_check` **внутри транзакции** работает и детектирует сироту (нарушений: 1);
   throw внутри `$transaction` откатывает DDL и данные атомарно — старая схема цела,
   `_new_*`-остатков нет.
3. `lower()` SQLite — ASCII-only: `'Отжимания'` → `'Отжимания'` (подтверждена
   обязательность JS-backfill через `String.toLowerCase()`).

### E-B — поведение Prisma Migrate (`eb-migrate.ts`)

Миграции подаются поэтапно через временную копию схемы (`tmp/eb`), чтобы `deploy`
применял ровно нужную фазу. Критерии: rebuild на БД с данными; failed-запись в
`_prisma_migrations`; поведение отката; recovery.

**Результат: PASS, ключевые находки:**

1. **Наивный DDL через `migrate deploy` НЕПРИГОДЕН**: Migrate исполняет миграции
   с **немедленной** FK-проверкой — `PRAGMA defer_foreign_keys` в его контексте
   **не действует**; `DROP` родителя с детьми падает с `Database error code: 1811,
   FOREIGN KEY constraint failed`.
2. **Rebuild с «парковкой детей» в migration.sql проходит через `migrate deploy`**
   на БД с данными: дети сохранены (3 строки, те же id/ссылки), кириллица в
   `name_lower` не изменена ASCII-`lower()` (ожидаемо), `foreign_key_check` — 0 строк.
   → **Основной путь миграции (через Prisma Migrate) жизнеспособен при парковочном DDL.**
3. **Откат Migrate НЕ атомарен**: после сбоя остаются таблицы `_new_probe_exercises`
   и `_pe_park`; дети **выселены** из `probe_program_exercises` (0 строк), но целы
   в `_pe_park` (3 строки); `probe_exercises` не тронута (DROP не выполнился).
   Восстановление должно включать: возврат детей из `_pe_park`, удаление остатков.
4. **Failed-запись**: строка с `finished_at IS NULL`, `logs` содержит точный текст
   `Database error code: 1299 — NOT NULL constraint failed: _new_probe_exercises.name_lower`
   (эталонный паттерн для оркестратора). Deploy блокирует новые миграции до recovery.
5. **`migrate resolve --rolled-back`**: успешен для failed-миграции; для applied-миграции
   отказ `P3012` («not in a failed state»); помеченную `--applied` нельзя вернуть
   в pending. Повторный deploy после resolve снова пытается исполнить миграцию.

### E-3 — multi-statement `$executeRawUnsafe` (`e3-multistatement.ts`, информационный)

**Результат: PASS (фиксация).** Строка с двумя операторами через `;` **не падает, но
молча исполняет только первый** (`e3_a` создана, `e3_b` — нет). Вывод: все raw-вызовы
миграционного инструментария — строго пооператорные.

### E-4 — WAL checkpoint и валидация копии (`e4-checkpoint.ts`)

Критерии: `busy=1` при активном писателе; `busy=0` и WAL = 0 байт после завершения
писателя; копия валидна.

**Результат: PASS.** `wal_checkpoint(TRUNCATE)` → `{busy:1, log:13, checkpointed:13}`
при открытой транзакции писателя; после отката писателя `{busy:0, log:0, checkpointed:0}`,
WAL-файл 0 байт; копия: `integrity_check` ok, `foreign_key_check` 0 строк, ровно 2
закоммиченные строки, откаченная строка писателя не попала.

### E-5 — целостность после rebuild (`e5-integrity.ts`)

**Результат: PASS.** После rebuild: дети с прежними id/ссылками; `Restrict` отклоняет
удаление используемого упражнения (ошибка 1811); `Cascade` удаляет состав с программой;
`unique (program_id, ord)` отклоняет дубли (ошибка 2067); индексы
`probe_exercises_name_lower_idx` и уникальный `probe_program_exercises_program_id_ord_key`
на месте; `foreign_key_check` — 0 строк.

### E-6 — сплит операторов migration.sql (`e6-sqlsplit.ts`)

**Результат: PASS.** Сплит по `;` с учётом кавычек и вырезанием комментариев **внутри**
оператора даёт 15 операторов (pragma + парковка×3 + 2×(create, insert, drop, rename) +
index + возврат×2); в DDL этапа нет `;` внутри литералов; исполнение сплита даёт
структуру, побайтово совпадающую с эталонной (table_info + index_list), дети целы.

## 5. Технические заметки для инструментария

- Сырые запросы возвращают **BigInt** для целых колонок (`COUNT(*)`, `busy`/`log`
  в pragma, `notnull`/`unique` в `table_info`/`index_list`) — `JSON.stringify` бросает
  `TypeError`; обязательное приведение `Number(...)`.
- `migrate resolve` не создаёт файл БД — пустой файл нужно создать до первого resolve.
- `PRAGMA defer_foreign_keys` действует внутри интерактивной транзакции (`$transaction`),
  но **не** в контексте исполнения миграций Prisma Migrate.
- `PRAGMA foreign_keys=OFF` внутри транзакции — no-op (документированное поведение SQLite).

## 6. Выводы для плана миграции (дерево решений)

| Ветвь | Итог |
|---|---|
| E-B (основной путь) | Наивный DDL — провален; **с парковочным DDL — пройден** → основной путь через `prisma migrate deploy` жизнеспособен, migration.sql обязан включать парковку детей |
| E-A (Alt 1, интерактивный исполнитель) | Пройден с парковкой детей — резервный вариант подтверждён |
| E-2 | Пройден — сериализатор V1 допущен; Decimal REAL детерминирован |
| E-4 | Пройден — процедура бэкапа подтверждена |
| E-5 | Пройден — целостность после rebuild подтверждена |
| E-6 | Пройден — сплит операторов для исполнителя надёжен |
| E-3 | Информационно: multi-statement тихо исполняет только первый оператор |

Дополнительные корректировки плана по итогам Шага 0:

1. **Парковка детей — обязательная часть migration.sql** (и основного пути, и Alt 1).
2. **Recovery при сбое deploy**: остановка → возврат детей из `_pe_park` (если миграция
   успела их выселить) → удаление `_new_*`/`_pe_park` → исправление данных (backfill) →
   `migrate resolve --rolled-back <failed>` (работает только для failed) → повторный deploy.
3. **Двухфазная схема «A → backfill → B»** сохраняется: `resolve --applied` **до** deploy
   работает и может использоваться оркестратором для управления порядком на свежих БД;
   но вернуть applied-миграцию в pending нельзя — порядок контролируется составом
   применяемых миграций, а не пере-разметкой.
4. Паттерн ожидаемой ошибки для оркестратора: `Database error code: 1299` +
   `NOT NULL constraint failed: _new_probe_exercises.name_lower` (для реальной базы —
   колонка `_new_exercises.name_lower`/`difficulty`).

## 7. Артефакты

| Файл | Назначение |
|---|---|
| `backend/prisma/stage0/probe.prisma` | пробная схема (целевое состояние) |
| `backend/prisma/stage0/migrations/…` | 0001_init, 0010_rebuild (парковка), 0020_rebuild_fail |
| `backend/prisma/stage0/checksum.ts` | сериализатор V1 |
| `backend/prisma/stage0/helpers.ts` | изоляция, схема, seed, `check/summary` |
| `backend/prisma/stage0/e*.ts`, `run-all.ts` | эксперименты и оркестратор |
| `backend/prisma/stage0/tmp/` | временные БД (одноразовые, безопасно удалять) |
| npm-скрипты | `stage0:generate`, `stage0:run` |
