import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { backendDir, stage0Dir } from './helpers.js';

/**
 * Оркестратор Шага 0: запускает все эксперименты последовательно
 * на изолированных временных БД (prisma/stage0/tmp) и печатает сводку.
 * Основная база (file:./dev.db) не затрагивается — см. helpers.assertIsolated.
 */

const tsxCli = path.join(backendDir, 'node_modules', 'tsx', 'dist', 'cli.mjs');

const EXPERIMENTS: Array<{ id: string; script: string; description: string }> = [
  { id: 'E-3', script: 'e3-multistatement.ts', description: 'multi-statement $executeRawUnsafe (информационный)' },
  { id: 'E-2', script: 'e2-decimal.ts', description: 'детерминизм Decimal-сериализации REAL' },
  { id: 'E-A', script: 'ea-transaction.ts', description: 'интерактивная транзакция: defer FK, foreign_key_check, откат' },
  { id: 'E-B', script: 'eb-migrate.ts', description: 'поведение Prisma Migrate: rebuild, failed-запись, откат' },
  { id: 'E-5', script: 'e5-integrity.ts', description: 'целостность связей и ограничений после rebuild' },
  { id: 'E-6', script: 'e6-sqlsplit.ts', description: 'сплит операторов migration.sql' },
  { id: 'E-4', script: 'e4-checkpoint.ts', description: 'WAL checkpoint и валидация копии' },
];

const results: Array<{ id: string; status: string }> = [];

for (const exp of EXPERIMENTS) {
  console.log(`\n########## ${exp.id} — ${exp.description} ##########\n`);
  const res = spawnSync(process.execPath, [tsxCli, path.join(stage0Dir, exp.script)], {
    cwd: backendDir,
    stdio: 'inherit',
  });
  results.push({ id: exp.id, status: res.status === 0 ? 'PASS' : `FAIL (exit ${res.status})` });
}

console.log('\n===================== СВОДКА ШАГА 0 =====================');
for (const r of results) console.log(`  ${r.id}: ${r.status}`);
const failed = results.filter((r) => r.status !== 'PASS');
console.log('=========================================================');
console.log(failed.length === 0 ? 'Все эксперименты Шага 0 пройдены.' : `Провалено экспериментов: ${failed.length}`);
process.exit(failed.length === 0 ? 0 : 1);
