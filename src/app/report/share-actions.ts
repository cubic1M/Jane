"use server";

import type { ShareCard } from "@/lib/share-card";
import { currentCard } from "@/lib/share-current";
import { recordInviteSent, shareLinkFor, type ShareMethod } from "@/lib/share-invites";
import { requireUser } from "@/lib/session";

// The report's Share button (./share-button.tsx): the person's link with the card worked out
// here from their own numbers (never what the browser says), then a count once it's sent.

export type PreparedShare = { path: string; card: ShareCard } | { error: string };

export async function prepareShare(): Promise<PreparedShare> {
  const user = await requireUser();
  const card = await currentCard(user.id);
  if (!card) return { error: "There's nothing to share yet." };
  const link = await shareLinkFor(user.id, card);
  if (!link) return { error: "Sharing isn't on for this account." };
  return { path: link.path, card: link.card };
}

export async function shareSent(method: ShareMethod): Promise<void> {
  const user = await requireUser();
  if (method !== "share_sheet" && method !== "copy") return;
  await recordInviteSent(user.id, method);
}
