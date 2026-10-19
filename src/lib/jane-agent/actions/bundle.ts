import { scopedFor } from "@/lib/db-scoped";
import type { ActionId } from "../types";
import { ChatActionError, linksOf, type ActionHandler } from "./handler";
import { takeChatAction } from "./index";

// Spec step 92: the Yes buttons on a message bundling findings of one kind ("3 subscriptions
// you could cancel"), one per finding. Each is that finding's own Yes, on its own (hidden)
// message, through takeChatAction, so every check and every effect is the same as a Yes on
// the finding by itself. The bundle stays open until each has been answered. The morning
// agenda (spec step 184) uses the same buttons for whatever it lists: each runs its item's
// own button (refs.items[n].action).

function bundleYes(n: 1 | 2 | 3 | 4 | 5): ActionHandler {
  return {
    id: `bundle.${n}` as ActionId,
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
      try {
        const { message: answered } = await takeChatAction(
          userId,
          row.id,
          item.action ?? "finding.yes",
          {
            client,
            now,
          },
        );
        note = answered.refs.note ?? "Got it.";
      } catch (error) {
        if (!(error instanceof ChatActionError) || error.code !== "not_open") throw error;
        note = "You'd already answered that one.";
      }
      const left = message.actions.filter((a) => a.id !== action.id && a.kind !== "link");
      const name = item.label.replace(/^Yes: /, "");
      return {
        status: left.length > 0 ? "open" : "answered",
        answeredWith: left.length > 0 ? null : "All answered",
        note: `${name}: ${note}`,
        actions: [...left, ...linksOf(message.actions)],
      };
    },
  };
}

export const bundleYes1 = bundleYes(1);
export const bundleYes2 = bundleYes(2);
export const bundleYes3 = bundleYes(3);
export const bundleYes4 = bundleYes(4);
export const bundleYes5 = bundleYes(5);
