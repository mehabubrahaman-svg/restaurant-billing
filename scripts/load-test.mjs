#!/usr/bin/env node
// Dinner-rush load test for a Hub (docs/09 WP 5.10; target from docs/08:
// p95 API latency under 100 ms on the Hub PC).
//
//   node scripts/load-test.mjs --hub http://127.0.0.1:7400 --setup-code ABCD1234 [--minutes 3]
//
// Point it at a NEW, empty Hub started with a known RESTRO_SETUP_CODE and a
// high RESTRO_RATE_LIMIT_PER_MINUTE (every simulated device shares this
// machine's IP). It sets the Hub up, adds staff, a 30-item menu and tables,
// then runs, concurrently:
//   - captains: open a table, add items in 1–3 rounds, send to the kitchen, re-read the floor
//   - kitchen screens: read the KOT board, move KOTs to READY
//   - cashiers: preview, bill and take payment (split cash + UPI) for orders whose food is ready
//   - token TV and the owner's dashboard polling
// and prints latency percentiles per route. Exit code 1 if overall p95 ≥ the target.
// No dependencies beyond Node 22.

const args = Object.fromEntries(
  process.argv.slice(2).reduce((pairs, a, i, all) => {
    if (a.startsWith('--'))
      pairs.push([a.slice(2), all[i + 1]?.startsWith('--') ? 'true' : (all[i + 1] ?? 'true')]);
    return pairs;
  }, []),
);
const HUB = `${(args.hub ?? 'http://127.0.0.1:7400').replace(/\/$/, '')}/api/v1`;
const MINUTES = Number(args.minutes ?? 3);
const CAPTAINS = Number(args.captains ?? 8);
const KITCHENS = Number(args.kitchens ?? 3);
const CASHIERS = Number(args.cashiers ?? 2);
const TABLES = Number(args.tables ?? 40);
const TARGET_P95_MS = Number(args['target-p95'] ?? 100);
const PASSWORD = 'Load#Test2026';

const samples = new Map(); // route label → durations (ms)
const failures = new Map(); // route label → { status → count }
let stopping = false;

async function request(
  session,
  method,
  path,
  body,
  label = `${method} ${path.replace(/[0-9a-f-]{36}/g, ':id').replace(/\?.*/, '')}`,
) {
  const headers = { ...(body !== undefined && { 'content-type': 'application/json' }) };
  if (session?.token) headers.authorization = `Bearer ${session.token}`;
  if (method !== 'GET') headers['idempotency-key'] = crypto.randomUUID();
  const started = performance.now();
  const res = await fetch(HUB + path, {
    method,
    headers,
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await res.text();
  const ms = performance.now() - started;
  if (res.status === 401 && session?.username) {
    await login(session);
    return request(session, method, path, body, label);
  }
  if (res.status >= 400) {
    const byStatus = failures.get(label) ?? {};
    const code = (() => {
      try {
        return JSON.parse(text).code ?? res.status;
      } catch {
        return res.status;
      }
    })();
    byStatus[code] = (byStatus[code] ?? 0) + 1;
    failures.set(label, byStatus);
    return { status: res.status, body: null };
  }
  if (!samples.has(label)) samples.set(label, []);
  samples.get(label).push(ms);
  return { status: res.status, body: text ? JSON.parse(text) : null };
}

async function must(session, method, path, body) {
  const res = await request(session, method, path, body, 'setup');
  if (!res.body && res.status >= 400) throw new Error(`${method} ${path} failed: ${res.status}`);
  return res.body;
}

async function login(session) {
  const res = await fetch(`${HUB}/auth/login`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ username: session.username, password: session.password }),
  });
  if (!res.ok) throw new Error(`login ${session.username}: ${res.status} ${await res.text()}`);
  session.token = (await res.json()).accessToken;
  return session;
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const pick = (list) => list[Math.floor(Math.random() * list.length)];
const think = (min, max) => sleep(min + Math.random() * (max - min));

async function seed() {
  if (!args['setup-code']) throw new Error('--setup-code is required (the Hub must be new)');
  await must(null, 'POST', '/setup', {
    setupCode: args['setup-code'],
    organization: { name: 'Load Test Kitchen', legalName: 'Load Test Kitchen Pvt Ltd' },
    branch: { name: 'Rush Hour', code: 'LOAD', stateCode: '19' },
    liquor: { enabled: false },
    languages: { defaultLocale: 'en-IN', receiptLanguages: ['en'] },
    admin: { username: 'owner', fullName: 'Load Owner', password: PASSWORD, pin: '2580' },
    backupPassphrase: 'load test backup passphrase',
  });
  const owner = await login({ username: 'owner', password: PASSWORD });
  const roles = (await must(owner, 'GET', '/roles')).data;
  const role = (code) => roles.find((r) => r.code === code).id;
  const staff = [
    ...Array.from({ length: CAPTAINS }, (_, i) => [`captain${i + 1}`, 'CAPTAIN']),
    ...Array.from({ length: KITCHENS }, (_, i) => [`chef${i + 1}`, 'KITCHEN']),
    ...Array.from({ length: CASHIERS }, (_, i) => [`cashier${i + 1}`, 'CASHIER']),
  ];
  for (const [i, [username, code]] of staff.entries()) {
    await must(owner, 'POST', '/users', {
      username,
      fullName: username,
      password: PASSWORD,
      pin: String(3000 + i * 7).padStart(4, '0'),
      roleIds: [role(code)],
    });
  }
  const gst = (await must(owner, 'GET', '/tax-groups')).data.find((g) => g.name === 'GST 5%').id;
  const stations = [];
  for (const name of ['Main Kitchen', 'Tandoor', 'Bar'])
    stations.push((await must(owner, 'POST', '/kitchen-stations', { name })).id);
  const categories = [];
  for (const name of ['Starters', 'Mains', 'Breads', 'Beverages'])
    categories.push((await must(owner, 'POST', '/categories', { name })).id);
  for (let i = 0; i < 30; i++) {
    await must(owner, 'POST', '/menu-items', {
      sku: `ITEM-${i}`,
      name: `Dish ${i + 1}`,
      categoryId: categories[i % 4],
      foodType: i % 3 === 0 ? 'NON_VEG' : 'VEG',
      basePrice: 5000 + i * 1000,
      taxGroupId: gst,
      kitchenStationId: stations[i % 3],
      prepTimeSec: 600,
    });
  }
  const area = await must(owner, 'POST', '/floor-areas', { name: 'Hall' });
  for (let i = 0; i < TABLES; i++) {
    await must(owner, 'POST', '/tables', {
      floorAreaId: area.id,
      label: `T${i + 1}`,
      posX: (i % 10) * 4,
      posY: Math.floor(i / 10) * 4,
      shape: 'SQUARE',
      seats: 4,
    });
  }
  await must(owner, 'POST', '/charge-rules', {
    name: 'Service charge',
    kind: 'PERCENT',
    value: 500,
    orderTypes: ['DINE_IN'],
    taxGroupId: gst,
    isOptional: true,
  });
  const menu = await must(owner, 'GET', '/menu');
  return { owner, menu };
}

async function captain(s, menu) {
  while (!stopping) {
    const floor = (await request(s, 'GET', '/floor')).body;
    const free =
      floor?.areas.flatMap((a) => a.tables).filter((t) => t.status === 'AVAILABLE') ?? [];
    if (free.length === 0) {
      await think(2000, 4000);
      continue;
    }
    const opened = await request(s, 'POST', '/orders', {
      orderType: 'DINE_IN',
      tableId: pick(free).id,
      covers: 2 + Math.floor(Math.random() * 3),
    });
    if (!opened.body) continue; // someone else took the table
    const rounds = 1 + Math.floor(Math.random() * 3);
    for (let r = 0; r < rounds && !stopping; r++) {
      const items = Array.from({ length: 1 + Math.floor(Math.random() * 3) }, () => ({
        menuItemId: pick(menu.items).id,
        quantity: 1 + Math.floor(Math.random() * 2),
      }));
      await request(s, 'POST', `/orders/${opened.body.id}/items`, { items });
      await think(300, 1200);
      await request(s, 'POST', `/orders/${opened.body.id}/kots`);
      await request(s, 'GET', `/orders/${opened.body.id}`);
      await think(1000, 3000);
    }
  }
}

async function kitchen(s, n) {
  while (!stopping) {
    const board = (await request(s, 'GET', '/kitchen/kots')).body?.data ?? [];
    // Each screen takes its share of the KOTs still cooking, oldest first.
    const cooking = board.filter((k) => ['NEW', 'ACCEPTED', 'COOKING'].includes(k.status));
    for (const kot of cooking.filter((_, i) => i % KITCHENS === n - 1).slice(0, 4)) {
      await request(s, 'POST', `/kitchen/kots/${kot.id}/status`, {
        to: 'READY',
        version: kot.version,
      });
    }
    await think(1500, 2500);
  }
}

async function cashier(s, n) {
  await request(s, 'POST', '/cash-shifts', { openingFloat: 500000 });
  while (!stopping) {
    const open = (await request(s, 'GET', '/orders?status=OPEN')).body?.data ?? [];
    const ready = open.filter(
      (o, i) =>
        i % CASHIERS === n - 1 &&
        o.itemCount > 0 &&
        o.pendingCount === 0 &&
        o.readyCount === o.itemCount,
    );
    for (const order of ready.slice(0, 2)) {
      await request(s, 'POST', `/orders/${order.id}/bill-preview`, {});
      const billed = await request(s, 'POST', `/orders/${order.id}/invoice`, {});
      const invoice = billed.body?.invoices?.[0];
      if (!invoice) continue;
      const upi = Math.floor(invoice.grandTotal / 2);
      await request(s, 'POST', `/invoices/${invoice.id}/payments`, {
        payments: [
          { method: 'UPI', amount: upi, reference: `RRN${Date.now()}`.slice(0, 20) },
          { method: 'CASH', amount: invoice.grandTotal - upi, tendered: invoice.grandTotal - upi },
        ],
      });
      await think(500, 1500);
    }
    await think(1000, 2000);
  }
}

async function screens(owner) {
  while (!stopping) {
    await request(null, 'GET', '/tokens');
    await request(owner, 'GET', '/reports/dashboard');
    await think(4000, 6000);
  }
}

function percentile(sorted, p) {
  return sorted.length === 0
    ? 0
    : sorted[Math.min(sorted.length - 1, Math.ceil((p / 100) * sorted.length) - 1)];
}

function report(seconds) {
  const rows = [...samples.entries()]
    .filter(([label]) => label !== 'setup')
    .map(([label, values]) => {
      const sorted = [...values].sort((a, b) => a - b);
      return {
        label,
        n: sorted.length,
        p50: percentile(sorted, 50),
        p95: percentile(sorted, 95),
        p99: percentile(sorted, 99),
        max: sorted.at(-1),
      };
    })
    .sort((a, b) => b.n - a.n);
  const all = rows.flatMap((r) => samples.get(r.label)).sort((a, b) => a - b);
  const f = (v) => v.toFixed(1).padStart(7);
  console.log(
    `\n${'route'.padEnd(44)} ${'count'.padStart(6)} ${'p50'.padStart(7)} ${'p95'.padStart(7)} ${'p99'.padStart(7)} ${'max'.padStart(7)}  (ms)`,
  );
  for (const r of rows)
    console.log(
      `${r.label.padEnd(44)} ${String(r.n).padStart(6)} ${f(r.p50)} ${f(r.p95)} ${f(r.p99)} ${f(r.max)}`,
    );
  const p95 = percentile(all, 95);
  console.log(
    `${'ALL'.padEnd(44)} ${String(all.length).padStart(6)} ${f(percentile(all, 50))} ${f(p95)} ${f(percentile(all, 99))} ${f(all.at(-1) ?? 0)}`,
  );
  console.log(
    `\nthroughput ${(all.length / seconds).toFixed(1)} req/s over ${seconds.toFixed(0)} s`,
  );
  if (failures.size > 0) {
    console.log(
      '\nrefusals (expected ones: VERSION_CONFLICT, TABLE_OCCUPIED, INVALID_STATE_TRANSITION from racing devices):',
    );
    for (const [label, byCode] of failures) console.log(`  ${label}: ${JSON.stringify(byCode)}`);
  }
  console.log(
    `\np95 ${p95.toFixed(1)} ms vs target ${TARGET_P95_MS} ms: ${p95 < TARGET_P95_MS ? 'PASS' : 'FAIL'}`,
  );
  return p95 < TARGET_P95_MS;
}

const { owner, menu } = await seed();
// Staff sign in one after another, as they do at the start of a shift. Sign-in
// is deliberately slow (bcrypt), so it is timed separately from the rush.
const signIn = async (username) => {
  const started = performance.now();
  const session = await login({ username, password: PASSWORD });
  signIns.push(performance.now() - started);
  return session;
};
const signIns = [];
const sessions = { captains: [], chefs: [], cashiers: [] };
for (let i = 1; i <= CAPTAINS; i++) sessions.captains.push(await signIn(`captain${i}`));
for (let i = 1; i <= KITCHENS; i++) sessions.chefs.push(await signIn(`chef${i}`));
for (let i = 1; i <= CASHIERS; i++) sessions.cashiers.push(await signIn(`cashier${i}`));
const sorted = [...signIns].sort((a, b) => a - b);
console.log(
  `sign-in: ${sorted.length} staff, p50 ${percentile(sorted, 50).toFixed(0)} ms, max ${sorted.at(-1).toFixed(0)} ms`,
);
console.log(
  `running ${CAPTAINS} captains, ${KITCHENS} kitchen screens, ${CASHIERS} cashiers for ${MINUTES} min`,
);
const started = performance.now();
const workers = [
  ...sessions.captains.map((s) => captain(s, menu)),
  ...sessions.chefs.map((s, i) => kitchen(s, i + 1)),
  ...sessions.cashiers.map((s, i) => cashier(s, i + 1)),
  screens(owner),
];
setTimeout(() => (stopping = true), MINUTES * 60_000);
await Promise.all(workers);
const ok = report((performance.now() - started) / 1000);
const paid = (await request(owner, 'GET', '/reports/day-end')).body;
if (paid)
  console.log(
    `day-end: ${paid.orders.count} orders, ${paid.sales.invoiceCount} bills, ₹${(paid.sales.total / 100).toLocaleString('en-IN')}`,
  );
process.exit(ok ? 0 : 1);
