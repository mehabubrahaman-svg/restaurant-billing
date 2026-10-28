/**
 * Static server for the measurement page (web/index.html + web/dist/main.js).
 *
 *   pnpm --filter @restroos/spike-bluetooth web            # HTTP on :8080
 *   pnpm --filter @restroos/spike-bluetooth web -- --https # HTTPS on :8443 with a spike CA
 *
 * Web Bluetooth only runs in a secure context. RUNBOOK §4 explains the three
 * ways to get one on a tablet; HTTPS with an installed CA is the one closest
 * to production.
 */
import { readFileSync } from 'node:fs';
import {
  createServer as createHttpServer,
  type IncomingMessage,
  type ServerResponse,
} from 'node:http';
import { createServer as createHttpsServer } from 'node:https';
import { networkInterfaces } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';
import { ensureServerCert } from './spike-certs';

const { values: args } = parseArgs({
  options: {
    https: { type: 'boolean', default: false },
    port: { type: 'string' },
  },
});

const webDir = join(dirname(fileURLToPath(import.meta.url)), '..', 'web');
const ips = Object.values(networkInterfaces())
  .flatMap((list) => list ?? [])
  .filter((a) => a.family === 'IPv4' && !a.internal)
  .map((a) => a.address);
const cert = args.https ? ensureServerCert(ips) : undefined;

const routes: Record<string, { file: string; type: string }> = {
  '/': { file: join(webDir, 'index.html'), type: 'text/html; charset=utf-8' },
  '/main.js': { file: join(webDir, 'dist', 'main.js'), type: 'text/javascript; charset=utf-8' },
  '/main.js.map': { file: join(webDir, 'dist', 'main.js.map'), type: 'application/json' },
  ...(cert ? { '/ca.crt': { file: cert.caCertPath, type: 'application/x-x509-ca-cert' } } : {}),
};

function handle(req: IncomingMessage, res: ServerResponse): void {
  const route = routes[(req.url ?? '/').split('?')[0]!];
  if (!route || req.method !== 'GET') {
    res.writeHead(404).end('not found');
    return;
  }
  try {
    res.writeHead(200, { 'content-type': route.type, 'cache-control': 'no-store' });
    res.end(readFileSync(route.file));
  } catch {
    res.writeHead(500).end(`missing ${route.file}: run "pnpm build:web" first`);
  }
}

const port = Number(args.port ?? (cert ? 8443 : 8080));
const server = cert
  ? createHttpsServer(
      { cert: readFileSync(cert.certPath), key: readFileSync(cert.keyPath) },
      handle,
    )
  : createHttpServer(handle);

server.listen(port, () => {
  const scheme = cert ? 'https' : 'http';
  console.log(`measurement page on:`);
  for (const host of ['localhost', ...ips]) console.log(`  ${scheme}://${host}:${port}/`);
  if (cert)
    console.log(`install the CA on each tablet from ${scheme}://<ip>:${port}/ca.crt (RUNBOOK §4)`);
  else
    console.log('plain HTTP: a tablet needs adb reverse or the insecure-origin flag (RUNBOOK §4)');
});
