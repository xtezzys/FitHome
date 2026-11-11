import type { Request, Response } from 'express';
import * as authService from '../services/auth.service.js';
import { parseRegisterDto, parseLoginDto } from '../middlewares/validate.js';
import { setRefreshCookie, clearRefreshCookie } from '../lib/cookies.js';
import { REFRESH_COOKIE } from '../lib/tokens.js';
import { asyncHandler } from '../lib/async-handler.js';

/**
 * HTTP-обработчики авторизации (docs/api.md §2).
 * Слой отвечает только за: валидацию входа, вызов service,
 * статус-коды, cookie и формат ответа.
 */

/** POST /api/auth/register — 201 + user/accessToken + refresh-cookie. */
export const register = asyncHandler((req: Request, res: Response) => {
  const dto = parseRegisterDto(req.body);
  return authService.register(dto).then((result) => {
    setRefreshCookie(res, result.refreshToken);
    res.status(201).json({ user: result.user, accessToken: result.accessToken });
  });
});

/** POST /api/auth/login — 200 + user/accessToken + refresh-cookie. */
export const login = asyncHandler((req: Request, res: Response) => {
  const dto = parseLoginDto(req.body);
  return authService.login(dto).then((result) => {
    setRefreshCookie(res, result.refreshToken);
    res.status(200).json({ user: result.user, accessToken: result.accessToken });
  });
});

/** POST /api/auth/refresh — 200 + новый accessToken + ротация refresh-cookie. */
export const refresh = asyncHandler(async (req: Request, res: Response) => {
  const result = await authService.refresh(req.cookies?.[REFRESH_COOKIE]);
  setRefreshCookie(res, result.refreshToken);
  res.status(200).json({ accessToken: result.accessToken });
});

/** POST /api/auth/logout — 204 + очистка refresh-cookie. */
export const logout = asyncHandler(async (req: Request, res: Response) => {
  await authService.logout(req.cookies?.[REFRESH_COOKIE]);
  clearRefreshCookie(res);
  res.status(204).send();
});
