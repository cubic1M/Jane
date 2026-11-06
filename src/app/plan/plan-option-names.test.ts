import { describe, expect, it, vi } from "vitest";

vi.mock("next/server", async (importOriginal) => ({
  ...(await importOriginal<typeof import("next/server")>()),
  after: vi.fn(),
}));
vi.mock("@/lib/session", () => ({
  requireUser: vi.fn(async () => ({ id: "u1", email: "alex@example.com" })),
}));
vi.mock("@/lib/plan", () => ({
  answerPlanItem: vi.fn(async () => ({ ok: true, agentJobId: undefined })),
  yesToAll: vi.fn(),
}));

import { answerPlanItem } from "@/lib/plan";
import { answerItem } from "./actions";

// A plan item's options come from its action type, which the form sends. A name every object has,
// like "constructor", passed the check and then crashed the action with a server error.
describe("a plan answer naming an action type that isn't one", () => {
  it("is answered without options, not with a crash", async () => {
    for (const actionType of ["constructor", "__proto__", "toString"]) {
      const data = new FormData();
      data.set("findingId", "f1");
      data.set("cardHash", "a".repeat(64));
      data.set("choice", "yes");
      data.set("changed", "true");
      data.set("actionType", actionType);
      await answerItem(null, data);
      expect(vi.mocked(answerPlanItem).mock.lastCall?.[1]).toMatchObject({ options: undefined });
    }
  });
});
