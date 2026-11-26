import type { Request, Response } from 'express';
import * as programService from '../services/program.service.js';
import {
  parseAddProgramExerciseDto,
  parseCreateProgramDto,
  parseId,
  parseProgramListQuery,
  parsePublicProgramListQuery,
  parseReorderDto,
  parseShareProgramDto,
  parseUpdateProgramDto,
  parseUpdateProgramExerciseDto,
} from '../middlewares/validate.js';
import { asyncHandler } from '../lib/async-handler.js';

/**
 * HTTP-обработчики программ (docs/api.md §4).
 * userId берётся из access-токена (requireAuth); права доступа
 * (владелец / готовая read-only) проверяются в services.
 */

/** GET /api/programs — 200 + { data, meta }. */
export const list = asyncHandler(async (req: Request, res: Response) => {
  const query = parseProgramListQuery(req.query);
  const result = await programService.listPrograms(req.userId as number, query);
  res.status(200).json(result);
});

/** GET /api/programs/:id — 200 + программа с составом. */
export const get = asyncHandler(async (req: Request, res: Response) => {
  const id = parseId(req.params.id);
  const program = await programService.getProgram(req.userId as number, id);
  res.status(200).json(program);
});

/** POST /api/programs — 201 + созданная программа. */
export const create = asyncHandler(async (req: Request, res: Response) => {
  const dto = parseCreateProgramDto(req.body);
  const program = await programService.createProgram(req.userId as number, dto);
  res.status(201).json(program);
});

/** PUT /api/programs/:id — 200 + обновлённая программа. */
export const update = asyncHandler(async (req: Request, res: Response) => {
  const id = parseId(req.params.id);
  const dto = parseUpdateProgramDto(req.body);
  const program = await programService.updateProgram(req.userId as number, id, dto);
  res.status(200).json(program);
});

/** DELETE /api/programs/:id — 204 (soft delete). */
export const remove = asyncHandler(async (req: Request, res: Response) => {
  const id = parseId(req.params.id);
  await programService.deleteProgram(req.userId as number, id);
  res.status(204).send();
});

/** POST /api/programs/:id/copy — 201 + копия в аккаунте. */
export const copy = asyncHandler(async (req: Request, res: Response) => {
  const id = parseId(req.params.id);
  const program = await programService.copyProgram(req.userId as number, id);
  res.status(201).json(program);
});

/** POST /api/programs/:id/exercises — 201 + строка состава. */
export const addExercise = asyncHandler(async (req: Request, res: Response) => {
  const programId = parseId(req.params.id);
  const dto = parseAddProgramExerciseDto(req.body);
  const row = await programService.addProgramExercise(req.userId as number, programId, dto);
  res.status(201).json(row);
});

/** PUT /api/programs/:id/exercises/:programExerciseId — 200 + строка состава. */
export const updateExercise = asyncHandler(async (req: Request, res: Response) => {
  const programId = parseId(req.params.id);
  const peId = parseId(req.params.programExerciseId);
  const dto = parseUpdateProgramExerciseDto(req.body);
  const row = await programService.updateProgramExercise(req.userId as number, programId, peId, dto);
  res.status(200).json(row);
});

/** PUT /api/programs/:id/exercises/order — 200 + программа с новым порядком. */
export const reorderExercises = asyncHandler(async (req: Request, res: Response) => {
  const programId = parseId(req.params.id);
  const dto = parseReorderDto(req.body);
  const program = await programService.reorderProgramExercises(req.userId as number, programId, dto);
  res.status(200).json(program);
});

// ─── Этап 5: публичная библиотека и отправка программ ───

/** GET /api/programs/public — 200 + { data, meta } публичной библиотеки. */
export const listPublic = asyncHandler(async (req: Request, res: Response) => {
  const query = parsePublicProgramListQuery(req.query);
  const result = await programService.listPublicPrograms(query);
  res.status(200).json(result);
});

/** POST /api/programs/:id/share — 201 + созданная передача. */
export const share = asyncHandler(async (req: Request, res: Response) => {
  const id = parseId(req.params.id);
  const dto = parseShareProgramDto(req.body);
  const created = await programService.shareProgram(req.userId as number, id, dto);
  res.status(201).json(created);
});

/** GET /api/programs/shares/incoming — 200 + полученные программы. */
export const incomingShares = asyncHandler(async (req: Request, res: Response) => {
  const rows = await programService.listIncomingShares(req.userId as number);
  res.status(200).json({ data: rows });
});

/** GET /api/programs/shares/outgoing — 200 + отправленные программы. */
export const outgoingShares = asyncHandler(async (req: Request, res: Response) => {
  const rows = await programService.listOutgoingShares(req.userId as number);
  res.status(200).json({ data: rows });
});

/** GET /api/programs/shares/:shareId — 200 + полученная программа с составом. */
export const getShare = asyncHandler(async (req: Request, res: Response) => {
  const shareId = parseId(req.params.shareId);
  const detail = await programService.getIncomingShare(req.userId as number, shareId);
  res.status(200).json(detail);
});

/** POST /api/programs/shares/:shareId/save — 201 + независимая копия. */
export const saveShare = asyncHandler(async (req: Request, res: Response) => {
  const shareId = parseId(req.params.shareId);
  const copy = await programService.saveSharedProgram(req.userId as number, shareId);
  res.status(201).json(copy);
});

/** DELETE /api/programs/shares/:shareId — 204. */
export const deleteShare = asyncHandler(async (req: Request, res: Response) => {
  const shareId = parseId(req.params.shareId);
  await programService.deleteIncomingShare(req.userId as number, shareId);
  res.status(204).send();
});

/** DELETE /api/programs/:id/exercises/:programExerciseId — 204. */
export const removeExercise = asyncHandler(async (req: Request, res: Response) => {
  const programId = parseId(req.params.id);
  const peId = parseId(req.params.programExerciseId);
  await programService.removeProgramExercise(req.userId as number, programId, peId);
  res.status(204).send();
});
