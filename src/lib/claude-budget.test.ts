import { describe, expect, it, vi } from "vitest";
import type { PrismaClient } from "@/generated/prisma/client";
import { holdOn, meteredClaude } from "./claude-budget";

// CodeRabbit part 2: a hold taken on the month's total must go back when a later counter fails, and
// a streamed call (no usage to charge) never runs free of the cap.

const counter = (key: string) => ({
  key,
  windowStart: new Date("2031-03-01T00:00:00Z"),
  capCents: 800,
});

describe("holdOn", () => {
  it("gives back the holds already taken when a later counter throws", async () => {
    const released: string[] = [];
    let queries = 0;
    const client = {
      $queryRaw: vi.fn(async () => {
        queries += 1;
        if (queries === 2) throw new Error("connection reset");
        return [{ count: 1 }];
      }),
      $executeRaw: vi.fn(async (_strings: TemplateStringsArray, ...values: unknown[]) => {
        released.push(String(values[1]));
        return 1;
      }),
    } as unknown as PrismaClient;
    await expect(
      holdOn([counter("chatmonth:total"), counter("day:u1")], 500, client),
    ).rejects.toThrow("connection reset");
    expect(released).toEqual(["chatmonth:total"]);
  });
});

describe("meteredClaude", () => {
  it("refuses a streamed call instead of running it uncounted", async () => {
    const create = vi.fn();
    const metered = meteredClaude("u1", {
      client: {} as PrismaClient,
      claude: (() => ({ messages: { create } })) as never,
    })();
    await expect(
      metered.messages.create({ model: "m", max_tokens: 1, messages: [], stream: true }),
    ).rejects.toThrow("metered_stream_unsupported");
    expect(create).not.toHaveBeenCalled();
  });
});
