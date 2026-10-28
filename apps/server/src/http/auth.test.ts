import { MeResponseSchema, SessionResponseSchema } from '@restroos/contracts';
import { LOCKOUT } from '@restroos/domain';
import { afterEach, describe, expect, it } from 'vitest';
import { ADMIN, createTestServer, type TestServer } from '../testing/test-server';

let s: TestServer;
afterEach(async () => s?.close());

const login = (payload: object) =>
  s.app.inject({ method: 'POST', url: '/api/v1/auth/login', payload });
const refresh = (cookie: string, payload: object = {}) =>
  s.app.inject({ method: 'POST', url: '/api/v1/auth/refresh', headers: { cookie }, payload });

describe('password login', () => {
  it('returns a session with the admin permissions and an httpOnly refresh cookie', async () => {
    s = await createTestServer();
    const res = await login({ username: ADMIN.username, password: ADMIN.password });
    expect(res.statusCode).toBe(200);
    const body = SessionResponseSchema.parse(res.json());
    expect(body.user).toMatchObject({ username: 'owner', fullName: 'Ananya Sen', hasPin: true });
    expect(body.branch).toMatchObject({ code: 'KOL1', stateCode: '19' });
    expect(body.roles).toEqual(['ADMIN']);
    expect(body.permissions).toContain('users.manage');
    expect(body.permissions).toHaveLength(52);
    const cookie = res.cookies.find((c) => c.name === 'restro_rt')!;
    expect(cookie).toMatchObject({ httpOnly: true, sameSite: 'Strict', path: '/api/v1/auth' });
  });

  it('accepts the username in any case', async () => {
    s = await createTestServer();
    expect((await login({ username: 'OWNER', password: ADMIN.password })).statusCode).toBe(200);
  });

  it('gives the same answer for a wrong password and an unknown user', async () => {
    s = await createTestServer();
    const wrong = await login({ username: ADMIN.username, password: 'nope-nope-nope' });
    const unknown = await login({ username: 'ghost', password: 'nope-nope-nope' });
    expect(wrong.statusCode).toBe(401);
    expect(unknown.statusCode).toBe(401);
    expect(wrong.json().code).toBe('INVALID_CREDENTIALS');
    expect(unknown.json().code).toBe('INVALID_CREDENTIALS');
    expect(wrong.json().detail).toBe(unknown.json().detail);
  });

  it('locks the account after repeated failures, then unlocks after the lock period', async () => {
    s = await createTestServer();
    for (let i = 0; i < LOCKOUT.maxAttempts; i++) {
      await login({ username: ADMIN.username, password: 'wrong-password-1' });
    }
    const locked = await login({ username: ADMIN.username, password: ADMIN.password });
    expect(locked.statusCode).toBe(423);
    expect(locked.json().code).toBe('ACCOUNT_LOCKED');

    s.clock.advance(LOCKOUT.lockMinutes * 60_000 + 1000);
    expect((await login({ username: ADMIN.username, password: ADMIN.password })).statusCode).toBe(
      200,
    );
  });

  it('records sign-ins and failures in the audit trail', async () => {
    s = await createTestServer();
    await login({ username: ADMIN.username, password: 'wrong-password-1' });
    await login({ username: ADMIN.username, password: ADMIN.password });
    const actions = s.database.db
      .prepare("SELECT action FROM audit_logs WHERE action LIKE 'auth.%' ORDER BY rowid")
      .pluck()
      .all();
    expect(actions).toEqual(['auth.login_failed', 'auth.login']);
  });
});

describe('PIN login', () => {
  it('lists PIN users and signs in with a PIN', async () => {
    s = await createTestServer();
    const tiles = await s.app.inject({ method: 'GET', url: '/api/v1/auth/pin-users' });
    expect(tiles.json().data).toEqual([
      expect.objectContaining({ fullName: 'Ananya Sen', initials: 'AS' }),
    ]);
    const userId = tiles.json().data[0].id;
    const ok = await s.app.inject({
      method: 'POST',
      url: '/api/v1/auth/pin-login',
      payload: { userId, pin: ADMIN.pin },
    });
    expect(ok.statusCode).toBe(200);
    const bad = await s.app.inject({
      method: 'POST',
      url: '/api/v1/auth/pin-login',
      payload: { userId, pin: '9999' },
    });
    expect(bad.statusCode).toBe(401);
  });
});

describe('sessions', () => {
  it('authenticates requests with the access token', async () => {
    s = await createTestServer();
    const session = await s.login();
    const me = await s.as(session.accessToken, { method: 'GET', url: '/api/v1/auth/me' });
    expect(me.statusCode).toBe(200);
    expect(MeResponseSchema.parse(me.json()).user.username).toBe('owner');
  });

  it('rejects missing, malformed and expired tokens', async () => {
    s = await createTestServer();
    const session = await s.login();
    expect((await s.app.inject({ method: 'GET', url: '/api/v1/auth/me' })).statusCode).toBe(401);
    expect((await s.as('not-a-jwt', { method: 'GET', url: '/api/v1/auth/me' })).statusCode).toBe(
      401,
    );
    s.clock.advance(16 * 60_000);
    expect(
      (await s.as(session.accessToken, { method: 'GET', url: '/api/v1/auth/me' })).statusCode,
    ).toBe(401);
  });

  it('rotates the refresh token and still serves the new access token', async () => {
    s = await createTestServer();
    const session = await s.login();
    s.clock.advance(14 * 60_000);
    const res = await refresh(session.cookie);
    expect(res.statusCode).toBe(200);
    const next = res.cookies.find((c) => c.name === 'restro_rt')!.value;
    expect(`restro_rt=${next}`).not.toBe(session.cookie);
    const me = await s.as(res.json().accessToken, { method: 'GET', url: '/api/v1/auth/me' });
    expect(me.statusCode).toBe(200);
  });

  it('ends the whole session when an old refresh token is replayed (token theft)', async () => {
    s = await createTestServer();
    const session = await s.login();
    const first = await refresh(session.cookie);
    const stolenReplay = await refresh(session.cookie);
    expect(stolenReplay.statusCode).toBe(401);
    // The legitimate holder of the newest token is logged out too.
    const newest = `restro_rt=${first.cookies.find((c) => c.name === 'restro_rt')!.value}`;
    expect((await refresh(newest)).statusCode).toBe(401);
    expect(
      (await s.as(first.json().accessToken, { method: 'GET', url: '/api/v1/auth/me' })).statusCode,
    ).toBe(401);
    const reuse = s.database.db
      .prepare("SELECT count(*) FROM audit_logs WHERE action = 'auth.token_reuse'")
      .pluck()
      .get();
    // Both the replay and the later attempt with the (now revoked) newest token are recorded.
    expect(reuse).toBe(2);
  });

  it('logout ends the session immediately, not when the access token expires', async () => {
    s = await createTestServer();
    const session = await s.login();
    const out = await s.app.inject({
      method: 'POST',
      url: '/api/v1/auth/logout',
      headers: { cookie: session.cookie },
    });
    expect(out.statusCode).toBe(204);
    expect(
      (await s.as(session.accessToken, { method: 'GET', url: '/api/v1/auth/me' })).statusCode,
    ).toBe(401);
    expect((await refresh(session.cookie)).statusCode).toBe(401);
  });

  it('changing your password keeps this session and ends the others', async () => {
    s = await createTestServer();
    const here = await s.login();
    const elsewhere = await s.login();
    const res = await s.as(here.accessToken, {
      method: 'POST',
      url: '/api/v1/auth/change-password',
      payload: { currentPassword: ADMIN.password, newPassword: 'Mishti-Doi-2027' },
    });
    expect(res.statusCode).toBe(204);
    expect(
      (await s.as(here.accessToken, { method: 'GET', url: '/api/v1/auth/me' })).statusCode,
    ).toBe(200);
    expect(
      (await s.as(elsewhere.accessToken, { method: 'GET', url: '/api/v1/auth/me' })).statusCode,
    ).toBe(401);
    expect(
      (await login({ username: ADMIN.username, password: 'Mishti-Doi-2027' })).statusCode,
    ).toBe(200);
  });

  it('never stores tokens or secrets in readable form', async () => {
    s = await createTestServer();
    const session = await s.login();
    const raw = session.cookie.slice('restro_rt='.length);
    const stored = s.database.db
      .prepare('SELECT token_hash FROM refresh_tokens')
      .pluck()
      .all() as string[];
    expect(stored).not.toContain(raw);
    const events = JSON.stringify(
      s.database.db.prepare('SELECT payload_json FROM domain_events').pluck().all(),
    );
    expect(events).not.toMatch(/\$2[aby]\$/); // no bcrypt hashes in synced events
    const audit = JSON.stringify(
      s.database.db.prepare('SELECT after_json FROM audit_logs').pluck().all(),
    );
    expect(audit).not.toMatch(/\$2[aby]\$/);
    expect(audit).not.toContain(ADMIN.password);
  });
});
