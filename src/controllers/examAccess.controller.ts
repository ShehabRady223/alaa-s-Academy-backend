import * as access from '../services/examAccess.service';
import * as att from '../services/attempt.service';
import { asyncHandler } from '../utils/asyncHandler';
import { pid } from '../utils/params';
import { ListAccessQuery } from '../validators/examAccess';

const me = (req: { user?: { id: string } }) => req.user!.id;
export const create = asyncHandler(async (req, res) => { res.status(201).json(await access.createAccess(me(req), req.body)); });
export const list = asyncHandler(async (req, res) => { res.json(await access.listAccess(me(req), req.query as unknown as ListAccessQuery)); });
export const get = asyncHandler(async (req, res) => { res.json({ access: await access.getAccess(me(req), pid(req)) }); });
export const revoke = asyncHandler(async (req, res) => { res.json({ access: await access.revokeAccess(me(req), pid(req)) }); });
export const regenerate = asyncHandler(async (req, res) => { res.json({ access: await access.regenerateQr(me(req), pid(req)) }); });
export const enter = asyncHandler(async (req, res) => { res.json(await att.accessInfo(req.body.token, req.user!)); });
