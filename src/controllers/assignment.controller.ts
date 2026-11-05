import * as svc from '../services/assignment.service';
import { asyncHandler } from '../utils/asyncHandler';
import { pid } from '../utils/params';
import { ListAssignmentsQuery } from '../validators/assignments';

const me = (req: { user?: { id: string } }) => req.user!.id;
// teacher
export const create = asyncHandler(async (req, res) => { res.status(201).json({ assignment: await svc.createAssignment(me(req), req.body) }); });
export const list = asyncHandler(async (req, res) => { res.json(await svc.listAssignments(me(req), req.query as unknown as ListAssignmentsQuery)); });
export const get = asyncHandler(async (req, res) => { res.json({ assignment: await svc.getAssignment(me(req), pid(req)) }); });
export const update = asyncHandler(async (req, res) => { res.json({ assignment: await svc.updateAssignment(me(req), pid(req), req.body) }); });
export const publish = asyncHandler(async (req, res) => { res.json({ assignment: await svc.publishAssignment(me(req), pid(req)) }); });
export const close = asyncHandler(async (req, res) => { res.json({ assignment: await svc.closeAssignment(me(req), pid(req)) }); });
export const remove = asyncHandler(async (req, res) => { await svc.deleteAssignment(me(req), pid(req)); res.status(204).end(); });
export const submissions = asyncHandler(async (req, res) => { res.json(await svc.listSubmissions(me(req), pid(req))); });
export const submission = asyncHandler(async (req, res) => { res.json({ submission: await svc.getSubmission(me(req), pid(req), pid(req, 'sid')) }); });
export const grade = asyncHandler(async (req, res) => { res.json({ submission: await svc.gradeSubmission(me(req), pid(req), pid(req, 'sid'), req.body) }); });
// student
export const mine = asyncHandler(async (req, res) => { res.json({ items: await svc.listMine(me(req)) }); });
export const mineOne = asyncHandler(async (req, res) => { res.json({ assignment: await svc.getMine(me(req), pid(req)) }); });
export const saveDraft = asyncHandler(async (req, res) => { res.json(await svc.saveDraft(me(req), pid(req), req.body.answers)); });
export const submit = asyncHandler(async (req, res) => { res.json({ assignment: await svc.submitMine(me(req), pid(req), req.body.answers) }); });
