import { describe, expect, it } from "vitest";
import { attachmentsForTask, formatFileSize, isImageAttachment } from "../src/index.js";
import type { Attachment } from "../src/index.js";

function attachment(over: Partial<Attachment> & { id: string }): Attachment {
  return {
    workspace_id: "w1",
    task_id: "t1",
    filename: "file.bin",
    content_type: "application/octet-stream",
    size_bytes: 1024,
    created_by: "u1",
    created_at: "2026-07-01T00:00:00Z",
    updated_at: "2026-07-01T00:00:00Z",
    is_deleted: false,
    ...over,
  };
}

describe("attachmentsForTask", () => {
  it("keeps only the task's live attachments, oldest first", () => {
    const list = [
      attachment({ id: "b", created_at: "2026-07-02T00:00:00Z" }),
      attachment({ id: "a", created_at: "2026-07-01T00:00:00Z" }),
      attachment({ id: "gone", is_deleted: true }),
      attachment({ id: "other", task_id: "t2" }),
    ];
    expect(attachmentsForTask(list, "t1").map((a) => a.id)).toEqual(["a", "b"]);
  });

  it("breaks same-timestamp ties by id so the order is stable (I9)", () => {
    const list = [
      attachment({ id: "z", created_at: "2026-07-01T00:00:00Z" }),
      attachment({ id: "a", created_at: "2026-07-01T00:00:00Z" }),
    ];
    expect(attachmentsForTask(list, "t1").map((a) => a.id)).toEqual(["a", "z"]);
  });
});

describe("isImageAttachment", () => {
  it("is true only for image content types", () => {
    expect(isImageAttachment(attachment({ id: "1", content_type: "image/png" }))).toBe(true);
    expect(isImageAttachment(attachment({ id: "2", content_type: "image/svg+xml" }))).toBe(true);
    expect(isImageAttachment(attachment({ id: "3", content_type: "application/pdf" }))).toBe(false);
    // Not a prefix match on the subtype: "text/image-map" is not an image.
    expect(isImageAttachment(attachment({ id: "4", content_type: "text/image-map" }))).toBe(false);
  });
});

describe("formatFileSize", () => {
  it("switches unit at each 1024 boundary", () => {
    expect(formatFileSize(0)).toBe("0 B");
    expect(formatFileSize(999)).toBe("999 B");
    expect(formatFileSize(1024)).toBe("1 KB");
    expect(formatFileSize(1024 * 1023)).toBe("1023 KB");
    expect(formatFileSize(1024 * 1024)).toBe("1.0 MB");
    expect(formatFileSize(2.5 * 1024 * 1024)).toBe("2.5 MB");
  });

  it("returns empty for a nonsensical size rather than 'NaN B'", () => {
    expect(formatFileSize(Number.NaN)).toBe("");
    expect(formatFileSize(-1)).toBe("");
  });
});
