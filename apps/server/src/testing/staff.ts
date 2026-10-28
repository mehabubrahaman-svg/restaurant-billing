import { RolesResponseSchema } from '@restroos/contracts';
import type { TestServer } from './test-server';

export type Call = (
  method: 'GET' | 'POST' | 'PATCH' | 'PUT',
  url: string,
  payload?: object,
  headers?: Record<string, string>,
) => ReturnType<TestServer['as']>;

/** A caller for `/api/v1` routes with the given access token. */
export function caller(s: TestServer, token: string): Call {
  return (method, url, payload, headers) =>
    s.as(token, {
      method,
      url: `/api/v1${url}`,
      ...(payload && { payload }),
      ...(headers && { headers }),
    });
}

/** Creates a staff member with one role template and signs them in. */
export async function signInAs(s: TestServer, admin: Call, roleCode: string, username: string) {
  const roles = RolesResponseSchema.parse((await admin('GET', '/roles')).json()).data;
  const roleId = roles.find((r) => r.code === roleCode)!.id;
  const password = 'Staff#Pass2026';
  const res = await admin('POST', '/users', {
    username,
    fullName: username,
    password,
    roleIds: [roleId],
  });
  if (res.statusCode !== 201) throw new Error(`could not create ${username}: ${res.body}`);
  const session = await s.login(username, password);
  return caller(s, session.accessToken);
}

/** Rows a command wrote to the audit log and the outbox, for the Definition-of-Done check. */
export function trail(s: TestServer, entityId: string) {
  const db = s.database.db;
  return {
    audit: db
      .prepare<[string], string>('SELECT action FROM audit_logs WHERE entity_id = ? ORDER BY rowid')
      .pluck()
      .all(entityId),
    events: db
      .prepare<[string], string>(
        'SELECT event_type FROM domain_events WHERE aggregate_id = ? ORDER BY seq',
      )
      .pluck()
      .all(entityId),
    queued: db
      .prepare<[string], number>('SELECT count(*) FROM sync_queue WHERE entity_id = ?')
      .pluck()
      .get(entityId)!,
  };
}
