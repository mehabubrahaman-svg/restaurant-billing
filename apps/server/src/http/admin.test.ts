import { AuditLogPageSchema, RolesResponseSchema, UserSchema } from '@restroos/contracts';
import { afterEach, describe, expect, it } from 'vitest';
import { createTestServer, type TestServer } from '../testing/test-server';

let s: TestServer;
afterEach(async () => s?.close());

async function adminServer() {
  s = await createTestServer();
  const admin = await s.login();
  const call = (method: 'GET' | 'POST' | 'PATCH', url: string, payload?: object) =>
    s.as(admin.accessToken, { method, url: `/api/v1${url}`, ...(payload && { payload }) });
  const roles = RolesResponseSchema.parse((await call('GET', '/roles')).json()).data;
  const roleId = (code: string) => roles.find((r) => r.code === code)!.id;
  return { admin, call, roleId };
}

describe('users', () => {
  it('creates, edits and lists staff', async () => {
    const { call, roleId } = await adminServer();
    const created = await call('POST', '/users', {
      username: 'Priya.Captain',
      fullName: 'Priya Ghosh',
      password: 'Sandesh@2026',
      pin: '3917',
      roleIds: [roleId('CAPTAIN')],
    });
    expect(created.statusCode).toBe(201);
    const user = UserSchema.parse(created.json());
    expect(user).toMatchObject({ username: 'priya.captain', hasPin: true, isActive: true });

    const edited = await call('PATCH', `/users/${user.id}`, {
      version: user.version,
      phone: '+919830012345',
    });
    expect(edited.json()).toMatchObject({ phone: '+919830012345', version: user.version + 1 });

    const stale = await call('PATCH', `/users/${user.id}`, {
      version: user.version,
      fullName: 'Priya G.',
    });
    expect(stale.statusCode).toBe(409);

    const list = (await call('GET', '/users')).json().data;
    expect(list.map((u: { username: string }) => u.username)).toEqual(['owner', 'priya.captain']);
  });

  it('refuses duplicate usernames, weak passwords and easy PINs', async () => {
    const { call, roleId } = await adminServer();
    const base = { fullName: 'Someone', roleIds: [roleId('CASHIER')] };
    expect(
      (
        await call('POST', '/users', { ...base, username: 'owner', password: 'Good-Pass-77' })
      ).json().code,
    ).toBe('USERNAME_TAKEN');
    expect(
      (await call('POST', '/users', { ...base, username: 'amit', password: 'amit12345' })).json()
        .code,
    ).toBe('PASSWORD_TOO_WEAK');
    expect(
      (
        await call('POST', '/users', {
          ...base,
          username: 'amit',
          password: 'Good-Pass-77',
          pin: '1234',
        })
      ).json().code,
    ).toBe('PIN_TOO_WEAK');
  });

  it('never leaves the restaurant without an admin', async () => {
    const { admin, call, roleId } = await adminServer();
    const me = (await call('GET', '/users')).json().data[0];
    const demote = await call('PATCH', `/users/${me.id}`, {
      version: me.version,
      roleIds: [roleId('MANAGER')],
    });
    expect(demote.json().code).toBe('LAST_ADMIN');
    const self = await call('POST', `/users/${admin.user.id}/deactivate`);
    expect(self.json().code).toBe('CANNOT_DEACTIVATE_SELF');
  });

  it('unlocks a locked account and resets a PIN', async () => {
    const { call, roleId } = await adminServer();
    const user = (
      await call('POST', '/users', {
        username: 'kitchen1',
        fullName: 'Bablu Mondal',
        password: 'Machher-Jhol-9',
        roleIds: [roleId('KITCHEN')],
      })
    ).json();
    for (let i = 0; i < 5; i++) {
      await s.app.inject({
        method: 'POST',
        url: '/api/v1/auth/login',
        payload: { username: 'kitchen1', password: 'wrong-password' },
      });
    }
    const locked = (await call('GET', '/users'))
      .json()
      .data.find((u: { id: string }) => u.id === user.id);
    expect(locked.lockedUntil).not.toBeNull();
    expect((await call('POST', `/users/${user.id}/unlock`)).json().lockedUntil).toBeNull();
    expect((await call('POST', `/users/${user.id}/reset-pin`, { pin: '6402' })).json().hasPin).toBe(
      true,
    );
  });
});

describe('roles', () => {
  it('lets the owner adjust a role but never ADMIN', async () => {
    const { call, roleId } = await adminServer();
    const roles = (await call('GET', '/roles')).json().data;
    const cashier = roles.find((r: { code: string }) => r.code === 'CASHIER');
    const updated = await call('PATCH', `/roles/${cashier.id}`, {
      version: cashier.version,
      permissions: [...cashier.permissions, 'billing.complimentary'],
    });
    expect(updated.json().permissions).toContain('billing.complimentary');

    const admin = roles.find((r: { code: string }) => r.code === 'ADMIN');
    expect(
      (
        await call('PATCH', `/roles/${admin.id}`, { version: admin.version, permissions: [] })
      ).json().code,
    ).toBe('ROLE_LOCKED');
    expect(
      (
        await call('POST', '/roles', {
          code: 'BARTENDER',
          name: 'Bartender',
          permissions: ['not.real'],
        })
      ).json().code,
    ).toBe('PERMISSION_UNKNOWN');
    const bartender = await call('POST', '/roles', {
      code: 'BARTENDER',
      name: 'Bartender',
      permissions: ['orders.create', 'orders.fire_kot'],
    });
    expect(bartender.statusCode).toBe(201);
    expect(roleId('CASHIER')).toBeTruthy();
  });
});

describe('settings', () => {
  it('updates branch settings with a version check and validates the GSTIN', async () => {
    const { call } = await adminServer();
    const branch = (await call('GET', '/settings/branch')).json();
    const updated = await call('PATCH', '/settings/branch', {
      version: branch.version,
      receiptFooter: 'ধন্যবাদ! আবার আসবেন।',
      cashRounding: 50,
      dayStartsAt: '05:00',
    });
    expect(updated.json()).toMatchObject({
      receiptFooter: 'ধন্যবাদ! আবার আসবেন।',
      cashRounding: 50,
      dayStartsAt: '05:00',
    });
    expect((await call('GET', '/settings/branch')).json().receiptFooter).toBe(
      'ধন্যবাদ! আবার আসবেন।',
    );

    const wrongState = await call('PATCH', '/settings/branch', {
      version: updated.json().version,
      gstin: '27AAPFU0939F1ZV',
    });
    expect(wrongState.json().code).toBe('GSTIN_STATE_MISMATCH');
  });

  it('keeps GST and VAT groups consistent', async () => {
    const { call } = await adminServer();
    const ok = await call('POST', '/tax-groups', {
      name: 'GST 40%',
      taxType: 'GST',
      components: [
        { code: 'CGST', rateBp: 2000, appliesTo: 'INTRA_STATE' },
        { code: 'SGST', rateBp: 2000, appliesTo: 'INTRA_STATE' },
        { code: 'IGST', rateBp: 4000, appliesTo: 'INTER_STATE' },
      ],
    });
    expect(ok.statusCode).toBe(201);
    const lopsided = await call('POST', '/tax-groups', {
      name: 'Broken',
      taxType: 'GST',
      components: [
        { code: 'CGST', rateBp: 250, appliesTo: 'INTRA_STATE' },
        { code: 'SGST', rateBp: 900, appliesTo: 'INTRA_STATE' },
      ],
    });
    expect(lopsided.json().code).toBe('TAX_GROUP_INVALID');
    const mixed = await call('POST', '/tax-groups', {
      name: 'Mixed',
      taxType: 'VAT',
      components: [{ code: 'IGST', rateBp: 500, appliesTo: 'ALWAYS' }],
    });
    expect(mixed.json().code).toBe('TAX_GROUP_INVALID');

    const group = ok.json();
    const off = await call('PATCH', `/tax-groups/${group.id}`, {
      version: group.version,
      isActive: false,
    });
    expect(off.json().isActive).toBe(false);
  });

  it('manages service charge and printers', async () => {
    const { call } = await adminServer();
    const charge = await call('POST', '/charge-rules', {
      name: 'Service charge',
      kind: 'PERCENT',
      value: 500,
      orderTypes: ['DINE_IN'],
    });
    expect(charge.json()).toMatchObject({ value: 500, isOptional: true, isActive: true });
    const printer = await call('POST', '/printers', {
      name: 'Counter printer',
      connection: 'NETWORK',
      address: '192.168.1.50:9100',
      purpose: 'BILL',
    });
    expect(printer.statusCode).toBe(201);
    expect((await call('POST', `/printers/${printer.json().id}/test`)).statusCode).toBe(202);
    expect((await call('GET', '/printers')).json().data).toHaveLength(1);
  });
});

describe('audit log', () => {
  it('pages newest first, filters, and verifies the chain', async () => {
    const { call, roleId } = await adminServer();
    for (const name of ['waiter1', 'waiter2', 'waiter3']) {
      await call('POST', '/users', {
        username: name,
        fullName: name,
        password: 'Phuchka-Time-1',
        roleIds: [roleId('CAPTAIN')],
      });
    }
    const first = AuditLogPageSchema.parse(
      (await call('GET', '/audit-logs?action=user.create&limit=2')).json(),
    );
    expect(first.data).toHaveLength(2);
    expect(first.data[0]!.actor?.fullName).toBe('Ananya Sen');
    expect((first.data[0]!.after as { username: string }).username).toBe('waiter3');
    const second = AuditLogPageSchema.parse(
      (
        await call('GET', `/audit-logs?action=user.create&limit=2&cursor=${first.nextCursor}`)
      ).json(),
    );
    expect(second.data.map((e) => (e.after as { username: string }).username)).toEqual(['waiter1']);
    expect(second.nextCursor).toBeNull();

    const verify = await call('POST', '/audit-logs/verify');
    expect(verify.json()).toMatchObject({ ok: true });
    expect(verify.json().rows).toBeGreaterThan(4);
  });
});
