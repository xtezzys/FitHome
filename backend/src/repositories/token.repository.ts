import { prisma } from './prisma.js';

/**
 * Доступ к refresh-сессиям через Prisma (docs/architecture.md §3).
 * В БД хранятся только SHA-256-хеши токенов (docs/database.md §2.8).
 */

export interface CreateSessionData {
  userId: number;
  tokenHash: string;
  expiresAt: Date;
}

/** Создаёт запись refresh-сессии. */
export function createSession(data: CreateSessionData) {
  return prisma.refreshToken.create({ data });
}

/** Находит сессию по хешу токена. */
export function findSessionByHash(tokenHash: string) {
  return prisma.refreshToken.findUnique({ where: { tokenHash } });
}

/** Помечает сессию отозванной (ротация, выход). */
export function revokeSession(id: number) {
  return prisma.refreshToken.update({
    where: { id },
    data: { revokedAt: new Date() },
  });
}

/** Ротация: отзыв старой сессии + создание новой одной транзакцией. */
export async function rotateSession(oldId: number, next: CreateSessionData) {
  return prisma.$transaction(async (tx) => {
    await tx.refreshToken.update({
      where: { id: oldId },
      data: { revokedAt: new Date() },
    });
    return tx.refreshToken.create({ data: next });
  });
}

/**
 * Отзывает все активные сессии пользователя.
 * Используется при повторном использовании отозванного токена
 * (подозрение на кражу) и при смене пароля.
 */
export async function revokeAllUserSessions(userId: number) {
  await prisma.refreshToken.updateMany({
    where: { userId, revokedAt: null },
    data: { revokedAt: new Date() },
  });
}

/** Удаляет истёкшие и давно отозванные сессии (очистка при входе). */
export async function deleteStaleSessions(userId: number) {
  await prisma.refreshToken.deleteMany({
    where: {
      userId,
      OR: [{ expiresAt: { lt: new Date() } }, { revokedAt: { lt: new Date(Date.now() - 7 * 24 * 60 * 60 * 1000) } }],
    },
  });
}
