import { compare, hash } from 'bcryptjs';
import { AppError } from '../types/errors.js';
import type { RegisterDto, LoginDto, AuthSessionDto, UserDto } from '../types/dto.js';
import * as userRepository from '../repositories/user.repository.js';
import * as tokenRepository from '../repositories/token.repository.js';
import { signAccessToken } from '../lib/jwt.js';
import { generateRefreshToken, hashToken, BCRYPT_ROUNDS, REFRESH_TTL_SECONDS } from '../lib/tokens.js';

/**
 * Бизнес-логика авторизации (docs/architecture.md §3, контракты — docs/api.md §2).
 * Не знает о HTTP: контроллер получает готовые данные и ставит cookie сам.
 *
 * Безопасность:
 * - пароли хранятся только как bcrypt-хеши (cost 10);
 * - refresh-токены в БД — только SHA-256-хеши;
 * - при повторном использовании отозванного токена отзываются все сессии
 *   пользователя (защита от кражи refresh-токена);
 * - ошибка входа не раскрывает, что именно неверно — email или пароль.
 */

/** Преобразует запись Prisma в публичный DTO без passwordHash. */
export function toUserDto(user: { id: number; email: string; name: string; createdAt: Date }): UserDto {
  return {
    id: user.id,
    email: user.email,
    name: user.name,
    createdAt: user.createdAt.toISOString(),
  };
}

/** Создаёт новую refresh-сессию и access-токен для пользователя. */
async function issueSession(userId: number): Promise<{ accessToken: string; refreshToken: string }> {
  const refreshToken = generateRefreshToken();
  await tokenRepository.createSession({
    userId,
    tokenHash: hashToken(refreshToken),
    expiresAt: new Date(Date.now() + REFRESH_TTL_SECONDS * 1000),
  });
  return { accessToken: signAccessToken(userId), refreshToken };
}

/** Регистрация: создаёт пользователя, настройки и первую сессию (docs/api.md §2). */
export async function register(dto: RegisterDto): Promise<AuthSessionDto & { refreshToken: string }> {
  const email = dto.email.trim().toLowerCase();

  const passwordHash = await hash(dto.password, BCRYPT_ROUNDS);
  const refreshToken = generateRefreshToken();

  let user;
  try {
    user = await userRepository.createUserWithSession(
      { email, passwordHash, name: dto.name.trim() },
      { tokenHash: hashToken(refreshToken), expiresAt: new Date(Date.now() + REFRESH_TTL_SECONDS * 1000) },
    );
  } catch (err) {
    // P2002 — нарушение уникального ограничения (email) — docs/api.md §2
    if (
      typeof err === 'object' &&
      err !== null &&
      'code' in err &&
      (err as { code?: string }).code === 'P2002'
    ) {
      throw new AppError('CONFLICT', 'Пользователь с таким email уже зарегистрирован');
    }
    throw err;
  }

  return { user: toUserDto(user), accessToken: signAccessToken(user.id), refreshToken };
}

/**
 * Вход по email и паролю. Единое сообщение об ошибке при неверном
 * email или пароле — не раскрываем существование учётной записи.
 */
export async function login(dto: LoginDto): Promise<AuthSessionDto & { refreshToken: string }> {
  const email = dto.email.trim().toLowerCase();
  const user = await userRepository.findUserByEmail(email);

  const passwordMatches =
    user !== null && (await compare(dto.password, user.passwordHash));
  if (!passwordMatches) {
    throw new AppError('UNAUTHORIZED', 'Неверный email или пароль');
  }

  // Чистим истёкшие сессии — лёгкая периодическая уборка без cron
  await tokenRepository.deleteStaleSessions(user.id);

  const session = await issueSession(user.id);
  return { user: toUserDto(user), ...session };
}

/**
 * Обновление access-токена по refresh-токену с ротацией (docs/api.md §2).
 * Повторное использование уже отозванного токена рассматривается как
 * компрометация: отзываются все сессии пользователя.
 */
export async function refresh(
  refreshToken: string | undefined,
): Promise<{ accessToken: string; refreshToken: string }> {
  if (!refreshToken) {
    throw new AppError('UNAUTHORIZED', 'Refresh-токен отсутствует');
  }

  const session = await tokenRepository.findSessionByHash(hashToken(refreshToken));
  if (!session) {
    throw new AppError('UNAUTHORIZED', 'Refresh-токен недействителен');
  }

  if (session.revokedAt !== null) {
    // Токен уже использован/отозван — возможна кража: отзываем все сессии
    await tokenRepository.revokeAllUserSessions(session.userId);
    throw new AppError('UNAUTHORIZED', 'Refresh-токен отозван');
  }

  if (session.expiresAt.getTime() <= Date.now()) {
    throw new AppError('UNAUTHORIZED', 'Срок действия refresh-токена истёк');
  }

  const nextRefreshToken = generateRefreshToken();
  await tokenRepository.rotateSession(session.id, {
    userId: session.userId,
    tokenHash: hashToken(nextRefreshToken),
    expiresAt: new Date(Date.now() + REFRESH_TTL_SECONDS * 1000),
  });

  return { accessToken: signAccessToken(session.userId), refreshToken: nextRefreshToken };
}

/** Выход: отзывает сессию по refresh-токену, если он передан. */
export async function logout(refreshToken: string | undefined): Promise<void> {
  if (!refreshToken) {
    return; // cookie отсутствует — выход уже фактически совершен
  }
  const session = await tokenRepository.findSessionByHash(hashToken(refreshToken));
  if (session && session.revokedAt === null) {
    await tokenRepository.revokeSession(session.id);
  }
}
