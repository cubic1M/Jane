import { beforeEach, describe, expect, it, vi } from "vitest";

const lifeEvents = vi.fn(async () => [{ id: "e1", kind: "moving" }]);
vi.mock("@/lib/account-copies", () => ({ onlyCountedRows: vi.fn(async () => ({})) }));
vi.mock("@/lib/db-scoped", () => ({
  scopedFor: () => ({
    lifeEvents: { findMany: lifeEvents },
    ownedAssets: { findMany: vi.fn(async () => []) },
    liabilities: { findMany: vi.fn(async () => []) },
  }),
}));

import { memoRead, forgetReads, withRequestMemo } from "@/lib/read-memo";
import { coverEvents } from "./cover-changes";

// Home's area trees each ask for the person's cover events with a clock of their own, a few
// milliseconds apart: inside one request or render they are one question, and a write forgets it.

describe("cover events asked more than once in a request", () => {
  beforeEach(() => lifeEvents.mockClear());

  it("are read once", async () => {
    await withRequestMemo(async () => {
      const [a, b] = await Promise.all([coverEvents("u1"), coverEvents("u1")]);
      expect(a).toEqual(b);
      expect(a).toEqual([{ event: "moving", eventKey: "e1", detail: {} }]);
      await coverEvents("u1");
    });
    expect(lifeEvents).toHaveBeenCalledTimes(1);
  });

  it("are one answer per person", async () => {
    await withRequestMemo(async () => {
      await coverEvents("u1");
      await coverEvents("u2");
    });
    expect(lifeEvents).toHaveBeenCalledTimes(2);
  });

  it("are read again after a write", async () => {
    await withRequestMemo(async () => {
      await coverEvents("u1");
      forgetReads();
      await coverEvents("u1");
    });
    expect(lifeEvents).toHaveBeenCalledTimes(2);
  });

  it("are asked afresh outside a request, and by a caller that names its day", async () => {
    await coverEvents("u1");
    await coverEvents("u1");
    expect(lifeEvents).toHaveBeenCalledTimes(2);
    lifeEvents.mockClear();
    await withRequestMemo(async () => {
      await coverEvents("u1", { now: new Date("2026-05-01T00:00:00Z") });
      await coverEvents("u1", { now: new Date("2026-06-01T00:00:00Z") });
    });
    expect(lifeEvents).toHaveBeenCalledTimes(2);
  });

  it("does not take another read's key", async () => {
    await withRequestMemo(async () => {
      await memoRead("u1|other", async () => "x");
      await coverEvents("u1");
    });
    expect(lifeEvents).toHaveBeenCalledTimes(1);
  });
});
