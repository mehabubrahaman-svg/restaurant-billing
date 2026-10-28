import { AuditLogQuerySchema, type AuditVerifyResponse } from '@restroos/contracts';
import type { FastifyInstance } from 'fastify';
import type { Cradle } from '../../container';

const VIEW = { permission: 'audit.view' } as const;

export async function auditRoutes(app: FastifyInstance, { cradle }: { cradle: Cradle }) {
  const { auditQueries, clock } = cradle;

  app.get('/audit-logs', { config: VIEW }, async (request) => {
    const query = AuditLogQuerySchema.parse(request.query);
    return auditQueries.page({ ...query, branchId: request.principal!.branchId });
  });

  app.post('/audit-logs/verify', { config: VIEW }, async (): Promise<AuditVerifyResponse> => ({
    ...auditQueries.verifyChain(),
    checkedAt: clock.now().toISOString(),
  }));
}
