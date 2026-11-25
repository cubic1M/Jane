import { describe, expect, it } from "vitest";
import { countingProblems } from "@/sweep/counted";
import { accountsLeftOut, type CountAcct } from "./books";

// What comparing an upload with the links beside it said (src/planning/same-account.ts) decides
// whether it counts: the same as one of them leaves it out, different from all of them counts it,
// anything else leaves it out (Plaid wins). Whichever order the ids come in.

const bankOf = (a: CountAcct) => (a.itemId ? "Chase" : null);
const base = { type: "depository", subtype: "checking", mask: null } as const;
const upload = (id: string): CountAcct => ({
  ...base,
  id,
  itemId: null,
  source: "csv",
  name: "Chase checking",
});
const link = (id: string, mask: string | null = null): CountAcct => ({
  ...base,
  id,
  itemId: `item_${id}`,
  source: "plaid",
  name: `Link ${id}`,
  mask,
});
type Said = "same" | "different" | "unknown";
const run = (accounts: CountAcct[], said: Record<string, Said>, separate: string[] = []) => {
  const cleared = new Set<string>();
  const left = accountsLeftOut(accounts, {
    bankOf,
    separate: new Set(separate),
    evidence: new Map(Object.entries(said)),
    cleared,
  });
  return { left, cleared };
};

describe.each([
  ["u first", ["u", "l1", "l2"]],
  ["u middle", ["l1", "u", "l2"]],
  ["u last", ["l1", "l2", "u"]],
])("an upload beside two links (%s)", (_name, order) => {
  const all = () => order.map((id) => (id === "u" ? upload("u") : link(id)));

  it("is left out as the same account when it shows the same as either link", () => {
    const { left } = run(all(), { "u|l1": "different", "u|l2": "same" });
    expect(left.get("u")).toMatchObject({ reason: "same_account", sameAs: { id: "l2" } });
  });

  it("counts when it shows something else than both, with nothing asked", () => {
    const { left, cleared } = run(all(), { "u|l1": "different", "u|l2": "different" });
    expect(left.has("u")).toBe(false);
    expect(cleared.has("u")).toBe(true);
    const counted = all().filter((a) => !left.has(a.id));
    expect(countingProblems(counted, bankOf, new Set(), cleared)).toEqual([]);
  });

  it("is left out when one of them couldn't be compared, whatever the other said", () => {
    const { left } = run(all(), { "u|l1": "different", "u|l2": "unknown" });
    expect(left.get("u")).toMatchObject({ reason: "maybe_same", sameAs: { id: "l2" } });
  });

  it("counts when the person said it is another, whatever was compared", () => {
    const { left } = run(all(), { "u|l1": "same", "u|l2": "same" }, ["u"]);
    expect(left.has("u")).toBe(false);
  });
});

describe("with nothing said", () => {
  it("is as before: left out as maybe the same", () => {
    const { left } = run([upload("u"), link("l1")], {});
    expect(left.get("u")?.reason).toBe("maybe_same");
  });
});
