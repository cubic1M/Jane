import { MESSAGE_PRIORITY } from "@/config/agent-chat";
import { priceRiseLine } from "../replies-price-rises";
import type { MessageSource } from "./source";

// Price rises seen before they land (spec step 243): one heads-up for each, a month or more
// before the higher price, with the cheaper choice and the call script.
export const priceRisesSource: MessageSource = {
  key: "price_rises",
  gather(snapshot) {
    return (snapshot.priceRises ?? [])
      .filter((r) => r.daysLeft >= 0)
      .map((r) => ({
        kind: "heads_up" as const,
        body: `${priceRiseLine(r)}\nWhat to say: "${r.script}"`,
        refs: {},
        actions: [
          { id: "price.called" as const, label: "I called", kind: "primary" as const },
          {
            id: "open" as const,
            label: "See deadlines",
            kind: "link" as const,
            href: "/deadlines",
          },
        ],
        dedupeKey: r.key,
        priority: MESSAGE_PRIORITY.price_rises,
      }));
  },
};
