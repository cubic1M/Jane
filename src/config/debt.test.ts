import { describe, expect, it } from "vitest";
import { DEBT_AUTOPILOT, DEBT_AUTOPILOT_SHORT } from "./debt";

// Debt autopilot text: every step is listed at every level, in order, and has a short line
// for the chat's answer.

describe("the debt autopilot steps", () => {
  const levels = ["ask", "safe", "all"] as const;

  it("lists the same steps at every level, in order", () => {
    const steps = (l: (typeof levels)[number]) => DEBT_AUTOPILOT[l].map((s) => s.step);
    expect(steps("safe")).toEqual(steps("ask"));
    expect(steps("all")).toEqual(steps("ask"));
    expect(steps("ask")).toEqual([...steps("ask")].sort((a, b) => a - b));
    expect(steps("ask")).toContain(230);
  });

  it("has a short line for every step, short enough to list them all in an answer", () => {
    for (const { step } of DEBT_AUTOPILOT.ask) {
      const line = DEBT_AUTOPILOT_SHORT[step];
      expect(line, `step ${step}`).toBeTruthy();
      expect(line.length, `step ${step}`).toBeLessThanOrEqual(100);
    }
    const total = DEBT_AUTOPILOT.ask.reduce((n, s) => n + DEBT_AUTOPILOT_SHORT[s.step].length, 0);
    expect(total).toBeLessThan(2_000);
  });

  it("says in full what Jane does at each level, and never that she acts without a tap on money", () => {
    for (const l of levels) {
      for (const s of DEBT_AUTOPILOT[l])
        expect(s.does.length, `${l} ${s.step}`).toBeGreaterThan(40);
    }
    expect(DEBT_AUTOPILOT.ask.find((s) => s.step === 230)!.does).toContain(
      "nothing happens until you tap",
    );
    expect(DEBT_AUTOPILOT.safe.find((s) => s.step === 230)!.does).toContain(
      "within your debt caps",
    );
  });
});
