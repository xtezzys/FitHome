import type { Request, Response } from 'express';
import * as userService from '../services/user.service.js';
import { parseUpdateProfileDto } from '../middlewares/validate.js';
import { asyncHandler } from '../lib/async-handler.js';

/**
 * HTTP-обработчики профиля (docs/api.md §2 — /api/auth/me).
 * userId берётся из access-токена (requireAuth) — клиент не может
 * обратиться к чужому профилю.
 */

/** GET /api/auth/me — 200 + профиль текущего пользователя. */
export const getMe = asyncHandler((req: Request, res: Response) => {
  return userService.getProfile(req.userId as number).then((user) => {
    res.status(200).json(user);
  });
});

/** PUT /api/auth/me — 200 + обновлённый профиль. */
export const updateMe = asyncHandler((req: Request, res: Response) => {
  const dto = parseUpdateProfileDto(req.body);
  return userService.updateProfile(req.userId as number, dto).then((user) => {
    res.status(200).json(user);
  });
});
