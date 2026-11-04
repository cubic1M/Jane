import { beforeEach, describe, expect, it, vi } from "vitest";

const db = vi.hoisted(() => ({
  requireUser: vi.fn(async () => ({ id: "me", role: "user" })),
  dismissImportRun: vi.fn(),
  skipSignal: vi.fn(async () => ({ ok: true })),
  takeSignal: vi.fn(async () => ({ ok: true, tradeId: "t" })),
  revertTrade: vi.fn(async () => ({ ok: true })),
  markEventSeen: vi.fn(async () => ({ ok: true })),
  revertEventAction: vi.fn(async () => ({ ok: true })),
  findFirst: vi.fn(async () => null),
}));

vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("next/server", () => ({ after: vi.fn() }));
vi.mock("@/lib/session", () => ({ requireUser: db.requireUser }));
vi.mock("@/lib/import/background", async (original) => ({
  ...(await original<object>()),
  dismissImportRun: db.dismissImportRun,
}));
vi.mock("@/lib/paper/account", async (original) => ({
  ...(await original<object>()),
  skipSignal: db.skipSignal,
  takeSignal: db.takeSignal,
  revertTrade: db.revertTrade,
}));
vi.mock("@/lib/db-scoped", async (original) => ({
  ...(await original<object>()),
  scopedFor: () => ({ janeMessages: { findFirst: db.findFirst } }),
}));

import { noteDetailsOpened } from "@/app/chat/actions";
import { dismissImport } from "@/app/import/actions";
import {
  paperRevertAction,
  paperSkipAction,
  paperTakeAction,
} from "@/app/investments/paper-actions";
import { isId } from "./action-args";

// TypeScript doesn't run in a server action: the browser can send anything.
const HOSTILE = [{ not: "" }, { 'role "jane_rls"': 1 }, undefined, null, 7, ["x"], ""] as never[];

describe("ids from the browser", () => {
  beforeEach(() => vi.clearAllMocks());

  it("takes only a string of a sensible length", () => {
    expect(isId("cmw1vr8r80000mubqi3s78uwe")).toBe(true);
    for (const value of HOSTILE) expect(isId(value)).toBe(false);
    expect(isId("x".repeat(201))).toBe(false);
  });

  it.each(HOSTILE.map((value) => [JSON.stringify(value), value]))(
    "never passes %s on to a query",
    async (_name, value) => {
      await dismissImport(value as never);
      expect(db.dismissImportRun).not.toHaveBeenCalled();
      expect((await paperSkipAction(value as never)).ok).toBe(false);
      expect(db.skipSignal).not.toHaveBeenCalled();
      expect((await paperTakeAction(value as never)).ok).toBe(false);
      expect(db.takeSignal).not.toHaveBeenCalled();
      expect((await paperRevertAction(value as never)).ok).toBe(false);
      expect(db.revertTrade).not.toHaveBeenCalled();
      await noteDetailsOpened(value as never);
      expect(db.findFirst).not.toHaveBeenCalled();
    },
  );
});
