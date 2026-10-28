import type { DeviceRecord, DeviceService } from '@restroos/application';
import { DEVICE_TOKEN_HEADER } from '@restroos/contracts';
import type { FastifyInstance, FastifyRequest } from 'fastify';
import fp from 'fastify-plugin';
import { HttpProblem } from '../problem';

export const DEVICE_COOKIE = 'restro_dt';

declare module 'fastify' {
  interface FastifyContextConfig {
    /**
     * Only from a paired device or the Hub PC itself. Used for PIN sign-in and
     * PIN approvals: a 4-digit PIN is only safe on a device the restaurant
     * registered, never from any browser that happens to be on the Wi-Fi.
     */
    pairedDeviceOnly?: boolean;
  }
  interface FastifyRequest {
    /** The paired device making the request, if any. */
    device?: DeviceRecord;
  }
}

export function isLocalhost(request: FastifyRequest): boolean {
  const ip = request.socket.remoteAddress ?? request.ip;
  return ip === '127.0.0.1' || ip === '::1' || ip === '::ffff:127.0.0.1';
}

export function deviceTokenOf(request: FastifyRequest): string | undefined {
  const header = request.headers[DEVICE_TOKEN_HEADER];
  if (typeof header === 'string' && header.length > 0) return header;
  return request.cookies[DEVICE_COOKIE];
}

/** Resolves the device token (cookie or X-Device-Token) on every API request. */
export const devicePlugin = fp<{ devices: DeviceService }>(
  async (app: FastifyInstance, { devices }) => {
    app.addHook('onRequest', async (request) => {
      const token = deviceTokenOf(request);
      if (token && token.length <= 128) {
        const device = devices.resolve(token, isLocalhost(request) ? 'LOCALHOST' : 'LAN');
        if (device) request.device = device;
      }
      if (
        request.routeOptions.config.pairedDeviceOnly &&
        !request.device &&
        !isLocalhost(request)
      ) {
        throw new HttpProblem(
          'DEVICE_NOT_PAIRED',
          'pair this device with the Hub to use PIN sign-in',
        );
      }
    });
  },
  { name: 'device', dependencies: ['@fastify/cookie'] },
);
