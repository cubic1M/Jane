import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("next/navigation", () => ({
  notFound: vi.fn(() => {
    throw new Error("NOT_FOUND");
  }),
  redirect: vi.fn((to: string) => {
    throw new Error(`REDIRECT:${to}`);
  }),
}));
vi.mock("@/lib/session", () => ({ requireUser: vi.fn(async () => ({ id: "user_1" })) }));
vi.mock("@/lib/connectors/connect", async (original) => ({
  ...(await original<typeof import("@/lib/connectors/connect")>()),
  startConnect: vi.fn(),
  declineConnect: vi.fn(),
}));

import { declineConnect, startConnect } from "@/lib/connectors/connect";
import { ConsentError } from "@/lib/connectors/consent";
import { connectNow, notNow } from "./actions";

// The consent screen's Allow and Not now (src/lib/connectors/connect.ts).

const form = (fields: Record<string, string>) => {
  const data = new FormData();
  for (const [k, v] of Object.entries(fields)) data.append(k, v);
  return data;
};

describe("the consent screen's answers", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.mocked(startConnect).mockReset();
    vi.mocked(declineConnect).mockReset();
  });

  it("does nothing unless connectors are on", async () => {
    vi.stubEnv("CONNECTORS", "");
    await expect(connectNow(form({ connectorId: "fake", from: "/home" }))).rejects.toThrow(
      "NOT_FOUND",
    );
    await expect(notNow(form({ connectorId: "fake", from: "/home" }))).rejects.toThrow("NOT_FOUND");
    expect(startConnect).not.toHaveBeenCalled();
  });

  it("goes to the partner's page, or back to the card with the connector connected", async () => {
    vi.stubEnv("CONNECTORS", "1");
    vi.mocked(startConnect).mockResolvedValueOnce({
      next: "partner",
      redirectUrl: "https://partner.example/x",
    });
    await expect(connectNow(form({ connectorId: "fake", from: "/investments" }))).rejects.toThrow(
      "REDIRECT:https://partner.example/x",
    );
    expect(startConnect).toHaveBeenCalledWith("user_1", "fake", {
      returnUrl: "/settings/connections/fake/return?from=%2Finvestments",
    });
    vi.mocked(startConnect).mockResolvedValueOnce({ next: "done", read: null });
    await expect(connectNow(form({ connectorId: "fake", from: "/investments" }))).rejects.toThrow(
      "REDIRECT:/investments?connected=fake",
    );
  });

  it("stays on the consent screen when the connector isn't for this person", async () => {
    vi.stubEnv("CONNECTORS", "1");
    vi.mocked(startConnect).mockRejectedValueOnce(new ConsentError("switched_off"));
    await expect(
      connectNow(form({ connectorId: "fake", from: "https://evil.example" })),
    ).rejects.toThrow("REDIRECT:/settings/connections/fake?from=%2Fhome");
  });

  it("records a Not now and goes back", async () => {
    vi.stubEnv("CONNECTORS", "1");
    await expect(notNow(form({ connectorId: "fake", from: "/insurance" }))).rejects.toThrow(
      "REDIRECT:/insurance",
    );
    expect(declineConnect).toHaveBeenCalledWith("user_1", "fake");
  });
});
