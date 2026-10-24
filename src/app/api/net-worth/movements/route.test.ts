import { beforeEach, describe, expect, it, vi } from "vitest";

const { netWorthMovements } = vi.hoisted(() => ({ netWorthMovements: vi.fn() }));
vi.mock("@/lib/session", () => ({ getCurrentUser: vi.fn() }));
vi.mock("@/lib/hub/net-worth-events", () => ({ netWorthMovements }));

import { decodeMovements } from "@/insights/net-worth-movements";
import { getCurrentUser } from "@/lib/session";
import { GET } from "./route";

const get = (query: string) => GET(new Request(`http://localhost/api/net-worth/movements${query}`));

describe("GET /api/net-worth/movements", () => {
  beforeEach(() => {
    vi.mocked(getCurrentUser).mockReset();
    netWorthMovements.mockReset();
  });

  it("refuses visitors who aren't signed in", async () => {
    vi.mocked(getCurrentUser).mockResolvedValue(null);
    expect((await get("?from=2026-01-01")).status).toBe(401);
    expect(netWorthMovements).not.toHaveBeenCalled();
  });

  it("needs a day to start from", async () => {
    vi.mocked(getCurrentUser).mockResolvedValue({ id: "user_1" } as never);
    expect((await get("")).status).toBe(400);
    expect((await get("?from=last-week")).status).toBe(400);
    expect(netWorthMovements).not.toHaveBeenCalled();
  });

  it("sends the signed-in person's own movements, compactly, never cached", async () => {
    vi.mocked(getCurrentUser).mockResolvedValue({ id: "user_1" } as never);
    const events = [
      {
        date: "2026-01-02",
        kind: "pay" as const,
        label: "Payday: Acme",
        cents: 300_000,
        href: "/transactions?q=Acme",
        name: "Acme",
        account: "Checking ····0000",
      },
      {
        date: "2026-01-05",
        kind: "transfer" as const,
        label: "Moved out: Savings",
        cents: 0,
        moved: 50_000,
        href: "/transactions?q=Savings",
        name: "Savings",
        account: "Checking ····0000",
      },
    ];
    netWorthMovements.mockResolvedValue(events);
    const response = await get("?from=2026-01-01");
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(netWorthMovements).toHaveBeenCalledWith("user_1", "2026-01-01");
    expect(decodeMovements(await response.json())).toEqual(events);
  });
});
