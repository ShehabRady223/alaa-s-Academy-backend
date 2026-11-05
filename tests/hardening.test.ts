import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { after, before, describe, it } from 'node:test';
import mongoose from 'mongoose';
import { Client, makeExam, makeStudent, makeTeacher, mcq, startApp, stopApp } from './helpers';

before(startApp); after(stopApp);

describe('removed features', () => {
  it('Activity log, Templates and the Question bank are gone: no routes, no collections, no code', async () => {
    const t = await makeTeacher(); const { exam } = await makeExam(t.c, { publish: true }); const s = await makeStudent(t.c);
    await t.c.post('/api/exam-access', { examId: exam.id, studentIds: [s.id] });
    for (const [m, p] of [['GET', '/api/audit-logs'], ['GET', '/api/templates'], ['POST', '/api/exams/from-template'], ['POST', `/api/exams/${exam.id}/save-as-template`], ['GET', '/api/questions'], ['GET', '/api/subjects'], ['GET', '/api/topics'], ['POST', '/api/questions'], ['GET', '/api/assignments-legacy']] as const) assert.equal((await t.c.req(m, p, m === 'POST' ? {} : undefined)).status, 404, p);
    const names = (await mongoose.connection.db!.listCollections().toArray()).map((c) => c.name);
    for (const gone of ['activitylogs', 'examtemplates', 'examassignments', 'subjects', 'topics', 'questions']) assert.ok(!names.includes(gone), `${gone} must not exist (${names.join(',')})`);
    const walk = (d: string): string[] => fs.readdirSync(d, { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? walk(path.join(d, e.name)) : [path.join(d, e.name)]));
    const hits = walk(path.join(__dirname, '../src')).filter((f) => /ActivityLog|logActivity|activity\.service|ExamTemplate|from-template|save-as-template|models\/(Question|Subject|Topic)'|question\.service|taxonomy/.test(fs.readFileSync(f, 'utf8')) && !f.includes('migrate-v2'));
    assert.deepEqual(hits, [], 'no source references');
  });
});

describe('input validation, injection and information leakage', () => {
  it('NoSQL operator injection is rejected or neutralised', async () => {
    const t = await makeTeacher();
    assert.equal((await new Client().post('/api/auth/login', { email: { $gt: '' }, password: { $gt: '' } })).status, 400);
    assert.equal((await new Client().post('/api/auth/login', { email: t.email, password: { $ne: 'x' } })).status, 400);
    assert.equal((await t.c.get('/api/students?status[$ne]=active')).status, 400); assert.equal((await t.c.get('/api/exams?search[$regex]=.*')).status, 400, 'operator objects are rejected, never executed');
    assert.equal((await t.c.get('/api/exams?status=draft%27%7C%7C1')).status, 400);
    assert.equal((await t.c.post('/api/students', { name: 'Op Test', email: 'op@example.com', notes: { $gt: '' } })).status, 400);
  });
  it('malformed ids, JSON, content and oversized bodies give clean 4xx JSON (never 500 / stack traces)', async () => {
    const t = await makeTeacher();
    for (const p of ['/api/exams/not-an-id', '/api/students/%00', '/api/assignments/xyz']) { const r = await t.c.get(p); assert.equal(r.status, 400, p); assert.ok(r.json.error.code && !/at .*\.ts|node_modules/.test(r.text)); }
    const broken = await t.c.req('POST', '/api/exams', '{"title": '); assert.equal(broken.status, 400); assert.equal(broken.code, 'BAD_REQUEST'); assert.ok(!/SyntaxError|at /.test(broken.text), 'no parser details leaked');
    const big = await t.c.post('/api/exams', { title: 'x'.repeat(200_000) }); assert.equal(big.status, 413, 'oversize body');
    assert.ok(!/stack|node_modules/.test(big.text));
  });
  it('regex injection in search cannot hang or match everything', async () => {
    const t = await makeTeacher(); await makeExam(t.c); const t0 = Date.now();
    const r = await t.c.get('/api/exams?search=' + encodeURIComponent('(a+)+$')); assert.equal(r.status, 200); assert.equal(r.json.total, 0); assert.ok(Date.now() - t0 < 2000);
    assert.equal((await t.c.get('/api/exams?search=' + encodeURIComponent('.*'))).json.total, 0, '".*" is matched literally');
  });
  it('student, question, exam and attempt inputs are bounds-checked', async () => {
    const t = await makeTeacher(); const { exam } = await makeExam(t.c, { publish: true }); const post = (p: string, b: object) => t.c.post(p, b);
    const asExam = (q: object) => post('/api/exams', { title: 'Ok title', questions: [q] });
    for (const [label, over] of [['two correct', { options: [{ text: 'a', isCorrect: true }, { text: 'b', isCorrect: true }] }], ['no correct', { options: [{ text: 'a', isCorrect: false }, { text: 'b', isCorrect: false }] }], ['js url', { image: 'javascript:alert(1)' }], ['points 0', { points: 0 }], ['points 1000', { points: 1000 }], ['9 options', { options: Array.from({ length: 9 }, (_, i) => ({ text: 'o' + i, isCorrect: i === 0 })) }], ['dup options', { options: [{ text: 'a', isCorrect: true }, { text: 'A', isCorrect: false }] }], ['bad type', { type: 'script' }], ['huge text', { text: 'x'.repeat(5001) }], ['long topic', { topic: 't'.repeat(81) }], ['bad id', { id: 'nope' }]] as const)
      assert.equal((await asExam({ ...mcq(), ...over })).status, 400, label);
    assert.equal((await asExam({ ...mcq(), isAdmin: true, teacherId: 'x' })).status, 201, 'unknown fields are ignored, not stored');
    assert.equal((await post('/api/exams', { title: 'Too many', questions: Array(201).fill(mcq()) })).status, 400, 'at most 200 questions');
    for (const b of [{ name: 'A', email: 'a@example.com' }, { name: 'Valid Name', email: 'not-an-email' }, { name: 'Valid Name', email: 'v@example.com', phone: 'x'.repeat(31) }, { name: 'Valid Name', email: 'v@example.com', dateOfBirth: 'yesterday' }, { name: 'Valid Name', email: 'v@example.com', notes: 'n'.repeat(2001) }]) assert.equal((await post('/api/students', b)).status, 400, JSON.stringify(b).slice(0, 60));
    for (const b of [{ title: 'T' }, { title: 'Ok title', passingScore: 101 }, { title: 'Ok title', durationMinutes: 0 }, { title: 'Ok title', maxAttempts: 11 }, { title: 'Ok title', startDate: '2030-01-02', expiresAt: '2030-01-01' }]) assert.equal((await post('/api/exams', b)).status, 400, JSON.stringify(b));
    assert.equal((await post('/api/exam-access', { examId: exam.id, studentIds: [] })).status, 400); assert.equal((await post('/api/exam-access', { examId: exam.id, studentIds: ['a'.repeat(24), 'a'.repeat(24)] })).status, 400, 'duplicates');
    const s = await makeStudent(t.c); const acc = (await post('/api/exam-access', { examId: exam.id, studentIds: [s.id] })).json.created[0]; const tok = (await t.c.get(`/api/qr/${acc.id}/link`)).json.url.split('/').pop();
    const run = (await s.c.post('/api/attempts/start', { token: tok })).json; const qid = run.questions[0].questionId;
    for (const r of [{ $gt: '' }, 'zzz', ['x'], 42]) assert.equal((await s.c.req('PATCH', `/api/attempts/${run.attemptId}/autosave`, { answers: [{ questionId: qid, response: r }] })).status, 400, JSON.stringify(r));
    assert.equal((await s.c.req('PATCH', `/api/attempts/${run.attemptId}/autosave`, { answers: [{ questionId: 'a'.repeat(24), response: null }] })).status, 400, 'question not in this attempt');
    assert.equal((await s.c.post('/api/exam-access/enter', { token: 'x' })).status, 400);
  });
  it('error format is consistent; security headers are present; CORS does not allow other origins', async () => {
    const t = await makeTeacher(); const r = await t.c.get('/api/nothing-here');
    assert.equal(r.status, 404); assert.deepEqual(Object.keys(r.json), ['error']); assert.ok(r.json.error.code && r.json.error.message);
    const h = (await t.c.get('/api/students')).headers; assert.equal(h.get('x-content-type-options'), 'nosniff'); assert.equal(h.get('x-powered-by'), null); assert.match(h.get('cache-control')!, /no-store/); assert.ok(h.get('strict-transport-security')); assert.ok(h.get('x-frame-options') || h.get('content-security-policy'));
    const evil = new Client('https://evil.example'); const e = await evil.get('/api/health'); assert.equal(e.headers.get('access-control-allow-origin'), 'http://localhost:5173', 'only the app origin is ever allowed'); assert.notEqual(e.headers.get('access-control-allow-origin'), '*'); assert.equal(e.headers.get('access-control-allow-credentials'), 'true');
    const ok = await new Client().get('/api/health'); assert.equal(ok.status, 200);
    const v = await t.c.post('/api/students', { name: 'x' }); assert.equal(v.status, 400); assert.ok(Array.isArray(v.json.error.details) && v.json.error.details[0].path);
  });
  it('API never returns secrets: no password hashes, token hashes or encrypted tokens', async () => {
    const t = await makeTeacher(); const s = await makeStudent(t.c); const { exam } = await makeExam(t.c, { publish: true });
    const blob = [(await t.c.get('/api/students')).text, (await t.c.get(`/api/students/${s.id}`)).text, (await t.c.get('/api/auth/me')).text, (await t.c.post('/api/exam-access', { examId: exam.id, studentIds: [s.id] })).text, (await t.c.get('/api/exam-access')).text].join('');
    assert.ok(!/passwordHash|tokenHash|tokenEnc|\$argon2/.test(blob));
  });
});
