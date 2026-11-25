import { describe, expect, it, vi } from "vitest";
import type { PrismaClient } from "@/generated/prisma/client";

vi.mock("@/lib/session", () => ({ requireUser: vi.fn() }));
vi.mock("./snapshot-store", () => ({
  loadSnapshotFast: vi.fn(async () => ({
    findings: [
      { findingId: "f1", title: "Netflix", annualSavingsCents: 20_000 },
      { findingId: "f2", title: "Hulu", annualSavingsCents: 10_000 },
    ],
  })),
}));

import { whichReply } from "./answer";

// CodeRabbit part 2: "Cancel it" with nothing to point back to asks which one; tapping Netflix
// carries on with the cancel instead of only describing Netflix.

const NOW = new Date("2026-10-18T15:00:00Z");
const client = {} as PrismaClient;

describe("whichReply", () => {
  it("keeps the typed verb on each choice", async () => {
    const reply = await whichReply(
      "u1",
      { kind: "act", verb: "cancel", target: "it" },
      { client, now: NOW },
    );
    expect(reply.refs.choices?.map((c) => c.intent)).toEqual([
      { kind: "act", verb: "cancel", target: "Netflix", findingId: "f1" },
      { kind: "act", verb: "cancel", target: "Hulu", findingId: "f2" },
    ]);
  });

  it("describes the finding when what was typed had no verb", async () => {
    const reply = await whichReply("u1", { kind: "about", target: "it" }, { client, now: NOW });
    expect(reply.refs.choices?.[0]?.intent).toEqual({
      kind: "about",
      target: "Netflix",
      findingId: "f1",
    });
  });
});
