import {
  SaveChargeRuleRequestSchema,
  SavePrinterRequestSchema,
  SaveTaxGroupRequestSchema,
  UpdateBranchSettingsRequestSchema,
  UpdateChargeRuleRequestSchema,
  UpdatePrinterRequestSchema,
  UpdateTaxGroupRequestSchema,
  type BranchSettings,
  type ChargeRulesResponse,
  type PrintersResponse,
  type TaxGroupsResponse,
} from '@restroos/contracts';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import type { Cradle } from '../../container';
import { commandContext } from '../context';

const IdParams = z.object({ id: z.uuid() });
const MANAGE = { permission: 'settings.manage' } as const;

export async function settingsRoutes(app: FastifyInstance, { cradle }: { cradle: Cradle }) {
  const { settingsService: settings } = cradle;

  app.get(
    '/settings/branch',
    async (request) => settings.branch(request.principal!.branchId) as BranchSettings,
  );

  app.patch('/settings/branch', { config: MANAGE }, async (request) => {
    const body = UpdateBranchSettingsRequestSchema.parse(request.body);
    return settings.updateBranch(body, commandContext(request)) as BranchSettings;
  });

  app.get('/tax-groups', async (): Promise<TaxGroupsResponse> => ({ data: settings.taxGroups() }));
  app.post('/tax-groups', { config: MANAGE }, async (request, reply) => {
    const body = SaveTaxGroupRequestSchema.parse(request.body);
    reply.status(201);
    return settings.createTaxGroup(body, commandContext(request));
  });
  app.patch('/tax-groups/:id', { config: MANAGE }, async (request) => {
    const { id } = IdParams.parse(request.params);
    return settings.updateTaxGroup(
      id,
      UpdateTaxGroupRequestSchema.parse(request.body),
      commandContext(request),
    );
  });

  app.get('/charge-rules', async (request): Promise<ChargeRulesResponse> => ({
    data: settings.chargeRules(request.principal!.branchId) as ChargeRulesResponse['data'],
  }));
  app.post('/charge-rules', { config: MANAGE }, async (request, reply) => {
    const body = SaveChargeRuleRequestSchema.parse(request.body);
    reply.status(201);
    return settings.createChargeRule(body, commandContext(request));
  });
  app.patch('/charge-rules/:id', { config: MANAGE }, async (request) => {
    const { id } = IdParams.parse(request.params);
    return settings.updateChargeRule(
      id,
      UpdateChargeRuleRequestSchema.parse(request.body),
      commandContext(request),
    );
  });

  app.get('/printers', async (request): Promise<PrintersResponse> => ({
    data: settings.printers(request.principal!.branchId),
  }));
  app.post('/printers', { config: MANAGE }, async (request, reply) => {
    const body = SavePrinterRequestSchema.parse(request.body);
    reply.status(201);
    return settings.createPrinter(body, commandContext(request));
  });
  app.patch('/printers/:id', { config: MANAGE }, async (request) => {
    const { id } = IdParams.parse(request.params);
    return settings.updatePrinter(
      id,
      UpdatePrinterRequestSchema.parse(request.body),
      commandContext(request),
    );
  });
  app.post('/printers/:id/test', { config: MANAGE }, async (request, reply) => {
    const { id } = IdParams.parse(request.params);
    settings.requestTestPrint(id, commandContext(request));
    return reply.send(await cradle.printService.testPage(id, request.principal!.branchId));
  });
}
