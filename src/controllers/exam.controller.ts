import * as svc from '../services/exam.service';
import { asyncHandler } from '../utils/asyncHandler';
import { pid } from '../utils/params';
import { ListExamsQuery } from '../validators/exams';

const me = (req: { user?: { id: string } }) => req.user!.id;
export const list = asyncHandler(async (req, res) => { res.json(await svc.listExams(me(req), req.query as unknown as ListExamsQuery)); });
export const create = asyncHandler(async (req, res) => { res.status(201).json({ exam: await svc.createExam(me(req), req.body) }); });
export const get = asyncHandler(async (req, res) => { res.json({ exam: await svc.getExamDetail(me(req), pid(req)) }); });
export const update = asyncHandler(async (req, res) => { res.json({ exam: await svc.updateExam(me(req), pid(req), req.body) }); });
export const publish = asyncHandler(async (req, res) => { res.json({ exam: await svc.publishExam(me(req), pid(req)) }); });
export const archive = asyncHandler(async (req, res) => { res.json({ exam: await svc.archiveExam(me(req), pid(req)) }); });
export const duplicate = asyncHandler(async (req, res) => { res.status(201).json({ exam: await svc.duplicateExam(me(req), pid(req)) }); });
export const remove = asyncHandler(async (req, res) => { await svc.deleteExam(me(req), pid(req)); res.status(204).end(); });
