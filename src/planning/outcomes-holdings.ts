import { CONFIRMED_SHARE, VERIFIED_PERCENT, WATCH_DAYS } from "@/config/outcomes";
import type { HoldingsWatch, Watch } from "@/detectors/contract";
import { DAY_MS } from "@/lib/dates";
import { formatCents } from "@/lib/money";
import type { Check } from "./outcomes";

// Whether an investing suggestion the person acted on shows in what they hold now (the verified
// savings record for investing). Pure: the watch the detector left with what was there then, the
// day they acted, today, and the holdings now. A fund is "gone" when under a fifth of it is left,
// waiting cash is "put to work" when at least four fifths of the excess has moved, an account is
// "closed" when it is missing or under a tenth of its balance. "waiting" until the next data is in.

export type HoldingsNow = {
  holdings: { accountId: string; ticker: string | null; isCash: boolean; valueCents: number }[];
  accounts: {
    id: string;
    name: string;
    type: string;
    subtype: string | null;
    balanceCents: number;
  }[];
};

export const isHoldingsWatch = (w: Watch): w is HoldingsWatch =>
  w.kind === "funds_left" || w.kind === "cash_invested" || w.kind === "account_closed";

const LEFT_SHARE = 0.2;
const CLOSED_SHARE = 0.1;
const MOVED_SHARE = 0.8;

const daysBetween = (from: string, to: string) => (Date.parse(to) - Date.parse(from)) / DAY_MS;
const verdict = (cents: number, expectedCents: number): "confirmed" | "partial" =>
  cents >= expectedCents * CONFIRMED_SHARE ? "confirmed" : "partial";

export function sweepCash(now: HoldingsNow): number {
  const investment = new Set(
    now.accounts.filter((a) => a.type === "investment" && a.subtype !== "hsa").map((a) => a.id),
  );
  return now.holdings
    .filter((h) => h.isCash && h.ticker === null && investment.has(h.accountId))
    .reduce((s, h) => s + h.valueCents, 0);
}

export function verifyHoldingsWatch(
  watch: HoldingsWatch,
  { startedOn, asOf, expectedCents }: { startedOn: string; asOf: string; expectedCents: number },
  now: HoldingsNow,
): Check {
  const over = daysBetween(startedOn, asOf) > WATCH_DAYS[watch.kind];

  if (watch.kind === "funds_left") {
    let cents = 0;
    const gone: string[] = [];
    const proofs: string[] = [];
    let smaller = 0;
    for (const f of watch.funds) {
      const left = now.holdings
        .filter((h) => h.ticker?.toUpperCase() === f.ticker.toUpperCase())
        .reduce((s, h) => s + h.valueCents, 0);
      if (left <= f.valueCents * LEFT_SHARE) {
        cents += f.yearlyCents;
        gone.push(f.ticker);
        proofs.push(`${f.ticker} went from ${formatCents(f.valueCents)} to ${formatCents(left)}`);
      } else if (left < f.valueCents * 0.8) smaller += 1;
    }
    if (cents > 0) {
      return {
        status: verdict(cents, expectedCents),
        cents,
        yearly: true,
        percent: VERIFIED_PERCENT.holdings_changed,
        evidence: gone,
        proof: `${proofs.join("; ")}.`,
      };
    }
    if (smaller === 0 && !over) return { status: "waiting" };
    return {
      status: "not_seen",
      evidence: [],
      proof:
        smaller > 0
          ? "The funds are smaller, but most of each is still held."
          : "The funds are still held at about what they were.",
    };
  }

  if (watch.kind === "cash_invested") {
    const moved = watch.beforeCents - sweepCash(now);
    const share = watch.excessCents > 0 ? Math.min(1, Math.max(0, moved / watch.excessCents)) : 0;
    if (share >= MOVED_SHARE) {
      return {
        status: "confirmed",
        cents: watch.yearlyCents,
        yearly: true,
        percent: VERIFIED_PERCENT.holdings_changed,
        evidence: [],
        proof: `Cash waiting in your investment accounts fell from ${formatCents(watch.beforeCents)} to ${formatCents(sweepCash(now))}.`,
      };
    }
    if (share > 0.3) {
      return {
        status: "partial",
        cents: Math.round(watch.yearlyCents * share),
        yearly: true,
        percent: VERIFIED_PERCENT.holdings_smaller,
        evidence: [],
        proof: `Some of the waiting cash has moved: ${formatCents(watch.beforeCents)} before, ${formatCents(sweepCash(now))} now.`,
      };
    }
    if (!over) return { status: "waiting" };
    return {
      status: "not_seen",
      evidence: [],
      proof: `The cash is still waiting: ${formatCents(sweepCash(now))} against ${formatCents(watch.beforeCents)} before.`,
    };
  }

  // account_closed
  let cents = 0;
  const closed: string[] = [];
  for (const a of watch.accounts) {
    const same = now.accounts.find((x) => x.id === a.id);
    if (!same || same.balanceCents <= a.balanceCents * CLOSED_SHARE) {
      cents += a.yearlyCents;
      closed.push(now.accounts.find((x) => x.id === a.id)?.name ?? "The account");
    }
  }
  if (cents > 0) {
    return {
      status: verdict(cents, expectedCents),
      cents,
      yearly: true,
      percent: VERIFIED_PERCENT.holdings_changed,
      evidence: closed,
      proof: `${closed.join(", ")} ${closed.length === 1 ? "is" : "are"} no longer holding what it did.`,
    };
  }
  if (!over) return { status: "waiting" };
  return { status: "not_seen", evidence: [], proof: "The account still holds about what it did." };
}
