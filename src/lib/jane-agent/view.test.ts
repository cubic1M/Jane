import { describe, expect, it } from "vitest";
import { parseActions, toChatMessage, type ChatMessage } from "./types";
import { toView } from "./view";

// Spec step 81: an open message shows its buttons; an answered one shows the answer, keeps
// its links, and keeps Undo only while Undo works.

const NOW = new Date("2026-10-19T13:05:00Z");

function message(over: Partial<ChatMessage> = {}): ChatMessage {
  return {
    id: "m1",
    kind: "decision",
    body: "Netflix went up.",
    refs: { findingId: "f1" },
    actions: [
      { id: "finding.yes", label: "Yes", kind: "primary" },
      { id: "finding.no", label: "No", kind: "secondary" },
      { id: "open", label: "Open", kind: "link", href: "/report/f1" },
    ],
    status: "open",
    answeredWith: null,
    answeredAt: null,
    createdAt: new Date("2026-10-19T13:00:00Z"),
    ...over,
  };
}

describe("toView", () => {
  it("shows an open message's buttons and links, at the person's local time", () => {
    const view = toView(message(), NOW, "America/New_York");
    expect(view).toMatchObject({
      tag: "to decide",
      fromJane: true,
      time: "Oct 19, 9:00 AM",
      buttons: [
        { id: "finding.yes", label: "Yes", kind: "primary" },
        { id: "finding.no", label: "No", kind: "secondary" },
      ],
      links: [{ label: "Open", href: "/report/f1?from=m1" }],
      undoUntil: null,
    });
  });

  it("drops the buttons once answered, but keeps Undo while it works", () => {
    const undoUntil = "2026-10-19T13:05:10.000Z";
    const answered = message({
      status: "answered",
      answeredWith: "No",
      refs: { findingId: "f1", undoUntil, note: "OK, I'll leave it." },
      actions: [
        { id: "undo.no", label: "Undo", kind: "secondary" },
        { id: "open", label: "Open", kind: "link", href: "/report/f1" },
      ],
    });
    expect(toView(answered, NOW, null)).toMatchObject({
      answeredWith: "No",
      note: "OK, I'll leave it.",
      buttons: [{ id: "undo.no", label: "Undo", kind: "secondary" }],
      links: [{ label: "Open", href: "/report/f1?from=m1" }],
      undoUntil,
    });
    expect(toView(answered, new Date("2026-10-19T13:05:11Z"), null)).toMatchObject({
      buttons: [],
      undoUntil: null,
    });
    expect(toView(message({ status: "answered" }), NOW, null).buttons).toEqual([]);
    expect(toView(message({ status: "dismissed" }), NOW, null).buttons).toEqual([]);
  });

  it("puts what the person typed on their side", () => {
    expect(toView(message({ kind: "user", actions: [] }), NOW, null)).toMatchObject({
      fromJane: false,
      tag: "you",
    });
  });
});

describe("reading stored messages", () => {
  it("keeps only well-formed buttons, and known kinds and statuses", () => {
    expect(
      parseActions([
        { id: "finding.yes", label: "Yes", kind: "primary" },
        { id: "delete_everything", label: "Boom", kind: "primary" },
        { id: "open", label: "Open", kind: "link" },
        { id: "open", label: "Open", kind: "link", href: "/plan" },
        "junk",
      ]),
    ).toEqual([
      { id: "finding.yes", label: "Yes", kind: "primary" },
      { id: "open", label: "Open", kind: "link", href: "/plan" },
    ]);
    expect(parseActions(null)).toEqual([]);
    const row = toChatMessage({
      id: "m",
      kind: "weird",
      body: "b",
      refs: [],
      actions: {},
      status: "strange",
      answeredWith: null,
      answeredAt: null,
      createdAt: NOW,
    });
    expect(row).toMatchObject({ kind: "heads_up", status: "dismissed", refs: {}, actions: [] });
  });
});
