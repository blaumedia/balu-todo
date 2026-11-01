import { describe, expect, it } from "vitest";
import type { RelocatedCommand } from "@balu/sync-client";
import { makeT } from "../src/i18n/index.js";
import { accessLostMessage, relocatedMessage } from "../src/lib/syncNotices.js";

const en = makeT("en");
const de = makeT("de");

function reloc(...reasons: string[][]): RelocatedCommand[] {
  return reasons.map(
    (r, i) =>
      ({ command: { type: "task_add", uuid: `u${i}`, args: {} }, reasons: r }) as unknown as RelocatedCommand,
  );
}

describe("relocatedMessage", () => {
  it("is null when nothing was relocated", () => {
    expect(relocatedMessage(en, [])).toBeNull();
  });

  it("names the Inbox for a deleted project", () => {
    expect(relocatedMessage(en, reloc(["project_deleted"]))).toBe(
      "1 task(s) added to the Inbox - their project was deleted.",
    );
  });

  it("counts every relocated task", () => {
    expect(relocatedMessage(en, reloc(["section_deleted"], ["section_deleted"]))).toBe(
      "2 task(s) added without a section - their section was deleted.",
    );
  });

  it("names the top level for a deleted parent", () => {
    expect(relocatedMessage(en, reloc(["parent_deleted"]))).toBe(
      "1 subtask(s) added as regular tasks - their parent task was deleted.",
    );
  });

  it("uses the combined message for mixed reasons", () => {
    expect(relocatedMessage(en, reloc(["project_deleted"], ["section_deleted"]))).toBe(
      "2 task(s) filed elsewhere - their project, section or parent task was deleted.",
    );
  });

  it("speaks German", () => {
    expect(relocatedMessage(de, reloc(["project_deleted"]))).toBe(
      "1 Aufgabe(n) im Eingang abgelegt - ihr Projekt wurde gelöscht.",
    );
  });
});

describe("accessLostMessage", () => {
  it("names the workspace and the lost changes", () => {
    expect(accessLostMessage(en, "removed", 3, "Team")).toBe(
      "You no longer have access to Team. 3 unsynced change(s) could not be saved.",
    );
  });

  it("omits the lost-changes sentence when nothing was queued", () => {
    expect(accessLostMessage(en, "removed", 0, "Team")).toBe("You no longer have access to Team.");
  });

  it("handles a deleted workspace without a name", () => {
    expect(accessLostMessage(en, "deleted", 1, null)).toBe(
      "This workspace has been deleted. 1 unsynced change(s) could not be saved.",
    );
  });

  it("speaks German", () => {
    expect(accessLostMessage(de, "removed", 2, "Team")).toBe(
      "Du hast keinen Zugriff mehr auf Team. 2 nicht synchronisierte Änderung(en) konnten nicht gespeichert werden.",
    );
  });

  it("keeps a name containing replacement patterns verbatim", () => {
    expect(accessLostMessage(en, "removed", 0, "A$&B")).toBe("You no longer have access to A$&B.");
  });
});
