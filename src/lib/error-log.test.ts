import { describe, expect, it, vi } from "vitest";
import type { PrismaClient } from "@/generated/prisma/client";
import { describeError, recordError } from "./error-log";

describe("recordError", () => {
  it("stores a scrubbed error without the query string", async () => {
    const logged = vi.spyOn(console, "error").mockImplementation(() => {});
    const create = vi.fn();
    const client = { errorEvent: { create } } as unknown as PrismaClient;
    const error = Object.assign(new Error("No user a@example.com with access-sandbox-xyz"), {
      digest: "123",
    });

    await recordError(
      error,
      { path: "/api/x?email=a@example.com", method: "POST", routeType: "route" },
      client,
    );

    const data = create.mock.calls[0][0].data;
    expect(data).toMatchObject({
      message: "Error: No user [email] with [plaid-token]",
      path: "/api/x",
      method: "POST",
      routeType: "route",
      digest: "123",
    });
    expect(JSON.stringify(data)).not.toMatch(/a@example\.com|access-sandbox/);
    expect(JSON.stringify(logged.mock.calls)).not.toContain("a@example.com");
  });

  it("never throws, even if storing fails", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    const client = {
      errorEvent: { create: vi.fn().mockRejectedValue(new Error("db down")) },
    } as unknown as PrismaClient;

    await expect(recordError(new Error("x"), {}, client)).resolves.toBeUndefined();
  });

  it("handles thrown values that aren't errors", () => {
    expect(describeError("plain string").message).toBe("Error: plain string");
  });
});

describe("what an error may keep", () => {
  it("drops what it quotes and keeps only code locations from the stack, as the logs do", () => {
    const error = new Error('Invalid value for description: "ZELLE TO MORGAN REYES" given');
    error.stack = `Error: Invalid value for description: "ZELLE TO MORGAN REYES" given\n    at save (/app/src/lib/x.ts:1:2)`;
    const { message, stack } = describeError(error);
    expect(message).not.toContain("MORGAN");
    expect(message).toContain("Invalid value");
    expect(stack).not.toContain("MORGAN");
    expect(stack).toContain("save");
  });
});
