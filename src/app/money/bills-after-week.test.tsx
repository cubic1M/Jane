import { type ReactElement, type ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

// Debug 2, tenth desktop sweep (11-20, Plaid sandbox, 14 months of checking + card): Spending &
// bills said "After this week: 6 regular charges … about $1,348.88 in all", and the list under it
// had eight, this week's Netflix (Nov 21) and Planet Fitness (Nov 25) first, though "Bills this
// week" had them already. Each list holds what its line counts.

const details = vi.hoisted(() => ({ value: {} as Record<string, ReactNode> }));
vi.mock("@/lib/session", () => ({
  requireUser: async () => ({ id: "u1", email: "a@example.com" }),
}));
vi.mock("next/server", () => ({ connection: async () => undefined }));
vi.mock("@/components/app-header", () => ({ AppHeader: () => null }));
vi.mock("@/components/page-shell", () => ({
  PageShell: ({ children }: { children: ReactNode }) => children,
}));
vi.mock("@/components/area-page/area-page", () => ({
  AreaPage: (props: { details: Record<string, ReactNode> }) => {
    details.value = props.details;
    return null;
  },
}));
const bill = (date: string, merchant: string, amountCents: number) => ({
  date,
  merchant,
  amountCents,
});
vi.mock("@/lib/area-pages/money-load", () => ({
  loadMoneyArea: async () => ({
    suggestions: [],
    actions: {},
    lows: [],
    weekEnds: "2026-11-27",
    bills: [
      bill("2026-11-21", "Netflix", 1_549),
      bill("2026-11-25", "Planet Fitness", 3_800),
      bill("2026-12-01", "Apts", 95_000),
      bill("2026-12-07", "Spotify", 599),
    ],
    recurring: [],
    budgets: { progress: [] },
    yearly: [],
    spending: null,
    topMerchants: [],
    books: [],
    fixes: {},
    transfers: [],
    missing: [],
    have: { owned: 0 },
    assetPromptHref: null,
    hasAccounts: true,
  }),
}));
vi.mock("@/lib/area-pages/money", async (actual) => ({
  ...(await actual<typeof import("@/lib/area-pages/money")>()),
  moneyTree: () => ({ tree: { key: "money", label: "", branches: [] }, chips: [], summaries: {} }),
}));

import MoneyPage from "./page";

async function render(): Promise<void> {
  const shell = MoneyPage({
    searchParams: Promise.resolve({}),
  } as Parameters<typeof MoneyPage>[0]) as ReactElement<{ children: ReactNode }>;
  const content = shell.props.children as ReactElement<Record<string, unknown>>;
  const body = await (content.type as (p: unknown) => Promise<ReactElement>)(content.props);
  renderToStaticMarkup(body);
}
const list = (id: string) => renderToStaticMarkup(<>{details.value[id]}</>);

describe("the bills after this week", () => {
  it("lists only the bills after this week, as its line counts them", async () => {
    await render();
    const later = list("coming:month");
    expect(later).toContain("Apts");
    expect(later).toContain("Spotify");
    expect(later).not.toContain("Netflix");
    expect(later).not.toContain("Planet Fitness");
  });

  it("leaves this week's bills under this week", async () => {
    await render();
    const week = list("coming:week");
    expect(week).toContain("Netflix");
    expect(week).toContain("Planet Fitness");
    expect(week).not.toContain("Apts");
  });
});
