import type { PrismaClient } from "@/generated/prisma/client";
import { scopedFor } from "@/lib/db-scoped";
import { listGoals } from "@/lib/goals";
import { moneyPartnerFor } from "@/lib/money-movement/partner";
import { formatCents } from "@/lib/money";
import type { Intent } from "./intents";
import { nameMatches } from "./names";
import type { Reply } from "./replies";
import { snoozeButton } from "./sources/source";
import type { ActionId, MessageAction, MessageRefs, MultiStep } from "./types";

// Requests that span sectors (spec step 185): "switch my car insurance and put the savings
// in my emergency fund" becomes one plan. Each step is what its feature's own answer offers
// (its Yes, on its own message, through its own button) or a transfer through the
// money-movement partner (step 144); all shown together for one confirmation. Nothing runs
// until then; ./actions/multi.ts runs them in order and stops at the first that fails.

type Answer = (intent: Intent) => Promise<Reply | null>;
type Options = { client: PrismaClient; now: Date; answer: Answer };

const MONTHS = 12;
const firstSentence = (body: string) => {
  const line = body.split("\n")[0].trim();
  return line.split(/(?<=[.!?])\s+/)[0].replace(/[.!?]+$/, "");
};

const cannot = (part: string, why: string): Reply => ({
  body: `I can't do all of that as one plan: ${part} ${why} Ask for the rest on its own and I'll set it up.`,
  actions: [],
  refs: {},
});

// What a step is about, and what it saves a year: the finding or the insurance pick its
// Yes acts on.
async function aboutOf(
  userId: string,
  refs: MessageRefs,
  client: PrismaClient,
): Promise<{ title: string | null; savingCents: number | null }> {
  const db = scopedFor(userId, client);
  if (refs.insuranceShopId) {
    const shop = await db.insuranceShops.findFirst({
      where: { id: refs.insuranceShopId },
      select: { savingCents: true },
    });
    return { title: null, savingCents: shop?.savingCents ?? null };
  }
  if (refs.findingId) {
    const finding = await db.findings.findFirst({
      where: { id: refs.findingId },
      select: { title: true, annualSavingsCents: true },
    });
    return { title: finding?.title ?? null, savingCents: finding?.annualSavingsCents ?? null };
  }
  return { title: null, savingCents: null };
}

async function transferStep(
  userId: string,
  intent: Extract<Intent, { kind: "move_to_goal" }>,
  savedSoFar: number,
  { client, now }: Options,
): Promise<MultiStep | string> {
  const goals = await listGoals(userId, { client, now });
  const goal =
    goals.find((g) => nameMatches(intent.goal, g.name)) ??
    goals.find((g) => nameMatches(g.name, intent.goal));
  // Spec step 192: "move $200 to savings" with no goal of that name goes to the savings account.
  const savings = goal ? null : await savingsAccount(userId, intent.goal, client);
  if (!goal && !savings) return `you don't have a goal called "${intent.goal}" yet.`;
  const amountCents =
    intent.amountCents === "savings" ? Math.round(savedSoFar / MONTHS) : intent.amountCents;
  if (amountCents <= 0) return "there's no saving yet to move.";
  if (!(await moneyPartnerFor(userId, { client })))
    return "moving money needs a money-movement partner, and none is connected yet.";
  const accounts = await scopedFor(userId, client).accounts.findMany({
    where: {
      type: "depository",
      subtype: "checking",
      NOT: { id: goal?.accountId ?? savings?.id ?? "" },
    },
    select: { id: true, name: true, currentBalanceCents: true },
    orderBy: [{ currentBalanceCents: "desc" }, { id: "asc" }],
  });
  const from = accounts[0];
  if (!from) return "there's no checking account to move it from.";
  const why = intent.amountCents === "savings" ? ", a month of what the steps before it save" : "";
  const to = goal
    ? { id: goal.id, name: goal.name, accountId: goal.accountId, label: `your ${goal.name} goal` }
    : { id: null, name: savings!.name, accountId: savings!.id, label: savings!.name };
  return {
    kind: "transfer",
    label: `Move ${formatCents(amountCents)} from ${from.name} to ${to.label}${why}`,
    goalId: to.id,
    goalName: to.name,
    fromAccountId: from.id,
    toAccountId: to.accountId,
    amountCents,
  };
}

// The person's savings account, when the words say savings ("savings", "my savings account").
async function savingsAccount(userId: string, words: string, client: PrismaClient) {
  if (!/\bsavings?\b/i.test(words)) return null;
  const accounts = await scopedFor(userId, client).accounts.findMany({
    where: { type: "depository", subtype: "savings" },
    select: { id: true, name: true },
    orderBy: [{ currentBalanceCents: "desc" }, { id: "asc" }],
  });
  return accounts[0] ?? null;
}

// Without a money-movement partner Jane can't move money in someone's bank, and neither can
// the team: a short guide for doing it themselves, and a reminder offer. She'll do it herself
// once a partner is connected.
export function moveGuideReply(amountCents: number | "savings", where: string): Reply {
  const amount = amountCents === "savings" ? "the amount" : formatCents(amountCents);
  return {
    body: [
      `I can't move money in your bank yet, but it takes a minute to do yourself: move ${amount} to ${where}.`,
      "1. Open your bank's app or website and find Transfers (or Move money).",
      `2. Choose your checking account to send from and ${where} to receive.`,
      `3. Enter ${amount}, pick today, and confirm.`,
      "Once a money-movement partner is connected, I'll do this myself, with your yes.",
    ].join("\n"),
    actions: [
      snoozeButton("Remind me tomorrow"),
      { id: "open", label: "See your accounts", kind: "link", href: "/net-worth" },
    ],
    refs: {},
  };
}

export async function planReply(
  userId: string,
  parts: readonly Intent[],
  options: Options,
): Promise<Reply> {
  const steps: MultiStep[] = [];
  let saved = 0;
  // Spec step 192: moving money alone, with no partner: how to do it yourself.
  const only = parts.length === 1 && parts[0].kind === "move_to_goal" ? parts[0] : null;
  if (only && !(await moneyPartnerFor(userId, { client: options.client }))) {
    return moveGuideReply(
      only.amountCents,
      `your ${only.goal}`.replace(/^your savings$/i, "your savings"),
    );
  }
  for (const part of parts) {
    if (part.kind === "move_to_goal") {
      const step = await transferStep(userId, part, saved, options);
      const said = part.amountCents === "savings" ? "moving the savings" : "that transfer";
      if (typeof step === "string") return cannot(`for ${said},`, step);
      steps.push(step);
      continue;
    }
    const reply = await options.answer(part);
    const yes = reply?.actions.find((a) => a.kind === "primary");
    if (!reply || !yes) {
      const why = reply ? `${firstSentence(reply.body)}.` : "I couldn't find it.";
      return cannot(`for "${partText(part)}",`, why);
    }
    const about = await aboutOf(userId, reply.refs, options.client);
    steps.push({
      kind: "chat",
      label: about.title ?? firstSentence(reply.body),
      action: yes.id as ActionId,
      actionLabel: yes.label,
      body: reply.body,
      refs: reply.refs,
      actions: reply.actions,
    });
    saved += about.savingCents ?? 0;
  }
  const n = steps.length;
  const confirm: MessageAction = {
    id: "multi.confirm",
    label: n === 1 ? "Yes, do it" : n === 2 ? "Do both" : `Do all ${n}`,
    kind: "primary",
  };
  return {
    body: [
      n === 1
        ? "I can do that once you say yes."
        : `I can do ${n === 2 ? "both" : `all ${n}`}, in this order, once you say yes.`,
      ...steps.map(
        (s, i) => `${i + 1}. ${s.kind === "chat" ? `${s.actionLabel}: ${s.label}` : s.label}.`,
      ),
      `Nothing happens until you tap "${confirm.label}". If a step fails, I stop there and tell you why.`,
    ].join("\n"),
    actions: [confirm, { id: "multi.cancel", label: "Cancel", kind: "secondary" }],
    refs: { multi: { steps } },
  };
}

function partText(intent: Intent): string {
  if (intent.kind === "act") return `${intent.verb} ${intent.target}`;
  if (intent.kind === "insurance")
    return `switch your ${intent.policyKind ?? ""} insurance`.replace("  ", " ");
  return intent.kind;
}
