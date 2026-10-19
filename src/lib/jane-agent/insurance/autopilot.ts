import { AUTOPILOT_LEVELS } from "@/config/autopilot";
import { INSURANCE_AUTOPILOT } from "@/config/insurance";
import type { PrismaClient } from "@/generated/prisma/client";
import { autopilotOf } from "@/lib/autopilot";
import type { Reply } from "../replies";

// "What do you do with my insurance on your own?" (spec step 108): what Jane does by
// herself at the person's autopilot level, and what always needs their tap.

export function autopilotReply(level: string | null): Reply {
  const key =
    level === "ask" || level === "safe" || level === "all" || level === "custom" ? level : "none";
  const name =
    key === "custom"
      ? "your own rules"
      : key === "none"
        ? "no autopilot level yet"
        : `"${AUTOPILOT_LEVELS[key].label}"`;
  return {
    body: `With insurance, I do this by myself at ${name}. ${INSURANCE_AUTOPILOT[key]} I never buy, change or cancel cover without your tap.`,
    actions: [
      { id: "open", label: "See your insurance", kind: "link", href: "/insurance" },
      { id: "open", label: "Autopilot settings", kind: "link", href: "/settings#autopilot" },
    ],
    refs: {},
  };
}

export async function autopilotAnswer(
  userId: string,
  { client }: { client: PrismaClient },
): Promise<Reply> {
  return autopilotReply(await autopilotOf(userId, { client }));
}
