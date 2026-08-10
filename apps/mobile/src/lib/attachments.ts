// Attachment blob transfer on mobile (contract §3.7.1).
//
// Unlike web, mobile does not want a Blob in memory: a thumbnail needs a URI an
// <Image> can render, and sharing needs a real file on disk. So downloads go
// straight to the cache directory through expo-file-system, authenticated with
// the same bearer token the sync client uses, and the local path is reused on
// every later render.
import { Directory, File, Paths } from 'expo-file-system';
import { attachmentFormData } from '@balu/api-client';
import type { Attachment } from '@balu/domain';
import { apiBase, getApi } from './clients';
import { useApp } from '../store/app';

/** A file part as React Native's FormData expects it. */
export interface RnFile {
  uri: string;
  name: string;
  type: string;
}

/** Cached local copies, keyed by attachment id, so a re-render never re-downloads. */
const localUris = new Map<string, string>();
const inFlight = new Map<string, Promise<string | null>>();

/**
 * Per-attachment cache directory: `attachments/{id}/`.
 *
 * The id owns the directory (cache hits stay keyed by it, and two files can
 * never collide) while the file inside keeps its real name - which is what the
 * share sheet displays. Storing the blob as a bare `{id}` offered every file to
 * the user as "40fb6133-..." with no extension and no usable type.
 */
function attachmentDir(attachmentId: string): Directory {
  const dir = new Directory(Paths.cache, 'attachments', attachmentId);
  if (!dir.exists) dir.create({ intermediates: true, idempotent: true });
  return dir;
}

function fileUrl(workspaceId: string, attachmentId: string): string | null {
  const serverUrl = useApp.getState().serverUrl;
  if (!serverUrl) return null;
  return `${apiBase(serverUrl)}/workspaces/${workspaceId}/attachments/${attachmentId}/file`;
}

/** The already-downloaded local uri for an attachment, if we have one. */
export function cachedUri(attachmentId: string): string | undefined {
  return localUris.get(attachmentId);
}

/**
 * The on-disk name inside the attachment's own directory: the original filename.
 *
 * That name is what `Sharing.shareAsync` shows and what both platforms read the
 * type from, so keeping it (extension included) is the difference between
 * sharing "Rechnung.pdf" and sharing an extensionless uuid.
 *
 * The server already sanitizes `filename` to a bare basename, but this is the
 * point where it becomes a real path, so the guard is repeated here rather than
 * assumed: a separator arriving from anywhere must not escape the directory.
 */
function cacheName(attachment: CacheableAttachment): string {
  const base = attachment.filename.replace(/\\/g, '/').split('/').pop() ?? '';
  // Letters and digits stay Unicode-aware, so "Rechnung Übersicht.pdf" keeps
  // its name instead of decaying into underscores; everything that could act as
  // a separator, a control character or a leading dot is replaced or stripped.
  const safe = base
    .replace(/[^\p{L}\p{N}._\-+() ]/gu, '_')
    .replace(/^\.+/, '')
    .trim();
  return safe.length > 0 ? safe.slice(0, 255) : attachment.id;
}

export type CacheableAttachment = Pick<Attachment, 'id' | 'filename'>;

/**
 * Download an attachment into the cache directory and return its local uri.
 *
 * Resolves to null when it cannot be fetched (offline, deleted, no session) -
 * callers show a placeholder rather than an error, because a missing thumbnail
 * is not something the user can act on.
 */
export function downloadAttachment(
  workspaceId: string,
  attachment: CacheableAttachment,
): Promise<string | null> {
  const attachmentId = attachment.id;
  const cached = localUris.get(attachmentId);
  if (cached) return Promise.resolve(cached);
  const running = inFlight.get(attachmentId);
  if (running) return running;

  const p = (async () => {
    try {
      const url = fileUrl(workspaceId, attachmentId);
      const token = getApi()?.getAccessToken();
      if (!url || !token) return null;

      const target = new File(attachmentDir(attachmentId), cacheName(attachment));
      // A previous run may already have it on disk even though this process's
      // map is empty (the cache survives restarts, the map does not).
      if (!target.exists) {
        await File.downloadFileAsync(url, target, {
          headers: { Authorization: `Bearer ${token}` },
          idempotent: true,
        });
      }
      localUris.set(attachmentId, target.uri);
      return target.uri;
    } catch {
      return null;
    } finally {
      inFlight.delete(attachmentId);
    }
  })();
  inFlight.set(attachmentId, p);
  return p;
}

/** Forget an attachment's cached copy and delete it from disk (best-effort). */
export function evictAttachment(attachment: CacheableAttachment): void {
  localUris.delete(attachment.id);
  try {
    // The whole `{id}` directory, so a rename (or an earlier cache layout)
    // cannot leave the old blob behind.
    const dir = new Directory(Paths.cache, 'attachments', attachment.id);
    if (dir.exists) dir.delete();
  } catch {
    /* the cache is disposable; a failure here costs nothing */
  }
}

/** Upload a picked file. Throws `ApiError` (413 `too_large`, 403, 404). */
export async function uploadAttachment(
  workspaceId: string,
  taskId: string,
  file: RnFile,
): Promise<Attachment> {
  const api = getApi();
  if (!api) throw new Error('no api client');
  // React Native's FormData takes a {uri, name, type} object where the web
  // takes a Blob; `attachmentFormData` passes whichever through untouched.
  return api.uploadAttachment(workspaceId, attachmentFormData(taskId, file));
}
