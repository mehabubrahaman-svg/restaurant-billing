import type { Clock } from '@restroos/application';
import {
  ensureTlsMaterial,
  lanAddresses,
  SqliteSecretStore,
  type SqliteDatabase,
  type TlsMaterial,
} from '@restroos/infrastructure';

export const MDNS_HOST = 'restro.local';

/** How devices on the LAN reach this Hub, and the certificate they should trust. */
export interface HubNetwork {
  readonly httpPort: number;
  readonly httpsPort: number;
  /** Current certificate material; the server certificate changes when the LAN address does. */
  readonly tls: TlsMaterial;
  /** Current LAN IPv4 addresses (they can change when the router hands out a new lease). */
  addresses(): string[];
  /** Re-issues the server certificate if the addresses changed. True when it did. */
  refresh(): boolean;
}

export function hubNetwork(
  db: SqliteDatabase,
  clock: Clock,
  ports: { http: number; https: number },
  addresses: () => string[] = lanAddresses,
): HubNetwork {
  const store = new SqliteSecretStore(db, clock);
  const issue = () =>
    ensureTlsMaterial(
      store,
      { dns: [MDNS_HOST, 'localhost'], ips: ['127.0.0.1', ...addresses()] },
      clock.now(),
    );
  let tls = issue();
  return {
    httpPort: ports.http,
    httpsPort: ports.https,
    get tls() {
      return tls;
    },
    addresses,
    refresh() {
      const next = issue();
      if (next.serverCertPem === tls.serverCertPem) return false;
      tls = next;
      return true;
    },
  };
}

export function hubUrls(network: HubNetwork) {
  const hosts = network.addresses();
  return {
    http: hosts.map((h) => `http://${h}:${network.httpPort}`),
    https:
      network.httpsPort > 0
        ? [
            `https://${MDNS_HOST}:${network.httpsPort}`,
            ...hosts.map((h) => `https://${h}:${network.httpsPort}`),
          ]
        : [],
  };
}
