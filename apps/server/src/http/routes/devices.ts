import type { DeviceRecord } from '@restroos/application';
import {
  CreatePairingCodeRequestSchema,
  PairDeviceRequestSchema,
  SavePeripheralRequestSchema,
  UpdateDeviceRequestSchema,
  UpdatePeripheralRequestSchema,
  type Device,
  type DevicesResponse,
  type HubInfo,
  type PairDeviceResponse,
  type PairingCodeResponse,
  type PeripheralsResponse,
} from '@restroos/contracts';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import type { Cradle } from '../../container';
import { hubUrls, MDNS_HOST } from '../../hub-network';
import { clientInfo, commandContext } from '../context';
import { DEVICE_COOKIE } from '../plugins/device';
import { HttpProblem } from '../problem';

const IdParams = z.object({ id: z.uuid() });
const MANAGE = { permission: 'settings.manage' } as const;
/** Device tokens last until the device is unpaired; the cookie is renewed on every pairing. */
const DEVICE_COOKIE_DAYS = 400;
const PAIR_LIMIT = { rateLimit: { max: 10, timeWindow: '1 minute' } };

export function toDevice(d: DeviceRecord): Device {
  return {
    id: d.id,
    name: d.name,
    kind: d.kind,
    platform: d.platform,
    lastSeenAt: d.lastSeenAt?.toISOString() ?? null,
    pairedAt: d.pairedAt?.toISOString() ?? null,
    isActive: d.isActive,
    version: d.version,
  };
}

/** WP 3.4: discovery, pairing, the device registry and peripherals. */
export async function deviceRoutes(app: FastifyInstance, { cradle }: { cradle: Cradle }) {
  const { deviceService: devices, hubNetwork, config, setupService } = cradle;
  const restaurantName = cradle.db
    .prepare<[], string>('SELECT name FROM organizations ORDER BY created_at LIMIT 1')
    .pluck();

  // ---- discovery (public) ----------------------------------------------------------
  app.get('/hub/info', { config: { public: true } }, async (): Promise<HubInfo> => ({
    name: 'RestroOS Hub',
    restaurantName: restaurantName.get() ?? null,
    version: config.version,
    needsSetup: setupService.needsSetup(),
    urls: hubUrls(hubNetwork),
    caFingerprint: hubNetwork.tls.caFingerprint,
    mdnsHost: MDNS_HOST,
  }));

  // The local CA, so a device can trust the Hub's HTTPS certificate.
  app.get('/hub/ca.crt', { config: { public: true } }, async (_request, reply) =>
    reply
      .header('content-type', 'application/x-x509-ca-cert')
      .header('content-disposition', 'attachment; filename="restroos-hub-ca.crt"')
      .send(hubNetwork.tls.caCertPem),
  );

  // ---- pairing -------------------------------------------------------------------------
  app.post(
    '/devices/pairing-codes',
    { config: MANAGE },
    async (request, reply): Promise<PairingCodeResponse> => {
      const body = CreatePairingCodeRequestSchema.parse(request.body);
      const { code, expiresAt } = devices.createPairingCode(body, commandContext(request));
      // First contact is over plain HTTP on the LAN: the device can't trust the CA before pairing.
      const base = hubUrls(hubNetwork).http[0] ?? `http://localhost:${hubNetwork.httpPort}`;
      reply.status(201);
      return {
        code,
        expiresAt: expiresAt.toISOString(),
        pairUrl: `${base}/pair?code=${code}`,
        caFingerprint: hubNetwork.tls.caFingerprint,
      };
    },
  );

  app.post(
    '/devices/pair',
    { config: { public: true, ...PAIR_LIMIT } },
    async (request, reply): Promise<PairDeviceResponse> => {
      const body = PairDeviceRequestSchema.parse(request.body);
      const client = clientInfo(request);
      const { device, token } = devices.pair(body, client);
      reply.setCookie(DEVICE_COOKIE, token, {
        httpOnly: true,
        sameSite: 'strict',
        secure: request.protocol === 'https',
        // Also sent on the WebSocket upgrade (/ws), where a token display with nobody signed in is recognised by it.
        path: '/',
        maxAge: DEVICE_COOKIE_DAYS * 86_400,
      });
      reply.status(201);
      return { device: toDevice(device), deviceToken: token };
    },
  );

  /** Which device this is. Public: a device asks before anyone signs in on it. */
  app.get('/devices/me', { config: { public: true } }, async (request): Promise<Device> => {
    if (!request.device)
      throw new HttpProblem('DEVICE_NOT_PAIRED', 'this device is not paired with the Hub');
    return toDevice(request.device);
  });

  // ---- registry (admin) ----------------------------------------------------------------
  app.get('/devices', { config: MANAGE }, async (request): Promise<DevicesResponse> => ({
    data: devices.list(request.principal!.branchId).map(toDevice),
  }));
  app.patch('/devices/:id', { config: MANAGE }, async (request) => {
    const { id } = IdParams.parse(request.params);
    return toDevice(
      devices.update(id, UpdateDeviceRequestSchema.parse(request.body), commandContext(request)),
    );
  });

  // ---- peripherals ---------------------------------------------------------------------
  app.get('/peripherals', { config: MANAGE }, async (request): Promise<PeripheralsResponse> => ({
    data: devices.peripherals(request.principal!.branchId),
  }));
  app.post('/peripherals', { config: MANAGE }, async (request, reply) => {
    const body = SavePeripheralRequestSchema.parse(request.body);
    reply.status(201);
    return devices.createPeripheral(body, commandContext(request));
  });
  app.patch('/peripherals/:id', { config: MANAGE }, async (request) => {
    const { id } = IdParams.parse(request.params);
    return devices.updatePeripheral(
      id,
      UpdatePeripheralRequestSchema.parse(request.body),
      commandContext(request),
    );
  });
}
