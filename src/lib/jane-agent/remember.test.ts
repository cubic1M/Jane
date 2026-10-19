import { describe, expect, it, vi } from "vitest";

vi.mock("@/lib/session", () => ({ requireUser: vi.fn() }));

import { parseIntent } from "./intents";
import { keeps, neverKeys, paydayDays, type Preference } from "./preferences";
import { nextPaydayFrom, paydayLine, parseFact } from "./remember";
import { rememberReply } from "./replies";

// Spec step 91: what the person tells Jane, understood by rules and offered to remember,
// never saved without the tap.

const TODAY = "2026-10-18";

describe("parseFact", () => {
  it("reads a payday, one or two a month", () => {
    expect(parseFact("payday is the 15th")).toEqual({
      kind: "fact",
      key: "payday",
      value: { days: [15] },
      label: "Payday is the 15th",
    });
    expect(parseFact("i get paid on the 1st and 15th")).toMatchObject({
      value: { days: [1, 15] },
      label: "Paid on the 1st and the 15th",
    });
    expect(parseFact("remember that my payday is the 22nd")?.label).toBe("Payday is the 22nd");
  });

  it("reads something they need or want kept", () => {
    expect(parseFact("i need my car")).toEqual({
      kind: "fact",
      key: "keep:car",
      value: { target: "car" },
      label: "You want to keep your car",
    });
    expect(parseFact("don't cancel netflix")?.key).toBe("keep:netflix");
    expect(parseFact("stop suggesting spotify")?.key).toBe("keep:spotify");
  });

  it("keeps anything after 'remember that' as a note, and ignores questions", () => {
    expect(parseFact("remember that we're saving for a house")).toMatchObject({
      key: "note:we're saving for a house",
      label: "We're saving for a house",
    });
    expect(parseFact("how much is netflix")).toBeNull();
    expect(parseFact("cancel netflix")).toBeNull();
  });

  it("is what the rules read it as, before anything else", () => {
    expect(parseIntent("Payday is the 15th.", TODAY)).toMatchObject({ kind: "remember" });
    expect(parseIntent("I need my car", TODAY)).toMatchObject({ kind: "remember" });
    expect(parseIntent("when do I get paid", TODAY)).toEqual({ kind: "payday" });
  });
});

describe("rememberReply", () => {
  it("offers Remember this, and saves nothing by itself", () => {
    const draft = parseFact("payday is the 15th")!;
    const reply = rememberReply(draft);
    expect(reply.body).toMatch(/^I can remember that: payday is the 15th\./);
    expect(reply.actions).toEqual([{ id: "pref.save", label: "Remember this", kind: "primary" }]);
    expect(reply.refs.preference).toEqual(draft);
  });
});

describe("paydays from what they said", () => {
  it("finds the next one, this month or next, and months that are too short", () => {
    expect(nextPaydayFrom([15], TODAY)).toBe("2026-11-15");
    expect(nextPaydayFrom([1, 15], "2026-10-10")).toBe("2026-10-15");
    expect(nextPaydayFrom([31], "2026-11-05")).toBe("2026-11-30");
    expect(paydayLine([1, 15], TODAY)).toBe(
      "Your next payday is Nov 1 (in 14 days), as you told me.",
    );
  });
});

describe("reading preferences", () => {
  const pref = (over: Partial<Preference>): Preference => ({
    id: "p",
    kind: "fact",
    key: "x",
    value: {},
    label: "x",
    createdAt: new Date(),
    ...over,
  });
  it("gives the never keys, paydays and what to keep", () => {
    const prefs = [
      pref({ kind: "never", key: "finding:sub:hulu" }),
      pref({ key: "payday", value: { days: [15, 1, 40] } }),
      pref({ key: "keep:car", value: { target: "car" } }),
    ];
    expect([...neverKeys(prefs)]).toEqual(["finding:sub:hulu"]);
    expect(paydayDays(prefs)).toEqual([1, 15]);
    expect(keeps(prefs)).toEqual(["car"]);
    expect(paydayDays([])).toBeNull();
  });
});
