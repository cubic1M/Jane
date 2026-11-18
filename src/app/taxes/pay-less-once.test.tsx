import { type ReactElement, type ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

// Debugger 11-18 (r342, Plaid S5: one month of a new checking account, on a phone): Taxes listed
// "Pay less tax: 2 things to look at" (the Saver's Credit among them), and the fold below the
// tree said "Ways to pay less: Suggestions on paying less tax will come once Jane works with a tax
// professional." The fold is for when nothing is there; beside the tree's own, it contradicts it.

const branches = vi.hoisted(() => ({ ids: [] as string[] }));
vi.mock("@/lib/session", () => ({
  requireUser: async () => ({ id: "u1", email: "a@example.com" }),
}));
vi.mock("next/server", () => ({ connection: async () => undefined }));
vi.mock("@/lib/concierge-mode", () => ({ conciergeMode: async () => false }));
vi.mock("@/components/app-header", () => ({ AppHeader: () => null }));
vi.mock("@/components/view-tracker", () => ({ ViewTracker: () => null }));
vi.mock("@/components/area-page/area-page", () => ({ AreaPage: () => null }));
vi.mock("@/components/page-shell", () => ({
  PageShell: ({ children }: { children: ReactNode }) => children,
}));
vi.mock("@/lib/area-pages/taxes-load", () => ({
  loadTaxesArea: async () => ({
    today: "2026-11-18",
    year: 2026,
    view: { complete: false },
    taxes: { level: "suggest" },
    tags: [],
    forms: [],
    estimate: {},
    setAside: {},
    advice: false,
    refunds: [],
    investments: {},
    savings: { advice: false, savings: [], year: 2026 },
    sideIncome: {},
    records: {},
    home: {},
    family: {},
    giving: {},
    plan: { moves: [] },
    check: null,
    kids: { status: "none" },
    fields: [],
    newIncome: null,
    suggestions: [],
    area: {
      tree: { key: "taxes", label: "Taxes", branches: branches.ids.map((id) => ({ id })) },
      chips: [],
      summaries: {},
    },
  }),
}));

import TaxesPage from "./page";

async function render(ids: string[]): Promise<string> {
  branches.ids = ids;
  const shell = TaxesPage({
    searchParams: Promise.resolve({}),
  } as Parameters<typeof TaxesPage>[0]) as ReactElement<{ children: ReactNode }>;
  const content = shell.props.children as ReactElement<Record<string, unknown>>;
  const body = await (content.type as (p: unknown) => Promise<ReactElement>)(content.props);
  return renderToStaticMarkup(body);
}

describe("Taxes' ways to pay less", () => {
  it("doesn't say they will come when the tree already lists some", async () => {
    expect(await render(["soon", "savings", "estimate"])).not.toContain("will come once Jane");
  });

  it("still says so when there are none", async () => {
    expect(await render(["soon", "estimate"])).toContain("will come once Jane");
  });
});
