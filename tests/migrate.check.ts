import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import mongoose from 'mongoose';
const URI = `mongodb://127.0.0.1:27017/mig_${Date.now()}`;
(async () => {
  await mongoose.connect(URI); const db = mongoose.connection.db!; const oid = () => new mongoose.Types.ObjectId();
  const admin = oid(), stu = oid(), subj = oid(), topic = oid(), q1 = oid(), q2 = oid(), draft = oid(), pub = oid(), asg = oid(), att = oid(), hw = oid(), sub = oid(), t1 = 'aaaa1111';
  await db.collection('users').insertMany([{ _id: admin, name: 'Alaa', email: 'a@x.com', role: 'admin', createdAt: new Date('2025-01-01') }, { _id: stu, name: 'S', email: 's@x.com', role: 'student', createdAt: new Date('2025-02-01') }]);
  await db.collection('studentprofiles').insertOne({ userId: stu, status: 'active' });
  await db.collection('subjects').insertOne({ _id: subj, name: 'Mathematics' }); await db.collection('topics').insertOne({ _id: topic, subjectId: subj, name: 'Algebra' });
  const mc = (id: any, text: string) => ({ _id: id, text, type: 'multiple_choice', points: 2, createdBy: admin, subjectId: subj, topicId: topic, options: [{ id: 'a', text: '3' }, { id: 'b', text: '4' }], correctOptionIds: ['b'], acceptedAnswers: [], caseSensitive: false, difficulty: 'easy', explanation: 'because' });
  await db.collection('questions').insertMany([mc(q1, 'What is 2 + 2?'), mc(q2, 'Pick one')]);
  // a DRAFT exam references the bank; a PUBLISHED exam carries its own frozen snapshot
  await db.collection('exams').insertMany([
    { _id: draft, title: 'Draft', createdBy: admin, status: 'draft', items: [{ questionId: q1, points: 3 }, { questionId: q2, points: 1 }], snapshot: [] },
    { _id: pub, title: 'Published', createdBy: admin, status: 'published', items: [{ questionId: q1, points: 2 }], snapshot: [{ questionId: q1, type: 'multiple_choice', text: 'FROZEN text', options: [{ id: 'a', text: '3' }, { id: 'b', text: '4' }], correctOptionIds: ['b'], acceptedAnswers: [], caseSensitive: false, points: 2, subjectId: subj, topicId: topic, subjectName: 'Mathematics', topicName: 'Algebra', difficulty: 'easy' }] },
  ]);
  await db.collection('examassignments').insertOne({ _id: asg, examId: pub, studentId: stu, assignedBy: admin, tokenHash: 'h', tokenEnc: 'e', maxAttempts: 1, status: 'active' });
  await db.collection('examattempts').insertOne({ _id: att, assignmentId: asg, studentId: stu, examId: pub, attemptNumber: 1, status: 'graded', maxScore: 2 });
  // homework from an earlier v2: tasks + submissions keyed by taskId
  await db.collection('assignments').insertOne({ _id: hw, teacherId: admin, title: 'HW', tasks: [{ id: t1, prompt: 'Summarise', points: 5 }], studentIds: [stu], status: 'published' });
  await db.collection('assignmentsubmissions').insertOne({ _id: sub, assignmentId: hw, studentId: stu, teacherId: admin, status: 'graded', answers: [{ taskId: t1, response: 'my text' }], grades: [{ taskId: t1, points: 4, feedback: 'ok' }] });
  await db.collection('activitylogs').insertOne({ action: 'x' }); await db.collection('examtemplates').insertOne({ name: 't' });
  await mongoose.disconnect();

  const env = { ...process.env, MONGO_URI: URI, JWT_SECRET: 'x'.repeat(40), CLIENT_URL: 'http://localhost:5173', TOKEN_ENCRYPTION_KEY: 'ab'.repeat(32) };
  const run = () => execFileSync('npx', ['tsx', 'src/scripts/migrate-v2.ts'], { env, encoding: 'utf8' });
  console.log(run().split('\n').filter((l) => /renamed|dropped|converted|Owner|complete/.test(l)).join('\n'));
  console.log('2nd run:', run().split('\n').filter((l) => /complete|renamed|dropped|converted/.test(l)).join(' | '));

  await mongoose.connect(URI); const d = mongoose.connection.db!; const names = (await d.listCollections().toArray()).map((c) => c.name);
  for (const gone of ['examassignments', 'activitylogs', 'examtemplates', 'subjects', 'topics', 'questions']) assert.ok(!names.includes(gone), `${gone} should be gone (${names.join(',')})`);
  const acc = await d.collection('examaccesses').findOne({}); assert.equal(String(acc!.teacherId), String(admin)); assert.equal(acc!.tokenHash, 'h', 'existing QR tokens survive');
  const a = await d.collection('examattempts').findOne({}); assert.equal(String(a!.accessId), String(asg)); assert.equal(String(a!.teacherId), String(admin));
  const dEx = await d.collection('exams').findOne({ _id: draft }) as any; assert.equal(dEx.questions.length, 2); assert.equal(dEx.questions[0].text, 'What is 2 + 2?'); assert.equal(dEx.questions[0].points, 3, 'per-exam points kept');
  assert.equal(dEx.questions[0].topic, 'Algebra'); assert.equal(dEx.subject, 'Mathematics'); assert.equal(dEx.questionCount, 2); assert.equal(dEx.totalPoints, 4); assert.equal(dEx.items, undefined); assert.equal(dEx.snapshot, undefined); assert.equal(String(dEx.teacherId), String(admin));
  const pEx = await d.collection('exams').findOne({ _id: pub }) as any; assert.equal(pEx.questions[0].text, 'FROZEN text', 'published exams keep their frozen snapshot, not the later-edited bank'); assert.equal(pEx.subject, 'Mathematics'); assert.equal(pEx.questions[0].topic, 'Algebra');
  const h = await d.collection('assignments').findOne({}) as any; assert.equal(h.tasks, undefined); assert.equal(h.questions.length, 1); assert.equal(h.questions[0].type, 'essay'); assert.equal(h.totalPoints, 5);
  const s = await d.collection('assignmentsubmissions').findOne({}) as any; assert.equal(String(s.answers[0].questionId), String(h.questions[0].questionId)); assert.equal(s.answers[0].response, 'my text'); assert.equal(s.grades[0].points, 4); assert.equal(s.answers[0].taskId, undefined);
  console.log('MIGRATION CHECKS PASSED'); await d.dropDatabase(); await mongoose.disconnect();
})().catch((e) => { console.error('MIGRATION CHECK FAILED', e); process.exit(1); });
