import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/session", () => ({ getCurrentUser: vi.fn() }));
vi.mock("@/lib/connectors/connect", async (original) => ({
  ...(await original<typeof import("@/lib/connectors/connect")>()),
  finishConnect: vi.fn(),
}));

import { finishConnect } from "@/lib/connectors/connect";
import { getCurrentUser } from "@/lib/session";
import { GET } from "./route";

// The way back from a partner's step (src/lib/connectors/connect.ts).

const back = (from: string) =>
  GET(
    new Request(
      `https://jane.example/settings/connections/fake/return?from=${encodeURIComponent(from)}`,
    ),
    { params: Promise.resolve({ connectorId: "fake" }) },
  );

describe("GET /settings/connections/[connectorId]/return", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.mocked(finishConnect).mockReset();
  });

  it("is a 404 unless connectors are on", async () => {
    vi.stubEnv("CONNECTORS", "");
    expect((await back("/home")).status).toBe(404);
    expect(finishConnect).not.toHaveBeenCalled();
  });

  it("sends someone signed out to sign in, reading nothing", async () => {
    vi.stubEnv("CONNECTORS", "1");
    vi.mocked(getCurrentUser).mockResolvedValue(null as never);
    const response = await back("/home");
    expect(new URL(response.headers.get("location")!).pathname).toBe("/login");
    expect(finishConnect).not.toHaveBeenCalled();
  });

  it("reads for the signed-in person and goes back to the card, never to another site", async () => {
    vi.stubEnv("CONNECTORS", "1");
    vi.mocked(getCurrentUser).mockResolvedValue({ id: "user_1" } as never);
    vi.mocked(finishConnect).mockResolvedValue({ saved: 1, note: "1 read." });
    const done = new URL((await back("/investments")).headers.get("location")!);
    expect(finishConnect).toHaveBeenCalledWith("user_1", "fake");
    expect(done.origin + done.pathname).toBe("https://jane.example/investments");
    expect(done.searchParams.get("connected")).toBe("fake");
    const away = new URL((await back("https://evil.example")).headers.get("location")!);
    expect(away.origin + away.pathname).toBe("https://jane.example/home");
  });
});
