import { prisma } from './prisma.js';

/**
 * Доступ к данным пользователей через Prisma (docs/architecture.md §3).
 * Не содержит бизнес-правил — только CRUD и транзакции.
 */

export interface CreateUserData {
  email: string;
  passwordHash: string;
  name: string;
}

export interface RefreshTokenData {
  tokenHash: string;
  expiresAt: Date;
}

/** Находит пользователя по email (уникальному логину). */
export function findUserByEmail(email: string) {
  return prisma.user.findUnique({ where: { email } });
}

/** Находит пользователя по идентификатору. */
export function findUserById(id: number) {
  return prisma.user.findUnique({ where: { id } });
}

/**
 * Создаёт пользователя вместе с настройками и refresh-сессией
 * одной транзакцией (docs/database.md §3: 1 пользователь — 1 настройки).
 */
export async function createUserWithSession(
  data: CreateUserData,
  refresh: RefreshTokenData,
) {
  return prisma.$transaction(async (tx) => {
    const user = await tx.user.create({
      data: {
        email: data.email,
        passwordHash: data.passwordHash,
        name: data.name,
        settings: { create: {} }, // значения по умолчанию из схемы (docs/database.md §2.2)
      },
    });
    await tx.refreshToken.create({
      data: { userId: user.id, tokenHash: refresh.tokenHash, expiresAt: refresh.expiresAt },
    });
    return user;
  });
}

/** Создаёт пользователя вместе с настройками (без refresh-сессии). */
export function createUser(data: CreateUserData) {
  return prisma.user.create({
    data: { ...data, settings: { create: {} } },
  });
}

/** Обновляет отображаемое имя пользователя. */
export function updateUserName(id: number, name: string) {
  return prisma.user.update({ where: { id }, data: { name } });
}

/** Заменяет хеш пароля. */
export function updateUserPassword(id: number, passwordHash: string) {
  return prisma.user.update({ where: { id }, data: { passwordHash } });
}
