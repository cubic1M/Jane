import { describe, expect, it } from "vitest";
import { concise, isPopup, popupCard, withoutPopups, POPUP_HEADLINE_WORDS } from "./popups";
import type { MessageView } from "./view";

// Jane's own messages as pop-ups: what floats, how short its headline is, what its buttons do.

const message = (over: Partial<MessageView> = {}): MessageView => ({
  id: "m1",
  kind: "decision",
  fromJane: true,
  tag: "to decide",
  time: "Oct 24, 9:00 AM",
  body: "How much should I do on my own?\nHandle the safe stuff: refunds and fees.",
  status: "open",
  answeredWith: null,
  note: null,
  advice: false,
  buttons: [
    { id: "autopilot.safe", label: "Handle the safe stuff", kind: "primary" },
    { id: "autopilot.all", label: "Handle everything allowed", kind: "secondary" },
    { id: "autopilot.ask", label: "Ask me first", kind: "secondary" },
  ],
  links: [],
  undoUntil: null,
  block: null,
  pinned: false,
  suggestion: false,
  options: null,
  ...over,
});

describe("what floats", () => {
  it("floats Jane's own open messages with a button, never her answers or what's done", () => {
    expect(isPopup(message())).toBe(true);
    expect(isPopup(message({ kind: "reply" }))).toBe(false);
    expect(isPopup(message({ status: "answered" }))).toBe(false);
    expect(isPopup(message({ buttons: [] }))).toBe(false);
    expect(isPopup(message({ fromJane: false, kind: "user" }))).toBe(false);
    // Only Undo left: it's history, in the list.
    expect(
      isPopup(message({ buttons: [{ id: "undo.no", label: "Undo", kind: "secondary" }] })),
    ).toBe(false);
  });

  it("leaves no gap in the list where a pop-up came from", () => {
    const a = message({ id: "a" });
    const b = message({ id: "b", kind: "reply", buttons: [] });
    expect(withoutPopups([a, b], [a]).map((m) => m.id)).toEqual(["b"]);
  });
});

describe("a pop-up's card", () => {
  it("has a headline of eight words at most, cut at a word", () => {
    expect(concise("Cancel Hulu, save $216/yr")).toBe("Cancel Hulu, save $216/yr");
    const long = concise("Your car insurance renews next week and the price went up by $240");
    expect(long.split(" ").length).toBeLessThanOrEqual(POPUP_HEADLINE_WORDS);
    expect(long).toBe("Your car insurance renews next week and the…");
  });

  it("taps the main button for Yes, puts the others behind More details, and snoozes on Not now", () => {
    const card = popupCard(message());
    expect(card).toMatchObject({
      headline: "How much should I do on my own?",
      yesLabel: "Handle the safe stuff",
      yesAction: "autopilot.safe",
      notNowAction: null,
      choices: [
        { id: "autopilot.all", label: "Handle everything allowed" },
        { id: "autopilot.ask", label: "Ask me first" },
      ],
    });
    expect(card.details.why).toBe("Handle the safe stuff: refunds and fees.");
    const heads = popupCard(
      message({
        kind: "heads_up",
        body: "Your rent is due Friday.",
        buttons: [
          { id: "deadline.done", label: "Paid it", kind: "primary" },
          { id: "snooze", label: "Remind me later", kind: "secondary" },
        ],
      }),
    );
    expect(heads).toMatchObject({
      yesAction: "deadline.done",
      notNowAction: "snooze",
      notNowLabel: "Remind me later",
      choices: [],
    });
  });

  it("keeps the whole message behind More details when the headline is cut", () => {
    const body = "Your car insurance renews next week and the price went up by $240";
    expect(popupCard(message({ body })).details.why).toBe(body);
  });
});
