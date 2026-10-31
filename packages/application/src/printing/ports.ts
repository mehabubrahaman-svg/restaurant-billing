import type { PrinterRecord } from '../settings/ports';
import type { PrintDocument } from './document';

/** A 1-bit image: `width` is a multiple of 8, rows packed MSB first, 1 = black. */
export interface MonoBitmap {
  readonly width: number;
  readonly height: number;
  readonly bits: Uint8Array;
}

/** Draws a slip as an image (Chromium with the bundled Noto fonts). */
export interface RasterRenderer {
  render(doc: PrintDocument, widthDots: number): Promise<MonoBitmap>;
}

/** Sends ready-made ESC/POS bytes to a printer (network, USB, Bluetooth serial, OS spooler). */
export interface PrinterTransport {
  send(printer: PrinterRecord, bytes: Uint8Array): Promise<void>;
}

/** A job for a printer the Hub can't reach itself: a Bluetooth printer attached to a tablet. */
export interface DevicePrintJobRecord {
  readonly id: string;
  readonly branchId: string;
  readonly deviceId: string;
  readonly printerId: string;
  readonly payload: Uint8Array;
  readonly status: 'QUEUED' | 'PRINTED' | 'FAILED' | 'EXPIRED';
  readonly error: string | null;
  readonly createdAt: Date;
}

/** Print jobs waiting for the tablet whose Bluetooth printer they are for. */
export interface DevicePrintQueue {
  enqueue(job: Omit<DevicePrintJobRecord, 'status' | 'error'>): void;
  /** QUEUED jobs for the device, oldest first. */
  queued(deviceId: string): DevicePrintJobRecord[];
  get(id: string): DevicePrintJobRecord | undefined;
  /** QUEUED → PRINTED, FAILED or EXPIRED; a job that already finished is left alone. */
  finish(
    id: string,
    status: 'PRINTED' | 'FAILED' | 'EXPIRED',
    error: string | null,
    at: Date,
  ): void;
}

export interface EscPosEncoder {
  text(doc: PrintDocument, columns: number): Uint8Array;
  raster(bitmap: MonoBitmap, cut: boolean): Uint8Array;
}
