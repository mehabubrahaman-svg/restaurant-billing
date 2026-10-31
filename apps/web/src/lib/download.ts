import { saveFileInApp } from './android-bridge';

/**
 * Hands a downloaded file to the browser's "save" (a temporary object URL on
 * a link). In the Android app, which can't follow blob: links, the app saves
 * it to Downloads instead.
 */
export async function saveBlob(blob: Blob, fileName: string): Promise<void> {
  if (await saveFileInApp(blob, fileName)) return;
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = fileName;
  link.rel = 'noopener';
  link.style.display = 'none';
  document.body.append(link);
  link.click();
  link.remove();
  // Give the browser a moment to start the download before the URL goes away.
  setTimeout(() => URL.revokeObjectURL(url), 10_000);
}

/** 1,278,222 → { value: 1.2, unit: 'MB' }: for "1.2 MB" in the user's digits. */
export function sizeParts(bytes: number): { value: number; unit: 'B' | 'KB' | 'MB' | 'GB' } {
  const units = ['B', 'KB', 'MB', 'GB'] as const;
  let value = bytes;
  let i = 0;
  while (value >= 1024 && i < units.length - 1) {
    value /= 1024;
    i += 1;
  }
  return { value: i === 0 ? value : Math.round(value * 10) / 10, unit: units[i]! };
}
