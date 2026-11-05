import { escapeRegex } from '../utils/regex';
import { ExamAccess } from '../models/ExamAccess';
import { ExamAttempt } from '../models/ExamAttempt';
import { Assignment } from '../models/Assignment';
import { AssignmentSubmission } from '../models/AssignmentSubmission';
import { StudentProfile } from '../models/StudentProfile';
import { User } from '../models/User';
import { ListStudentsQuery } from '../validators/students';
import { conflict, notFound } from '../utils/errors';
import { revokeAllSessions, sendInvite } from './auth.service';

type CreateInput = { name: string; email: string; phone?: string; dateOfBirth?: Date; level?: string; notes?: string };
const profileView = (p: { phone?: string | null; level?: string | null; notes?: string | null; dateOfBirth?: Date | null; status: string; lastActiveAt?: Date | null }) =>
  ({ phone: p.phone, level: p.level, notes: p.notes, dateOfBirth: p.dateOfBirth, status: p.status, lastActiveAt: p.lastActiveAt });

/** Students belong to the teacher who created them. Every lookup requires `teacherId`, so ids of other teachers' students 404. */
async function ownedProfile(tid: string, id: string) {
  const profile = await StudentProfile.findOne({ userId: id, teacherId: tid });
  if (!profile) throw notFound('Student not found');
  return profile;
}

export async function createStudent(tid: string, input: CreateInput) {
  if (await User.exists({ email: input.email })) throw conflict('A user with this email already exists');
  const user = await User.create({ name: input.name, email: input.email, role: 'student' });
  try {
    await StudentProfile.create({ userId: user._id, teacherId: tid, phone: input.phone, dateOfBirth: input.dateOfBirth, level: input.level, notes: input.notes });
  } catch (e) {
    await User.deleteOne({ _id: user._id }); // manual rollback keeps this working without a replica set
    throw e;
  }
  const invite = await sendInvite({ id: user.id, name: user.name, email: user.email });
  return { student: await getStudent(tid, user.id), inviteLink: invite.link, emailed: invite.emailed };
}

/** Three simple queries (no $lookup/$facet): portable, index-friendly, no N+1. */
export async function listStudents(tid: string, q: ListStudentsQuery) {
  const profilesFilter: Record<string, unknown> = { teacherId: tid, ...(q.status ? { status: q.status } : {}) };
  const ids = await StudentProfile.distinct('userId', profilesFilter);
  const rx = q.search ? new RegExp(escapeRegex(q.search), 'i') : null;
  const userFilter = { _id: { $in: ids }, role: 'student', ...(rx ? { $or: [{ name: rx }, { email: rx }] } : {}) };
  const sort = { [q.sortBy]: q.order === 'asc' ? 1 : -1, _id: 1 } as const;
  const [users, total] = await Promise.all([
    User.find(userFilter).sort(sort).skip((q.page - 1) * q.limit).limit(q.limit).lean(),
    User.countDocuments(userFilter),
  ]);
  const pageIds = users.map((u) => u._id);
  const [profiles, attempts] = await Promise.all([
    StudentProfile.find({ userId: { $in: pageIds } }).lean(),
    ExamAttempt.find({ studentId: { $in: pageIds }, teacherId: tid, status: { $in: ['graded', 'pending_review'] } }).select('studentId examId status percentage').lean(),
  ]);
  const pMap = new Map(profiles.map((p) => [String(p.userId), p]));
  const stats = new Map<string, { exams: Set<string>; sum: number; n: number }>();
  for (const a of attempts) {
    const s = stats.get(String(a.studentId)) ?? { exams: new Set<string>(), sum: 0, n: 0 };
    s.exams.add(String(a.examId));
    if (a.status === 'graded' && a.percentage != null) { s.sum += a.percentage; s.n++; }
    stats.set(String(a.studentId), s);
  }
  const items = users.flatMap((u) => {
    const p = pMap.get(String(u._id)); if (!p) return [];
    const st = stats.get(String(u._id));
    return [{ id: String(u._id), name: u.name, email: u.email, createdAt: u.createdAt, profile: profileView(p), examsTaken: st?.exams.size ?? 0, averageScore: st && st.n ? Math.round((st.sum / st.n) * 10) / 10 : null }];
  });
  return { items, page: q.page, limit: q.limit, total, totalPages: Math.ceil(total / q.limit) };
}

export async function getStudent(tid: string, id: string) {
  const p = await ownedProfile(tid, id);
  const u = await User.findById(id).lean();
  if (!u) throw notFound('Student not found');
  return { id: String(u._id), name: u.name, email: u.email, createdAt: u.createdAt, profile: profileView(p) };
}

type UpdateInput = Partial<CreateInput> & { status?: 'active' | 'disabled' };
export async function updateStudent(tid: string, id: string, input: UpdateInput) {
  const profile = await ownedProfile(tid, id);
  const user = await User.findById(id);
  if (!user) throw notFound('Student not found');
  if (input.email && input.email !== user.email) {
    if (await User.exists({ email: input.email, _id: { $ne: user._id } })) throw conflict('A user with this email already exists');
    user.email = input.email;
  }
  if (input.name) user.name = input.name;
  await user.save();
  const { name: _n, email: _e, status, ...fields } = input;
  Object.assign(profile, fields);
  // An invited student becomes active only by setting their own password.
  if (status === 'disabled' || (status === 'active' && profile.status === 'disabled')) profile.status = status;
  await profile.save();
  if (status === 'disabled') await revokeAllSessions(id); // cut off refresh immediately
  return getStudent(tid, id);
}

export async function resendInvite(tid: string, id: string) {
  const s = await getStudent(tid, id);
  if (s.profile.status === 'disabled') throw conflict('Student is disabled');
  const invite = await sendInvite({ id, name: s.name, email: s.email });
  return { inviteLink: invite.link, emailed: invite.emailed };
}

export async function deleteStudent(tid: string, id: string) {
  await ownedProfile(tid, id);
  if ((await ExamAttempt.exists({ studentId: id })) || (await AssignmentSubmission.exists({ studentId: id }))) {
    throw conflict('This student has exam or assignment history. Disable the account instead of deleting it.');
  }
  await revokeAllSessions(id);
  await Promise.all([
    ExamAccess.deleteMany({ studentId: id }),
    Assignment.updateMany({ studentIds: id }, { $pull: { studentIds: id } }),
    StudentProfile.deleteOne({ userId: id, teacherId: tid }),
    User.deleteOne({ _id: id, role: 'student' }),
  ]);
}
