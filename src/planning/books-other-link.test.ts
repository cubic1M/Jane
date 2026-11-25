import { describe, expect, it } from "vitest";
import { accountsLeftOut, duplicateAccounts, type CountAcct } from "./books";

// CodeRabbit on #2259: a link with no Plaid item (SnapTrade's brokerage accounts) beside the CSV of
// the same account has two null item ids, so the copy rule never paired them and both counted.

const base = { type: "investment", subtype: "brokerage", mask: "4321", itemId: null } as const;
const snaptrade: CountAcct = { ...base, id: "z_link", source: "snaptrade", name: "Fidelity" };
const csv: CountAcct = { ...base, id: "a_csv", source: "csv", name: "Fidelity brokerage" };

describe("a link with no Plaid item, and an upload of the same account", () => {
  it("is a copy: the link counts, the upload does not, whichever id sorts first", () => {
    const found = duplicateAccounts([csv, snaptrade]);
    expect(found.map((d) => [d.keep.id, d.duplicate.id])).toEqual([["z_link", "a_csv"]]);
    expect(accountsLeftOut([snaptrade, csv]).get("a_csv")).toMatchObject({ reason: "copy" });
    expect(accountsLeftOut([snaptrade, csv]).has("z_link")).toBe(false);
  });

  it("leaves Plaid links as they were, and two uploads alone here", () => {
    const plaid = { ...base, id: "p1", itemId: "item1", source: "plaid", name: "Fidelity" };
    const plaid2 = { ...plaid, id: "p2", itemId: "item2" };
    expect(duplicateAccounts([plaid, plaid2])).toHaveLength(1);
    expect(duplicateAccounts([csv, { ...csv, id: "b_csv" }])).toEqual([]);
    expect(duplicateAccounts([plaid, { ...snaptrade, id: "s1" }])).toHaveLength(1);
  });
});
