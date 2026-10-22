import { describe, expect, it } from "vitest";
import { PEOPLE } from "@/config/people";
import { demoAccounts, demoTransactions } from "../demo-bank";
import { PEOPLE_EXTRAS } from "./index";

// The lanes add signals to the sample people in their own files; merged, nothing collides.
describe("the lanes' extras for the sample people", () => {
  it("keeps every key unique across lanes and the base data", () => {
    for (const p of PEOPLE) {
      const demo = { seed: `x${p.id}`, anchor: "2026-10-18", person: p.id };
      const t = demoTransactions(demo, null, "2026-10-17");
      expect(new Set(t.map((x) => x.transaction_id)).size).toBe(t.length);
      const accounts = demoAccounts(demo);
      expect(new Set(accounts.map((a) => a.account_id)).size).toBe(accounts.length);
      const known = new Set(accounts.map((a) => a.account_id));
      for (const x of t) expect(known.has(x.account_id), x.name).toBe(true);
    }
  });

  it("lists only people that exist", () => {
    const ids = new Set(PEOPLE.map((p) => p.id as string));
    for (const lane of PEOPLE_EXTRAS)
      for (const id of Object.keys(lane)) expect(ids.has(id)).toBe(true);
  });
});
