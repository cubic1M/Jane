import { isValidElement, type ReactElement, type ReactNode } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";

// The session lookup calls connection(). On a page that already called after(), a second
// lookup that runs once the browser has gone throws ("used connection() inside after()"),
// so the header must use the person the page looked up and never read the session itself.
vi.mock("@/lib/session", () => {
  const readsSession = vi.fn(async () => {
    throw new Error("the header read the session");
  });
  return { getCurrentUser: readsSession, getSessionState: readsSession, requireUser: readsSession };
});
vi.mock("@/lib/plaid/demo", () => ({ hasDemoBank: vi.fn(async () => false) }));
// The profile menu's sign-out action loads Auth.js, which needs a Next.js server.
vi.mock("@/lib/auth-actions", () => ({ signOutToHome: vi.fn() }));

import { getCurrentUser, getSessionState, requireUser } from "@/lib/session";
import { hasDemoBank } from "@/lib/plaid/demo";
import { AppHeader } from "./app-header";
import { DemoBanner } from "./demo-banner";

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

describe("DemoBanner", () => {
  beforeEach(() => {
    vi.mocked(hasDemoBank).mockReset();
  });

  it("checks the person it is given for a demo bank, without reading the session", async () => {
    vi.mocked(hasDemoBank).mockResolvedValue(true);

    const banner = await DemoBanner({ userId: "user_1" });

    expect(hasDemoBank).toHaveBeenCalledWith("user_1");
    expect(banner).not.toBeNull();
    expect(getCurrentUser).not.toHaveBeenCalled();
    expect(getSessionState).not.toHaveBeenCalled();
    expect(requireUser).not.toHaveBeenCalled();
  });

  it("shows nothing without a demo bank", async () => {
    vi.mocked(hasDemoBank).mockResolvedValue(false);

    expect(await DemoBanner({ userId: "user_1" })).toBeNull();
  });
});

describe("AppHeader", () => {
  it("hands the page's signed-in person to the demo-bank banner", () => {
    const header = AppHeader({ user: { id: "user_1", email: "a@example.com" } });

    const banner = findElement(header, DemoBanner);
    expect(banner?.props).toEqual({ userId: "user_1" });
  });
});
