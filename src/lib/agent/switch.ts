import {
  SWITCH_MIN_MOVED_SHARE,
  SWITCH_PRICE_TOLERANCE_CENTS,
  SWITCH_WATCH_DAYS,
} from "@/config/agent";
import { normalizeMerchant } from "@/data-sources/merchant";
import type { PrismaClient } from "@/generated/prisma/client";
import { sendStatusEmail } from "@/lib/action-emails";
import { track } from "@/lib/analytics";
import { db as defaultClient } from "@/lib/db";
import { scopedFor } from "@/lib/db-scoped";
import { formatCents } from "@/lib/money";
import { handOff, loadAction, merchantOf, note, setStatus, type LoadedAction } from "./run";
import { isoDay } from "@/lib/dates";
import { ownedBy, type OnlyPeople } from "@/lib/only-people";

// Switching to the option the person picked (spec steps 76–77). Jane never signs anyone
// up or moves money: the person signs up with the link, and Jane watches the account to
// see it happen. A cheaper tier is done when the cheaper charge shows up; another
// provider's plan, when its first charge shows up, and only then is the old service
// cancelled (by the team), so the person is never without it; a savings account, when
// the money is seen leaving. Savings are counted from the real new charges.

type Options = { client?: PrismaClient; now?: Date; notify?: typeof sendStatusEmail };

export type Switch = {
  optionId: string;
  kind: "tier" | "plan" | "savings";
  name: string;
  provider: string;
  monthlyCents: number | null;
  apyBps: number | null;
  signUpUrl: string | null;
  savingCents: number;
  fromMonthlyCents: number | null;
  amountCents: number | null;
  fromRateBps: number | null;
};

const num = (v: unknown) => (typeof v === "number" && Number.isFinite(v) ? v : null);
const str = (v: unknown) => (typeof v === "string" && v ? v : null);

// The switch recorded with the yes, if there was one.
export function switchOf(options: unknown): Switch | null {
  const o = (options ?? {}) as Record<string, unknown>;
  const optionId = str(o.switchTo);
  const kind = str(o.switchKind);
  const name = str(o.switchName);
  if (!optionId || !name || (kind !== "tier" && kind !== "plan" && kind !== "savings")) {
    return null;
  }
  return {
    optionId,
    kind,
    name,
    provider: str(o.switchProvider) ?? name,
    monthlyCents: num(o.switchMonthlyCents),
    apyBps: num(o.switchApyBps),
    signUpUrl: str(o.switchSignUpUrl),
    savingCents: num(o.switchSavingCents) ?? 0,
    fromMonthlyCents: num(o.switchFromMonthlyCents),
    amountCents: num(o.switchAmountCents),
    fromRateBps: num(o.switchFromRateBps),
  };
}

// What the person does, in one sentence per kind.
export function switchTodo(sw: Switch, company: string): string {
  if (sw.kind === "tier") {
    return `Change your ${company} plan to ${sw.name}${sw.signUpUrl ? " with the link" : " on their site"}. Jane watches your next ${company} charge to confirm the lower price; there's nothing else to tell Jane.`;
  }
  if (sw.kind === "plan") {
    return `Sign up for ${sw.name}${sw.signUpUrl ? " with the link" : ""}. When Jane sees its first bill, our team cancels ${company} for you, so you're never without service.`;
  }
  return `Open ${sw.name}${sw.signUpUrl ? " with the link" : ""} and move the money yourself; Jane never moves money. Jane watches for the transfer and counts what it earns.`;
}

// The agent's step for an action with a switch: ask the person to sign up, then watch.
export async function startSwitch(
  userId: string,
  action: LoadedAction,
  { client = defaultClient, now = new Date(), notify = sendStatusEmail }: Options = {},
): Promise<"waiting"> {
  const sw = switchOf(action.decision.options)!;
  await setStatus(
    userId,
    action,
    "waiting_on_user",
    {
      agentState: "switching",
      agentNextAt: null,
      selfServiceUrl: sw.signUpUrl,
      userTodo: switchTodo(sw, merchantOf(action)),
    },
    { client, now, notify },
  );
  await note(
    userId,
    action.id,
    `Switching to ${sw.name} (${sw.provider}). Jane is watching your account for it.`,
    client,
  );
  await track(userId, "switch_started", { kind: sw.kind });
  return "waiting";
}

const keyOf = (text: string | null) => (text ? (normalizeMerchant(text)?.key ?? null) : null);
const matches = (got: string | null, want: string | null) =>
  Boolean(want && got && (got === want || got.startsWith(`${want} `)));

type Seen =
  | { kind: "done"; confirmedAnnualCents: number; text: string }
  | { kind: "new_service"; confirmedAnnualCents: number | null; text: string }
  | null;

// Looks through the account since the switch started for the sign that it happened.
async function lookFor(
  userId: string,
  action: LoadedAction,
  sw: Switch,
  since: Date,
  client: PrismaClient,
): Promise<Seen> {
  const rows = await scopedFor(userId, client).transactions.findMany({
    where: { date: { gt: new Date(`${isoDay(since)}T00:00:00Z`) } },
    select: {
      date: true,
      amountCents: true,
      description: true,
      merchantName: true,
      pfcPrimary: true,
    },
    orderBy: { date: "asc" },
  });
  if (sw.kind === "tier") {
    const want = keyOf(action.company);
    const cheaper = rows.find(
      (r) =>
        r.amountCents > 0 &&
        sw.monthlyCents !== null &&
        r.amountCents <= sw.monthlyCents + SWITCH_PRICE_TOLERANCE_CENTS &&
        matches(keyOf(r.merchantName ?? r.description), want),
    );
    if (!cheaper) return null;
    const saved = Math.max(0, ((sw.fromMonthlyCents ?? 0) - cheaper.amountCents) * 12);
    return {
      kind: "done",
      confirmedAnnualCents: saved,
      text: `${merchantOf(action)} charged ${formatCents(cheaper.amountCents)} on ${isoDay(cheaper.date)}: you're on ${sw.name}.`,
    };
  }
  if (sw.kind === "plan") {
    const want = keyOf(sw.provider);
    const first = rows.find(
      (r) => r.amountCents > 0 && matches(keyOf(r.merchantName ?? r.description), want),
    );
    if (!first) return null;
    return {
      kind: "new_service",
      confirmedAnnualCents:
        sw.fromMonthlyCents === null
          ? null
          : Math.max(0, (sw.fromMonthlyCents - first.amountCents) * 12),
      text: `First ${sw.provider} bill seen on ${isoDay(first.date)} (${formatCents(first.amountCents)}).`,
    };
  }
  const amount = sw.amountCents ?? 0;
  const moved = rows.find(
    (r) =>
      r.amountCents >= Math.round(amount * SWITCH_MIN_MOVED_SHARE) &&
      r.pfcPrimary === "TRANSFER_OUT",
  );
  if (!moved || sw.apyBps === null) return null;
  const counted = Math.min(moved.amountCents, amount);
  return {
    kind: "done",
    confirmedAnnualCents: Math.max(
      0,
      Math.round((counted * (sw.apyBps - (sw.fromRateBps ?? 0))) / 10_000),
    ),
    text: `${formatCents(moved.amountCents)} moved out on ${isoDay(moved.date)}.`,
  };
}

// The daily check on every switch in progress.
export async function confirmSwitches({
  client = defaultClient,
  now = new Date(),
  notify = sendStatusEmail,
  userId: only,
  userIds,
}: Options & { userId?: string } & OnlyPeople = {}): Promise<{
  switched: number;
  handedOff: number;
}> {
  // A system job across users (or one, after their sync): ids only, and everything after
  // is scoped to the person.
  const due = await client.action.findMany({
    where: {
      agentState: "switching",
      status: { in: ["in_progress", "waiting_on_user"] },
      ...(only ? { userId: only } : ownedBy(userIds)),
    },
    select: { id: true, userId: true },
    take: 200,
  });
  const counts = { switched: 0, handedOff: 0 };
  const options = { client, now, notify };
  for (const { id, userId } of due) {
    const action = await loadAction(userId, id, client);
    const sw = action ? switchOf(action.decision.options) : null;
    if (!action || !sw || !action.startedAt) continue;
    const seen = await lookFor(userId, action, sw, action.startedAt, client);
    if (seen?.kind === "done") {
      await setStatus(
        userId,
        action,
        "done",
        {
          agentState: "finished",
          userTodo: null,
          confirmedAnnualCents: seen.confirmedAnnualCents,
        },
        options,
      );
      await note(userId, id, `${seen.text} Done.`, client);
      await track(userId, "switch_confirmed", { kind: sw.kind });
      counts.switched += 1;
    } else if (seen?.kind === "new_service") {
      // The new service is on: only now does the old one get cancelled.
      await handOff(
        userId,
        action,
        `${seen.text} Cancel ${merchantOf(action)} now; the person has switched to ${sw.name}.`,
        options,
      );
      await scopedFor(userId, client).actions.updateMany({
        where: { id },
        data: {
          ...(seen.confirmedAnnualCents === null
            ? {}
            : { confirmedAnnualCents: seen.confirmedAnnualCents }),
          userTodo: `Jane saw your first ${sw.provider} bill. Our team is cancelling ${merchantOf(action)} for you now.`,
        },
      });
      await track(userId, "switch_confirmed", { kind: sw.kind });
      counts.switched += 1;
    } else if (now.getTime() - action.startedAt.getTime() > SWITCH_WATCH_DAYS * 86_400_000) {
      await handOff(
        userId,
        action,
        `No sign of the switch to ${sw.name} after ${SWITCH_WATCH_DAYS} days.`,
        options,
      );
      counts.handedOff += 1;
    }
  }
  return counts;
}
