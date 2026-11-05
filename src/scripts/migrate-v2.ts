/**
 * One-off, idempotent migration from the v1.0 schema (also safe to run on an earlier v2).
 *   - ExamAssignment -> ExamAccess (collection + `assignmentId` -> `accessId` on attempts)
 *   - `createdBy`/`assignedBy` -> `teacherId`; every existing record is owned by the oldest teacher account
 *   - question bank -> questions embedded in each exam (draft exams: from the bank; published/archived: from their frozen snapshot)
 *   - homework `tasks` -> embedded essay questions
 *   - drops the removed collections: activity log, templates, subjects, topics, question bank
 *   - syncs indexes (drops the old ones)
 * BACK UP THE DATABASE FIRST. Everyone must sign in again afterwards (new cookie names).
 */
import mongoose from 'mongoose';
import { connectDb } from '../config/db';

// Models must not auto-create (empty) collections before the renames below, or `examaccesses` would already exist.
mongoose.set('autoCreate', false);
mongoose.set('autoIndex', false);

type Doc = Record<string, any>; // raw v1 documents: their shape is exactly what we are migrating away from
const oid = () => new mongoose.Types.ObjectId();
const total = (qs: { points: number }[]) => Math.round(qs.reduce((s, q) => s + q.points, 0) * 100) / 100;
const fromBank = (q: Doc, points: number, topic?: string | null) => ({
  questionId: q._id ?? q.questionId, type: q.type, text: q.text, options: q.options ?? [], correctOptionIds: q.correctOptionIds ?? [], acceptedAnswers: q.acceptedAnswers ?? [],
  caseSensitive: !!q.caseSensitive, points, topic: topic ?? q.topicName ?? null, explanation: q.explanation ?? null, image: q.image ?? null,
});

async function main() {
  await connectDb();
  const db = mongoose.connection.db!;
  const has = async (name: string) => (await db.listCollections({ name }).toArray()).length > 0;
  const owner = await db.collection('users').findOne({ role: 'admin' }, { sort: { createdAt: 1 } });
  if (!owner) throw new Error('No teacher (admin) account found. Run seed:admin first.');
  console.log(`Owner of existing data: ${owner.email}`);

  // --- exam access + ownership ---
  if (await has('examassignments')) {
    if (await has('examaccesses')) {
      if (await db.collection('examaccesses').countDocuments()) throw new Error('Both examassignments and a non-empty examaccesses exist. Resolve manually before migrating.');
      await db.collection('examaccesses').drop(); // an empty leftover, e.g. created by starting the new API once
    }
    await db.collection('examassignments').rename('examaccesses'); console.log('renamed examassignments -> examaccesses');
  }
  const access = db.collection('examaccesses');
  await access.updateMany({ teacherId: { $exists: false } }, { $set: { teacherId: owner._id } });
  await access.updateMany({}, { $unset: { assignedBy: '' } });
  await db.collection('examattempts').updateMany({ assignmentId: { $exists: true } }, { $rename: { assignmentId: 'accessId' } });
  await db.collection('exams').updateMany({ createdBy: { $exists: true } }, { $rename: { createdBy: 'teacherId' } });
  for (const name of ['exams', 'studentprofiles', 'examattempts']) await db.collection(name).updateMany({ teacherId: { $exists: false } }, { $set: { teacherId: owner._id } });

  // --- question bank -> embedded questions ---
  const bank = new Map<string, Doc>(); const subjects = new Map<string, string>(); const topics = new Map<string, string>();
  if (await has('questions')) for await (const q of db.collection('questions').find()) bank.set(String(q._id), q);
  if (await has('subjects')) for await (const s of db.collection('subjects').find()) subjects.set(String(s._id), s.name);
  if (await has('topics')) for await (const t of db.collection('topics').find()) topics.set(String(t._id), t.name);
  let converted = 0;
  for await (const e of db.collection('exams').find({ $or: [{ items: { $exists: true } }, { snapshot: { $exists: true } }] })) {
    const snap: Doc[] = e.snapshot ?? [];
    const questions = snap.length
      ? snap.map((q) => fromBank(q, q.points, q.topicName))
      : (e.items ?? []).flatMap((it: Doc) => { const q = bank.get(String(it.questionId)); return q ? [fromBank(q, it.points ?? q.points, topics.get(String(q.topicId)))] : []; });
    const subject = snap[0]?.subjectName ?? subjects.get(String(bank.get(String(e.items?.[0]?.questionId))?.subjectId)) ?? 'General';
    await db.collection('exams').updateOne({ _id: e._id }, { $set: { questions, questionCount: questions.length, totalPoints: total(questions), subject }, $unset: { items: '', snapshot: '' } });
    converted++;
  }
  if (converted) console.log(`converted ${converted} exam(s) to embedded questions`);

  // --- homework: tasks -> embedded essay questions (only relevant if an earlier v2 was deployed) ---
  if (await has('assignments')) for await (const a of db.collection('assignments').find({ tasks: { $exists: true } })) {
    const map = new Map<string, mongoose.Types.ObjectId>();
    const questions = (a.tasks as Doc[]).map((t) => { const id = oid(); map.set(t.id, id); return { questionId: id, type: 'essay', text: t.prompt, options: [], correctOptionIds: [], acceptedAnswers: [], caseSensitive: false, points: t.points }; });
    await db.collection('assignments').updateOne({ _id: a._id }, { $set: { questions, questionCount: questions.length, totalPoints: total(questions), subject: 'General' }, $unset: { tasks: '' } });
    for await (const s of db.collection('assignmentsubmissions').find({ assignmentId: a._id })) {
      const answers = (s.answers ?? []).map((x: Doc) => ({ questionId: map.get(x.taskId) ?? oid(), response: x.response }));
      const grades = (s.grades ?? []).map((g: Doc) => ({ questionId: map.get(g.taskId) ?? oid(), points: g.points, isCorrect: null, needsReview: false, feedback: g.feedback ?? null }));
      await db.collection('assignmentsubmissions').updateOne({ _id: s._id }, { $set: { answers, grades } });
    }
  }

  for (const name of ['activitylogs', 'examtemplates', 'subjects', 'topics', 'questions']) if (await has(name)) { await db.collection(name).drop(); console.log(`dropped ${name}`); }
  await db.collection('users').updateMany({}, { $unset: { failedLogins: '' } });

  const [{ Exam }, { ExamAccess }, { ExamAttempt }, { StudentProfile }, { Assignment }, { AssignmentSubmission }, { RefreshToken }, { Notification }] = await Promise.all([
    import('../models/Exam'), import('../models/ExamAccess'), import('../models/ExamAttempt'), import('../models/StudentProfile'),
    import('../models/Assignment'), import('../models/AssignmentSubmission'), import('../models/RefreshToken'), import('../models/Notification'),
  ]);
  for (const m of [Exam, ExamAccess, ExamAttempt, StudentProfile, Assignment, AssignmentSubmission, RefreshToken, Notification]) {
    try { await m.syncIndexes(); } catch (e) { console.warn(`index sync problem on ${m.modelName}: ${(e as Error).message}`); }
  }
  console.log('Migration complete. All users must sign in again.');
  await mongoose.disconnect();
}
main().catch((e) => { console.error(e); process.exit(1); });
