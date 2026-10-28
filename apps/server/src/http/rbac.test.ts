import { afterEach, describe, expect, it } from 'vitest';
import { ADMIN, createTestServer, type TestServer } from '../testing/test-server';

let s: TestServer;
afterEach(async () => s?.close());

/** Creates a cashier through the API and signs them in. */
async function cashier(server: TestServer, adminToken: string) {
  const roles = await server.as(adminToken, { method: 'GET', url: '/api/v1/roles' });
  const cashierRole = roles.json().data.find((r: { code: string }) => r.code === 'CASHIER');
  const created = await server.as(adminToken, {
    method: 'POST',
    url: '/api/v1/users',
    payload: {
      username: 'ravi',
      fullName: 'Ravi Das',
      password: 'Rasgulla#2026',
      pin: '4826',
      roleIds: [cashierRole.id],
    },
  });
  expect(created.statusCode).toBe(201);
  return { user: created.json(), session: await server.login('ravi', 'Rasgulla#2026') };
}

/** A test-only route that a cashier may run only with a manager's approval. */
const withRefundRoute = () =>
  createTestServer({
    registerApiRoutes: (api) => {
      api.post(
        '/test/refund',
        { config: { permission: 'billing.refund', approvable: true } },
        async (request) => ({
          approvedBy: request.approverId,
        }),
      );
    },
  });

describe('permissions', () => {
  it('lets each role do only what it is allowed to', async () => {
    s = await createTestServer();
    const admin = await s.login();
    const { session } = await cashier(s, admin.accessToken);
    expect(session.roles).toEqual(['CASHIER']);
    expect(session.permissions).not.toContain('users.manage');

    const asCashier = await s.as(session.accessToken, { method: 'GET', url: '/api/v1/users' });
    expect(asCashier.statusCode).toBe(403);
    expect(asCashier.json()).toMatchObject({ code: 'FORBIDDEN', permission: 'users.manage' });
    expect(
      (await s.as(session.accessToken, { method: 'GET', url: '/api/v1/settings/branch' }))
        .statusCode,
    ).toBe(200);
  });

  it('applies a role change on the next request, without signing in again', async () => {
    s = await createTestServer();
    const admin = await s.login();
    const { user, session } = await cashier(s, admin.accessToken);
    expect(
      (await s.as(session.accessToken, { method: 'GET', url: '/api/v1/audit-logs' })).statusCode,
    ).toBe(403);

    const roles = (await s.as(admin.accessToken, { method: 'GET', url: '/api/v1/roles' })).json()
      .data;
    const accountant = roles.find((r: { code: string }) => r.code === 'ACCOUNTANT');
    const patched = await s.as(admin.accessToken, {
      method: 'PATCH',
      url: `/api/v1/users/${user.id}`,
      payload: { version: user.version, roleIds: [accountant.id] },
    });
    expect(patched.statusCode).toBe(200);
    expect(
      (await s.as(session.accessToken, { method: 'GET', url: '/api/v1/audit-logs' })).statusCode,
    ).toBe(200);
  });

  it('signs out a deactivated user straight away', async () => {
    s = await createTestServer();
    const admin = await s.login();
    const { user, session } = await cashier(s, admin.accessToken);
    await s.as(admin.accessToken, { method: 'POST', url: `/api/v1/users/${user.id}/deactivate` });
    expect(
      (await s.as(session.accessToken, { method: 'GET', url: '/api/v1/auth/me' })).statusCode,
    ).toBe(401);
    const again = await s.app.inject({
      method: 'POST',
      url: '/api/v1/auth/login',
      payload: { username: 'ravi', password: 'Rasgulla#2026' },
    });
    expect(again.json().code).toBe('ACCOUNT_DISABLED');
  });
});

describe('manager approval', () => {
  it('asks for approval, accepts a manager PIN once, and records both people', async () => {
    s = await withRefundRoute();
    const admin = await s.login();
    const { session } = await cashier(s, admin.accessToken);

    const denied = await s.as(session.accessToken, {
      method: 'POST',
      url: '/api/v1/test/refund',
      payload: {},
    });
    expect(denied.statusCode).toBe(403);
    expect(denied.json()).toMatchObject({
      code: 'APPROVAL_REQUIRED',
      permission: 'billing.refund',
    });

    const approve = await s.as(session.accessToken, {
      method: 'POST',
      url: '/api/v1/auth/approve',
      payload: { userId: admin.user.id, pin: ADMIN.pin, permission: 'billing.refund' },
    });
    expect(approve.statusCode).toBe(200);
    const token = approve.json().approverToken;

    const ok = await s.as(session.accessToken, {
      method: 'POST',
      url: '/api/v1/test/refund',
      headers: { 'x-approver-token': token },
      payload: {},
    });
    expect(ok.statusCode).toBe(200);
    expect(ok.json().approvedBy).toBe(admin.user.id);

    const replay = await s.as(session.accessToken, {
      method: 'POST',
      url: '/api/v1/test/refund',
      headers: { 'x-approver-token': token },
      payload: {},
    });
    expect(replay.statusCode).toBe(403);
    const audit = s.database.db
      .prepare("SELECT actor_id, approver_id FROM audit_logs WHERE action = 'auth.approve'")
      .get() as { actor_id: string; approver_id: string };
    expect(audit).toEqual({ actor_id: session.user.id, approver_id: admin.user.id });
  });

  it('rejects an approval for a different permission, a wrong PIN, or an expired token', async () => {
    s = await withRefundRoute();
    const admin = await s.login();
    const { session } = await cashier(s, admin.accessToken);
    const approveFor = (permission: string, pin: string = ADMIN.pin) =>
      s.as(session.accessToken, {
        method: 'POST',
        url: '/api/v1/auth/approve',
        payload: { userId: admin.user.id, pin, permission },
      });

    expect((await approveFor('billing.refund', '9182')).statusCode).toBe(401);

    const wrongScope = (await approveFor('billing.cancel')).json().approverToken;
    const tryRefund = (token: string) =>
      s.as(session.accessToken, {
        method: 'POST',
        url: '/api/v1/test/refund',
        headers: { 'x-approver-token': token },
        payload: {},
      });
    expect((await tryRefund(wrongScope)).statusCode).toBe(403);

    const expiring = (await approveFor('billing.refund')).json().approverToken;
    s.clock.advance(61_000);
    expect((await tryRefund(expiring)).statusCode).toBe(403);
  });

  it('does not let a cashier approve for themselves', async () => {
    s = await withRefundRoute();
    const admin = await s.login();
    const { session } = await cashier(s, admin.accessToken);
    const self = await s.as(session.accessToken, {
      method: 'POST',
      url: '/api/v1/auth/approve',
      payload: { userId: session.user.id, pin: '4826', permission: 'billing.refund' },
    });
    expect(self.statusCode).toBe(403);
    expect(self.json().code).toBe('FORBIDDEN');
  });
});
