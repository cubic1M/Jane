import {
  BUFFER_ADJUST_SHARE,
  BUFFER_FLOOR_MONTHS,
  BUFFER_TARGET_MONTHS,
  MAX_ADJUST_SHARE,
  MIN_STEADY_MONTHS,
  STEADY_SHARE,
} from "@/config/steady-pay";

// A steady paycheck from uneven income (spec step 240). Pure: the last months' deposits, the
// share to set aside for tax, the buffer and the monthly spending in; the month's "paycheck"
// out. It follows income smoothly, moves up when the buffer is above its target and down when
// below, and never takes the buffer under its floor.

export type SteadyInput = {
  // Uneven income received each of the last months (oldest first), before tax set-aside.
  monthlyDepositsCents: number[];
  // Share of each deposit set aside for tax (0 to 0.5).
  setAsideRate: number;
  bufferCents: number;
  monthlySpendingCents: number;
};

export type SteadyPlan = {
  status: "ready" | "not_enough_history" | "no_floor_room";
  paycheckCents: number;
  // What the paycheck would be with the buffer on target.
  usualCents: number;
  targetCents: number;
  floorCents: number;
  adjust: "raised" | "lowered" | "steady";
  reason: string;
};

const dollars = (cents: number) =>
  `$${Math.round(cents / 100).toLocaleString("en-US", { maximumFractionDigits: 0 })}`;

export function steadyPlan(input: SteadyInput): SteadyPlan {
  const targetCents = Math.round(input.monthlySpendingCents * BUFFER_TARGET_MONTHS);
  const floorCents = Math.round(input.monthlySpendingCents * BUFFER_FLOOR_MONTHS);
  const months = input.monthlyDepositsCents;
  const base = { usualCents: 0, targetCents, floorCents, adjust: "steady" as const };
  if (months.length < MIN_STEADY_MONTHS) {
    return {
      ...base,
      status: "not_enough_history",
      paycheckCents: 0,
      reason: `I need at least ${MIN_STEADY_MONTHS} months of income to work out a steady paycheck.`,
    };
  }
  const average = months.reduce((s, c) => s + c, 0) / months.length;
  const usual = Math.round(average * (1 - input.setAsideRate) * STEADY_SHARE);
  // The buffer moves it: above target adds a share of the gap, below takes it off, up to a
  // quarter of the usual paycheck either way.
  const gap = input.bufferCents - targetCents;
  const cap = Math.round(usual * MAX_ADJUST_SHARE);
  const adjustment = Math.max(-cap, Math.min(cap, Math.round(gap * BUFFER_ADJUST_SHARE)));
  const wanted = Math.max(0, usual + adjustment);
  // Never below the floor: the paycheck is only what the buffer has above it.
  const room = Math.max(0, input.bufferCents - floorCents);
  const paycheckCents = Math.min(wanted, room);
  const adjust = paycheckCents > usual ? "raised" : paycheckCents < usual ? "lowered" : "steady";
  const reason =
    room === 0
      ? `Your buffer is at its floor (${dollars(floorCents)}), so no paycheck this month; the next deposit rebuilds it.`
      : paycheckCents < wanted
        ? `The buffer only has ${dollars(room)} above its floor, so the paycheck is held to that.`
        : adjust === "raised"
          ? `Your buffer is above its ${dollars(targetCents)} target, so the paycheck is a little more.`
          : adjust === "lowered"
            ? `Your buffer is below its ${dollars(targetCents)} target, so the paycheck is a little less while it fills.`
            : `Your buffer is on target, so the paycheck is the usual ${dollars(usual)}.`;
  return {
    status: room === 0 ? "no_floor_room" : "ready",
    paycheckCents,
    usualCents: usual,
    targetCents,
    floorCents,
    adjust,
    reason,
  };
}

// A year of it: the buffer after each month's deposit (less its tax set-aside) and paycheck.
export function simulateYear(
  deposits: number[],
  setAsideRate: number,
  startBufferCents: number,
  monthlySpendingCents: number,
): { bufferCents: number; paycheckCents: number }[] {
  const out: { bufferCents: number; paycheckCents: number }[] = [];
  let buffer = startBufferCents;
  const seen: number[] = [];
  for (const deposit of deposits) {
    seen.push(deposit);
    // The deposit lands in the buffer (less tax set-aside), then the paycheck leaves it.
    buffer += Math.round(deposit * (1 - setAsideRate));
    const plan = steadyPlan({
      monthlyDepositsCents: seen.slice(-12),
      setAsideRate,
      bufferCents: buffer,
      monthlySpendingCents,
    });
    buffer -= plan.paycheckCents;
    out.push({ bufferCents: buffer, paycheckCents: plan.paycheckCents });
  }
  return out;
}
