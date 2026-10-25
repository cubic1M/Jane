import { describe, expect, it } from "vitest";
import { chosenView, isChoice, revertedView } from "./choices";
import { isPopup, popupCard } from "./popups";
import type { MessageView } from "./view";

// A choice is instant and stays (founder, 2026-10-25): marked, the others kept, Revert offered;
// Revert brings the choices back.

const question: MessageView = {
  id: "m1",
  kind: "decision",
  fromJane: true,
  tag: "decision",
  time: "Oct 25, 9:00 AM",
  body: "How much should I do on my own?\nPick one.",
  status: "open",
  answeredWith: null,
  note: null,
  advice: false,
  buttons: [
    { id: "autopilot.safe", label: "Handle the safe stuff", kind: "primary" },
    { id: "autopilot.all", label: "Handle everything allowed", kind: "secondary" },
    { id: "autopilot.ask", label: "Ask me first", kind: "secondary" },
    { id: "snooze", label: "Decide next week", kind: "secondary" },
  ],
  links: [],
  undoUntil: null,
  block: null,
  pinned: false,
  suggestion: false,
  options: null,
};

describe("choices", () => {
  it("knows the autopilot levels are one choice", () => {
    expect(isChoice("autopilot.all")).toBe(true);
    expect(isChoice("snooze")).toBe(false);
    expect(isChoice("finding.yes")).toBe(false);
  });

  it("marks a choice at once, keeps every choice, and offers Revert", () => {
    const chosen = chosenView(question, question.buttons[1]);
    expect(chosen).toMatchObject({
      status: "answered",
      answeredWith: "Handle everything allowed",
      chosen: { key: "autopilot.all", label: "Handle everything allowed", final: false },
    });
    expect(chosen.chosen!.choices.map((c) => c.label)).toEqual([
      "Handle the safe stuff",
      "Handle everything allowed",
      "Ask me first",
    ]);
    expect(chosen.buttons.map((b) => b.id)).toEqual(["choice.revert", "choice.done"]);
  });

  it("brings the choices back on Revert", () => {
    const back = revertedView(chosenView(question, question.buttons[0]));
    expect(back).toMatchObject({ status: "open", answeredWith: null, chosen: null });
    expect(back.buttons.map((b) => b.id)).toEqual([
      "autopilot.safe",
      "autopilot.all",
      "autopilot.ask",
    ]);
    expect(revertedView(question)).toBe(question);
  });

  it("makes its pop-up card one that stays chosen, with Revert, until Done", () => {
    expect(popupCard(question).revertable).toBe(true);
    const chosen = chosenView(question, question.buttons[2]);
    expect(isPopup(chosen)).toBe(true);
    expect(popupCard(chosen)).toMatchObject({ chosen: "Ask me first", revertable: true });
    expect(isPopup({ ...chosen, chosen: { ...chosen.chosen!, settled: true } })).toBe(false);
    expect(
      popupCard({ ...question, buttons: [{ id: "finding.yes", label: "Yes", kind: "primary" }] })
        .revertable,
    ).toBe(false);
  });
});
