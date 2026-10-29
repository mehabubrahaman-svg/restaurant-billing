import type { ReportFileStore } from '@restroos/application';
import { copyFileSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join, resolve, sep } from 'node:path';

/**
 * Report files under the Hub's data folder (reports/), each under its own id
 * so a file made again never replaces an older one. With a copy folder (a
 * shared or synced folder for the accountant) each file is also copied there
 * under its plain name.
 */
export class FileReportStore implements ReportFileStore {
  constructor(
    private readonly o: {
      dir: string;
      copyDir: string | null;
      /** A missing share must not stop the report. */
      onCopyError?: (error: unknown) => void;
    },
  ) {}

  write(id: string, fileName: string, content: string | Uint8Array) {
    mkdirSync(this.o.dir, { recursive: true });
    const path = join(this.o.dir, `${id}-${fileName}`);
    writeFileSync(path, content, { flag: 'wx' });
    if (this.o.copyDir) {
      try {
        mkdirSync(this.o.copyDir, { recursive: true });
        copyFileSync(path, join(this.o.copyDir, fileName));
      } catch (error) {
        this.o.onCopyError?.(error);
      }
    }
    return {
      path,
      sizeBytes: typeof content === 'string' ? Buffer.byteLength(content) : content.byteLength,
    };
  }

  read(path: string): Uint8Array | undefined {
    return this.inside(path) && existsSync(path) ? readFileSync(path) : undefined;
  }

  remove(path: string): void {
    if (this.inside(path)) rmSync(path, { force: true });
  }

  /** Only files in the reports folder are read or removed. */
  private inside(path: string): boolean {
    return resolve(path).startsWith(resolve(this.o.dir) + sep);
  }
}
