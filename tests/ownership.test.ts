import assert from 'node:assert/strict';
import { after, before, describe, it } from 'node:test';
import { Client, essayQ, makeExam, makeStudent, makeTeacher, startApp, stopApp, toInput } from './helpers';

before(startApp); after(stopApp);

describe('teacher isolation (IDOR / BOLA) and student access control', () => {
  it('teacher B cannot see, change, publish, archive, duplicate or delete teacher A\'s exam', async () => {
    const A = await makeTeacher('A'), B = await makeTeacher('B'); const { exam } = await makeExam(A.c);
    for (const [m, p, b] of [['GET', `/api/exams/${exam.id}`], ['PATCH', `/api/exams/${exam.id}`, { title: 'Hijacked' }], ['DELETE', `/api/exams/${exam.id}`], ['POST', `/api/exams/${exam.id}/publish`], ['POST', `/api/exams/${exam.id}/archive`], ['POST', `/api/exams/${exam.id}/duplicate`]] as const) {
      const r = await B.c.req(m, p, b ?? (m === 'POST' ? {} : undefined)); assert.equal(r.status, 404, `${m} ${p} -> ${r.status}`);
    }
    assert.equal((await B.c.get('/api/exams')).json.total, 0); assert.equal((await A.c.get(`/api/exams/${exam.id}`)).json.exam.title, exam.title, 'A\'s exam untouched');
  });

  it('questions live inside their exam: another teacher cannot read them and cannot smuggle in their ids; the bank is gone', async () => {
    const A = await makeTeacher(), B = await makeTeacher(); const { exam, q1 } = await makeExam(A.c);
    assert.equal((await B.c.get(`/api/exams/${exam.id}`)).status, 404);
    const own = (await B.c.post('/api/exams', { title: 'Mine', questions: [toInput(q1)] })).json.exam; // B reuses A's question id
    assert.notEqual(own.questions[0].id, q1.id, 'a foreign id is replaced by a fresh server-side id');
    const upd = await B.c.patch(`/api/exams/${own.id}`, { questions: [toInput(own.questions[0]), toInput(q1)] });
    assert.equal(upd.json.exam.questions[0].id, own.questions[0].id, 'own ids are kept across edits'); assert.notEqual(upd.json.exam.questions[1].id, q1.id);
    for (const p of ['/api/questions', '/api/subjects', '/api/topics']) assert.equal((await B.c.get(p)).status, 404, p);
  });

  it('students are private to their teacher: no read, edit, delete, invite or assignment by another teacher', async () => {
    const A = await makeTeacher(), B = await makeTeacher(); const s = await makeStudent(A.c);
    for (const [m, p, b] of [['GET', `/api/students/${s.id}`], ['PATCH', `/api/students/${s.id}`, { name: 'Zed Zed' }], ['DELETE', `/api/students/${s.id}`], ['POST', `/api/students/${s.id}/resend-invite`], ['GET', `/api/analytics/students/${s.id}`], ['GET', `/api/reports/students/${s.id}/pdf`]] as const)
      assert.equal((await B.c.req(m, p, b ?? (m === 'POST' ? {} : undefined))).status, 404, `${m} ${p}`);
    assert.equal((await B.c.get('/api/students')).json.total, 0);
    const { exam } = await makeExam(B.c, { publish: true });
    const r = await B.c.post('/api/exam-access', { examId: exam.id, studentIds: [s.id] }); assert.equal(r.json.created.length, 0); assert.equal(r.json.skipped[0].reason, 'Student not found');
    const hw = await B.c.post('/api/assignments', { title: 'HW', questions: [essayQ('p', 1)], studentIds: [s.id] }); assert.equal(hw.status, 400, 'cannot send homework to another teacher\'s student');
  });

  it('exam access, QR codes, results and grading are isolated; a student cannot use someone else\'s QR', async () => {
    const A = await makeTeacher(), B = await makeTeacher(); const s1 = await makeStudent(A.c), s2 = await makeStudent(A.c);
    const { exam, q1 } = await makeExam(A.c, { publish: true, essay: true });
    const created = (await A.c.post('/api/exam-access', { examId: exam.id, studentIds: [s1.id, s2.id] })).json.created;
    const acc1 = created.find((x: any) => x.student.id === s1.id), acc2 = created.find((x: any) => x.student.id === s2.id);
    assert.equal((await B.c.get(`/api/exam-access/${acc1.id}`)).status, 404); assert.equal((await B.c.get(`/api/qr/${acc1.id}`)).status, 404);
    assert.equal((await B.c.get(`/api/qr/${acc1.id}/link`)).status, 404); assert.equal((await B.c.post(`/api/exam-access/${acc1.id}/revoke`)).status, 404);
    assert.equal((await B.c.get('/api/exam-access')).json.total, 0);
    const url = (await A.c.get(`/api/qr/${acc1.id}/link`)).json.url as string; const token = url.split('/').pop()!;
    assert.equal((await s2.c.post('/api/exam-access/enter', { token })).code, 'NOT_YOUR_EXAM', 'student 2 cannot use student 1\'s QR');
    assert.equal((await A.c.post('/api/exam-access/enter', { token })).status, 403, 'teachers cannot enter exams');
    const info = await s1.c.post('/api/exam-access/enter', { token }); assert.equal(info.status, 200);
    const run = await s1.c.post('/api/attempts/start', { token }); assert.equal(run.status, 200);
    assert.ok(!JSON.stringify(run.json).includes('correctOptionIds') && !JSON.stringify(run.json).includes('explanation'), 'no answers sent to the student');
    const att = run.json.attemptId; const choice = run.json.questions.find((q: any) => q.options.length);
    const wrongOpt = choice.options[0].id;
    await s1.c.req('PATCH', `/api/attempts/${att}/autosave`, { answers: [{ questionId: choice.questionId, response: wrongOpt }] });
    assert.equal((await s2.c.get(`/api/attempts/${att}`)).status, 404, 'student 2 cannot read student 1\'s attempt');
    assert.equal((await s2.c.post(`/api/attempts/${att}/submit`, {})).status, 404);
    assert.equal((await s1.c.post(`/api/attempts/${att}/submit`, { answers: [{ questionId: choice.questionId, response: wrongOpt }, ...run.json.questions.filter((q: any) => !q.options.length).map((q: any) => ({ questionId: q.questionId, response: 'An essay.' }))] })).status, 200);
    const res = (await A.c.get('/api/results')).json; assert.equal(res.total, 1); const rid = res.items[0].id; assert.equal(res.items[0].status, 'pending_review');
    assert.equal((await B.c.get('/api/results')).json.total, 0); assert.equal((await B.c.get(`/api/results/${rid}`)).status, 404);
    assert.equal((await B.c.patch(`/api/results/${rid}/grade`, { grades: [{ questionId: q1.id, points: 2 }] })).status, 404);
    assert.equal((await B.c.post(`/api/results/${rid}/release`)).status, 404);
    assert.equal((await B.c.post('/api/results/release', { examId: exam.id })).status, 404);
    assert.equal((await s1.c.get(`/api/attempts/${att}/result`)).json.result.released, false, 'unreleased result stays hidden from the student');
    assert.equal((await s1.c.get('/api/results')).status, 403); assert.equal((await s1.c.get('/api/exams')).status, 403); assert.equal((await s1.c.get('/api/students')).status, 403);
    assert.equal(acc2.student.id, s2.id);
  });

  it('students cannot reach any teacher endpoint; anonymous users reach none', async () => {
    const t = await makeTeacher(); const s = await makeStudent(t.c);
    for (const p of ['/api/students', '/api/exams', '/api/assignments', '/api/exam-access', '/api/results', '/api/dashboard/admin', '/api/analytics/topics', '/api/reports/results.csv', '/api/settings', '/api/notifications']) {
      assert.equal((await s.c.get(p)).status, 403, `student ${p}`); assert.equal((await new Client().get(p)).status, 401, `anon ${p}`);
    }
    assert.equal((await t.c.get('/api/student/assignments')).status, 403, 'teachers cannot use student endpoints');
  });

  it('mass assignment: ownership and role cannot be set from the request body', async () => {
    const A = await makeTeacher(), B = await makeTeacher();
    const r = await A.c.post('/api/students', { name: 'Eve Eve', email: `eve${Date.now()}@example.com`, teacherId: B.id, role: 'admin', status: 'active' });
    assert.equal(r.status, 201); assert.equal(r.json.student.profile.status, 'invited');
    assert.equal((await A.c.get(`/api/students/${r.json.student.id}`)).status, 200); assert.equal((await B.c.get(`/api/students/${r.json.student.id}`)).status, 404);
    const { User } = await import('../src/models/User'); assert.equal((await User.findById(r.json.student.id))!.role, 'student');
    const e = await A.c.post('/api/exams', { title: 'Mass', teacherId: B.id, status: 'published' }); assert.equal(e.status, 201);
    assert.equal((await B.c.get(`/api/exams/${e.json.exam.id}`)).status, 404); assert.equal(e.json.exam.status, 'draft');
  });
});
