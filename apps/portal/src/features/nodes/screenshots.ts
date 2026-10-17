import { SCREENSHOT_TYPES } from '../../components/domain/NoteScreenshots';

/** The API's limits on a note's screenshots. */
export const SCREENSHOT_MAX = 3;
export const SCREENSHOT_MAX_BYTES = 5 * 1024 * 1024;

/** `412 KB` / `1.2 MB`. */
export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${Number((bytes / 1024 / 1024).toFixed(1))} MB`;
}

/** Why `file` can't be attached, or null. */
export function screenshotError(file: File): string | null {
  if (!(SCREENSHOT_TYPES as readonly string[]).includes(file.type)) return `${file.name || 'That file'} isn’t a PNG, JPG or WebP image.`;
  if (file.size > SCREENSHOT_MAX_BYTES) return `${file.name || 'That image'} is over 5 MB (${formatBytes(file.size)}).`;
  return null;
}

/** Splits `files` into those that fit after `count` already attached and the first problem with the rest. */
export function acceptScreenshots(files: readonly File[], count: number): { accepted: File[]; error: string | null } {
  const accepted: File[] = [];
  let error: string | null = null;
  for (const file of files) {
    const problem = screenshotError(file);
    if (problem) error ??= problem;
    else if (count + accepted.length >= SCREENSHOT_MAX) error ??= `Attach at most ${SCREENSHOT_MAX} screenshots.`;
    else accepted.push(file);
  }
  return { accepted, error };
}

/** The file's bytes as base64 (no `data:` prefix), as the notes API takes them. */
export async function fileToBase64(file: Blob): Promise<string> {
  const bytes = new Uint8Array(await file.arrayBuffer());
  let binary = '';
  for (let i = 0; i < bytes.length; i += 0x8000) binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(binary);
}
