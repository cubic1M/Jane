import { describe, expect, it } from "vitest";
import { demoInvestments } from "@/lib/investments/__fixtures__/demo";
import { holdingsReply } from "./replies";

// Debugger 11-16 (a Fidelity positions upload): "how much do I have invested?" ended "From Your
// upload." An uploaded account's source is labelled "Your upload"; in a sentence it's "your upload".

describe("where one account's holdings came from", () => {
  it("is said mid-sentence for an upload", () => {
    const data = demoInvestments();
    const uploaded = {
      ...data,
      accounts: data.accounts.map((a) => ({ ...a, institution: "Your upload" })),
    };
    const body = holdingsReply(uploaded, "401k").body;
    expect(body).toMatch(/\nFrom your upload\.$/);
  });

  it("keeps a bank's own name", () => {
    expect(holdingsReply(demoInvestments(), "401k").body).toMatch(
      /\nFrom Demo Bank \(fake data\)\.$/,
    );
  });
});
