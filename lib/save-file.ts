// Saving report/template files either into a user-chosen folder (File System Access API) or,
// when that is unavailable or denied, via a normal browser download. All of this runs fully
// client-side (no network) so it keeps working offline.
import { db } from './db';

const SAVE_DIR_KEY = 'saveDirHandle';

// FileSystemDirectoryHandle isn't typed in every TS lib target, so we keep it loose.
type DirHandle = any;

export function isFsAccessSupported(): boolean {
  return typeof window !== 'undefined' && 'showDirectoryPicker' in window;
}

// Ensure we hold read-write permission on a (possibly persisted) directory handle.
export async function ensureRwPermission(dir: DirHandle): Promise<boolean> {
  try {
    if (!dir) return false;
    const opts = { mode: 'readwrite' as const };
    if ((await dir.queryPermission?.(opts)) === 'granted') return true;
    if ((await dir.requestPermission?.(opts)) === 'granted') return true;
    return false;
  } catch {
    return false;
  }
}

// Persisted save-location handle (stored in IndexedDB; survives reloads).
export async function getSavedDir(): Promise<DirHandle | null> {
  try {
    const rec = await db.settings.get(SAVE_DIR_KEY);
    return rec?.value ?? null;
  } catch {
    return null;
  }
}

export async function getSavedDirName(): Promise<string | null> {
  const dir = await getSavedDir();
  return dir?.name ?? null;
}

export async function setSavedDir(handle: DirHandle): Promise<void> {
  try {
    await db.settings.put({ key: SAVE_DIR_KEY, value: handle });
  } catch {
    /* ignore */
  }
}

export async function clearSavedDir(): Promise<void> {
  try {
    await db.settings.delete(SAVE_DIR_KEY);
  } catch {
    /* ignore */
  }
}

// Prompt the user to choose a folder and remember it. Returns null if unsupported or cancelled.
export async function pickSaveDir(): Promise<{ name: string } | null> {
  if (!isFsAccessSupported()) return null;
  try {
    const handle = await (window as any).showDirectoryPicker({ mode: 'readwrite' });
    if (!handle) return null;
    await setSavedDir(handle);
    return { name: handle?.name ?? 'Selected folder' };
  } catch {
    // user cancelled the picker
    return null;
  }
}

// Write a blob into the chosen folder, falling back to a download. Returns how it was saved.
export async function saveReportBlob(
  blob: Blob,
  filename: string,
  dir?: DirHandle | null
): Promise<'folder' | 'download'> {
  if (dir) {
    try {
      if (await ensureRwPermission(dir)) {
        const fileHandle = await dir.getFileHandle(filename, { create: true });
        const writable = await fileHandle.createWritable();
        await writable.write(blob);
        await writable.close();
        return 'folder';
      }
    } catch {
      // fall through to the download path
    }
  }
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.rel = 'noopener';
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  setTimeout(() => URL.revokeObjectURL(url), 4000);
  return 'download';
}
