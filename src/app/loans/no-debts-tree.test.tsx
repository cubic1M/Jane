import { type ReactElement, type ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

// Debugger 11-19 (r356, Plaid S4 on a phone: one checking account, no card or loan): Home's Loans &
// credit tile said "No loans or cards linked · 1 to look at" (Jane's "No credit history may be
// building"), and /loans showed only "No loans, cards or plans yet." with no tree: what Home
// pointed to wasn't there. With nothing owed but something to look at, the tree shows.

const items = vi.hoisted(() => ({ status: "look" as "look" | "good" }));
vi.mock("@/lib/session", () => ({
  requireUser: async () => ({ id: "u1", email: "a@example.com" }),
}));
vi.mock("next/server", () => ({ connection: async () => undefined }));
vi.mock("@/lib/advice-mode", () => ({ adviceMode: async () => false }));
vi.mock("@/components/app-header", () => ({ AppHeader: () => null }));
vi.mock("@/components/view-tracker", () => ({ ViewTracker: () => null }));
vi.mock("@/components/area-page/area-page", () => ({
  AreaPage: () => <div data-testid="tree">the tree</div>,
}));
vi.mock("@/components/page-shell", () => ({
  PageShell: ({ children }: { children: ReactNode }) => children,
}));
vi.mock("@/lib/area-pages/loans-load", () => ({
  loadLoansArea: async () => ({
    book: { debts: [], totalOwedCents: 0, monthlyCents: 0 },
    bnpl: { installments: [] },
    prompts: [],
    mine: [],
    accounts: [],
    plans: [],
    refinanceOpen: false,
    area: {
      tree: {
        key: "loans",
        label: "Loans & credit",
        sub: "1 to look at",
        branches: [
          {
            id: "credit",
            label: "Your credit",
            status: items.status,
            items: [
              {
                id: "credit:credit_file_start",
                label: "No credit history building",
                status: items.status,
              },
            ],
          },
        ],
      },
      chips: [],
      summaries: {},
    },
  }),
}));

import LoansPage from "./page";

async function render(status: "look" | "good"): Promise<string> {
  items.status = status;
  const shell = LoansPage({
    searchParams: Promise.resolve({}),
  } as Parameters<typeof LoansPage>[0]) as ReactElement<{ children: ReactNode }>;
  const content = shell.props.children as ReactElement<Record<string, unknown>>;
  const body = await (content.type as (p: unknown) => Promise<ReactElement>)(content.props);
  return renderToStaticMarkup(body);
}

describe("Loans with nothing owed", () => {
  it("shows the tree when there's something to look at", async () => {
    const html = await render("look");
    expect(html).toContain("the tree");
    expect(html).toContain("add your accounts");
  });

  it("keeps just the way to add accounts when there's nothing", async () => {
    const html = await render("good");
    expect(html).not.toContain("the tree");
    expect(html).toContain("add your accounts");
  });
});
