import argon2 from 'argon2';
import jwt from 'jsonwebtoken';
import type { Server } from 'http';
import mongoose from 'mongoose';

process.env.NODE_ENV = 'test';
process.env.MONGO_URI = `mongodb://127.0.0.1:27017/alaas_test_${Date.now()}`;
process.env.JWT_SECRET = 'test-secret-test-secret-test-secret-0123456789';
process.env.CLIENT_URL = 'http://localhost:5173';
process.env.TOKEN_ENCRYPTION_KEY = 'ab'.repeat(32);
mongoose.set('autoIndex', false); // we create indexes ourselves so a backend lacking TTL/collation support doesn't crash startup

export const ORIGIN = 'http://localhost:5173';
let server: Server; let base = '';
export const unsupportedIndexes: string[] = [];

export async function startApp() {
  const { app } = await import('../src/app');
  await import('../src/models/SubmitClaim'); // registered via the assignment service; imported explicitly so its unique index is created
  await mongoose.connect(process.env.MONGO_URI!);
  for (const model of Object.values(mongoose.models)) {
    for (const [spec, opts] of model.schema.indexes()) {
      if (opts.expireAfterSeconds != null) { unsupportedIndexes.push(`${model.modelName} TTL ${JSON.stringify(spec)} (skipped)`); continue; }
      try { await model.collection.createIndex(spec as never, opts as never); } catch (e) { unsupportedIndexes.push(`${model.modelName} ${JSON.stringify(spec)}: ${(e as Error).message.slice(0, 60)}`); }
    }
  }
  server = app.listen(Number(process.env.TEST_PORT ?? 0)); base = `http://127.0.0.1:${(server.address() as { port: number }).port}`;
}
export async function stopApp() { await mongoose.connection.dropDatabase(); await mongoose.disconnect(); server.close(); }

/** A tiny browser: keeps cookies, and only sends the refresh cookie to /api/auth/* like the real Path attribute does. */
export class Client {
  jar = new Map<string, string>(); setCookies: string[] = [];
  constructor(public origin: string | null = ORIGIN) {}
  async req(method: string, path: string, body?: unknown, headers: Record<string, string> = {}) {
    const cookie = [...this.jar].filter(([k]) => k !== 'aa_refresh' || path.startsWith('/api/auth')).map(([k, v]) => `${k}=${v}`).join('; ');
    const res = await fetch(base + path, { method, headers: { 'content-type': 'application/json', ...(this.origin ? { origin: this.origin } : {}), ...(cookie ? { cookie } : {}), ...headers }, body: body === undefined ? undefined : typeof body === 'string' ? body : JSON.stringify(body) }); // strings are sent as-is (lets tests send broken JSON)
    this.setCookies = res.headers.getSetCookie();
    for (const sc of this.setCookies) { const [pair] = sc.split('; '); const i = pair!.indexOf('='); const k = pair!.slice(0, i), v = pair!.slice(i + 1); if (!v || /Max-Age=0|Expires=Thu, 01 Jan 1970/i.test(sc)) this.jar.delete(k); else this.jar.set(k, v); }
    const buf = Buffer.from(await res.arrayBuffer()); const text = buf.toString('utf8'); let json: any; try { json = JSON.parse(text); } catch { /* not json */ }
    return { status: res.status, json, text, buf, headers: res.headers, code: json?.error?.code as string | undefined };
  }
  get = (p: string) => this.req('GET', p); post = (p: string, b?: unknown) => this.req('POST', p, b ?? {}); patch = (p: string, b: unknown) => this.req('PATCH', p, b);
  put = (p: string, b: unknown) => this.req('PUT', p, b); del = (p: string) => this.req('DELETE', p);
}

let n = 0; export const uniq = (p = 'u') => `${p}${Date.now().toString(36)}${++n}`;
export async function makeTeacher(name = 'Teacher') {
  const { User } = await import('../src/models/User');
  const email = `${uniq('t')}@example.com`; const password = 'Passw0rd!x';
  const user = await User.create({ name, email, role: 'admin', passwordHash: await argon2.hash(password) });
  const c = new Client(); const r = await c.post('/api/auth/login', { email, password });
  if (r.status !== 200) throw new Error('teacher login failed ' + r.text);
  return { c, id: user.id as string, email, password };
}
/** Creates a student through the real invite flow and returns a signed-in client for them. */
export async function makeStudent(teacher: Client, name = 'Student') {
  const email = `${uniq('s')}@example.com`; const password = 'Passw0rd!s';
  const created = await teacher.post('/api/students', { name, email });
  if (created.status !== 201) throw new Error('student create failed ' + created.text);
  const token = new URL(created.json.inviteLink).searchParams.get('token');
  const c = new Client(); const r = await c.post('/api/auth/set-password', { token, password });
  if (r.status !== 200) throw new Error('set-password failed ' + r.text);
  return { c, id: created.json.student.id as string, email, password };
}
/** An access token that is already expired, signed with the real secret. */
export const expiredAccessToken = (userId: string, role: string) =>
  jwt.sign({ sub: userId, role, typ: 'access' }, process.env.JWT_SECRET!, { issuer: 'alaas-academy', audience: 'api', algorithm: 'HS256', expiresIn: -30 });

/** A multiple-choice question in the shape the editors send. */
export const mcq = (text = 'What is 2 + 2?', extra: object = {}) => ({ type: 'multiple_choice', text, points: 2, options: [{ text: '3', isCorrect: false }, { text: '4', isCorrect: true }], ...extra });
export const essayQ = (text = 'Explain slope.', points = 2) => ({ type: 'essay', text, points });
/** Turns a question as the API returns it back into the shape the editors send (so tests can edit and re-save). */
export const toInput = (q: any) => ({
  id: q.id, type: q.type, text: q.text, points: q.points, ...(q.topic ? { topic: q.topic } : {}),
  ...(q.type === 'multiple_choice' || q.type === 'multiple_select' ? { options: q.options.map((o: any) => ({ text: o.text, isCorrect: q.correctOptionIds.includes(o.id) })) } : {}),
  ...(q.type === 'true_false' ? { correctAnswer: q.correctOptionIds[0] === 'true' } : {}),
  ...(q.type === 'short_answer' ? { acceptedAnswers: q.acceptedAnswers, caseSensitive: q.caseSensitive } : {}),
});

/** Creates an exam with its questions directly (there is no question bank). */
export async function makeExam(t: Client, opts: { publish?: boolean; essay?: boolean } = {}) {
  const questions: object[] = [mcq()]; if (opts.essay) questions.push(essayQ());
  const created = await t.post('/api/exams', { title: 'Exam ' + uniq(), durationMinutes: 30, questions });
  if (created.status !== 201) throw new Error('exam create failed ' + created.text);
  const exam = created.json.exam;
  if (opts.publish) await t.post(`/api/exams/${exam.id}/publish`);
  return { exam, q1: exam.questions[0] };
}
