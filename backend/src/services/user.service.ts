import { compare, hash } from 'bcryptjs';
import { AppError } from '../types/errors.js';
import type { UpdateProfileDto, UserDto } from '../types/dto.js';
import * as userRepository from '../repositories/user.repository.js';
import * as tokenRepository from '../repositories/token.repository.js';
import { toUserDto } from './auth.service.js';
import { BCRYPT_ROUNDS } from '../lib/tokens.js';

/**
 * Бизнес-логика профиля пользователя (docs/api.md §2 — PUT /api/auth/me).
 * Проверка прав доступа: пользователь оперирует только своей записью —
 * userId берётся из verified access-токена, а не из тела запроса.
 */

/** Возвращает профиль текущего пользователя. */
export async function getProfile(userId: number): Promise<UserDto> {
  const user = await userRepository.findUserById(userId);
  if (!user) {
    throw new AppError('NOT_FOUND', 'Пользователь не найден');
  }
  return toUserDto(user);
}

/**
 * Редактирует профиль: имя и/или смена пароля.
 * Смена пароля требует текущий пароль; после смены все refresh-сессии
 * отзываются — на других устройствах потребуется войти заново.
 */
export async function updateProfile(userId: number, dto: UpdateProfileDto): Promise<UserDto> {
  const user = await userRepository.findUserById(userId);
  if (!user) {
    throw new AppError('NOT_FOUND', 'Пользователь не найден');
  }

  let passwordHash: string | undefined;
  if (dto.newPassword !== undefined) {
    const currentPasswordMatches = await compare(
      dto.currentPassword as string,
      user.passwordHash,
    );
    if (!currentPasswordMatches) {
      throw new AppError('UNAUTHORIZED', 'Текущий пароль указан неверно');
    }
    passwordHash = await hash(dto.newPassword, BCRYPT_ROUNDS);
  }

  if (dto.name !== undefined) {
    await userRepository.updateUserName(userId, dto.name);
  }
  if (passwordHash !== undefined) {
    await userRepository.updateUserPassword(userId, passwordHash);
    await tokenRepository.revokeAllUserSessions(userId);
  }

  const updated = await userRepository.findUserById(userId);
  return toUserDto(updated!);
}
