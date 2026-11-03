import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/db-scoped", () => ({ scopedFor: vi.fn((id: string) => ({ userId: id })) }));
vi.mock("@/lib/import/remove", () => ({ listUploads: vi.fn() }));
// The profile menu's sign-out action and the banner's Start over load a server.
vi.mock("@/lib/auth-actions", () => ({ signOutToHome: vi.fn() }));
vi.mock("@/app/try/statement-actions", () => ({ startOverTry: vi.fn() }));
vi.mock("@/lib/session", () => ({
  getCurrentUser: vi.fn(),
  getSessionState: vi.fn(),
  requireUser: vi.fn(),
}));

import { isValidElement, type ReactElement, type ReactNode } from "react";
import { listUploads } from "@/lib/import/remove";
import { AppHeader } from "./app-header";
import { TryWarnings } from "./try-warnings";

// A figure that might be wrong never shows without its warning, for someone who uploaded from the
// landing page and so never passed /import.

const NOT_ADDING_UP = "The balances in this file don't add up between Oct 2 and Oct 3.";
const uploaded = (...warnings: string[][]) =>
  vi.mocked(listUploads).mockResolvedValue({
    earlier: [],
    uploads: warnings.map((w) => ({ warnings: w })),
  } as never);

function findElement(node: ReactNode, type: unknown): ReactElement | null {
  if (Array.isArray(node)) {
    for (const child of node) {
      const found = findElement(child, type);
      if (found) return found;
    }
    return null;
  }
  if (!isValidElement(node)) return null;
  if (node.type === type) return node;
  return findElement((node.props as { children?: ReactNode }).children, type);
}

describe("TryWarnings", () => {
  beforeEach(() => vi.mocked(listUploads).mockReset());

  it("shows what didn't add up, in the words the check wrote, for this person", async () => {
    uploaded([NOT_ADDING_UP]);
    const html = renderToStaticMarkup(await TryWarnings({ userId: "trial_own_abc" }));
    expect(html).toContain("The balances in this file don&#x27;t add up between Oct 2 and Oct 3.");
    expect(html).toContain("data-control-warning");
    expect(html).toContain('role="alert"');
    expect(listUploads).toHaveBeenCalledWith({ userId: "trial_own_abc" });
  });

  it("says each one once, across uploads", async () => {
    uploaded([NOT_ADDING_UP], [NOT_ADDING_UP, "Another."], []);
    const html = renderToStaticMarkup(await TryWarnings({ userId: "trial_own_abc" }));
    expect(html.split("data-control-warning")).toHaveLength(3);
  });

  it("shows nothing for a statement that adds up", async () => {
    uploaded([], []);
    expect(await TryWarnings({ userId: "trial_own_abc" })).toBeNull();
  });
});

describe("the top of the app", () => {
  it("carries the warnings for a temporary try, outside any boundary of their own", () => {
    const header = AppHeader({ user: { id: "trial_own_abc" } });
    expect(findElement(header, TryWarnings)?.props).toEqual({ userId: "trial_own_abc" });
  });

  it("leaves everyone else to /import", () => {
    expect(findElement(AppHeader({ user: { id: "cm1real" } }), TryWarnings)).toBeNull();
    expect(findElement(AppHeader({ user: { id: "trial_sample" } }), TryWarnings)).toBeNull();
  });
});
