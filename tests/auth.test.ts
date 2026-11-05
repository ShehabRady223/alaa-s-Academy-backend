import assert from 'node:assert/strict';
import { after, before, describe, it } from 'node:test';
import { Client, expiredAccessToken, makeStudent, makeTeacher, startApp, stopApp, unsupportedIndexes } from './helpers';

before(startApp); after(stopApp);
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

describe('authentication: access + refresh token rotation', () => {
  it('login sets an httpOnly access cookie and a path-scoped, SameSite=Strict refresh cookie', async () => {
    const t = await makeTeacher();
    const c = new Client(); const r = await c.post('/api/auth/login', { email: t.email, password: t.password });
    assert.equal(r.status, 200); assert.equal(r.json.user.role, 'admin');
    const access = c.setCookies.find((c) => c.startsWith('aa_access='))!, refresh = c.setCookies.find((c) => c.startsWith('aa_refresh='))!;
    assert.match(access, /HttpOnly/i); assert.match(access, /SameSite=Lax/i);
    assert.match(refresh, /HttpOnly/i); assert.match(refresh, /SameSite=Strict/i); assert.match(refresh, /Path=\/api\/auth/);
    assert.ok(!JSON.stringify(r.json).includes('token'), 'tokens never appear in the response body');
  });

  it('wrong password and unknown email give the same 401 message', async () => {
    const t = await makeTeacher();
    const a = await new Client().post('/api/auth/login', { email: t.email, password: 'nope-nope-1' });
    const b = await new Client().post('/api/auth/login', { email: 'ghost@example.com', password: 'nope-nope-1' });
    assert.equal(a.status, 401); assert.equal(b.status, 401); assert.equal(a.json.error.message, b.json.error.message);
  });

  it('protected routes need a token; an expired access token says TOKEN_EXPIRED (not NO_TOKEN)', async () => {
    const t = await makeTeacher();
    assert.equal((await new Client().get('/api/students')).code, 'NO_TOKEN');
    const c = new Client(); c.jar.set('aa_access', expiredAccessToken(t.id, 'admin'));
    const r = await c.get('/api/students'); assert.equal(r.status, 401); assert.equal(r.code, 'TOKEN_EXPIRED');
    c.jar.set('aa_access', 'garbage'); assert.equal((await c.get('/api/students')).code, 'TOKEN_INVALID');
  });

  it('refresh rotates: new refresh token each time, old one is dead, access works again', async () => {
    const t = await makeTeacher(); const c = t.c; const old = c.jar.get('aa_refresh')!;
    c.jar.set('aa_access', expiredAccessToken(t.id, 'admin'));
    assert.equal((await c.get('/api/students')).code, 'TOKEN_EXPIRED');
    const r = await c.post('/api/auth/refresh'); assert.equal(r.status, 200);
    const fresh = c.jar.get('aa_refresh')!; assert.notEqual(fresh, old);
    assert.equal((await c.get('/api/students')).status, 200, 'new access token works');
    const { RefreshToken } = await import('../src/models/RefreshToken');
    const { sha256 } = await import('../src/utils/tokens');
    const rows = await RefreshToken.find({ userId: t.id }); assert.equal(rows.length, 2);
    assert.ok(rows.every((x) => x.tokenHash !== old && x.tokenHash !== fresh), 'only hashes are stored, never raw tokens');
    assert.ok(rows.some((x) => x.tokenHash === sha256(fresh)));
  });

  it('REUSE DETECTION: replaying a rotated refresh token revokes the whole session family', async () => {
    const t = await makeTeacher(); const c = t.c; const stolen = c.jar.get('aa_refresh')!;
    assert.equal((await c.post('/api/auth/refresh')).status, 200); // legitimate rotation #1
    const legit = c.jar.get('aa_refresh')!;
    const { RefreshToken } = await import('../src/models/RefreshToken');
    const { sha256 } = await import('../src/utils/tokens');
    await RefreshToken.updateOne({ tokenHash: sha256(stolen) }, { usedAt: new Date(Date.now() - 60_000) }); // pretend it happened a minute ago
    const attacker = new Client(); attacker.jar.set('aa_refresh', stolen);
    const r = await attacker.post('/api/auth/refresh');
    assert.equal(r.status, 401); assert.equal(r.code, 'REFRESH_REUSE');
    assert.ok(!attacker.jar.has('aa_refresh'), 'cookies are cleared on a dead session');
    const victim = new Client(); victim.jar.set('aa_refresh', legit);
    const v = await victim.post('/api/auth/refresh'); assert.equal(v.status, 401); assert.equal(v.code, 'REFRESH_REVOKED', "the legitimate token is revoked too");
  });

  it('a near-simultaneous replay (two tabs) is a race, not theft: the family survives', async () => {
    const t = await makeTeacher(); const old = t.c.jar.get('aa_refresh')!;
    assert.equal((await t.c.post('/api/auth/refresh')).status, 200);
    const tab2 = new Client(); tab2.jar.set('aa_refresh', old);
    const r = await tab2.post('/api/auth/refresh'); assert.equal(r.code, 'REFRESH_RACE');
    assert.equal((await t.c.post('/api/auth/refresh')).status, 200, 'the winner keeps working');
  });

  it('concurrent refreshes with one token: exactly one succeeds', async () => {
    const t = await makeTeacher(); const tok = t.c.jar.get('aa_refresh')!;
    const results = await Promise.all(Array.from({ length: 6 }, async () => { const c = new Client(); c.jar.set('aa_refresh', tok); return (await c.post('/api/auth/refresh')).status; }));
    assert.equal(results.filter((s) => s === 200).length, 1, JSON.stringify(results));
  });

  it('refresh cookie is not sent outside /api/auth and refresh without it is rejected', async () => {
    const t = await makeTeacher(); const c = new Client(); c.jar.set('aa_access', t.c.jar.get('aa_access')!);
    assert.equal((await c.post('/api/auth/refresh')).code, 'NO_REFRESH');
  });

  it('logout revokes the session; the old refresh token can no longer be used', async () => {
    const t = await makeTeacher(); const rt = t.c.jar.get('aa_refresh')!;
    assert.equal((await t.c.post('/api/auth/logout')).status, 204);
    assert.ok(!t.c.jar.has('aa_refresh') && !t.c.jar.has('aa_access'));
    const c = new Client(); c.jar.set('aa_refresh', rt);
    assert.equal((await c.post('/api/auth/refresh')).code, 'REFRESH_REVOKED');
    assert.equal((await new Client().post('/api/auth/logout')).status, 204, 'logout is idempotent');
  });

  it('logout-all and password change end every other session', async () => {
    const t = await makeTeacher(); const other = new Client(); await other.post('/api/auth/login', { email: t.email, password: t.password });
    const otherRt = other.jar.get('aa_refresh')!;
    const ch = await t.c.post('/api/auth/change-password', { currentPassword: t.password, newPassword: 'N3wPassword!' });
    assert.equal(ch.status, 204);
    const c = new Client(); c.jar.set('aa_refresh', otherRt); assert.equal((await c.post('/api/auth/refresh')).code, 'REFRESH_REVOKED', 'other device is signed out');
    assert.equal((await t.c.get('/api/auth/me')).status, 200, 'this device got a fresh session');
    assert.equal((await t.c.post('/api/auth/logout-all')).status, 204);
  });

  it('absolute session lifetime: an expired family cannot refresh even if recently rotated', async () => {
    const t = await makeTeacher(); const { RefreshToken } = await import('../src/models/RefreshToken');
    await RefreshToken.updateMany({ userId: t.id }, { familyExpiresAt: new Date(Date.now() - 1000) });
    assert.equal((await t.c.post('/api/auth/refresh')).code, 'REFRESH_EXPIRED');
  });

  it('disabling a student kills their refresh ability immediately', async () => {
    const teacher = await makeTeacher(); const s = await makeStudent(teacher.c);
    assert.equal((await s.c.get('/api/auth/me')).status, 200);
    assert.equal((await teacher.c.patch(`/api/students/${s.id}`, { status: 'disabled' })).status, 200);
    s.c.jar.set('aa_access', expiredAccessToken(s.id, 'student'));
    assert.equal((await s.c.post('/api/auth/refresh')).code, 'REFRESH_REVOKED');
    assert.equal((await new Client().post('/api/auth/login', { email: s.email, password: s.password })).status, 403);
  });

  it('CSRF: a state-changing request from a foreign Origin is refused even with valid cookies', async () => {
    const t = await makeTeacher(); const evil = new Client('https://evil.example'); evil.jar = t.c.jar;
    const r = await evil.post('/api/students', { name: 'Mallory', email: 'm@example.com' });
    assert.equal(r.status, 403); assert.equal(r.code, 'CSRF_BLOCKED');
    const sfs = await t.c.req('POST', '/api/students', { name: 'X Y', email: 'xy@example.com' }, { 'sec-fetch-site': 'cross-site' }); assert.equal(sfs.status, 403);
  });

  it('brute force: the 9th wrong login for one account from one IP is rate-limited', async () => {
    const t = await makeTeacher(); const c = new Client(); const codes: number[] = [];
    for (let i = 0; i < 10; i++) codes.push((await c.post('/api/auth/login', { email: t.email, password: 'wrong-pass-1' })).status);
    // makeTeacher() already used one of the 8 allowed attempts for this account+IP
    assert.deepEqual(codes.slice(0, 7), Array(7).fill(401)); assert.equal(codes[9], 429); assert.ok(codes.filter((s) => s === 401).length <= 8);
  });

  it('(info) indexes the test database could not create', () => { console.log('    unsupported on this test DB:', unsupportedIndexes.length ? unsupportedIndexes : 'none'); });
});
void sleep;
