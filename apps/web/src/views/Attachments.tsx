import { useEffect, useReducer, useRef, useState } from "react";
import {
  attachmentsForTask,
  formatFileSize,
  isImageAttachment,
  type Attachment,
} from "@balu/domain";
import { attachmentFormData } from "@balu/api-client";
import type { Snapshot } from "@balu/sync-client";
import { api, getSync } from "../lib/clients.js";
import { canWrite, useMyRole } from "../lib/role.js";
import { useT } from "../lib/useT.js";
import { useApp } from "../store/app.js";
import { Icon } from "../components/Icon.js";

/**
 * Object URLs for already-fetched blobs, keyed by attachment id.
 *
 * Module-level so switching tasks and coming back does not re-download a
 * thumbnail. Nothing is ever revoked: the entries have to outlive the component
 * that made them, and an attachment list is a handful of small images, so the
 * memory a session can leak here is bounded by what the user actually opened.
 * Revocation would need a real cache policy (LRU + refcount) to be correct, and
 * that is a v2 concern.
 */
const objectUrls = new Map<string, string>();
/** De-duplicates concurrent fetches of the same blob (two renders, one request). */
const inFlight = new Map<string, Promise<string | null>>();

function loadObjectUrl(workspaceId: string, id: string): Promise<string | null> {
  const cached = objectUrls.get(id);
  if (cached) return Promise.resolve(cached);
  const running = inFlight.get(id);
  if (running) return running;

  const p = (async () => {
    try {
      const blob = await api.getAttachmentBlob(workspaceId, id);
      const url = URL.createObjectURL(blob);
      objectUrls.set(id, url);
      return url;
    } catch {
      // Offline, or the blob is gone. The placeholder simply stays.
      return null;
    } finally {
      inFlight.delete(id);
    }
  })();
  inFlight.set(id, p);
  return p;
}

export function AttachmentsSection({ snapshot, taskId }: { snapshot: Snapshot; taskId: string }) {
  const { t } = useT();
  const writable = canWrite(useMyRole());
  const workspaceId = useApp((s) => s.workspace?.id) ?? null;
  const showToast = useApp((s) => s.showToast);

  const attachments = attachmentsForTask(snapshot.attachments, taskId);
  const images = attachments.filter(isImageAttachment);
  const files = attachments.filter((a) => !isImageAttachment(a));

  const [, rerender] = useReducer((n: number) => n + 1, 0);
  const [lightbox, setLightbox] = useState<Attachment | null>(null);
  const [uploading, setUploading] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  // Fetch every image we do not have yet; each arrival re-renders.
  const imageKey = images.map((a) => a.id).join(",");
  useEffect(() => {
    if (!workspaceId) return;
    let alive = true;
    for (const a of images) {
      if (objectUrls.has(a.id)) continue;
      void loadObjectUrl(workspaceId, a.id).then((url) => {
        if (url && alive) rerender();
      });
    }
    return () => {
      alive = false;
    };
    // `imageKey` is the real dependency: `images` is a fresh array every render.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [workspaceId, imageKey]);

  // Escape closes the lightbox, as everywhere else in the app.
  useEffect(() => {
    if (!lightbox) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setLightbox(null);
    };
    globalThis.addEventListener("keydown", onKey);
    return () => globalThis.removeEventListener("keydown", onKey);
  }, [lightbox]);

  async function download(a: Attachment) {
    if (!workspaceId) return;
    try {
      const blob = await api.getAttachmentBlob(workspaceId, a.id);
      const url = URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = url;
      link.download = a.filename;
      link.click();
      // Safe to revoke immediately: the click has already handed the blob to
      // the download manager. This URL is single-use, unlike the thumbnails.
      URL.revokeObjectURL(url);
    } catch {
      showToast(t("attachment.downloadError"));
    }
  }

  async function upload(file: File) {
    if (!workspaceId) return;
    setUploading(true);
    try {
      await api.uploadAttachment(workspaceId, attachmentFormData(taskId, file));
      // The row itself arrives through sync (there is no attachment_add
      // command to apply optimistically), so ask for it now rather than
      // leaving the user staring at an unchanged list for up to a minute.
      await getSync()?.sync();
    } catch {
      showToast(t("attachment.uploadError"));
    } finally {
      setUploading(false);
    }
  }

  function remove(id: string) {
    if (globalThis.confirm(t("attachment.deleteConfirm"))) {
      getSync()?.mutate({ type: "attachment_delete", args: { id } });
    }
  }

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 10, borderTop: "1px solid var(--border)", paddingTop: 16 }}>
      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: 6,
          fontSize: 11,
          fontWeight: 500,
          letterSpacing: "0.4px",
          textTransform: "uppercase",
          color: "var(--text-tertiary)",
        }}
      >
        <Icon name="paperclip" size={13} />
        {t("attachment.title")}
        {attachments.length > 0 && <span style={{ fontVariantNumeric: "tabular-nums" }}>· {attachments.length}</span>}
      </div>

      {images.length > 0 && (
        <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
          {images.map((a) => {
            const url = objectUrls.get(a.id);
            return (
              <div key={a.id} className="balu-attachment-item" style={{ position: "relative", width: 72, height: 72 }}>
                <button
                  type="button"
                  onClick={() => url && setLightbox(a)}
                  title={a.filename}
                  style={{
                    width: 72,
                    height: 72,
                    padding: 0,
                    border: "1px solid var(--border)",
                    borderRadius: "var(--radius-control)",
                    overflow: "hidden",
                    background: "var(--slate-100)",
                    cursor: url ? "zoom-in" : "default",
                    display: "block",
                  }}
                >
                  {url ? (
                    <img
                      src={url}
                      alt={a.filename}
                      style={{ width: "100%", height: "100%", objectFit: "cover", display: "block" }}
                    />
                  ) : (
                    // Neutral placeholder while the blob is in flight (or after
                    // it failed) - never a broken-image glyph.
                    <span style={{ display: "flex", width: "100%", height: "100%", alignItems: "center", justifyContent: "center" }}>
                      <Icon name="file-text" size={18} color="var(--text-tertiary)" />
                    </span>
                  )}
                </button>
                {writable && <RemoveButton label={t("attachment.delete")} onClick={() => remove(a.id)} />}
              </div>
            );
          })}
        </div>
      )}

      {files.length > 0 && (
        <div style={{ display: "flex", flexDirection: "column", gap: 2 }}>
          {files.map((a) => (
            <div key={a.id} className="balu-attachment-item" style={{ position: "relative", display: "flex", alignItems: "center" }}>
              <button
                type="button"
                onClick={() => void download(a)}
                title={a.filename}
                style={{
                  flex: 1,
                  minWidth: 0,
                  display: "flex",
                  alignItems: "center",
                  gap: 8,
                  padding: "6px 8px",
                  border: "none",
                  background: "transparent",
                  borderRadius: "var(--radius-control)",
                  color: "var(--text-primary)",
                  cursor: "pointer",
                  fontSize: "var(--text-secondary-size)",
                  fontFamily: "var(--font-sans)",
                  textAlign: "left",
                }}
              >
                <Icon name="file-text" size={15} color="var(--text-tertiary)" />
                <span style={{ flex: 1, minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                  {a.filename}
                </span>
                <span style={{ flex: "none", fontSize: 12, color: "var(--text-tertiary)", fontVariantNumeric: "tabular-nums" }}>
                  {formatFileSize(a.size_bytes)}
                </span>
              </button>
              {writable && <RemoveButton label={t("attachment.delete")} onClick={() => remove(a.id)} inline />}
            </div>
          ))}
        </div>
      )}

      {writable && (
        <>
          <input
            ref={inputRef}
            type="file"
            style={{ display: "none" }}
            onChange={(e) => {
              const file = e.target.files?.[0];
              // Reset first: picking the same file twice in a row otherwise
              // fires no change event at all.
              e.target.value = "";
              if (file) void upload(file);
            }}
          />
          <button
            type="button"
            disabled={uploading}
            onClick={() => inputRef.current?.click()}
            style={{
              alignSelf: "flex-start",
              display: "inline-flex",
              alignItems: "center",
              gap: 6,
              height: 28,
              padding: "0 10px",
              borderRadius: "var(--radius-control)",
              border: "1px dashed var(--border)",
              background: "transparent",
              color: uploading ? "var(--text-tertiary)" : "var(--text-secondary)",
              cursor: uploading ? "default" : "pointer",
              fontSize: 13,
              fontFamily: "var(--font-sans)",
            }}
          >
            <Icon name={uploading ? "refresh-cw" : "plus"} size={13} />
            {t("attachment.add")}
          </button>
        </>
      )}

      {lightbox && <Lightbox attachment={lightbox} onClose={() => setLightbox(null)} />}
    </div>
  );
}

function RemoveButton({ label, onClick, inline }: { label: string; onClick: () => void; inline?: boolean }) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label={label}
      className="balu-attachment-remove"
      style={{
        position: inline ? "static" : "absolute",
        top: -6,
        right: -6,
        flex: "none",
        width: 20,
        height: 20,
        display: "inline-flex",
        alignItems: "center",
        justifyContent: "center",
        borderRadius: "50%",
        border: "1px solid var(--border)",
        background: "var(--surface-raised)",
        color: "var(--text-tertiary)",
        cursor: "pointer",
        padding: 0,
      }}
    >
      <Icon name="x" size={11} />
    </button>
  );
}

function Lightbox({ attachment, onClose }: { attachment: Attachment; onClose: () => void }) {
  const url = objectUrls.get(attachment.id);
  if (!url) return null;
  return (
    <div
      onClick={onClose}
      role="presentation"
      style={{
        position: "fixed",
        inset: 0,
        zIndex: 90,
        background: "rgba(0,0,0,0.82)",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        cursor: "zoom-out",
      }}
    >
      <img
        src={url}
        alt={attachment.filename}
        style={{ maxWidth: "90vw", maxHeight: "90vh", objectFit: "contain", display: "block" }}
      />
    </div>
  );
}
