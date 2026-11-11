/**
 * DTO авторизации и профиля (docs/api.md §2).
 * Формируются валидаторами (middlewares/validate.ts) на границе контроллеров.
 */

export interface RegisterDto {
  email: string;
  password: string;
  name: string;
}

export interface LoginDto {
  email: string;
  password: string;
}

export interface UpdateProfileDto {
  name?: string;
  currentPassword?: string;
  newPassword?: string;
}

/** Публичное представление пользователя — без passwordHash. */
export interface UserDto {
  id: number;
  email: string;
  name: string;
  createdAt: string;
}

/** Результат регистрации/входа: пользователь + access-токен. */
export interface AuthSessionDto {
  user: UserDto;
  accessToken: string;
}
