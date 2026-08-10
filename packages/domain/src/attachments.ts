// Attachment helpers (contract §3.7, v1.4).

import type { Attachment } from "./types.js";

/** Stable ordering by `created_at` ascending, tie-broken by id (as comments, I9). */
export function compareAttachmentAsc(a: Attachment, b: Attachment): number {
  if (a.created_at < b.created_at) return -1;
  if (a.created_at > b.created_at) return 1;
  return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
}

/** Live attachments for a task, `created_at` ascending, soft-deleted excluded. */
export function attachmentsForTask(
  attachments: ReadonlyArray<Attachment>,
  taskId: string,
): Attachment[] {
  return attachments
    .filter((a) => a.task_id === taskId && !a.is_deleted)
    .sort(compareAttachmentAsc);
}

/** Images get thumbnails; everything else gets a file row. */
export function isImageAttachment(a: Attachment): boolean {
  return a.content_type.startsWith("image/");
}

/**
 * Compact human size: bytes under 1 KB, then KB, then MB with one decimal.
 *
 * Shared rather than written twice, so the same file never reads "0.9 MB" on
 * one platform and "922 KB" on the other (I7).
 */
export function formatFileSize(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes < 0) return "";
  if (bytes < 1024) return `${Math.round(bytes)} B`;
  const kb = bytes / 1024;
  if (kb < 1024) return `${Math.round(kb)} KB`;
  return `${(kb / 1024).toFixed(1)} MB`;
}
