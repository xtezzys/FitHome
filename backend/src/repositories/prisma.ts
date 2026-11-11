import { PrismaClient } from '@prisma/client';

/**
 * Единственный экземпляр Prisma Client (docs/architecture.md §3).
 * Обращения к Prisma допустимы только внутри repositories —
 * этот модуль импортируется исключительно ими.
 */
export const prisma = new PrismaClient();
