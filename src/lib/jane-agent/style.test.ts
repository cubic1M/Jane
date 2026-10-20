import { describe, expect, it } from "vitest";
import { parseFact } from "./remember";
import type { Preference } from "./preferences";
import type { Reply } from "./replies";
import { shapeReply, styleInstructions, styleOf, type Style } from "./style";

// Spec step 188: Jane's way of talking, picked up from what the person says.

const pref = (key: string, value: Preference["value"]): Preference => ({
  id: key,
  kind: "style",
  key,
  value,
  label: key,
  createdAt: new Date(),
});

const LIST: Reply = {
  body: [
    "You have $1,234.56 safe to spend until payday, Nov 1 (in 13 days). That is after your bills.",
    "Due in the next 7 days: Netflix $17.99 in 3 days.",
    "These 3 matter most:",
    "1. Review your Hulu subscription. It saves the most.",
    "2. Move idle cash. It earns more.",
    "3. Lower your phone bill. It is above average.",
  ].join("\n"),
  actions: [{ id: "finding.yes", label: "Yes: Hulu", kind: "primary" }],
  refs: { findingId: "f1" },
};

const STYLES: Style[] = [
  { length: "short", voice: "plain" },
  { length: "normal", voice: "plain" },
  { length: "detailed", voice: "plain" },
  { length: "short", voice: "numbers" },
  { length: "detailed", voice: "numbers" },
];

describe("what the person says about how Jane talks", () => {
  it.each([
    ["keep it short", { key: "length", value: { length: "short" } }],
    ["be more detailed", { key: "length", value: { length: "detailed" } }],
    ["numbers first", { key: "voice", value: { voice: "numbers" } }],
    ["tell me things as they come", { key: "posting", value: { posting: "as_they_come" } }],
    ["remember that i like it short", null],
  ])("reads %j", (text, want) => {
    const draft = parseFact(text);
    if (want) expect(draft).toMatchObject({ kind: "style", ...want });
    else expect(draft?.kind).not.toBe("style");
  });

  it("falls back to the defaults", () => {
    expect(styleOf([])).toEqual({ length: "normal", voice: "plain" });
    expect(
      styleOf([pref("length", { length: "short" }), pref("voice", { voice: "numbers" })]),
    ).toEqual({
      length: "short",
      voice: "numbers",
    });
  });
});

describe("answers in the person's style", () => {
  it.each(STYLES)("keeps the answer first and the button, at %j", (style) => {
    const shaped = shapeReply(LIST, style);
    expect(shaped.body.split("\n")[0]).toMatch(/^You have \$1,234\.56 safe to spend/);
    expect(shaped.actions).toEqual(LIST.actions);
    expect(shaped.refs).toEqual(LIST.refs);
  });

  it("is shorter when short, and unchanged at normal and detailed", () => {
    const short = shapeReply(LIST, { length: "short", voice: "plain" });
    expect(short.body.split("\n")[0]).toBe(
      "You have $1,234.56 safe to spend until payday, Nov 1 (in 13 days).",
    );
    expect(short.body.length).toBeLessThan(LIST.body.length * 0.6);
    expect(shapeReply(LIST, { length: "normal", voice: "plain" })).toBe(LIST);
    expect(shapeReply(LIST, { length: "detailed", voice: "plain" })).toBe(LIST);
  });

  it("brings the lines with figures up front for numbers first", () => {
    const reply: Reply = {
      body: "Netflix is a regular charge.\nIt has gone up.\nIt costs $17.99 a month.",
      actions: [],
      refs: {},
    };
    expect(shapeReply(reply, { length: "normal", voice: "numbers" }).body.split("\n")[0]).toBe(
      "It costs $17.99 a month.",
    );
  });

  it("tells Claude, only when it isn't the default", () => {
    expect(styleInstructions({ length: "normal", voice: "plain" })).toBeNull();
    expect(styleInstructions({ length: "short", voice: "numbers" })).toMatch(
      /one or two short sentences[\s\S]*Lead with the figures/,
    );
  });
});
