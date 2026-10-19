import { describe, expect, it, vi } from "vitest";

vi.mock("@/lib/session", () => ({ requireUser: vi.fn() }));

import { COVER_EVENTS } from "@/config/insurance";
import { parseIntent } from "@/lib/jane-agent/intents";
import {
  coverActions,
  coverBody,
  coverEventRef,
  doneNote,
  parseCoverEventRef,
} from "@/lib/jane-agent/insurance/cover-words";
import { changesFor, type PolicyLite } from "./cover-change-rules";
import type { CoverChange } from "./cover-changes";

// Cover changes with life events (spec step 154): the changes each event needs, and how
// Jane asks about them once. Pure.

const policies: PolicyLite[] = [
  { id: "car", kind: "auto", status: "active" },
  { id: "rent", kind: "renters", status: "active" },
  { id: "health", kind: "health", status: "active" },
  { id: "old", kind: "home", status: "cancelled" },
];

describe("the changes each event needs", () => {
  it.each([
    ["car_bought", [["add_vehicle", "car"]]],
    [
      "moving",
      [
        ["address", "car"],
        ["address", "rent"],
      ],
    ],
    [
      "new_baby",
      [
        ["add_dependant", "health"],
        ["review_life", null],
      ],
    ],
    [
      "married",
      [
        ["add_spouse", "car"],
        ["add_spouse", "health"],
        ["review_life", null],
      ],
    ],
    [
      "new_job",
      [
        ["review_benefits", null],
        ["review_life", null],
      ],
    ],
  ] as const)("%s", (event, expected) => {
    expect(changesFor(event, policies).map((c) => [c.change, c.policyId])).toEqual(expected);
  });

  it("has a test for every event", () => {
    expect([...COVER_EVENTS].sort()).toEqual(
      ["car_bought", "married", "moving", "new_baby", "new_job"].sort(),
    );
  });

  it("asks to get car insurance for a car with no car policy, and leaves cancelled ones alone", () => {
    expect(changesFor("car_bought", []).map((c) => c.change)).toEqual(["get_auto"]);
    expect(changesFor("moving", [policies[3]])).toEqual([]);
  });
});

describe("in the chat", () => {
  const change = (over: Partial<CoverChange>): CoverChange => ({
    id: "c",
    event: "car_bought",
    eventKey: "a1",
    change: "add_vehicle",
    policyId: "car",
    detail: { vehicle: "2024 Honda Civic" },
    status: "prepared",
    newPremiumCents: null,
    confirmation: null,
    doneBy: null,
    ...over,
  });
  const onFile = [
    {
      id: "car",
      carrier: "GEICO",
      kind: "auto" as const,
      premiumCents: 14_200,
      premiumFrequency: "monthly" as const,
    },
  ];

  it("asks once, saying who makes the changes", () => {
    expect(coverBody("car_bought", [change({})], onFile, true).split("\n")).toEqual([
      "You've got a new car. Here's what I've got ready for your insurance:",
      "- Add 2024 Honda Civic to your GEICO car policy",
      "I'll make these with your insurers when you say so, and tell you any new price.",
    ]);
    expect(
      coverBody("car_bought", [change({})], onFile, false)
        .split("\n")
        .at(-1),
    ).toBe("Tell your insurers about these, then tap Done so I keep your insurance up to date.");
    expect(coverActions([change({})], true).map((a) => a.label)).toEqual([
      "Make the changes",
      "Not now",
      "Your insurance",
    ]);
    expect(coverActions([change({})], false)[0].label).toBe("Done");
    expect(coverActions([change({ change: "review_life", policyId: null })], true)[0].label).toBe(
      "OK",
    );
  });

  it("says the new price once it's made", () => {
    expect(doneNote([change({ newPremiumCents: 25_600 })], onFile)).toBe(
      "Done. Your GEICO car policy is now $256.00 a month.",
    );
    expect(doneNote([change({ newPremiumCents: 14_200, change: "address" })], onFile)).toBe(
      "Done.",
    );
  });

  it("keeps the event in the message's refs", () => {
    const ref = coverEventRef("married", "told:2026-10-19");
    expect(parseCoverEventRef(ref)).toEqual({ event: "married", eventKey: "told:2026-10-19" });
    expect(parseCoverEventRef(undefined)).toBeNull();
  });

  it("reads a marriage or a new car told to Jane", () => {
    expect(parseIntent("we just got married!", "2026-10-19")).toMatchObject({
      kind: "insurance",
      ask: "life_change",
      event: "married",
    });
    expect(parseIntent("I bought a new car", "2026-10-19")).toMatchObject({
      ask: "life_change",
      event: "car_bought",
    });
  });
});
