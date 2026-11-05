// Boots the real API on :4000 against the test database and seeds data for the browser end-to-end run.
import fs from 'node:fs';
process.env.TEST_PORT = '4000';
import { makeExam, makeStudent, makeTeacher, startApp } from './helpers';
(async () => {
  await startApp();
  const fresh = await makeTeacher('Fresh Teacher'); // a teacher with no data at all
  const t = await makeTeacher('Alaa Hassan'); const s1 = await makeStudent(t.c, 'Ahmed Ali'); const s2 = await makeStudent(t.c, 'Mariam Hossam');
  const { exam } = await makeExam(t.c, { publish: true });   const acc = (await t.c.post('/api/exam-access', { examId: exam.id, studentIds: [s1.id] })).json.created[0];
  const url = (await t.c.get(`/api/qr/${acc.id}/link`)).json.url as string;
  fs.writeFileSync('/tmp/e2e.json', JSON.stringify({ teacher: { email: t.email, password: t.password, id: t.id }, fresh: { email: fresh.email, password: fresh.password, id: fresh.id }, s1: { email: s1.email, password: s1.password, id: s1.id }, s2: { email: s2.email, password: s2.password, id: s2.id }, examId: exam.id, qrToken: url.split('/').pop(), secret: process.env.JWT_SECRET }));
  console.log('E2E SERVER READY');
})();
