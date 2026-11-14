import { describe, expect, it, vi } from "vitest";
import type { PrismaClient } from "@/generated/prisma/client";
import { addFormOpen, addPolicyHref } from "./add-link";

vi.mock("@/lib/advice-mode", () => ({ adviceMode: async () => true }));
vi.mock("@/lib/insurance/checkups", () => ({ runCheckup: async () => null }));

// Debugger 11-13: a student who had only uploaded a checking statement opened Insurance on a
// phone and found a long "Add a policy" form, set to Car, open under the tree. The form opens
// only when a link asks for it, and every "Add a policy" link asks.
describe("the insurance page's add form", () => {
  it("stays closed unless the address asks for it", () => {
    expect(addFormOpen("")).toBe(false);
    expect(addFormOpen("renters")).toBe(true);
    expect(addFormOpen("new")).toBe(true);
  });

  it("is asked for by a link with a kind and by one without", () => {
    expect(addPolicyHref("renters")).toBe("/insurance?add=renters#add");
    expect(addPolicyHref()).toBe("/insurance?add=new#add");
    expect(addPolicyHref(null)).toBe("/insurance?add=new#add");
  });

  it("is opened by the chat's checkup when there are no policies yet", async () => {
    const { checkupAnswer } = await import("@/lib/jane-agent/insurance/checkup");
    const reply = await checkupAnswer("user-1", {
      client: {} as PrismaClient,
      now: new Date("2026-11-13T20:00:00Z"),
    });
    const hrefs = reply.actions.map((a) => ("href" in a ? a.href : ""));
    expect(hrefs).toContain("/insurance?add=new#add");
  });
});
