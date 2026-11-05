import * as svc from '../services/attempt.service';
import { asyncHandler } from '../utils/asyncHandler';
import { pid } from '../utils/params';

export const start = asyncHandler(async (req, res) => { res.json(await svc.startAttempt(req.body.token, req.user!)); });
export const get = asyncHandler(async (req, res) => { res.json(await svc.getRunner(pid(req), req.user!)); });
export const autosave = asyncHandler(async (req, res) => { res.json(await svc.autosave(pid(req), req.user!, req.body.answers)); });
export const submit = asyncHandler(async (req, res) => { res.json(await svc.submit(pid(req), req.user!, req.body.answers)); });
export const result = asyncHandler(async (req, res) => { res.json(await svc.getResult(pid(req), req.user!)); });
