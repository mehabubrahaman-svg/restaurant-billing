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

export interface EscPosEncoder {
  text(doc: PrintDocument, columns: number): Uint8Array;
  raster(bitmap: MonoBitmap, cut: boolean): Uint8Array;
}
