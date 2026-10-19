import { describe, expect, it, vi } from "vitest";

vi.mock("@/lib/session", () => ({ requireUser: vi.fn() }));
import { CHAT_BLOCK_ROWS, CHAT_BLOCK_WIDTH } from "@/config/agent-chat";
import type { GoalView } from "@/lib/goals";
import { blockCents, drawBlock, parseBlock, type AnswerBlock } from "./blocks";
import { goalsReply } from "./goals-reply";

// Spec step 94: every block fits a 375px phone (CHAT_BLOCK_WIDTH monospace characters) and
// has a text alternative with every figure in it.

const blocks: AnswerBlock[] = [
  {
    type: "bars",
    title: "Spending in October",
    rows: [
      { label: "Loan payments", cents: 263_564 },
      { label: "Shopping", cents: 161_459 },
      { label: "Food and drink", cents: 18_690 },
      { label: "Fees", cents: 0 },
    ],
  },
  {
    type: "table",
    title: "Your options",
    columns: ["Option", "1st year", "Saves"],
    rows: [
      ["Pine Mobile Unlimited with a very long name", "$420.00", "$1,320.00"],
      ["Mint Unlimited", "$360.00", "$1,380.00"],
    ],
  },
  {
    type: "timeline",
    title: "Due this week",
    rows: [
      { date: "2026-10-20", label: "Verizon Wireless", cents: 14_500 },
      { date: "2026-10-22", label: "Duolingo renews every three months", cents: 2_999 },
      { date: "2026-10-25", label: "FSA deadline", cents: null },
    ],
  },
  {
    type: "progress",
    title: "Your goals",
    rows: [
      { label: "Emergency fund for the whole family", doneCents: 150_000, totalCents: 600_000 },
      { label: "Trip", doneCents: 90_000, totalCents: 90_000 },
    ],
  },
];

describe("drawBlock", () => {
  it.each(blocks.map((b) => [b.type, b] as const))("fits a phone: %s", (_, block) => {
    const drawn = drawBlock(block);
    expect(drawn.lines.length).toBeGreaterThan(0);
    for (const line of drawn.lines) expect(line.length, line).toBeLessThanOrEqual(CHAT_BLOCK_WIDTH);
  });

  it("draws bars to scale, with exact amounts", () => {
    const { lines, alt } = drawBlock(blocks[0]);
    expect(lines[0]).toMatch(/^Loan paym… █+ \$2,635\.64$/);
    expect(lines[3]).toMatch(/^Fees {7} +\$0\.00$/);
    expect(lines[0].split("█").length).toBeGreaterThan(lines[1].split("█").length);
    expect(alt).toBe(
      "Spending in October: Loan payments $2,635.64, Shopping $1,614.59, Food and drink $186.90, Fees $0.00.",
    );
  });

  it("lines up a table, a timeline and progress, each with a full text alternative", () => {
    expect(drawBlock(blocks[1]).alt).toContain(
      "Option Mint Unlimited, 1st year $360.00, Saves $1,380.00",
    );
    const timeline = drawBlock(blocks[2]);
    expect(timeline.lines[0]).toMatch(/^Oct 20 ├ Verizon Wireless +\$145\.00$/);
    expect(timeline.lines[2]).toMatch(/^Oct 25 └ FSA deadline/);
    expect(timeline.alt).toContain("Oct 22, Duolingo renews every three months, $29.99");
    const progress = drawBlock(blocks[3]);
    expect(progress.lines[1]).toMatch(/^\[#+-+\]  25%$/);
    expect(progress.lines[4]).toMatch(/^\[#+\] 100%$/);
    expect(progress.alt).toContain("Trip: $900.00 of $900.00, 100%");
  });

  it("keeps to the row limit", () => {
    const many: AnswerBlock = {
      type: "bars",
      title: "t",
      rows: Array.from({ length: 20 }, (_, i) => ({ label: `${i}`, cents: i })),
    };
    expect(drawBlock(many).lines).toHaveLength(CHAT_BLOCK_ROWS);
  });
});

describe("blockCents and parseBlock", () => {
  it("gives a block's figures, and reads only well-formed blocks back", () => {
    expect(blockCents(blocks[3])).toEqual([150_000, 600_000, 90_000, 90_000]);
    expect(parseBlock(blocks[0])).toEqual(blocks[0]);
    expect(parseBlock({ type: "pie", title: "x", rows: [] })).toBeNull();
    expect(parseBlock({ type: "table", title: "x", rows: [] })).toBeNull();
    expect(parseBlock(null)).toBeNull();
  });
});

// The goals answer (spec step 94): how many are on track, then what needs something, with
// each goal's progress as bars.
describe("goalsReply", () => {
  const goal = (name: string, progress: GoalView["progress"], targetCents = 100_000) =>
    ({ id: name, name, targetCents, targetDate: "2027-06-01", progress }) as unknown as GoalView;

  it("says how many are on track first, then any that passed their date", () => {
    const reply = goalsReply([
      goal("Trip", {
        status: "on_the_way",
        savedCents: 25_000,
        leftCents: 75_000,
        percent: 25,
        monthsLeft: 8,
        monthlyCents: 9_375,
      }),
      goal("Car", { status: "date_passed", savedCents: 10_000, leftCents: 90_000, percent: 10 }),
    ]);
    expect(reply.body.split("\n")).toEqual([
      "1 of your 2 goals is on track.",
      "Trip: $93.75 a month to reach it on time.",
      "Car reached its date with $900.00 still to go: you can pick a new date on Goals.",
    ]);
    expect(reply.refs.block).toEqual({
      type: "progress",
      title: "Your goals",
      rows: [
        { label: "Trip", doneCents: 25_000, totalCents: 100_000 },
        { label: "Car", doneCents: 10_000, totalCents: 100_000 },
      ],
    });
    expect(goalsReply([]).body).toMatch(/^You don't have any goals yet\./);
    expect(
      goalsReply([goal("Trip", { status: "reached", savedCents: 100_000, percent: 100 })]).body,
    ).toBe("You've reached your goal.");
  });
});
