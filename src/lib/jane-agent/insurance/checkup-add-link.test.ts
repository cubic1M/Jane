import { describe, expect, it, vi } from "vitest";
import type { PrismaClient } from "@/generated/prisma/client";
import { checkupAnswer } from "./checkup";

vi.mock("@/lib/advice-mode", () => ({ adviceMode: async () => true }));
vi.mock("@/lib/insurance/checkups", () => ({ runCheckup: async () => null }));

// Debugger 11-13: a student who had only uploaded a checking statement opened Insurance on a
// phone and found a long "Add a policy" form, set to Car, open under the tree. The form now opens
// only when a link asks for it (?add=, e2e/insurance-add-closed.spec.ts), so the chat's "Add a
// policy" link has to ask, even when it names no kind.
describe("the chat's checkup with no policies yet", () => {
  it("links to the add form open, not just to where it sits", async () => {
    const reply = await checkupAnswer("user-1", {
      client: {} as PrismaClient,
      now: new Date("2026-11-13T20:00:00Z"),
    });
    const hrefs = reply.actions.map((a) => ("href" in a ? a.href : ""));
    expect(hrefs).toContain("/insurance?add=new#add");
  });
});
