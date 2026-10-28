import type { PrinterRecord, PrinterTransport } from '@restroos/application';
import { DomainError } from '@restroos/domain';
import { execFile } from 'node:child_process';
import { open } from 'node:fs/promises';
import { connect } from 'node:net';

const TIMEOUT_MS = 5_000;

/**
 * Gets bytes to the printer, by connection type:
 * - NETWORK: raw TCP to "ip[:port]" (port 9100 by default), the common LAN thermal printer
 * - USB / BLUETOOTH: the device file the OS gives it, e.g. /dev/usb/lp0 or /dev/rfcomm0 (Linux), COM3 (Windows)
 * - SYSTEM: the OS print queue in raw mode (CUPS `lp -o raw` on Linux)
 * BLE printers are driven by the tablet they're paired with, not the Hub.
 */
export const hubPrinterTransport: PrinterTransport = {
  async send(printer: PrinterRecord, bytes: Uint8Array): Promise<void> {
    if (!printer.address) throw offline(printer, 'no address set');
    switch (printer.connection) {
      case 'NETWORK':
        return sendTcp(printer, bytes);
      case 'USB':
      case 'BLUETOOTH':
        return sendToDeviceFile(printer, bytes);
      case 'SYSTEM':
        return sendToSpooler(printer, bytes);
      case 'BLE':
        throw new DomainError(
          'PRINTER_ON_DEVICE',
          `${printer.name} is a Bluetooth LE printer; the tablet it is paired with prints to it`,
        );
    }
  },
};

function offline(printer: PrinterRecord, why: string) {
  return new DomainError('PRINTER_OFFLINE', `${printer.name} is not reachable (${why})`);
}

function sendTcp(printer: PrinterRecord, bytes: Uint8Array): Promise<void> {
  const [host, port] = printer.address!.split(':');
  return new Promise((resolve, reject) => {
    const socket = connect({ host: host!, port: Number(port ?? 9100) });
    socket.setTimeout(TIMEOUT_MS, () => {
      socket.destroy();
      reject(offline(printer, 'timed out'));
    });
    socket.once('error', (error) =>
      reject(offline(printer, (error as NodeJS.ErrnoException).code ?? error.message)),
    );
    socket.once('connect', () => socket.end(bytes, () => resolve()));
  });
}

async function sendToDeviceFile(printer: PrinterRecord, bytes: Uint8Array): Promise<void> {
  const path =
    process.platform === 'win32' && /^COM\d+$/i.test(printer.address!)
      ? `\\\\.\\${printer.address}`
      : printer.address!;
  try {
    const file = await open(path, 'w');
    try {
      await file.write(bytes);
    } finally {
      await file.close();
    }
  } catch (error) {
    throw offline(printer, (error as NodeJS.ErrnoException).code ?? 'write failed');
  }
}

function sendToSpooler(printer: PrinterRecord, bytes: Uint8Array): Promise<void> {
  if (process.platform === 'win32') {
    return Promise.reject(
      new DomainError(
        'PRINTER_UNSUPPORTED',
        'Windows print queues are reached through the desktop app (Sprint 5B packaging)',
      ),
    );
  }
  return new Promise((resolve, reject) => {
    const child = execFile(
      'lp',
      ['-d', printer.address!, '-o', 'raw'],
      { timeout: TIMEOUT_MS },
      (error) => (error ? reject(offline(printer, error.message)) : resolve()),
    );
    child.stdin?.end(Buffer.from(bytes));
  });
}
