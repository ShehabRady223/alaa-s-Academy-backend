import * as students from '../services/student.service';
import { asyncHandler } from '../utils/asyncHandler';
import { pid } from '../utils/params';
import { ListStudentsQuery } from '../validators/students';

const me = (req: { user?: { id: string } }) => req.user!.id;
export const create = asyncHandler(async (req, res) => { res.status(201).json(await students.createStudent(me(req), req.body)); });
export const list = asyncHandler(async (req, res) => { res.json(await students.listStudents(me(req), req.query as unknown as ListStudentsQuery)); });
export const get = asyncHandler(async (req, res) => { res.json({ student: await students.getStudent(me(req), pid(req)) }); });
export const update = asyncHandler(async (req, res) => { res.json({ student: await students.updateStudent(me(req), pid(req), req.body) }); });
export const resendInvite = asyncHandler(async (req, res) => { res.json(await students.resendInvite(me(req), pid(req))); });
export const remove = asyncHandler(async (req, res) => { await students.deleteStudent(me(req), pid(req)); res.status(204).end(); });
