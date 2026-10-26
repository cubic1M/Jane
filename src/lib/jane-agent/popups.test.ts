import { describe, expect, it } from "vitest";
import {
  chatList,
  concise,
  firstSentence,
  hiddenBrief,
  isPopup,
  popupCard,
  popupStack,
  withoutPopups,
  POPUP_HEADLINE_WORDS,
} from "./popups";
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
    expect(card.details.about).toBe("Handle the safe stuff: refunds and fees.");
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

  it("shows its first sentence whole, never cut with an ellipsis, and the rest behind More details", () => {
    const body = "Your car insurance renews next week and the price went up by $240";
    expect(popupCard(message({ body })).headline).toBe(body);
    expect(popupCard(message({ body })).details.about).toBeUndefined();
    const brief = popupCard(
      message({
        kind: "brief",
        body: "Good morning! Three things today.\nYour rent is due Friday.",
      }),
    );
    expect(brief.headline).toBe("Good morning!");
    expect(brief.details.about).toBe("Three things today.\nYour rent is due Friday.");
    expect(firstSentence("Saved $3.50 a month. More soon.")).toBe("Saved $3.50 a month.");
  });
});

describe("one stack of cards, never repeated", () => {
  const suggestion = (id: string, body: string) => message({ id, body, suggestion: true });

  it("puts the day's suggestions first, then the rest, one card per message and per headline", () => {
    const stack = popupStack(
      [suggestion("s1", "Drop your mortgage insurance, save $1,562/yr\nWhy you: …")],
      [
        message({ id: "s1", suggestion: true }),
        message({
          id: "d1",
          body: "Drop your mortgage insurance, save $1,562/yr\nFrom insurance.",
        }),
        message({ id: "d2" }),
        message({ id: "b1", kind: "brief", body: "Here's your week." }),
        // The morning greeting is off for now (MORNING_BRIEF): never a card.
        message({ id: "g1", kind: "brief", body: "Good morning! Three things today." }),
      ],
      12,
    );
    expect(stack.map((m) => m.id)).toEqual(["s1", "b1", "d2"]);
  });

  it("keeps no more than the limit beyond the suggestions", () => {
    const others = ["a", "b", "c"].map((id) => message({ id, body: `Thing ${id}` }));
    expect(popupStack([], others, 2)).toHaveLength(2);
  });

  it("keeps the cards out of the chat: no suggestion, waiting or answered, and no twin", () => {
    const stack = [suggestion("s1", "Cancel Hulu, save $216/yr")];
    const list = chatList(
      [
        suggestion("s1", "Cancel Hulu, save $216/yr"),
        message({ id: "s0", suggestion: true, status: "answered" }),
        message({ id: "twin", body: "Cancel Hulu, save $216/yr\nFrom spending." }),
        message({ id: "r1", kind: "reply", body: "Here's your plan." }),
        message({ id: "old", body: "Cancel Hulu, save $216/yr", status: "answered" }),
      ],
      stack,
    );
    expect(list.map((m) => m.id)).toEqual(["r1", "old"]);
  });
});

describe("the morning greeting, off for now", () => {
  it("hides a greeting brief while it's off, and only that", () => {
    const greeting = message({ kind: "brief", body: "Good afternoon! $2,710 safe to spend." });
    expect(hiddenBrief(greeting)).toBe(true);
    expect(hiddenBrief(greeting, true)).toBe(false);
    expect(hiddenBrief(message({ kind: "brief", body: "Here's your week." }))).toBe(false);
    // The first-run hello is gone for good, whatever the flag.
    const hello = message({ kind: "brief", body: "Hi, I'm Jane. I look at your money every day." });
    expect(hiddenBrief(hello)).toBe(true);
    expect(hiddenBrief(hello, true)).toBe(true);
    expect(hiddenBrief(message({ kind: "decision", body: "Good morning! Not a brief." }))).toBe(
      false,
    );
    expect(chatList([greeting], []).length).toBe(0);
  });
});

describe("a card whose only button is its snooze", () => {
  it("shows it once, as Yes, with a plain Not now", () => {
    const card = popupCard(
      message({
        kind: "heads_up",
        body: "Coming up in 2 days: your card payment ($72.00).",
        buttons: [{ id: "snooze", label: "Remind me tomorrow", kind: "secondary" }],
      }),
    );
    expect(card).toMatchObject({
      yesLabel: "Remind me tomorrow",
      yesAction: "snooze",
      notNowLabel: "Not now",
      notNowAction: null,
    });
  });
});
