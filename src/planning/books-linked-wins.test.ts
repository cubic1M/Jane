import { describe, expect, it } from "vitest";
import { netWorth } from "@/insights/net-worth";
import { withoutCopies } from "@/lib/account-copies";
import { accountsLeftOut, type CountAcct } from "./books";

// The founder's rule, 11-24: "it should always match the data of Plaid and show no duplicate
// statements". What net worth counts is what a bank link reads, plus an uploaded statement only when
// it can't be a copy of a linked account, nor an earlier upload of an account uploaded again. Each
// shape below read about twice the truth on main (707d1eaf and the notice-only #2244).

type Row = CountAcct & { currentBalanceCents: number };
let n = 0;
const acct = (over: Partial<Row> & Pick<Row, "name" | "currentBalanceCents">): Row => {
  n += 1;
  return {
    id: `acc${String(n).padStart(3, "0")}`,
    itemId: null,
    source: "csv",
    mask: null,
    type: "depository",
    subtype: "checking",
    ...over,
  };
};
const link = (over: Partial<Row> & Pick<Row, "name" | "currentBalanceCents">) =>
  acct({ itemId: "item_chase", source: "plaid", ...over });

const BANKS: Record<string, string> = {
  item_chase: "Chase",
  item_wells: "Wells Fargo",
  item_chase_again: "Chase",
};
const bankOf = (a: CountAcct) => (a.itemId ? (BANKS[a.itemId] ?? null) : null);
const counted = (accounts: Row[], over: Parameters<typeof accountsLeftOut>[1] = {}) => {
  const left = accountsLeftOut(accounts, { bankOf, ...over });
  const kept = withoutCopies(accounts, new Set(left.keys()), (a) => a.id);
  return {
    left,
    kept,
    netCents: netWorth(kept.map((a) => ({ ...a, balanceCents: a.currentBalanceCents }))).netCents,
  };
};

describe("net worth counts the link, and an upload only when it can't be a copy of one", () => {
  it("leaves out an upload with no last four beside a linked account of the same bank and kind", () => {
    const upload = acct({ name: "Chase checking", currentBalanceCents: 120_000 });
    const linked = link({ name: "TOTAL CHECKING", mask: "1234", currentBalanceCents: 485_000 });
    const { left, netCents } = counted([upload, linked]);
    expect(netCents).toBe(485_000);
    expect(left.get(upload.id)).toMatchObject({ reason: "maybe_same", sameAs: { id: linked.id } });
  });

  it("leaves it out whichever is older", () => {
    const linked = link({ name: "TOTAL CHECKING", mask: "1234", currentBalanceCents: 485_000 });
    const upload = acct({ name: "Chase checking", currentBalanceCents: 120_000 });
    expect(counted([linked, upload]).netCents).toBe(485_000);
  });

  it("leaves out an upload whose last four match a link Plaid names another subtype", () => {
    const upload = acct({ name: "Chase checking", mask: "1234", currentBalanceCents: 120_000 });
    const linked = link({
      name: "Checking",
      mask: "1234",
      subtype: "cash management",
      currentBalanceCents: 485_000,
    });
    expect(counted([upload, linked]).netCents).toBe(485_000);
  });

  it("counts an upload proven to be another account", () => {
    const linked = link({ name: "TOTAL CHECKING", mask: "1234", currentBalanceCents: 485_000 });
    const others = [
      // another last four, another kind, another bank, another type
      acct({ name: "Chase checking", mask: "5678", currentBalanceCents: 10_000 }),
      acct({ name: "Chase savings", subtype: "savings", currentBalanceCents: 20_000 }),
      acct({ name: "Wells Fargo checking", currentBalanceCents: 30_000 }),
      acct({
        name: "Chase card",
        type: "credit",
        subtype: "credit card",
        currentBalanceCents: 40_000,
      }),
    ];
    const { left, netCents } = counted([linked, ...others]);
    expect([...left.keys()]).toEqual([]);
    expect(netCents).toBe(485_000 + 10_000 + 20_000 + 30_000 - 40_000);
  });

  it("counts an upload the person said is an account of its own", () => {
    const upload = acct({ name: "Chase checking", currentBalanceCents: 120_000 });
    const linked = link({ name: "TOTAL CHECKING", mask: "1234", currentBalanceCents: 485_000 });
    expect(counted([upload, linked], { separate: new Set([upload.id]) }).netCents).toBe(605_000);
  });

  it("counts an upload when nothing is linked: there is nothing to match it to", () => {
    const upload = acct({ name: "Chase checking", currentBalanceCents: 120_000 });
    expect(counted([upload]).netCents).toBe(120_000);
  });

  it("counts two uploads of one account once: the later statement's closing balance", () => {
    const early = acct({ name: "Chase checking", mask: "1234", currentBalanceCents: 100_000 });
    const later = acct({ name: "Chase checking (2)", mask: "1234", currentBalanceCents: 130_000 });
    const endsOn = new Map([
      [early.id, "2026-10-31"],
      [later.id, "2026-11-20"],
    ]);
    for (const order of [
      [early, later],
      [later, early],
    ]) {
      const { left, netCents } = counted(order, { endsOn });
      expect(netCents).toBe(130_000);
      expect(left.get(early.id)?.reason).toBe("older_upload");
    }
    // The statement that ends later wins even when it was uploaded first.
    const flipped = new Map([
      [early.id, "2026-11-30"],
      [later.id, "2026-11-20"],
    ]);
    expect(counted([early, later], { endsOn: flipped }).netCents).toBe(100_000);
  });

  it("counts two uploads with no last four once, and two different banks' separately", () => {
    const a = acct({ name: "Wells Fargo checking", currentBalanceCents: 50_000 });
    const b = acct({ name: "Wells Fargo checking 2", currentBalanceCents: 60_000 });
    expect(counted([a, b], { endsOn: new Map([[b.id, "2026-11-20"]]) }).netCents).toBe(60_000);
    const c = acct({ name: "Chase checking", currentBalanceCents: 70_000 });
    expect(counted([a, c]).netCents).toBe(120_000);
  });

  it("counts an account linked twice once, named two ways", () => {
    const first = link({ name: "Checking", mask: "1234", currentBalanceCents: 485_000 });
    const second = link({
      name: "Checking",
      mask: "1234",
      itemId: "item_chase_again",
      subtype: "cash management",
      currentBalanceCents: 485_000,
    });
    const { left, netCents } = counted([first, second]);
    expect(netCents).toBe(485_000);
    expect(left.get(second.id)?.reason).toBe("linked_twice");
  });

  it("does not drop a card or an account of another kind linked beside an upload", () => {
    const linked = link({ name: "TOTAL CHECKING", mask: "1234", currentBalanceCents: 485_000 });
    const card = link({
      name: "Sapphire",
      mask: "9999",
      type: "credit",
      subtype: "credit card",
      currentBalanceCents: 90_000,
    });
    expect(counted([linked, card]).netCents).toBe(395_000);
  });
});
