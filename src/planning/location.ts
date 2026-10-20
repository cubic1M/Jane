import { createHash } from "node:crypto";
import { MIN_SWAP_CENTS, PLACEMENT, type AccountKind } from "@/config/location";

// The right investment in the right account (spec step 231, demo advice). Pure. One
// allocation across every account, with the tax-inefficient holdings placed in tax-advantaged
// accounts and the tax-efficient ones in taxable accounts, as swaps that leave the overall
// mix exactly where it was. A swap sells a class in one account and buys it in another, and
// each pair is bought and sold together, so doing some of them never changes the mix. A swap
// that sells at a gain in a taxable account shows the tax it would cost.

export type Class = "bonds" | "us_stocks" | "intl_stocks";
export const CLASSES: readonly Class[] = ["bonds", "us_stocks", "intl_stocks"];

export type PlanHolding = {
  ticker: string;
  name: string;
  valueCents: number;
  // Cost basis, when known (taxable accounts only matter).
  gainCents: number | null;
  // The class when the fund is one pure class that can be moved; otherwise null (a
  // target-date fund or a cash fund stays where it is).
  moveClass: Class | null;
};

export type PlanAccount = {
  id: string;
  name: string;
  kind: AccountKind;
  holdings: PlanHolding[];
};

export type Swap = {
  key: string;
  // This account sells `sell` and buys `buy`, amount cents; the other account does the reverse.
  a: { accountId: string; accountName: string; sell: Class; buy: Class };
  b: { accountId: string; accountName: string; sell: Class; buy: Class };
  amountCents: number;
  // Tax from the sale at a gain in a taxable account, and the gain it realises.
  taxCents: number;
  gainCents: number;
};

export type LocationPlan = {
  swaps: Swap[];
  // Per account: class amounts now and after.
  before: Record<string, Record<Class, number>>;
  after: Record<string, Record<Class, number>>;
  // Class totals across every account, now (and after: the same).
  totals: Record<Class, number>;
  // Yearly tax on payouts in taxable accounts now and after, and the difference.
  taxNowCents: number;
  taxAfterCents: number;
  savedCents: number;
  key: string;
};

const zero = (): Record<Class, number> => ({ bonds: 0, us_stocks: 0, intl_stocks: 0 });

export function movable(account: PlanAccount): Record<Class, number> {
  const out = zero();
  for (const h of account.holdings) if (h.moveClass) out[h.moveClass] += h.valueCents;
  return out;
}

// The target class amounts per account: the movable money, placed by the waterfall.
export function targets(accounts: PlanAccount[]): Record<string, Record<Class, number>> {
  const capacity = new Map<string, number>();
  const now = new Map<string, Record<Class, number>>();
  for (const a of accounts) {
    const m = movable(a);
    now.set(a.id, m);
    capacity.set(a.id, m.bonds + m.us_stocks + m.intl_stocks);
  }
  const total = zero();
  for (const m of now.values()) for (const c of CLASSES) total[c] += m[c];
  const out: Record<string, Record<Class, number>> = Object.fromEntries(
    accounts.map((a) => [a.id, zero()]),
  );
  // Place classes in the order of their tax drag: bonds first.
  for (const c of CLASSES) {
    let left = total[c];
    for (const kind of PLACEMENT[c]) {
      for (const a of accounts.filter((x) => x.kind === kind)) {
        const room = capacity.get(a.id) ?? 0;
        const put = Math.min(left, room);
        out[a.id][c] += put;
        capacity.set(a.id, room - put);
        left -= put;
        if (left <= 0) break;
      }
      if (left <= 0) break;
    }
  }
  return out;
}

const gainShare = (account: PlanAccount, c: Class) => {
  const rows = account.holdings.filter((h) => h.moveClass === c);
  const value = rows.reduce((s, h) => s + h.valueCents, 0);
  const gain = rows.reduce((s, h) => s + Math.max(0, h.gainCents ?? 0), 0);
  return value > 0 ? gain / value : 0;
};

export function locationPlan(input: {
  accounts: PlanAccount[];
  // Yield of each class's core fund, in basis points (interest or dividends).
  yieldBps: Record<Class, number>;
  // Tax rate on payouts by class (interest at the ordinary rate, dividends at the lower one).
  payoutRate: Record<Class, number>;
  gainRate: number;
}): LocationPlan {
  const { accounts } = input;
  const before: Record<string, Record<Class, number>> = {};
  for (const a of accounts) before[a.id] = movable(a);
  const target = targets(accounts);
  const after: Record<string, Record<Class, number>> = {};
  const delta: Record<string, Record<Class, number>> = {};
  for (const a of accounts) {
    after[a.id] = { ...target[a.id] };
    delta[a.id] = zero();
    for (const c of CLASSES) delta[a.id][c] = target[a.id][c] - before[a.id][c];
  }
  // Pair a sale of one class in an account with the purchase of the same class by another
  // whose delta is the mirror: account A sells c1 / buys c2 while B sells c2 / buys c1.
  const swaps: Swap[] = [];
  const byId = new Map(accounts.map((a) => [a.id, a]));
  const left = JSON.parse(JSON.stringify(delta)) as typeof delta;
  for (const c1 of CLASSES) {
    for (const c2 of CLASSES) {
      if (c1 >= c2) continue;
      for (const a of accounts) {
        // a sells c1 and buys c2
        if (left[a.id][c1] >= 0 || left[a.id][c2] <= 0) continue;
        for (const b of accounts) {
          if (b.id === a.id || left[b.id][c2] >= 0 || left[b.id][c1] <= 0) continue;
          const amount = Math.min(-left[a.id][c1], left[a.id][c2], -left[b.id][c2], left[b.id][c1]);
          if (amount < MIN_SWAP_CENTS) continue;
          left[a.id][c1] += amount;
          left[a.id][c2] -= amount;
          left[b.id][c2] += amount;
          left[b.id][c1] -= amount;
          swaps.push(makeSwap(byId.get(a.id)!, byId.get(b.id)!, c1, c2, amount, input.gainRate));
        }
      }
      // The reverse direction: a sells c2 and buys c1.
      for (const a of accounts) {
        if (left[a.id][c2] >= 0 || left[a.id][c1] <= 0) continue;
        for (const b of accounts) {
          if (b.id === a.id || left[b.id][c1] >= 0 || left[b.id][c2] <= 0) continue;
          const amount = Math.min(-left[a.id][c2], left[a.id][c1], -left[b.id][c1], left[b.id][c2]);
          if (amount < MIN_SWAP_CENTS) continue;
          left[a.id][c2] += amount;
          left[a.id][c1] -= amount;
          left[b.id][c1] += amount;
          left[b.id][c2] -= amount;
          swaps.push(makeSwap(byId.get(a.id)!, byId.get(b.id)!, c2, c1, amount, input.gainRate));
        }
      }
    }
  }
  // Tax drag now and after, in taxable accounts only.
  const drag = (amounts: Record<string, Record<Class, number>>) =>
    accounts
      .filter((a) => a.kind === "taxable")
      .reduce(
        (s, a) =>
          s +
          CLASSES.reduce(
            (t, c) =>
              t +
              Math.round(((amounts[a.id][c] * input.yieldBps[c]) / 10_000) * input.payoutRate[c]),
            0,
          ),
        0,
      );
  // After the swaps actually listed (leftovers under the minimum stay put).
  const applied: Record<string, Record<Class, number>> = {};
  for (const a of accounts) {
    applied[a.id] = zero();
    for (const c of CLASSES) applied[a.id][c] = before[a.id][c] + (delta[a.id][c] - left[a.id][c]);
  }
  const totals = zero();
  for (const a of accounts) for (const c of CLASSES) totals[c] += before[a.id][c];
  const nowDrag = drag(before);
  const afterDrag = drag(applied);
  return {
    swaps,
    before,
    after: applied,
    totals,
    taxNowCents: nowDrag,
    taxAfterCents: afterDrag,
    savedCents: nowDrag - afterDrag,
    key: createHash("sha256")
      .update(
        JSON.stringify(
          swaps.map((s) => [s.a.accountId, s.b.accountId, s.a.sell, s.a.buy, s.amountCents]),
        ),
      )
      .digest("hex")
      .slice(0, 24),
  };
}

function makeSwap(
  a: PlanAccount,
  b: PlanAccount,
  aSells: Class,
  aBuys: Class,
  amount: number,
  gainRate: number,
): Swap {
  // The tax comes from selling at a gain in a taxable account.
  const sellGain = (acc: PlanAccount, c: Class) =>
    acc.kind === "taxable" ? Math.round(amount * gainShare(acc, c)) : 0;
  const gain = sellGain(a, aSells) + sellGain(b, aBuys);
  return {
    key: createHash("sha256")
      .update(`${a.id}|${b.id}|${aSells}|${aBuys}|${amount}`)
      .digest("hex")
      .slice(0, 16),
    a: { accountId: a.id, accountName: a.name, sell: aSells, buy: aBuys },
    b: { accountId: b.id, accountName: b.name, sell: aBuys, buy: aSells },
    amountCents: amount,
    taxCents: Math.round(gain * gainRate),
    gainCents: gain,
  };
}
