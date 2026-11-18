import { isValidElement, type ReactElement, type ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

// Debugger 11-18 (r341, Plaid S6 on a phone): a Yes on the card-interest card in the dock opened
// its page with "‹ Back to the chat" and "‹ Back to your report" one above the other. The page
// has one way back, to where the person came from: the chat when its address names one of Jane's
// messages (?from=…), the report otherwise.

const where = vi.hoisted(() => ({ from: null as string | null }));
vi.mock("next/navigation", () => ({
  notFound: () => {
    throw new Error("not found");
  },
  usePathname: () => "/report/f1",
  useSearchParams: () => new URLSearchParams(where.from ? { from: where.from } : {}),
  useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }),
}));
vi.mock("@/lib/session", () => ({
  requireUser: async () => ({ id: "u1", email: "a@example.com", timezone: "America/Chicago" }),
}));
const finding = {
  id: "f1",
  type: "card_interest",
  title: "$371.00 in interest on Plaid credit card in the last 12 months",
  annualSavingsCents: 37_100,
  evidence: { charges: [] },
  explanation: null,
  explanationHash: null,
  status: "shown",
  confidence: "high",
};
vi.mock("@/lib/db-scoped", () => ({
  scopedDb: async () => ({
    findings: {
      findFirst: async () => finding,
      updateMany: async () => ({ count: 0 }),
      count: async () => 1,
    },
    decisions: { findFirst: async () => null },
  }),
}));
vi.mock("@/lib/referrals", () => ({ partnerForUser: async () => null }));
vi.mock("@/lib/concierge-mode", () => ({ conciergeMode: async () => false }));
vi.mock("@/lib/compare", () => ({ comparisonFor: async () => null }));
vi.mock("@/lib/merchants", () => ({
  companyFacts: async () => ({ merchant: null, outcome: null }),
  cancelsFromOwnAccountOnly: () => false,
}));
vi.mock("@/lib/finding-sures", () => ({
  findingSureFacts: async () => ({ sures: {}, months: 12 }),
}));
vi.mock("@/lib/report-state", () => ({
  findingSure: () => ({ percent: 95, reason: "11 interest charges in 12 months of data" }),
}));
// Jane wrote about this finding: the card in the dock is one of its messages.
vi.mock("@/lib/jane-agent/messages", () => ({
  CHOICE_WORDS: {},
  messageAboutFinding: async () => "msg123",
}));
vi.mock("@/components/view-tracker", () => ({ ViewTracker: () => null }));
vi.mock("./decision-buttons", () => ({ DecisionButtons: () => null }));
vi.mock("./diy-kit", () => ({ DiyKit: () => null }));
vi.mock("./best-option", () => ({ BestOption: () => null }));
// The header's own way back, as the real one draws it.
vi.mock("@/components/app-header", async () => {
  const { BackToChat } = await import("@/components/back-to-chat");
  return {
    AppHeader: ({ chatMessageId }: { chatMessageId?: string | null }) => (
      <BackToChat messageId={chatMessageId} />
    ),
    PageLoading: () => null,
  };
});

import CardPage from "./page";

// The page's Suspense child, rendered as the server would.
async function render(from: string | null): Promise<string> {
  where.from = from;
  const props = {
    params: Promise.resolve({ findingId: "f1" }),
    searchParams: Promise.resolve(from ? { from } : {}),
  } as Parameters<typeof CardPage>[0];
  const main = CardPage(props) as ReactElement<{ children: ReactNode }>;
  const suspense = main.props.children as ReactElement<{ children: ReactNode }>;
  const card = suspense.props.children as ReactElement<Record<string, unknown>>;
  if (!isValidElement(card) || typeof card.type !== "function") throw new Error("no card");
  const body = await (card.type as (p: unknown) => Promise<ReactElement>)(card.props);
  return renderToStaticMarkup(body);
}
const waysBack = (html: string) =>
  [...html.matchAll(/‹ Back to (the chat|your report)/g)].map((m) => m[1]);

describe("a finding's page", () => {
  it("opened from Jane's message goes back to the chat only", async () => {
    expect(waysBack(await render("msg123"))).toEqual(["the chat"]);
  });

  it("opened from the report goes back to the report only", async () => {
    expect(waysBack(await render(null))).toEqual(["your report"]);
  });
});
