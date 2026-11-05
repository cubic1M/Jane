import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("next/server", async (original) => ({
  ...(await original<typeof import("next/server")>()),
  after: vi.fn((work: () => unknown) => work()),
}));
vi.mock("@/lib/session", () => ({ getCurrentUser: vi.fn() }));
vi.mock("@/lib/page-opened", () => ({ pageOpened: vi.fn(async () => undefined) }));

import { pageOpened } from "@/lib/page-opened";
import { getCurrentUser } from "@/lib/session";
import { POST } from "./route";

const post = (body: unknown) =>
  POST(
    new NextRequest("http://localhost/api/opened", {
      method: "POST",
      body: typeof body === "string" ? body : JSON.stringify(body),
      headers: { "content-type": "application/json" },
    }),
  );

describe("POST /api/opened", () => {
  beforeEach(() => {
    vi.mocked(pageOpened).mockReset().mockResolvedValue(undefined);
    vi.mocked(getCurrentUser)
      .mockReset()
      .mockResolvedValue({ id: "user_1" } as never);
  });

  it("does nothing for someone not signed in", async () => {
    vi.mocked(getCurrentUser).mockResolvedValue(null);
    expect((await post({ page: "home" })).status).toBe(401);
    expect(pageOpened).not.toHaveBeenCalled();
  });

  it("runs the page's work as the person signed in", async () => {
    expect((await post({ page: "home" })).status).toBe(204);
    expect(pageOpened).toHaveBeenCalledWith("user_1", "home", []);
  });

  it("passes the plan's cards on", async () => {
    await post({ page: "plan", findingIds: ["abc", "def"] });
    expect(pageOpened).toHaveBeenCalledWith("user_1", "plan", ["abc", "def"]);
  });

  it("refuses a page it doesn't know, broken JSON and bad ids", async () => {
    expect((await post({ page: "admin" })).status).toBe(400);
    expect((await post("{not json")).status).toBe(400);
    expect((await post({ page: "plan", findingIds: "abc" })).status).toBe(400);
    expect((await post({ page: "plan", findingIds: ["a b"] })).status).toBe(400);
    expect((await post({ page: "plan", findingIds: Array(501).fill("a") })).status).toBe(400);
    expect(pageOpened).not.toHaveBeenCalled();
  });

  it("answers even when the work fails", async () => {
    vi.mocked(pageOpened).mockRejectedValue(new Error("no"));
    expect((await post({ page: "investments" })).status).toBe(204);
  });
});
