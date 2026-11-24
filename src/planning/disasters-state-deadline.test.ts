import { describe, expect, it } from "vitest";
import { SAMPLE_RELIEF } from "@/config/disasters";
import { deadlineMoves } from "./disasters";

// CodeRabbit sweep 1b: a state's own tax deadline was moved to the federal postponed date even
// when the state did not follow the relief.
const harris = SAMPLE_RELIEF.find((r) => r.id === "SAMPLE-TX-2026-09")!;
const due = harris.incidentFrom;
const list = [
  { id: "s", title: "State income tax return", dueOn: due, done: false },
  { id: "f", title: "Federal estimated tax payment", dueOn: due, done: false },
  { id: "c", title: "California estimated tax payment", dueOn: due, done: false },
  { id: "t", title: "Texas franchise tax report", dueOn: due, done: false },
  { id: "w", title: "IRS filing deadline for Washington residents", dueOn: due, done: false },
];

describe("state deadlines under federal relief", () => {
  it("are left alone when the state does not follow", () => {
    const ids = deadlineMoves({ ...harris, stateFollows: false }, list).map((m) => m.id);
    expect(ids).toEqual(["f", "w"]);
  });
  it("move when the state follows", () => {
    const ids = deadlineMoves({ ...harris, stateFollows: true }, list).map((m) => m.id);
    // Texas relief: the Texas deadline moves with it, California's does not.
    expect(ids.sort()).toEqual(["f", "s", "t", "w"]);
  });
});

describe("West Virginia is not Virginia", () => {
  const wv = [{ id: "x", title: "West Virginia estimated tax payment", dueOn: due, done: false }];
  it("moves under West Virginia's relief and not Virginia's", () => {
    expect(deadlineMoves({ ...harris, state: "WV", stateFollows: true }, wv)).toHaveLength(1);
    expect(deadlineMoves({ ...harris, state: "VA", stateFollows: true }, wv)).toHaveLength(0);
  });
  it("keeps an ordinary Virginia title working", () => {
    const va = [{ id: "v", title: "Virginia estimated tax payment", dueOn: due, done: false }];
    expect(deadlineMoves({ ...harris, state: "VA", stateFollows: true }, va)).toHaveLength(1);
  });
});

describe("a county name in the title", () => {
  it("doesn't change the state that owns the deadline", () => {
    const t = [
      {
        id: "k",
        title: "Texas estimated tax payment (Washington County)",
        dueOn: due,
        done: false,
      },
    ];
    expect(deadlineMoves({ ...harris, state: "TX", stateFollows: true }, t)).toHaveLength(1);
    expect(deadlineMoves({ ...harris, state: "WA", stateFollows: true }, t)).toHaveLength(0);
  });
});

describe("a state name inside a longer word", () => {
  it("is not that state", () => {
    const t = [
      {
        id: "m",
        title: "Maineville business: Ohio estimated tax payment",
        dueOn: due,
        done: false,
      },
    ];
    expect(deadlineMoves({ ...harris, state: "OH", stateFollows: true }, t)).toHaveLength(1);
    expect(deadlineMoves({ ...harris, state: "ME", stateFollows: true }, t)).toHaveLength(0);
  });
});
