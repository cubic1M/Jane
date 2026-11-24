import { describe, expect, it } from "vitest";
import { checkGuardrails, dollarFigures } from "@/lib/guardrails";
import { chargeExplainReply, lookUpCharge, type ChargeAsked } from "./charge-explain";
import type { BillLine } from "./replies-old-bills";

// "Why did I pay $100 to Vercel?" (founder 11-24), from the person's own charges. Fixtures: a
// merchant that jumps once (20, 20, 20, 100), one that steps up and stays, a variable bill, and one
// seen once.

const line = (id: string, date: string, dollars: number, name = "Vercel"): BillLine => ({
  id,
  date,
  amountCents: Math.round(dollars * 100),
  description: `${name.toUpperCase()} INC`,
  merchantName: name,
  pfcDetailed: null,
});
const spike = [
  line("v1", "2026-08-20", 20),
  line("v2", "2026-09-20", 20),
  line("v3", "2026-10-20", 20),
  line("v4", "2026-11-20", 100),
];
const step = [
  line("s1", "2026-07-20", 20),
  line("s2", "2026-08-20", 20),
  line("s3", "2026-09-20", 100),
  line("s4", "2026-10-20", 100),
  line("s5", "2026-11-20", 100),
];
const once = [line("o1", "2026-11-20", 100)];
const NONE: ChargeAsked = { amountCents: null, day: null };

const say = (target: string, lines: BillLine[], asked: ChargeAsked = NONE) => {
  const reply = chargeExplainReply(lookUpCharge(target, lines, asked), asked, target);
  // Every answer through the guardrails, its own figures the ones it may state.
  const guard = checkGuardrails(
    reply.body,
    dollarFigures(reply.body).map((f) => f.cents),
    undefined,
    "standard",
  );
  expect(guard.ok ? [] : guard.issues, reply.body).toEqual([]);
  return reply;
};

describe("a merchant that jumps (20, 20, 20, 100)", () => {
  it("says what was paid, the usual, the difference and that it is the first this high", () => {
    const { body } = say("vercel", spike, { amountCents: 10_000, day: null });
    expect(body).toContain(
      "You paid Vercel $100.00 on Nov 20. You usually pay it $20.00 a month, so this is $80.00 more than usual; it is the first time it has been this high in what I can see.",
    );
  });

  it("says plainly the bank's line doesn't say why, and offers to read the invoice", () => {
    const { body, actions } = say("vercel", spike);
    expect(body).toContain("Your bank's line shows only who was paid and how much, not why.");
    expect(body).toContain("paste its text");
    expect(body).toContain("name the one that explains the extra $80.00");
    expect(actions[0]).toMatchObject({ label: "Read the invoice", href: "/invoice?charge=v4" });
  });

  it("marks a reason a bill can rise as general, never as a fact about this bill", () => {
    const { body } = say("vercel", spike);
    expect(body).toContain("In general, a bill can rise when usage is added to a plan fee");
    expect(body).toContain("I can't tell it from your bank's line");
  });

  it("answers by the amount, the day, and 'so high' the same way", () => {
    const byAmount = say("vercel", spike, { amountCents: 10_000, day: null }).body;
    const byDay = say("vercel", spike, { amountCents: null, day: "2026-11-20" }).body;
    const high = say("vercel", spike, { amountCents: null, day: null, high: true }).body;
    for (const body of [byDay, high])
      expect(body.split(" Your bank's")[0]).toBe(byAmount.split(" Your bank's")[0]);
  });

  it("explains an earlier $20 charge as like the rest of its run, and what came after", () => {
    const { body } = say("vercel", spike, { amountCents: 2_000, day: "2026-10-20" });
    expect(body).toContain("You paid Vercel $20.00 on Oct 20.");
    expect(body).toContain(
      "It has been $20.00 each time since Aug 20 (3 charges): nothing is different about this one.",
    );
    expect(body).not.toContain("more than usual");
    expect(body).toContain("The charge after it, on Nov 20, was $100.00.");
    expect(body).not.toContain("In general");
  });

  it("explains a $20 charge after the spike as the same as usual", () => {
    const back = [...spike, line("v5", "2026-12-20", 20)];
    const { body } = say("vercel", back);
    expect(body).toContain(
      "That's the same as your usual $20.00 a month: nothing is different about this one.",
    );
    expect(body).not.toContain("more than usual");
  });
});

describe("a merchant that stepped up and stayed (20, 20, 100, 100, 100)", () => {
  it("says since when, not a first time", () => {
    const { body } = say("vercel", step);
    expect(body).toContain("You paid Vercel $100.00 on Nov 20.");
    expect(body).toContain(
      "You used to pay it $20.00 a month, so this is $80.00 more than usual; it went up on Sep 20 and has been $100.00 each time since (3 charges).",
    );
    expect(body).not.toContain("first time");
  });
});

describe("whether it is the first time this high", () => {
  const highest = (lines: BillLine[], asked: ChargeAsked = NONE) => {
    const found = lookUpCharge("vercel", lines, asked);
    return found.kind === "found" ? found.explanation.highest : null;
  };

  it("is true for a spike above every charge before it", () => {
    expect(highest(spike)).toBe(true);
  });

  it("is false for a $100 charge when an earlier $100 is in its own run", () => {
    expect(highest(step)).toBe(false);
    expect(highest(step, { amountCents: 10_000, day: "2026-10-20" })).toBe(false);
    // The first $100 of the run is the one that was above everything before it.
    expect(highest(step, { amountCents: 10_000, day: "2026-09-20" })).toBe(true);
  });
});

describe("a variable bill", () => {
  const power = [
    line("p1", "2026-06-04", 38.72, "Xcel Energy"),
    line("p2", "2026-07-04", 52.1, "Xcel Energy"),
    line("p3", "2026-08-04", 41.3, "Xcel Energy"),
    line("p4", "2026-09-04", 47.6, "Xcel Energy"),
    line("p5", "2026-10-04", 44.0, "Xcel Energy"),
    line("p6", "2026-11-04", 57.49, "Xcel Energy"),
  ];
  it("says 'about' the middle of the earlier ones, and the highest so far", () => {
    const { body } = say("xcel energy", power);
    expect(body).toContain(
      "You usually pay it about $44.00 a month, so this is $13.49 more than usual",
    );
    expect(body).toContain("first time it has been this high");
  });
});

describe("a charge seen once", () => {
  it("says it is the only one, so there is no usual", () => {
    const { body } = say("vercel", once, { amountCents: 10_000, day: null });
    expect(body).toContain(
      "You paid Vercel $100.00 on Nov 20. It's the only charge from Vercel I see",
    );
    expect(body).toContain("so I can't say what's usual yet");
    expect(body).not.toMatch(/usually|more than usual/);
    expect(body).toContain("not why");
  });
});

describe("what isn't there", () => {
  it("says no charge from that name", () => {
    expect(lookUpCharge("hulu", spike, NONE)).toEqual({ kind: "none" });
    expect(say("hulu", spike).body).toContain("I don't see a charge from Hulu");
  });

  it("says the amount or day isn't there, with its latest", () => {
    expect(say("vercel", spike, { amountCents: 5_000, day: null }).body).toBe(
      "I don't see a $50.00 charge from Vercel. Its latest was $100.00 on Nov 20.",
    );
    expect(say("vercel", spike, { amountCents: null, day: "2026-03-02" }).body).toBe(
      "I don't see a charge from Vercel on Mar 2. Its latest was $100.00 on Nov 20.",
    );
  });
});

describe("a charge that went down, and one that is the first of its run", () => {
  it("says less than usual", () => {
    const down = [
      line("d1", "2026-09-20", 100),
      line("d2", "2026-10-20", 100),
      line("d3", "2026-11-20", 20),
    ];
    const { body } = say("vercel", down);
    expect(body).toContain("so this is $80.00 less than usual");
    expect(body).not.toContain("first time");
  });

  it("says the earliest charge it sees can't be compared with an earlier one", () => {
    const first = [line("e1", "2026-09-20", 100), line("e2", "2026-10-20", 20)];
    const { body } = say("vercel", first, { amountCents: 10_000, day: null });
    expect(body).toContain("It's the earliest charge from Vercel I see (2 in all)");
    expect(body).toContain("The charge after it, on Oct 20, was $20.00.");
  });
});
