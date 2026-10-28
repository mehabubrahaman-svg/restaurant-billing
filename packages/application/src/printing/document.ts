/**
 * A printed slip (bill, KOT, shift report) as plain blocks, independent of
 * the printer. Encoders turn it into ESC/POS text, or a renderer draws it as
 * an image for scripts printers can't print (Hindi, Bengali).
 */
export type PrintBlock =
  | {
      kind: 'text';
      text: string;
      align?: 'left' | 'center' | 'right';
      bold?: boolean;
      size?: 1 | 2;
    }
  /** Two columns: left text and right-aligned text (an amount). */
  | { kind: 'row'; left: string; right: string; bold?: boolean; size?: 1 | 2 }
  | { kind: 'rule'; char?: '-' | '=' }
  | { kind: 'qr'; data: string }
  | { kind: 'feed'; lines: number };

export interface PrintDocument {
  readonly blocks: readonly PrintBlock[];
  /** Cut the paper at the end. */
  readonly cut: boolean;
}

/** Characters a thermal printer's built-in font can't show (Devanagari, Bengali, …). */
export function needsRaster(doc: PrintDocument): boolean {
  return doc.blocks.some((b) => {
    const text = b.kind === 'text' ? b.text : b.kind === 'row' ? b.left + b.right : '';
    // eslint-disable-next-line no-control-regex
    return /[^\u0000-\u007f₹]/.test(text);
  });
}

/** Columns of the built-in font: 48 on 80 mm paper, 32 on 58 mm. */
export const columnsFor = (paperWidthMm: 58 | 80) => (paperWidthMm === 80 ? 48 : 32);
/** Printable dots at 203 dpi: 576 on 80 mm, 384 on 58 mm. */
export const dotsFor = (paperWidthMm: 58 | 80) => (paperWidthMm === 80 ? 576 : 384);
