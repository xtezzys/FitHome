import { AppError } from '../types/errors.js';
import type { RegisterDto, LoginDto, UpdateProfileDto } from '../types/dto.js';

/**
 * Валидация входных данных на границе контроллеров (docs/architecture.md §3).
 * Контракт на границе HTTP: любое отклонение — VALIDATION_ERROR 400
 * в едином формате ошибок (docs/api.md §1).
 */

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
/** bcrypt ограничивает пароль 72 байтами. */
const PASSWORD_MAX = 72;
const NAME_MAX = 50;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function requireString(body: Record<string, unknown>, field: string): string {
  const value = body[field];
  if (typeof value !== 'string') {
    throw new AppError('VALIDATION_ERROR', `Поле "${field}" обязательно и должно быть строкой`);
  }
  return value;
}

/** Валидирует данные регистрации (docs/api.md §2). */
export function parseRegisterDto(body: unknown): RegisterDto {
  if (!isRecord(body)) {
    throw new AppError('VALIDATION_ERROR', 'Тело запроса должно быть JSON-объектом');
  }

  const email = requireString(body, 'email').trim().toLowerCase();
  if (!EMAIL_RE.test(email) || email.length > 254) {
    throw new AppError('VALIDATION_ERROR', 'Некорректный email');
  }

  const password = requireString(body, 'password');
  if (password.length < 8 || password.length > PASSWORD_MAX) {
    throw new AppError('VALIDATION_ERROR', `Пароль должен содержать от 8 до ${PASSWORD_MAX} символов`);
  }

  const name = requireString(body, 'name').trim();
  if (name.length === 0 || name.length > NAME_MAX) {
    throw new AppError('VALIDATION_ERROR', `Имя обязательно и должно содержать до ${NAME_MAX} символов`);
  }

  return { email, password, name };
}

/** Валидирует данные входа (docs/api.md §2). */
export function parseLoginDto(body: unknown): LoginDto {
  if (!isRecord(body)) {
    throw new AppError('VALIDATION_ERROR', 'Тело запроса должно быть JSON-объектом');
  }
  const email = requireString(body, 'email');
  const password = requireString(body, 'password');
  return { email, password };
}

/**
 * Валидирует редактирование профиля: допустимо имя и/или смена пароля.
 * Смена пароля требует текущий пароль.
 */
export function parseUpdateProfileDto(body: unknown): UpdateProfileDto {
  if (!isRecord(body)) {
    throw new AppError('VALIDATION_ERROR', 'Тело запроса должно быть JSON-объектом');
  }

  const dto: UpdateProfileDto = {};

  if (body.name !== undefined) {
    const name = requireString(body, 'name').trim();
    if (name.length === 0 || name.length > NAME_MAX) {
      throw new AppError('VALIDATION_ERROR', `Имя должно содержать от 1 до ${NAME_MAX} символов`);
    }
    dto.name = name;
  }

  if (body.newPassword !== undefined) {
    const newPassword = requireString(body, 'newPassword');
    if (newPassword.length < 8 || newPassword.length > PASSWORD_MAX) {
      throw new AppError('VALIDATION_ERROR', `Новый пароль должен содержать от 8 до ${PASSWORD_MAX} символов`);
    }
    const currentPassword = requireString(body, 'currentPassword');
    dto.newPassword = newPassword;
    dto.currentPassword = currentPassword;
  }

  if (dto.name === undefined && dto.newPassword === undefined) {
    throw new AppError('VALIDATION_ERROR', 'Передайте name и/или newPassword для обновления');
  }

  return dto;
}
