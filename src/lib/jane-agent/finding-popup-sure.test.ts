import { describe, expect, it } from "vitest";
import { popupCard } from "./popups";
import { findingCandidate } from "./sources/findings";
import type { MessageView } from "./view";

// Debugger 11-16 (a U.S. Bank checking upload on a phone): the dock's "Review your Amazon Prime
// subscription." showed no "% sure" on its face, while the Hulu price and Saver's Credit cards
// beside it did (founder: every suggestion shows how sure Jane is). The finding's message said it
// only in its words (#1861), which a pop-up keeps behind More details. It carries it as the other
// heads-ups do, so the card's face says it, and its details say it once.

const sure = { percent: 75, reason: "3 charges in 3 months of data" };
const candidate = findingCandidate(
  {
    findingId: "f1",
    type: "subscription_review",
    title: "Review your Amazon Prime subscription",
    annualSavingsCents: 17_988,
    savings: "Could save about $179.88 a year",
    fingerprint: "fp",
    urgent: false,
    pick: null,
    sure,
  },
  false,
);

// The message as the chat and the dock read it (src/lib/jane-agent/view.ts).
const view: MessageView = {
  id: "m1",
  kind: "decision",
  fromJane: true,
  tag: "to decide",
  time: "Nov 16, 9:00 AM",
  body: candidate.body,
  status: "open",
  answeredWith: null,
  note: null,
  advice: false,
  ...(candidate.refs.confidence ? { confidence: candidate.refs.confidence } : {}),
  buttons: candidate.actions.flatMap((a) =>
    a.kind === "link" ? [] : [{ id: a.id, label: a.label, kind: a.kind }],
  ),
  links: [],
  undoUntil: null,
  block: null,
  pinned: false,
  suggestion: false,
  options: null,
};

describe("a finding's pop-up", () => {
  it("says how sure Jane is on its face", () => {
    expect(candidate.refs.confidence).toEqual(sure);
    expect(popupCard(view).details.confidence).toEqual(sure);
  });

  it("says it once in its details, and the chat's words keep it", () => {
    expect(popupCard(view).details.about).not.toContain("% sure");
    expect(candidate.body).toContain("75% sure: 3 charges in 3 months of data.");
  });
});
