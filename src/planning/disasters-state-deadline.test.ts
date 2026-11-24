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
  { id: "w", title: "IRS filing deadline for Washington residents", dueOn: due, done: false },
];

describe("state deadlines under federal relief", () => {
  it("are left alone when the state does not follow", () => {
    const ids = deadlineMoves({ ...harris, stateFollows: false }, list).map((m) => m.id);
    expect(ids).toEqual(["f", "w"]);
  });
  it("move when the state follows", () => {
    const ids = deadlineMoves({ ...harris, stateFollows: true }, list).map((m) => m.id);
    expect(ids.sort()).toEqual(["c", "f", "s", "w"]);
  });
});
