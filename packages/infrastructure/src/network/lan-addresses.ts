import { networkInterfaces } from 'node:os';

/** IPv4 addresses other devices on the LAN can reach this PC at (no loopback, no link-local). */
export function lanAddresses(): string[] {
  return Object.values(networkInterfaces())
    .flat()
    .filter((i): i is NonNullable<typeof i> => !!i && i.family === 'IPv4' && !i.internal)
    .map((i) => i.address)
    .filter((a) => !a.startsWith('169.254.'))
    .sort();
}
