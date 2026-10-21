import { scopedFor } from "@/lib/db-scoped";
import type { ActionId, MessageAction } from "../types";
import { ChatActionError, linksOf, type ActionHandler } from "./handler";
import { takeChatAction } from "./index";

// Spec step 92: the Yes buttons on a message bundling findings of one kind ("3 subscriptions
// you could cancel"), one per finding. Each is that finding's own Yes, on its own (hidden)
// message, through takeChatAction, so every check and every effect is the same as a Yes on
// the finding by itself. The bundle stays open until each has been answered. The morning
// agenda (spec step 184) uses the same buttons for whatever it lists: each runs its item's
// own button (refs.items[n].action).

function bundleYes(n: 1 | 2 | 3 | 4 | 5, no = false): ActionHandler {
  return {
    id: (no ? `bundle.no.${n}` : `bundle.${n}`) as ActionId,
    on: "open",
    async run({ userId, message, action, client, now }) {
      const item = message.refs.items?.[n - 1];
      if (!item)
        throw new ChatActionError("failed", "Something went wrong. Open the plan instead.");
      const row = await scopedFor(userId, client).janeMessages.findFirst({
        where: { dedupeKey: item.dedupeKey },
        select: { id: true },
      });
      if (!row) throw new ChatActionError("not_found", "That one isn't there anymore.");
      let note: string;
      let detail: MessageAction[] = [];
      try {
        const { message: answered } = await takeChatAction(
          userId,
          row.id,
          (no ? item.no : item.action) ?? "finding.yes",
          {
            client,
            now,
          },
        );
        note = answered.refs.note ?? "Got it.";
        // Spec step 265: the page behind a suggestion opens from the agenda once it's said yes.
        detail = linksOf(answered.actions);
      } catch (error) {
        if (!(error instanceof ChatActionError) || error.code !== "not_open") throw error;
        note = "You'd already answered that one.";
      }
      const noId = (m: number) => `bundle.no.${m}`;
      // Answering an item takes its Yes and its Not-for-me away together.
      const sibling = no ? `bundle.${n}` : noId(n);
      const left = message.actions.filter(
        (a) => a.id !== action.id && a.id !== sibling && a.kind !== "link",
      );
      const name = item.label.replace(/^Yes: /, "");
      return {
        status: left.length > 0 ? "open" : "answered",
        answeredWith: left.length > 0 ? null : "All answered",
        note: `${name}: ${note}`,
        actions: [...left, ...linksOf(message.actions), ...detail],
      };
    },
  };
}

export const bundleYes1 = bundleYes(1);
export const bundleYes2 = bundleYes(2);
export const bundleYes3 = bundleYes(3);
export const bundleYes4 = bundleYes(4);
export const bundleYes5 = bundleYes(5);
export const bundleNo1 = bundleYes(1, true);
export const bundleNo2 = bundleYes(2, true);
export const bundleNo3 = bundleYes(3, true);
export const bundleNo4 = bundleYes(4, true);
export const bundleNo5 = bundleYes(5, true);
