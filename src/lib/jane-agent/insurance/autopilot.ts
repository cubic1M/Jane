import { AUTOPILOT_LEVELS } from "@/config/autopilot";
import { INSURANCE_AUTOPILOT } from "@/config/insurance";
import { READ_ONLY_INSURANCE } from "@/config/read-only-beta";
import type { PrismaClient } from "@/generated/prisma/client";
import { autopilotOf } from "@/lib/autopilot";
import { conciergeMode } from "@/lib/concierge-mode";
import { autopilotFor, type SectorAutopilot } from "@/lib/sector-autopilot";
import type { Reply } from "../replies";
import { byHerself } from "../replies-autopilot";

// "What do you do with my insurance on your own?" (spec step 108): what Jane keeps up at the
// person's autopilot level, then what the Insurance area's own setting lets it buy or switch
// on its own (spec step 141), so the answer matches what it does.

export function autopilotReply(
  level: string | null,
  insurance: Pick<SectorAutopilot, "sector" | "level" | "actionCapCents" | "monthlyCapCents">,
): Reply {
  const key =
    level === "ask" || level === "safe" || level === "all" || level === "custom" ? level : "none";
  const at =
    key === "custom"
      ? " under your own rules"
      : key === "none"
        ? ""
        : ` at "${AUTOPILOT_LEVELS[key].label}"`;
  return {
    body: `With insurance, here's what I do by myself${at}. ${INSURANCE_AUTOPILOT[key]} ${byHerself(insurance)}`,
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
  if (!(await conciergeMode(userId, { client }))) {
    return {
      body: READ_ONLY_INSURANCE.body,
      actions: [{ id: "open", label: "See your insurance", kind: "link", href: "/insurance" }],
      refs: {},
    };
  }
  const [level, insurance] = await Promise.all([
    autopilotOf(userId, { client }),
    autopilotFor(userId, "insurance", { client }),
  ]);
  return autopilotReply(level, insurance);
}
