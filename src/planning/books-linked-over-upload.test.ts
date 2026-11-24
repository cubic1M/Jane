import { describe, expect, it } from "vitest";
import { netWorth } from "@/insights/net-worth";
import { withoutCopies } from "@/lib/account-copies";
import { copiesToLeaveOut, duplicateAccounts, type Acct } from "./books";

// The founder's Home, 11-23: net worth "not my current net worth". An account uploaded from a
// statement and later linked is in the database twice, the same last digits, type and subtype, and
// net worth counts it once. The copy kept was the older one, so for anyone who uploaded first (as
// the founders did, before Plaid production) it was the upload: net worth was the statement's last
// balance, and the linked account, updated each day, was the copy left out. The link is kept.

const account = (
  id: string,
  itemId: string | null,
  name: string,
  currentBalanceCents: number,
): Acct & { currentBalanceCents: number } => ({
  id,
  itemId,
  name,
  mask: "1234",
  type: "depository",
  subtype: "checking",
  currentBalanceCents,
});

// Chase checking uploaded first (its statement ended at $1,200.00), linked later ($4,850.00 now).
// cuid ids sort by when they were made: the upload's is the older.
const UPLOAD = account("cmhupload0001", null, "Chase checking", 120_000);
const LINKED = account("cmhzlinked002", "item_chase", "TOTAL CHECKING", 485_000);

describe("an account both uploaded and linked", () => {
  it("keeps the link and leaves the upload out, whichever came first", () => {
    for (const accounts of [
      [UPLOAD, LINKED],
      [LINKED, UPLOAD],
    ]) {
      expect(duplicateAccounts(accounts).map((d) => [d.keep.name, d.duplicate.name])).toEqual([
        ["TOTAL CHECKING", "Chase checking"],
      ]);
    }
  });

  it("counts in net worth at the linked balance, not the statement's", () => {
    const accounts = [UPLOAD, LINKED];
    const kept = withoutCopies(accounts, copiesToLeaveOut(accounts), (a) => a.id);
    const worth = netWorth(kept.map((a) => ({ ...a, balanceCents: a.currentBalanceCents })));
    expect(worth.netCents).toBe(485_000);
  });

  it("still keeps the older of two links of one account", () => {
    const older = account("cmhaaaa0001", "item_a", "Checking", 100_000);
    const newer = account("cmhbbbb0002", "item_b", "Checking", 100_000);
    expect(duplicateAccounts([newer, older]).map((d) => d.keep.id)).toEqual(["cmhaaaa0001"]);
  });
});
