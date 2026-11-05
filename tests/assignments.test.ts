import assert from 'node:assert/strict';
import { after, before, describe, it } from 'node:test';
import mongoose from 'mongoose';
import { essayQ, makeExam, makeStudent, makeTeacher, mcq, startApp, stopApp, toInput } from './helpers';

before(startApp); after(stopApp);
const short = (points = 5) => ({ type: 'short_answer', text: 'Capital of France?', acceptedAnswers: ['Paris'], points });
const body = (o: object = {}) => ({ title: 'Chapter 3 homework', questions: [essayQ('Summarise the chapter', 5), short(5)], ...o });
/** Correct answers for every question of an assignment as the student sees it. */
const answers = (a: any, right = true) => a.questions.map((q: any) => ({ questionId: q.questionId, response: q.type === 'essay' ? 'My summary of the chapter.' : q.type === 'short_answer' ? (right ? 'paris' : 'Rome') : q.options.length ? (right ? null : q.options[0].id) : null }));

describe('assignments (homework): independent from exams, with their own questions', () => {
  it('a teacher with NO exams can create, update and delete an assignment; schemas share no references', async () => {
    const t = await makeTeacher(); assert.equal((await t.c.get('/api/exams')).json.total, 0); const s = await makeStudent(t.c);
    const created = await t.c.post('/api/assignments', body({ studentIds: [s.id], publish: true })); assert.equal(created.status, 201); const a = created.json.assignment;
    assert.equal(a.status, 'published'); assert.equal(a.totalPoints, 10); assert.equal(a.questionCount, 2); assert.equal(a.questions.length, 2);
    assert.equal((await t.c.patch(`/api/assignments/${a.id}`, { title: 'Chapter 3 homework v2' })).json.assignment.title, 'Chapter 3 homework v2');
    assert.equal((await t.c.del(`/api/assignments/${a.id}`)).status, 204); assert.equal((await t.c.get(`/api/assignments/${a.id}`)).status, 404);
    const names = (m: string) => Object.keys(mongoose.models[m]!.schema.paths).join(' ').toLowerCase();
    for (const m of ['Assignment', 'AssignmentSubmission']) assert.ok(!/exam|qr|token/.test(names(m)), `${m} has no exam/QR fields`);
    for (const m of ['Exam', 'ExamAccess', 'ExamAttempt']) assert.ok(!/assignment/.test(names(m).replace('accessid', '')), `${m} has no assignment fields`);
  });

  it('an exam can exist without assignments, and deleting either never touches the other', async () => {
    const t = await makeTeacher(); const s = await makeStudent(t.c); const { exam } = await makeExam(t.c, { publish: true });
    const a = (await t.c.post('/api/assignments', body({ studentIds: [s.id], publish: true }))).json.assignment;
    assert.equal((await t.c.post(`/api/exams/${exam.id}/archive`)).status, 200); assert.equal((await t.c.del(`/api/exams/${exam.id}`)).status, 204);
    assert.equal((await t.c.get(`/api/assignments/${a.id}`)).json.assignment.status, 'published', 'assignment unaffected by exam deletion');
    const e2 = (await makeExam(t.c, { publish: true })).exam; assert.equal((await t.c.del(`/api/assignments/${a.id}`)).status, 204);
    assert.equal((await t.c.get(`/api/exams/${e2.id}`)).json.exam.status, 'published', 'exam unaffected by assignment deletion');
  });

  it('validation: questions, points, due date, recipients', async () => {
    const t = await makeTeacher(); const bad = (o: object) => t.c.post('/api/assignments', body(o));
    assert.equal((await bad({ questions: [] })).status, 400); assert.equal((await bad({ title: 'x' })).status, 400); assert.equal((await bad({ questions: [{ ...essayQ(), points: 101 }] })).status, 400);
    assert.equal((await bad({ questions: Array(51).fill(essayQ()) })).status, 400); assert.equal((await bad({ questions: [{ type: 'multiple_choice', text: 'q', points: 1, options: [{ text: 'a', isCorrect: true }, { text: 'b', isCorrect: true }] }] })).status, 400);
    assert.equal((await bad({ dueDate: '2001-01-01' })).status, 400); assert.equal((await bad({ dueDate: 'not-a-date' })).status, 400); assert.equal((await bad({ studentIds: ['nope'] })).status, 400);
    assert.equal((await bad({ publish: true })).status, 400, 'cannot publish with no recipients'); assert.equal((await bad({ questions: [{ ...essayQ(), text: '   ' }] })).status, 400);
  });

  it('student flow: drafts invisible, only recipients see it, no answers leak, auto-grading + manual essay grading', async () => {
    const t = await makeTeacher(); const s1 = await makeStudent(t.c), s2 = await makeStudent(t.c);
    const a = (await t.c.post('/api/assignments', body({ studentIds: [s1.id] }))).json.assignment;
    assert.deepEqual((await s1.c.get('/api/student/assignments')).json.items, [], 'drafts are not visible'); assert.equal((await s1.c.get(`/api/student/assignments/${a.id}`)).status, 404);
    assert.equal((await t.c.post(`/api/assignments/${a.id}/publish`)).status, 200);
    assert.equal((await s1.c.get('/api/student/assignments')).json.items.length, 1); assert.equal((await s2.c.get(`/api/student/assignments/${a.id}`)).status, 404, 'non-recipient');
    assert.equal((await s2.c.req('PUT', `/api/student/assignments/${a.id}/submission`, { answers: [] })).status, 404);
    const resp = await s1.c.get(`/api/student/assignments/${a.id}`); const mine = resp.json.assignment;
    assert.ok(!/acceptedAnswers|correctOptionIds|explanation|Paris/.test(resp.text), 'no answers sent to the student'); assert.equal(mine.submission, null);
    assert.equal((await s1.c.req('PUT', `/api/student/assignments/${a.id}/submission`, { answers: [{ questionId: 'a'.repeat(24), response: 'x' }] })).status, 400);
    assert.equal((await s1.c.req('PUT', `/api/student/assignments/${a.id}/submission`, { answers: answers(mine).slice(0, 1) })).status, 200);
    assert.equal((await s1.c.get(`/api/student/assignments/${a.id}`)).json.assignment.submission.status, 'draft');
    assert.equal((await t.c.get(`/api/assignments/${a.id}/submissions`)).json.items[0].submission, null, 'drafts are not shown to the teacher');
    assert.equal((await s1.c.post(`/api/student/assignments/${a.id}/submission/submit`, { answers: [{ questionId: mine.questions[0].questionId, response: '  ' }] })).status, 400, 'empty submit refused');
    const [x, y] = await Promise.all([1, 2].map(() => s1.c.post(`/api/student/assignments/${a.id}/submission/submit`, { answers: answers(mine) })));
    assert.deepEqual([x!.status, y!.status].sort(), [200, 409], 'double submit: exactly one wins');
    assert.equal((await s1.c.req('PUT', `/api/student/assignments/${a.id}/submission`, { answers: answers(mine) })).status, 409, 'cannot overwrite after submitting');
    const view = (await s1.c.get(`/api/student/assignments/${a.id}`)).json.assignment.submission; assert.equal(view.status, 'submitted', 'the essay still needs the teacher'); assert.ok(!('score' in view) && !('results' in view), 'nothing revealed before grading is finished');
    const sid = (await t.c.get(`/api/assignments/${a.id}/submissions`)).json.items.find((i: any) => i.submission).submission.id;
    const detail = (await t.c.get(`/api/assignments/${a.id}/submissions/${sid}`)).json.submission; const essay = detail.questions.find((q: any) => q.type === 'essay'); const sq = detail.questions.find((q: any) => q.type === 'short_answer');
    assert.equal(sq.pointsAwarded, 5); assert.equal(sq.isCorrect, true, 'short answer graded by the server'); assert.equal(essay.needsReview, true);
    assert.equal((await t.c.patch(`/api/assignments/${a.id}/submissions/${sid}/grade`, { grades: [{ questionId: essay.id, points: 6 }] })).status, 400, 'above max');
    assert.equal((await t.c.patch(`/api/assignments/${a.id}/submissions/${sid}/grade`, { grades: [{ questionId: 'b'.repeat(24), points: 1 }] })).status, 400, 'not part of the assignment');
    const full = await t.c.patch(`/api/assignments/${a.id}/submissions/${sid}/grade`, { grades: [{ questionId: essay.id, points: 4, feedback: 'Good' }], feedback: 'Nice work' });
    assert.equal(full.json.submission.status, 'graded'); assert.equal(full.json.submission.score, 9);
    const g = (await s1.c.get(`/api/student/assignments/${a.id}`)).json.assignment.submission; assert.equal(g.score, 9); assert.equal(g.feedback, 'Nice work'); assert.equal(g.results.find((r: any) => r.questionId === essay.id).feedback, 'Good');
    assert.equal((await t.c.patch(`/api/assignments/${a.id}`, { questions: [essayQ('new', 1)] })).status, 409, 'questions lock once work is submitted');
    assert.equal((await t.c.patch(`/api/assignments/${a.id}`, { studentIds: [s2.id] })).status, 409, 'cannot remove a student who has work');
    assert.equal((await t.c.del(`/api/students/${s1.id}`)).status, 409, 'students with work cannot be deleted');
  });

  it('an all-automatic assignment is graded the moment the student submits', async () => {
    const t = await makeTeacher(); const s = await makeStudent(t.c);
    const a = (await t.c.post('/api/assignments', body({ questions: [mcq('2+2?', { points: 2 }), { type: 'true_false', text: 'Sky is blue', correctAnswer: true, points: 1 }, short(2)], studentIds: [s.id], publish: true }))).json.assignment;
    const mine = (await s.c.get(`/api/student/assignments/${a.id}`)).json.assignment; const four = mine.questions[0].options.find((o: any) => o.text === '4').id;
    const ans = [{ questionId: mine.questions[0].questionId, response: four }, { questionId: mine.questions[1].questionId, response: 'false' }, { questionId: mine.questions[2].questionId, response: ' PARIS ' }];
    const r = await s.c.post(`/api/student/assignments/${a.id}/submission/submit`, { answers: ans }); assert.equal(r.status, 200);
    const sub = r.json.assignment.submission; assert.equal(sub.status, 'graded'); assert.equal(sub.score, 4, '2 + 0 + 2'); assert.equal(sub.maxScore, 5);
    assert.deepEqual(sub.results.map((x: any) => x.isCorrect), [true, false, true]); assert.ok(sub.results[0].correctOptionIds.length, 'answers revealed after grading');
    assert.equal((await t.c.get(`/api/assignments/${a.id}/submissions`)).json.items[0].submission.status, 'graded');
    const again = await s.c.req('PUT', `/api/student/assignments/${a.id}/submission`, { answers: [{ questionId: mine.questions[0].questionId, response: four }] }); assert.equal(again.status, 409, 'already submitted');
  });

  it('answers are checked against the real options', async () => {
    const t = await makeTeacher(); const s = await makeStudent(t.c);
    const a = (await t.c.post('/api/assignments', body({ questions: [mcq('2+2?')], studentIds: [s.id], publish: true }))).json.assignment;
    const q = (await s.c.get(`/api/student/assignments/${a.id}`)).json.assignment.questions[0];
    for (const response of ['not-an-option', ['x'], { $gt: '' }, 42]) assert.equal((await s.c.req('PUT', `/api/student/assignments/${a.id}/submission`, { answers: [{ questionId: q.questionId, response }] })).status, 400, JSON.stringify(response));
  });

  it('due dates: late work refused unless allowed; closed assignments accept nothing; cascade delete', async () => {
    const t = await makeTeacher(); const s = await makeStudent(t.c); const { Assignment } = await import('../src/models/Assignment'); const { AssignmentSubmission } = await import('../src/models/AssignmentSubmission');
    const strict = (await t.c.post('/api/assignments', body({ studentIds: [s.id], publish: true, dueDate: new Date(Date.now() + 60_000).toISOString() }))).json.assignment;
    const lenient = (await t.c.post('/api/assignments', body({ studentIds: [s.id], publish: true, allowLate: true, dueDate: new Date(Date.now() + 60_000).toISOString() }))).json.assignment;
    await Assignment.updateMany({ _id: { $in: [strict.id, lenient.id] } }, { dueDate: new Date(Date.now() - 1000) });
    const mine = (await s.c.get(`/api/student/assignments/${strict.id}`)).json.assignment;
    assert.equal((await s.c.post(`/api/student/assignments/${strict.id}/submission/submit`, { answers: answers(mine) })).code, 'DUE_PASSED');
    const l = (await s.c.get(`/api/student/assignments/${lenient.id}`)).json.assignment;
    assert.equal((await s.c.post(`/api/student/assignments/${lenient.id}/submission/submit`, { answers: answers(l) })).status, 200);
    assert.equal((await AssignmentSubmission.findOne({ assignmentId: lenient.id }))!.late, true);
    const open = (await t.c.post('/api/assignments', body({ studentIds: [s.id], publish: true }))).json.assignment;
    assert.equal((await t.c.post(`/api/assignments/${open.id}/close`)).status, 200);
    const closed = (await s.c.get(`/api/student/assignments/${open.id}`)).json.assignment; assert.equal(closed.status, 'closed', 'closed work stays visible, read-only');
    assert.equal((await s.c.post(`/api/student/assignments/${open.id}/submission/submit`, { answers: answers(closed) })).status, 409);
    assert.equal((await t.c.del(`/api/assignments/${lenient.id}`)).status, 204); assert.equal(await AssignmentSubmission.countDocuments({ assignmentId: lenient.id }), 0, 'submissions deleted with the assignment');
  });

  it('teacher B cannot read, change, grade, publish, close or delete teacher A\'s assignment', async () => {
    const A = await makeTeacher(), B = await makeTeacher(); const s = await makeStudent(A.c);
    const a = (await A.c.post('/api/assignments', body({ studentIds: [s.id], publish: true }))).json.assignment;
    for (const [m, p, b] of [['GET', `/api/assignments/${a.id}`], ['PATCH', `/api/assignments/${a.id}`, { title: 'Hijack' }], ['DELETE', `/api/assignments/${a.id}`], ['POST', `/api/assignments/${a.id}/publish`], ['POST', `/api/assignments/${a.id}/close`], ['GET', `/api/assignments/${a.id}/submissions`]] as const)
      assert.equal((await B.c.req(m, p, b ?? (m === 'POST' ? {} : undefined))).status, 404, `${m} ${p}`);
    assert.equal((await B.c.get('/api/assignments')).json.total, 0); assert.equal((await A.c.get(`/api/assignments/${a.id}`)).json.assignment.title, 'Chapter 3 homework');
    const edit = await A.c.patch(`/api/assignments/${a.id}`, { questions: a.questions.map(toInput).concat(essayQ('Extra', 1)) }); assert.equal(edit.status, 200); assert.equal(edit.json.assignment.questions[0].id, a.questions[0].id, 'ids kept on edit');
  });
});
