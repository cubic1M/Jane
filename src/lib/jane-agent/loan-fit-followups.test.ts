import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/session", () => ({ requireUser: vi.fn() }));
vi.mock("@/lib/home", () => ({ homeSummary: vi.fn() }));
vi.mock("./snapshot", () => ({ loadSnapshot: vi.fn() }));
vi.mock("@/lib/advice-mode", () => ({ adviceMode: vi.fn(async () => true) }));
vi.mock("@/lib/fit", () => ({ loadFit: vi.fn() }));
// The cost cap has its own tests (./spend.test.ts); here Claude is always under it.
vi.mock("./spend", async (original) => ({
  ...(await original<typeof import("./spend")>()),
  overDailyCap: vi.fn(async () => false),
  addSpend: vi.fn(),
}));

import { FIT_TERMS } from "@/config/fit";
import type { PrismaClient } from "@/generated/prisma/client";
import { adviceMode } from "@/lib/advice-mode";
import { loadFit, type FitView } from "@/lib/fit";
import { demoLender } from "@/lib/lenders/demo";
import type { LoanOffer } from "@/lib/lenders/partner";
import { fit } from "@/planning/fit";
import { askClaudeInChat, resetClaudeHealth, type ChatTurn } from "./claude";
import { forgetPrimer } from "./primer-cache";
import { loadSnapshot, type Snapshot } from "./snapshot";

// Follow-ups on the best loan (spec step 284's "why that one?" and "what about a shorter term?"),
// with a faked Claude: the loan_fit tool gives the reason for the pick, the pick against each
// other option and the lender's other terms with the differences worked out, so the answer
// quotes those figures and passes the guardrails without doing sums of its own.

const NOW = new Date("2026-10-18T15:00:00Z");
const client = {} as PrismaClient;
const create = vi.fn();
const sent: { role: string; content: unknown }[][] = [];
type Listener = (...args: unknown[]) => void;
const claude = () =>
  ({
    messages: {
      stream: (params: { messages: { role: string; content: unknown }[] }) => {
        sent.push(structuredClone(params.messages));
        const listeners: Record<string, Listener[]> = {};
        const emit = (name: string, ...args: unknown[]) =>
          (listeners[name] ?? []).forEach((fn) => fn(...args));
        const stream = {
          on(name: string, fn: Listener) {
            (listeners[name] ??= []).push(fn);
            return stream;
          },
          async finalMessage() {
            const message = await create(params);
            for (const block of message.content) {
              emit("streamEvent", { type: "content_block_start", content_block: block });
              if (block.type === "text") emit("text", block.text);
            }
            return message;
          },
        };
        return stream;
      },
    },
  }) as never;
const options = { client, now: NOW, claude };

let ids = 0;
const toolUse = (name: string, input: object = {}) => ({
  stop_reason: "tool_use",
  content: [{ type: "tool_use", id: `t${++ids}`, name, input }],
});
const final = (text: string) => ({ stop_reason: "end_turn", content: [{ type: "text", text }] });
// The loan_fit result in the request Claude is answering.
const toolResult = (params: { messages: { content: unknown }[] }) =>
  JSON.parse(
    (params.messages.at(-1)!.content as { content: string }[])[0].content,
  ) as LoanFitOutput;

type LoanFitOutput = {
  pick: string;
  whyThePick: {
    pick: string;
    reason: string;
    versusTheOthers: { option: string; months: number; pickPaidInAll: string }[];
  };
  otherTerms: {
    lender: string;
    shorterMonths: number | null;
    terms: {
      months: number;
      monthlyPayment: string;
      monthlyPaymentVersusBest: string;
      interestVersusBest: string;
    }[];
  };
};

// A $25,000 car loan on $4,000 a month take-home, priced by the lender stand-in.
let view: FitView;
beforeAll(async () => {
  const offers: LoanOffer[] = [];
  for (const termMonths of FIT_TERMS.auto) {
    offers.push(
      ...(await demoLender.prequalify({
        product: "auto",
        amountCents: 2_500_000,
        termMonths,
        creditBand: "good",
        month: "2026-10",
      })),
    );
  }
  view = {
    ...fit({
      need: "car",
      product: "auto",
      amountCents: 2_500_000,
      person: {
        creditScore: 720,
        incomeCents: 400_000,
        debtPaymentsCents: 30_000,
        cashCents: 500_000,
        debtTrouble: false,
      },
      offers,
    }),
    available: true,
    advice: true,
    checkedOn: "2026-10-18",
    baseline: null,
    debtKey: null,
  };
});

const history: ChatTurn[] = [
  { role: "user", content: "what's the best car loan for $25,000?" },
  { role: "assistant", content: "For a car loan of $25,000, here are your options." },
];

describe("following up on the best loan, with a faked Claude", () => {
  beforeEach(() => {
    create.mockReset();
    sent.length = 0;
    forgetPrimer();
    resetClaudeHealth();
    vi.mocked(loadSnapshot)
      .mockReset()
      .mockResolvedValue({
        timezone: "America/Los_Angeles",
        findings: [],
        plan: { items: 0, annualSavingsCents: 0, safeItems: 0 },
      } as unknown as Snapshot);
    vi.mocked(loadFit).mockReset().mockResolvedValue(view);
  });

  it("answers why that one from the reason and the differences the tool worked out", async () => {
    let answer = "";
    create
      .mockResolvedValueOnce(toolUse("loan_fit", { need: "car", amount_dollars: 25_000 }))
      .mockImplementationOnce(async (params) => {
        const out = toolResult(params);
        const other = out.whyThePick.versusTheOthers.find((o) => o.pickPaidInAll !== "the same")!;
        answer = `${out.whyThePick.reason} Against ${other.option} over ${other.months} months, it's ${other.pickPaidInAll} in all.`;
        return final(answer);
      });

    const result = await askClaudeInChat("u1", history, "why that one?", options);

    // The loan_fit tool was there to call on a follow-up with no loan words of its own.
    const tools = (create.mock.calls[0][0] as { tools: { name: string }[] }).tools;
    expect(tools.map((t) => t.name)).toContain("loan_fit");
    expect(loadFit).toHaveBeenCalledWith(
      "u1",
      { need: "car", amountCents: 2_500_000 },
      { client, now: NOW },
    );
    const out = toolResult(create.mock.calls[1][0]);
    expect(out.pick).toBe(view.pick);
    expect(out.whyThePick.pick).toBe(view.options.find((o) => o.id === view.pick)!.lender);
    expect(out.whyThePick.versusTheOthers).toHaveLength(view.options.length - 1);
    expect(answer).toMatch(/\$[\d,]+\.\d\d (?:more|less) in all\.$/);
    // Every figure was the tool's, so the answer stands as written.
    expect(result.kind).toBe("answer");
    expect(result.reply.body).toContain(answer);
    expect(create).toHaveBeenCalledTimes(2);
  });

  it("answers a shorter term from the same lender's numbers, the differences worked out", async () => {
    let answer = "";
    create
      .mockResolvedValueOnce(toolUse("loan_fit", { need: "car", amount_dollars: 25_000 }))
      .mockImplementationOnce(async (params) => {
        const out = toolResult(params);
        const t = out.otherTerms.terms.find((x) => x.months === out.otherTerms.shorterMonths)!;
        answer = `With ${out.otherTerms.lender} over ${t.months} months it's ${t.monthlyPayment} a month: ${t.monthlyPaymentVersusBest}, with ${t.interestVersusBest}.`;
        return final(answer);
      });

    const result = await askClaudeInChat(
      "u1",
      [
        ...history,
        { role: "user", content: "why that one?" },
        { role: "assistant", content: "It costs the least in all at a payment that fits." },
      ],
      "what about a shorter term?",
      options,
    );

    const out = toolResult(create.mock.calls[1][0]);
    const best = view.options.find((o) => o.label === "best_cost")!;
    expect(out.otherTerms.lender).toBe(best.lender);
    expect(out.otherTerms.shorterMonths).toBeLessThan(best.termMonths);
    // A shorter term costs more a month and less interest, as the tool says.
    expect(answer).toMatch(/: \$[\d,]+\.\d\d more a month, with \$[\d,]+\.\d\d less interest\.$/);
    expect(result.kind).toBe("answer");
    expect(result.reply.body).toContain(answer);
    expect(create).toHaveBeenCalledTimes(2);
  });

  it("would not let a difference Claude worked out itself through", async () => {
    create
      .mockResolvedValueOnce(toolUse("loan_fit", { need: "car", amount_dollars: 25_000 }))
      .mockResolvedValueOnce(final("A shorter term would save you $1,234.57 in interest."))
      .mockResolvedValue(final("A shorter term costs more a month and less interest."));

    const result = await askClaudeInChat("u1", history, "what about a shorter term?", options);

    expect(result.reply.body).not.toContain("$1,234.57");
  });

  it("puts the options on the answer as the pick card, with its two buttons", async () => {
    create
      .mockResolvedValueOnce(toolUse("loan_fit", { need: "car", amount_dollars: 25_000 }))
      .mockResolvedValueOnce(final("Here are your best car loans for $25,000."));

    const result = await askClaudeInChat("u1", [], "best car loan for $25,000?", options);

    expect(result.kind).toBe("answer");
    const card = result.reply.refs.options!;
    expect(card.kind).toBe("loan");
    expect(card.topic).toBe("car:2500000");
    expect(card.options[0].id).toBe(view.pick);
    expect(result.reply.refs.advice).toBe(true);
    expect(result.reply.actions.map((a) => a.id)).toEqual(["option.pick", "option.later"]);
    // Claude is told the options are on a card, so it names the pick, not the whole list.
    expect(toolResult(create.mock.calls[1][0])).toMatchObject({ shownAsACard: true });
  });

  it("shows no pick card without demo advice", async () => {
    vi.mocked(adviceMode).mockResolvedValue(false);
    try {
      create
        .mockResolvedValueOnce(toolUse("loan_fit", { need: "car", amount_dollars: 25_000 }))
        .mockResolvedValueOnce(final("There are a few car loans you could look at."));
      const result = await askClaudeInChat("u1", [], "car loans for $25,000?", options);
      expect(result.reply.refs.options).toBeUndefined();
      expect(result.reply.actions).toEqual([]);
    } finally {
      vi.mocked(adviceMode).mockResolvedValue(true);
    }
  });

  // Gap audit: with no amount it used to answer "Nothing fits right now", which isn't true.
  it("asks for the amount when a car, home or personal loan has none, and prices nothing", async () => {
    create
      .mockResolvedValueOnce(toolUse("loan_fit", { need: "car" }))
      .mockResolvedValueOnce(final("How much is the car you have in mind?"));
    await askClaudeInChat("u1", [], "what's the best car loan for me?", options);
    const out = JSON.parse(
      (create.mock.calls[1][0].messages.at(-1)!.content as { content: string }[])[0].content,
    ) as { needsAmount?: boolean; note?: string };
    expect(out.needsAmount).toBe(true);
    expect(out.note).toMatch(/ask how much .* or the car's price/);
    expect(loadFit).not.toHaveBeenCalled();
  });
});
