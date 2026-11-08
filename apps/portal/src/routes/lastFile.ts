const KEY = 'rds.portal.lastFile';

/** The file key of the last file page visited, if storage has one. */
export function lastFile(): string | null {
  try {
    return window.localStorage.getItem(KEY);
  } catch {
    return null;
  }
}

export function rememberFile(fileKey: string): void {
  try {
    window.localStorage.setItem(KEY, fileKey);
  } catch {
    // Storage can be unavailable (private mode, quota); the sidebar then falls back to Files.
  }
}

/** Drops the remembered file when it is `fileKey`, e.g. one this server doesn't track (a reset local store). */
export function forgetFile(fileKey: string): void {
  try {
    if (window.localStorage.getItem(KEY) === fileKey) window.localStorage.removeItem(KEY);
  } catch {
    // Nothing remembered when storage is unavailable.
  }
}
