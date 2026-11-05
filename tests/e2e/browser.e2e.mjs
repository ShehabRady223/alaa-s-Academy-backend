import chromium from '@sparticuz/chromium'; import puppeteer from 'puppeteer-core'; import fs from 'fs'; import { createRequire } from 'module';
const jwt = createRequire(import.meta.url)('/home/claude/alaas-academy/apps/api/node_modules/jsonwebtoken');
const D = JSON.parse(fs.readFileSync('/tmp/e2e.json', 'utf8'));
const b = await puppeteer.launch({ args: chromium.args, executablePath: await chromium.executablePath(), headless: 'shell' });
const fails = []; const ok = (c, m) => { console.log((c ? 'PASS ' : 'FAIL ') + m); if (!c) fails.push(m); };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms)); const BASE = 'http://localhost:5173';
const browsers = [];
async function newPage(w = 1280, h = 900) { const br = await puppeteer.launch({ args: chromium.args, executablePath: await chromium.executablePath(), headless: 'shell' }); browsers.push(br); const p = await br.newPage(); await p.setViewport({ width: w, height: h }); p.on('dialog', (d) => d.accept()); p.reqs = []; p.on('request', (r) => { if (r.url().includes('/api/')) p.reqs.push(`${r.method()} ${new URL(r.url()).pathname}`); }); p.on('pageerror', (e) => { console.log('PAGE ERROR', e.message); fails.push('pageerror ' + e.message); }); return p; }
const go = (p, path) => p.goto(BASE + path, { waitUntil: 'networkidle0' });
const text = (p) => p.evaluate(() => document.body.innerText);
const clickText = async (p, sel, t) => { for (const e of await p.$$(sel)) if ((await e.evaluate((n) => n.textContent)).trim().includes(t)) { await e.click(); return true; } return false; };
const field = async (p, label) => (await p.evaluateHandle((l) => { for (const x of document.querySelectorAll('label')) { const s = x.querySelector('span'); if (s && s.textContent.trim() === l) return x.querySelector('input,textarea,select'); } return null; }, label)).asElement();
const fill = async (p, label, v) => { const el = await field(p, label); await el.click({ clickCount: 3 }); await el.type(v); };
const count = (p, re) => p.reqs.filter((r) => re.test(r)).length;
const expired = (id, role) => jwt.sign({ sub: id, role, typ: 'access' }, D.secret, { issuer: 'alaas-academy', audience: 'api', algorithm: 'HS256', expiresIn: -60 });

async function addQuestion(p, q) {
  await clickText(p, 'button', 'Add question'); await sleep(400);
  const dlg = 'dialog[open]'; if (q.type) await p.select(`${dlg} select`, q.type); await sleep(150);
  await (await p.$(`${dlg} textarea`)).type(q.text);
  if (q.options) for (let i = 0; i < q.options.length; i++) await (await p.$(`${dlg} input[aria-label="Option ${i + 1} text"]`)).type(q.options[i]);
  if (q.correct != null) await (await p.$(`${dlg} input[aria-label="Option ${q.correct + 1} is correct"]`)).click();
  if (q.accepted) await (await p.$(`${dlg} input[aria-label="Accepted answer 1"]`)).type(q.accepted);
  if (q.points) await p.evaluate((el, v) => { const set = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set; set.call(el, String(v)); el.dispatchEvent(new Event('input', { bubbles: true })); el.dispatchEvent(new Event('change', { bubbles: true })); }, await p.$(`${dlg} input[type=number]`), q.points);
  await (await p.$(`${dlg} button[type=submit]`)).click(); await sleep(500);
  return !(await p.$(dlg)); // true when the dialog closed, i.e. the question was accepted
}
const shot = (p, n) => p.screenshot({ path: `/tmp/shot/${n}.png` });
async function login(p, who) { await go(p, '/login'); await fill(p, 'Email', who.email); await fill(p, 'Password', who.password); await clickText(p, 'button', 'Sign in'); await sleep(1200); }

// ---------- 1. teacher login, direct creation entry points
let p = await newPage(); await login(p, D.teacher);
ok(p.url().endsWith('/admin'), 'teacher lands on the dashboard after login');
let t = await text(p); ok(t.includes('Create exam') && t.includes('Create assignment'), 'dashboard offers Create exam and Create assignment directly');
ok(!t.includes('Audit') && !t.includes('Template') && !t.includes('Recent activity'), 'no audit log / template / activity UI anywhere in the navigation or dashboard');

// ---------- 2. expired access token: silent refresh, single flight
const REFURL = BASE + '/api/auth/refresh'; const cookies = await p.cookies(REFURL); const refresh = cookies.find((c) => c.name === 'aa_refresh'); ok(!!refresh && refresh.httpOnly && refresh.sameSite === 'Strict' && refresh.path === '/api/auth', 'refresh cookie: HttpOnly, SameSite=Strict, Path=/api/auth');
await p.setCookie({ name: 'aa_access', value: expired(D.teacher.id, 'admin'), domain: 'localhost', path: '/', httpOnly: true });
p.reqs.length = 0; await p.goto(BASE + '/admin/students', { waitUntil: 'networkidle0' });
ok(p.url().endsWith('/admin/students'), 'expired access token does NOT log the user out');
ok(count(p, /POST \/api\/auth\/refresh/) === 1, `exactly ONE refresh although several requests hit the expired token (saw ${count(p, /POST \/api\/auth\/refresh/)})`);
ok((await text(p)).includes('Ahmed Ali'), 'page rendered with data after the transparent refresh');
const after = await p.cookies(REFURL); ok(after.find((c) => c.name === 'aa_refresh').value !== refresh.value, 'refresh cookie was rotated');

// ---------- 3. dead session -> login screen
const bad = await newPage(); await login(bad, D.teacher);
await bad.setCookie({ name: 'aa_access', value: expired(D.teacher.id, 'admin'), domain: 'localhost', path: '/' }, { name: 'aa_refresh', value: 'x'.repeat(43), domain: 'localhost', path: '/api/auth', httpOnly: true });
await bad.goto(BASE + '/admin/students', { waitUntil: 'networkidle0' }); await sleep(500);
ok(bad.url().includes('/login'), 'unrefreshable session returns to the login screen'); await bad.browser().close();

// ---------- 4. create an exam through the UI: questions are added right inside it (no bank)
ok(!(await text(p)).includes('Question bank'), 'there is no Question bank in the navigation');
const fresh = await newPage(); await login(fresh, D.fresh); await go(fresh, '/admin/exams/new'); await sleep(300);
const addBtn = await fresh.evaluate(() => { const b = [...document.querySelectorAll('button')].find((x) => x.textContent.trim() === 'Add question'); return b && !b.disabled; });
ok(addBtn, 'a brand-new teacher (no subjects, no topics) can add a question immediately'); await fresh.browser().close();
p.reqs.length = 0; await go(p, '/admin/exams/new');
ok((await text(p)).includes('New exam'), '/admin/exams/new opens the exam builder directly');
await fill(p, 'Title', 'Biology Midterm'); await fill(p, 'Subject', 'Biology');
ok(await addQuestion(p, { text: 'Which organelle makes energy?', options: ['Nucleus', 'Mitochondrion'], correct: 1, points: 2 }), 'multiple choice with only 2 of the 4 starter rows filled is ACCEPTED (the reported bug)');
ok(await addQuestion(p, { type: 'essay', text: 'Describe photosynthesis.', points: 5 }), 'an essay question can be added');
const incomplete = await addQuestion(p, { text: 'No correct answer marked', options: ['A', 'B'] }); ok(!incomplete && (await text(p)).includes('Mark exactly one option as correct'), 'an incomplete question shows a VISIBLE message instead of failing silently');
await clickText(p, 'dialog[open] button', 'Cancel'); await sleep(300);
ok((await text(p)).includes('Questions (2)') && (await text(p)).includes('Answer: Mitochondrion'), 'both questions are listed, with the correct answer visible to the teacher');
p.reqs.length = 0; await p.evaluate(() => { const b = [...document.querySelectorAll('button')].find((x) => x.textContent.trim() === 'Create exam'); b.click(); b.click(); }); // a genuine double click
await sleep(1500);
ok(/\/admin\/exams\/[a-f0-9]{24}$/.test(p.url()), 'navigates to the new exam right after creating it');
ok(count(p, /POST \/api\/exams$/) === 1, `double click created exactly one exam (POSTs: ${count(p, /POST \/api\/exams$/)})`);
const examUrl = p.url(); ok((await text(p)).includes('Biology Midterm') && (await text(p)).includes('Questions (2)'), 'new exam is shown immediately with its questions');
ok(count(p, /GET \/api\/exams\/[a-f0-9]{24}$/) === 0, `no extra GET for the exam just created: the response seeded the cache (GETs: ${count(p, /GET \/api\/exams\/[a-f0-9]{24}$/)})`);
await shot(p, 'e2e-builder');

// ---------- 5. update (single request), list shows it with no manual refresh
await fill(p, 'Title', 'Biology Midterm v2'); p.reqs.length = 0; await clickText(p, 'button', 'Save changes'); await sleep(900);
ok(count(p, /PATCH \/api\/exams\/[a-f0-9]{24}$/) === 1 && count(p, /PUT /) === 0, 'settings + questions saved with ONE PATCH');
ok((await text(p)).includes('Biology Midterm v2') && !(await text(p)).includes('Unsaved changes'), 'editor shows the saved state immediately');
await clickText(p, 'a', 'All exams'); await sleep(800);
ok((await text(p)).includes('Biology Midterm v2') && !(await text(p)).includes('Biology Midterm\n'), 'exams list shows the new title without a manual refresh');

// ---------- 6. assignment created independently through the UI, with its own questions
p.reqs.length = 0; await go(p, '/admin/assignments/new');
await fill(p, 'Title', 'Chapter 3 homework');
ok(await addQuestion(p, { type: 'short_answer', text: 'What is the capital of France?', accepted: 'Paris', points: 5 }), 'short-answer question added directly in the assignment');
ok(await addQuestion(p, { type: 'essay', text: 'Summarise the chapter in 5 lines.', points: 5 }), 'essay question added directly in the assignment');
await sleep(400); const sBoxes = await p.$$('input[type=checkbox]'); let picked = 0; for (const bx of sBoxes) { const lab = await bx.evaluate((n) => n.closest('label')?.innerText ?? ''); if (lab.includes('Ahmed Ali')) { await bx.click(); picked++; } }
ok(picked === 1, 'recipient list shows only this teacher\'s students');
await shot(p, 'e2e-assignment-form');
await clickText(p, 'button', 'Publish'); await sleep(1500);
ok(/\/admin\/assignments\/[a-f0-9]{24}$/.test(p.url()), 'navigates to the new assignment after publishing');
t = await text(p); ok(t.includes('Chapter 3 homework') && t.includes('Published') && t.includes('Ahmed Ali') && t.includes('Questions (2)'), 'assignment detail shows status, recipient and questions immediately');
const hwUrl = p.url(); await shot(p, 'e2e-assignment-detail');
await go(p, '/admin/assignments'); ok((await text(p)).includes('Chapter 3 homework'), 'assignment list contains it (no exam needed)');
p.reqs.length = 0; await go(p, '/admin/assignments/new'); await fill(p, 'Title', 'Past due'); await addQuestion(p, { type: 'essay', text: 'x', points: 1 });
await p.evaluate((el) => { const set = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set; set.call(el, '2020-01-01T10:00'); el.dispatchEvent(new Event('input', { bubbles: true })); el.dispatchEvent(new Event('change', { bubbles: true })); }, await field(p, 'Due')); await clickText(p, 'button', 'Save draft'); await sleep(500);
ok((await text(p)).includes('The due date must be in the future') && count(p, /POST \/api\/assignments/) === 0, 'invalid input is rejected on the client with a clear message and sends nothing');

// ---------- 7. student: sees homework, saves draft, submits; auto + manual grading; student sees the grade
const sp = await newPage(900, 900); await login(sp, D.s1); t = await text(sp);
ok(sp.url().endsWith('/me') && t.includes('My assignments') && t.includes('Chapter 3 homework'), 'student sees the assignment on their home page');
const sp2 = await newPage(); await login(sp2, D.s2); ok(!(await text(sp2)).includes('Chapter 3 homework'), 'a student who was not chosen does NOT see it'); await sp2.browser().close();
await clickText(sp, 'a', 'Chapter 3 homework'); await sleep(900);
ok(!(await sp.content()).includes('Paris'), 'the correct answer is not shown to the student before grading');
await (await sp.$('input[aria-label="Your answer"]')).type('paris'); await (await sp.$('textarea[aria-label="Your answer"]')).type('The chapter explains photosynthesis.'); await clickText(sp, 'button', 'Save draft'); await sleep(600);
ok((await text(sp)).includes('Draft saved') || count(sp, /PUT \/api\/student\/assignments/) === 1, 'draft save works');
await shot(sp, 'e2e-student-assignment');
await clickText(sp, 'button', 'Submit'); await sleep(300); await clickText(sp, 'dialog[open] button', 'Submit'); await sleep(1200);
t = await text(sp); ok(t.includes('Submitted') && t.includes('still needs to grade'), 'submitted state shown immediately; the essay is waiting for the teacher');
ok((await sp.$$('textarea:not([readonly])')).length === 0, 'answers are read-only after submitting');
await go(p, hwUrl.replace(BASE, '')); ok((await text(p)).includes('Needs grading'), 'teacher sees the new submission');
await clickText(p, 'a', 'Grade'); await sleep(900);
const ptsInputs = await p.$$('input[type=number]'); let essayPts = null; for (const el of ptsInputs) if ((await el.evaluate((n) => n.value)) === '') essayPts = el;
const autoPts = await Promise.all(ptsInputs.map((el) => el.evaluate((n) => n.value)));
await essayPts.type('4'); await clickText(p, 'button', 'Save grades'); await sleep(900);
ok((await text(p)).includes('9/10') && (await text(p)).includes('Graded'), 'final grade 9/10 is reflected immediately on the teacher page');
await go(sp, '/me'); ok((await text(sp)).includes('Graded 9/10'), 'student sees the grade on their home page');

// ---------- 8. exam by QR (independent flow) with the real backend
await go(sp, '/exam/access/' + D.qrToken); ok((await text(sp)).includes('Start exam'), 'QR link opens the exam instructions');
await clickText(sp, 'button', 'Start exam'); await sleep(1200); ok(sp.url().includes('/exam/run/'), 'start navigates to the runner');
const radios = await sp.$$('input[type=radio]'); await radios[1].click(); await sleep(2600);
ok(count(sp, /PATCH \/api\/attempts\/[a-f0-9]{24}\/autosave/) >= 1, 'answer autosaved'); await clickText(sp, 'button', 'Review and submit'); await sleep(300); await clickText(sp, 'dialog[open] button', 'Submit exam'); await sleep(1500);
ok(sp.url().includes('/exam/result/'), 'submit navigates to the result page'); await shot(sp, 'e2e-exam-result');

// ---------- 9. logout revokes the session
const rtBefore = (await sp.cookies(REFURL)).find((c) => c.name === 'aa_refresh'); await clickText(sp, 'button', 'Sign out'); await sleep(1000);
ok(sp.url().includes('/login'), 'sign out returns to login'); ok(!(await sp.cookies(REFURL)).some((c) => c.name === 'aa_refresh'), 'cookies cleared');
const replay = await fetch('http://localhost:4000/api/auth/refresh', { method: 'POST', headers: { cookie: `aa_refresh=${rtBefore.value}`, 'content-type': 'application/json' }, body: '{}' });
ok(replay.status === 401, 'the old refresh token is dead after logout');
for (const x of browsers) await x.close().catch(() => {}); await b.close().catch(() => {}); console.log(fails.length ? `\n${fails.length} FAILURE(S): ${fails.join(' | ')}` : '\nALL E2E CHECKS PASSED');
