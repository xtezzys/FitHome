/**
 * Типы, зеркалящие DTO backend (docs/architecture.md §2).
 * Публичное представление пользователя — без passwordHash (docs/api.md §2).
 */

export interface User {
  id: number;
  email: string;
  name: string;
  createdAt: string;
}
