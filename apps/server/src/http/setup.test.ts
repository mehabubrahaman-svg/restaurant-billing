import { SetupStatusResponseSchema } from '@restroos/contracts';
import { gstinCheckCharacter } from '@restroos/domain';
import { afterEach, describe, expect, it } from 'vitest';
import {
  createTestServer,
  SETUP_FIXTURE,
  TEST_SETUP_CODE,
  type TestServer,
} from '../testing/test-server';

let s: TestServer;
afterEach(async () => s?.close());

const fresh = () => createTestServer({ install: false });
const setup = (body: object) =>
  s.app.inject({ method: 'POST', url: '/api/v1/setup', payload: body });
const westBengalGstin = () => {
  const first14 = '19AABCS1234Q1Z';
  return first14 + gstinCheckCharacter(first14);
};

describe('first-time setup', () => {
  it('offers only wave 1 states, with liquor rules per state', async () => {
    s = await fresh();
    const res = await s.app.inject({ method: 'GET', url: '/api/v1/setup/status' });
    const status = SetupStatusResponseSchema.parse(res.json());
    expect(status.needsSetup).toBe(true);
    const codes = status.states.map((st) => st.gstStateCode);
    expect(codes).toContain('19'); // West Bengal
    expect(codes).toContain('07'); // Delhi
    expect(codes).not.toContain('27'); // Maharashtra is wave 2
    expect(status.states.find((st) => st.gstStateCode === '10')).toMatchObject({
      name: 'Bihar',
      liquorPermitted: false,
    });
  });

  it('sets up the restaurant, then lets the admin sign in', async () => {
    s = await fresh();
    const res = await setup({
      ...SETUP_FIXTURE,
      branch: { ...SETUP_FIXTURE.branch, gstin: westBengalGstin() },
    });
    expect(res.statusCode).toBe(201);
    expect(
      (await s.app.inject({ method: 'GET', url: '/api/v1/setup/status' })).json().needsSetup,
    ).toBe(false);

    const session = await s.login();
    expect(session.roles).toEqual(['ADMIN']);

    const taxes = (
      await s.as(session.accessToken, { method: 'GET', url: '/api/v1/tax-groups' })
    ).json().data;
    expect(taxes.map((t: { name: string }) => t.name).sort()).toEqual([
      'GST 0%',
      'GST 18%',
      'GST 5%',
      'Liquor VAT 20%',
    ]);
    expect(taxes.find((t: { name: string }) => t.name === 'Liquor VAT 20%')).toMatchObject({
      taxType: 'VAT',
      invoiceSeries: 'LIQ',
    });

    const branch = (
      await s.as(session.accessToken, { method: 'GET', url: '/api/v1/settings/branch' })
    ).json();
    expect(branch).toMatchObject({
      stateName: 'West Bengal',
      gstin: westBengalGstin(),
      liquorEnabled: true,
      liquorInvoice: 'SEPARATE',
      defaultLocale: 'bn-IN',
      receiptLanguages: ['en', 'bn'],
    });

    const series = s.database.db
      .prepare('SELECT series, prefix FROM document_sequences ORDER BY series')
      .all();
    expect(series).toEqual([
      { series: 'CN', prefix: 'KOL1/CN/2026-27/' },
      { series: 'INV', prefix: 'KOL1/2026-27/' },
      { series: 'LIQ', prefix: 'KOL1/LIQ/2026-27/' },
    ]);
    const roles = s.database.db.prepare('SELECT code FROM roles ORDER BY code').pluck().all();
    expect(roles).toEqual([
      'ACCOUNTANT',
      'ADMIN',
      'CAPTAIN',
      'CASHIER',
      'INVENTORY',
      'KITCHEN',
      'MANAGER',
    ]);
  });

  it('runs only once', async () => {
    s = await createTestServer(); // already installed
    const res = await setup(SETUP_FIXTURE);
    expect(res.statusCode).toBe(409);
    expect(res.json().code).toBe('SETUP_ALREADY_DONE');
  });

  it('requires the code shown on the Hub, and rolls it after repeated guesses', async () => {
    s = await fresh();
    const wrong = await setup({ ...SETUP_FIXTURE, setupCode: 'GUESS123' });
    expect(wrong.statusCode).toBe(403);
    expect(wrong.json().code).toBe('INVALID_SETUP_CODE');
    for (let i = 0; i < 4; i++) await setup({ ...SETUP_FIXTURE, setupCode: 'GUESS123' });
    expect(s.setupCode.current()).not.toBe(TEST_SETUP_CODE);
    expect((await setup(SETUP_FIXTURE)).statusCode).toBe(403);
  });

  it('rejects a GSTIN from another state or with a typo', async () => {
    s = await fresh();
    const maharashtra = await setup({
      ...SETUP_FIXTURE,
      branch: { ...SETUP_FIXTURE.branch, gstin: '27AAPFU0939F1ZV' },
    });
    expect(maharashtra.json()).toMatchObject({ status: 422, code: 'GSTIN_STATE_MISMATCH' });
    const typo = westBengalGstin().slice(0, 14) + (westBengalGstin()[14] === 'A' ? 'B' : 'A');
    const mistyped = await setup({
      ...SETUP_FIXTURE,
      branch: { ...SETUP_FIXTURE.branch, gstin: typo },
    });
    expect(mistyped.json().code).toBe('GSTIN_INVALID');
  });

  it('refuses liquor in a prohibition state unless explicitly overridden', async () => {
    s = await fresh();
    const bihar = { ...SETUP_FIXTURE, branch: { ...SETUP_FIXTURE.branch, stateCode: '10' } };
    const refused = await setup(bihar);
    expect(refused.json().code).toBe('LIQUOR_NOT_PERMITTED_IN_STATE');
    const overridden = await setup({
      ...bihar,
      liquor: { ...SETUP_FIXTURE.liquor, overrideProhibition: true },
    });
    expect(overridden.statusCode).toBe(201);
  });

  it('refuses wave 2 states and weak admin passwords', async () => {
    s = await fresh();
    const wave2 = await setup({
      ...SETUP_FIXTURE,
      branch: { ...SETUP_FIXTURE.branch, stateCode: '27' },
    });
    expect(wave2.json().code).toBe('STATE_NOT_AVAILABLE');
    const weak = await setup({
      ...SETUP_FIXTURE,
      admin: { ...SETUP_FIXTURE.admin, password: '12345678' },
    });
    expect(weak.json().code).toBe('PASSWORD_TOO_WEAK');
    expect(
      (await s.app.inject({ method: 'GET', url: '/api/v1/setup/status' })).json().needsSetup,
    ).toBe(true);
  });

  it('stores the backup key derived from the passphrase, never the passphrase', async () => {
    s = await fresh();
    await setup(SETUP_FIXTURE);
    const secrets = s.database.db
      .prepare('SELECT name, value FROM system_secrets ORDER BY name')
      .all() as {
      name: string;
      value: string;
    }[];
    expect(secrets.map((x) => x.name)).toEqual(['backup.kdf', 'backup.key']);
    expect(JSON.stringify(secrets)).not.toContain(SETUP_FIXTURE.backupPassphrase);
    expect(secrets[0]!.value).toMatch(/^scrypt\$32768\$8\$1\$/);
    expect(secrets[1]!.value).toMatch(/^[0-9a-f]{64}$/);
  });
});
