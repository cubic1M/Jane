import type { PrismaClient } from "@/generated/prisma/client";
import { db as defaultClient } from "@/lib/db";
import { scopedFor } from "@/lib/db-scoped";
import { ITEM_STATUS } from "./sync";

// What a linked bank needs from the person, said calmly and honestly (the founder: "Your bank
// needs you to sign in again"): a sign-in (Link's update mode), new accounts to share, or an
// outage that left the data behind, each with how old the data is. Pure, but for the loader.

const HOUR_MS = 60 * 60 * 1000;

// "3 days ago", "yesterday", "5 hours ago": how old something is, in words.
export function updatedAgo(when: Date | null, now: Date): string {
  if (!when) return "not yet";
  const hours = Math.floor((now.getTime() - when.getTime()) / HOUR_MS);
  if (hours < 1) return "just now";
  if (hours < 24) return hours === 1 ? "an hour ago" : `${hours} hours ago`;
  const days = Math.floor(hours / 24);
  return days === 1 ? "yesterday" : `${days} days ago`;
}

// Plaid's error codes, in plain words: what happened at the bank.
function troubleWords(code: string): string {
  if (
    /^INSTITUTION_(DOWN|NOT_RESPONDING|NOT_AVAILABLE)$/.test(code) ||
    code === "PLANNED_MAINTENANCE"
  )
    return "isn't answering right now";
  if (code.endsWith("_LIMIT") || code === "RATE_LIMIT") return "asked us to slow down";
  return "couldn't be read the last time we tried";
}

export type BankItem = {
  id: string;
  name: string | null;
  status: string;
  lastSyncedAt: Date | null;
  newAccountsAvailable: boolean;
  lastErrorCode: string | null;
};

export type BankNotice = {
  itemId: string;
  kind: "sign_in" | "new_accounts" | "trouble";
  title: string;
  words: string;
  // Opens Plaid Link in update mode for this bank.
  action: string | null;
};

export function bankNotices(items: readonly BankItem[], now: Date): BankNotice[] {
  return items.flatMap((item): BankNotice[] => {
    const name = item.name ?? "Your bank";
    const age = `What you see from there was last updated ${updatedAgo(item.lastSyncedAt, now)}.`;
    if (item.status === ITEM_STATUS.loginRequired)
      return [
        {
          itemId: item.id,
          kind: "sign_in",
          title: "Your bank needs you to sign in again",
          words: `${name} paused sharing until you sign in. Nothing is wrong with your money. ${age}`,
          action: "Sign in again",
        },
      ];
    const notices: BankNotice[] = [];
    if (item.newAccountsAvailable)
      notices.push({
        itemId: item.id,
        kind: "new_accounts",
        title: `${name} has accounts you haven't shared`,
        words: "Choose which to share, and Jane counts them too.",
        action: "Choose accounts",
      });
    if (item.lastErrorCode)
      notices.push({
        itemId: item.id,
        kind: "trouble",
        title: `${name} ${troubleWords(item.lastErrorCode)}`,
        words: `${age} Jane tries again on its own; there's nothing you need to do.`,
        action: null,
      });
    return notices;
  });
}

export async function loadBankNotices(
  userId: string,
  { client = defaultClient, now = new Date() }: { client?: PrismaClient; now?: Date } = {},
): Promise<BankNotice[]> {
  const items = await scopedFor(userId, client).plaidItems.findMany({
    select: {
      id: true,
      institutionName: true,
      status: true,
      lastSyncedAt: true,
      newAccountsAvailable: true,
      lastErrorCode: true,
    },
    orderBy: { createdAt: "asc" },
  });
  return bankNotices(
    items.map((i) => ({ ...i, name: i.institutionName })),
    now,
  );
}
