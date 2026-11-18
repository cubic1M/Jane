import { type ReactElement, type ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

// Debugger 11-18 (r345, an uploaded U.S. Bank checking account, on a phone): Home said "Needs you:
// 2 new alerts", and the link opened Jane's list at its top ("What matters now"), the alerts last
// on the page under its other lists. It opens the alerts.

const { none } = vi.hoisted(() => ({ none: () => null }));
vi.mock("next/server", () => ({ connection: async () => undefined }));
vi.mock("next/navigation", () => ({ redirect: vi.fn(), useRouter: vi.fn() }));
vi.mock("@/lib/session", () => ({
  requireUser: async () => ({ id: "u1", email: "a@example.com" }),
}));
vi.mock("@/lib/hub/load", () => ({
  loadHubAreas: vi.fn(),
  loadHubTop: async () => ({
    hero: { asOf: "2026-11-18", netWorth: { known: false } },
    home: { plan: { items: [] }, waitingOnYou: [], unreadAlerts: 2, lastUpdated: null },
    cashFlow: { asOf: "2026-11-18" },
  }),
}));
vi.mock("@/lib/hub/view", () => ({
  heroView: () => ({}),
  cashFlowView: () => ({}),
  tilesView: () => [],
}));
vi.mock("@/lib/checklist", () => ({ firstWeekChecklist: async () => null }));
vi.mock("@/lib/autopilot", () => ({ autopilotOf: async () => "suggest" }));
vi.mock("@/lib/books", () => ({ openBooks: async () => null }));
vi.mock("@/lib/jane-agent/popup-stack", () => ({ loadPopupStack: async () => [] }));
vi.mock("@/lib/plaid/bank-status", () => ({
  loadBankNotices: async () => [],
  updatedAgo: () => "",
}));
vi.mock("@/lib/concierge-mode", () => ({ conciergeMode: async () => false }));
vi.mock("@/lib/advice-mode", () => ({ adviceMode: async () => false }));
vi.mock("@/lib/hub/area-trees", () => ({ loadAreaTrees: async () => ({}) }));
vi.mock("@/detection/engine", () => ({ isFirstDetectionComplete: async () => true }));
vi.mock("@/lib/db-scoped", () => ({
  scopedFor: () => ({
    transactions: { aggregate: async () => ({ _max: { date: null } }) },
    suggestions: { findMany: async () => [] },
  }),
}));
vi.mock("@/components/app-header", () => ({ AppHeader: none }));
vi.mock("@/components/bank-status-notice", () => ({ BankStatusNotice: none }));
vi.mock("@/components/books-notice", () => ({ BooksNotice: none }));
vi.mock("@/components/hub/hub", () => ({ HeroRow: none }));
vi.mock("@/components/hub/cash-flow", () => ({ CashFlowStrip: none }));
vi.mock("@/components/loading-bar", () => ({ LoadingBar: none }));
vi.mock("@/components/autopilot-chooser", () => ({ AutopilotChooser: none }));
vi.mock("../chat/suggestion-cards", () => ({ SuggestionCards: none }));
vi.mock("./checklist", () => ({ FirstWeekChecklist: none }));

import HomePage from "./page";

async function render(): Promise<string> {
  const main = HomePage({ searchParams: Promise.resolve({}) } as Parameters<
    typeof HomePage
  >[0]) as ReactElement<{ children: ReactNode }>;
  const suspense = main.props.children as ReactElement<{ children: ReactNode }>;
  const content = suspense.props.children as ReactElement<Record<string, unknown>>;
  const body = await (content.type as (p: unknown) => Promise<ReactElement>)(content.props);
  return renderToStaticMarkup(body);
}

describe("Home's new alerts", () => {
  it("open the alerts, not the top of Jane's list", async () => {
    const html = await render();
    const link = /<a [^>]*href="([^"]*)"[^>]*>2 new alerts<\/a>/.exec(html);
    expect(link?.[1]).toBe("/jane#alerts");
  });
});
