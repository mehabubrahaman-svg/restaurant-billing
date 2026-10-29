import { mkdirSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { parseArgs } from 'node:util';
import { buildRelay } from './app';
import { RelayStore } from './store';

/**
 * RestroOS relay. Run it on a small cloud server behind HTTPS (a reverse
 * proxy such as Caddy or nginx); the Hub connects with wss://.
 *
 *   node dist/main.js                      serve (RELAY_PORT, RELAY_HOST, RELAY_DATA_DIR)
 *   node dist/main.js add-hub --name "Park Street" [--middleware-url URL] [--middleware-key KEY]
 *                                          prints the hub id, the Hub's key and the webhook secret once
 */
const dataDir = resolve(process.env['RELAY_DATA_DIR'] ?? 'relay-data');
mkdirSync(dataDir, { recursive: true });
const store = new RelayStore(join(dataDir, 'relay.db'));

const { positionals, values } = parseArgs({
  allowPositionals: true,
  options: {
    name: { type: 'string' },
    'middleware-url': { type: 'string' },
    'middleware-key': { type: 'string' },
  },
});

if (positionals[0] === 'add-hub') {
  if (!values.name) {
    console.error('add-hub needs --name');
    process.exit(2);
  }
  const hub = store.addHub({
    name: values.name,
    ...(values['middleware-url'] ? { middlewareUrl: values['middleware-url'] } : {}),
    ...(values['middleware-key'] ? { middlewareKey: values['middleware-key'] } : {}),
  });
  console.log(
    JSON.stringify(
      {
        hubId: hub.id,
        hubKey: hub.key,
        webhookUrl: `/webhooks/${hub.id}`,
        webhookSecret: hub.webhookSecret,
        note: 'Shown once. Enter the hub id and key in the Hub (Admin → Online orders); give the webhook URL and secret to the middleware.',
      },
      null,
      2,
    ),
  );
  store.close();
} else {
  const { app } = buildRelay({
    store,
    logger: { level: process.env['RELAY_LOG_LEVEL'] ?? 'info' },
  });
  const port = Number(process.env['RELAY_PORT'] ?? 7800);
  const host = process.env['RELAY_HOST'] ?? '0.0.0.0';
  await app.listen({ port, host });
  const stop = async () => {
    await app.close();
    store.close();
    process.exit(0);
  };
  process.once('SIGINT', () => void stop());
  process.once('SIGTERM', () => void stop());
}
