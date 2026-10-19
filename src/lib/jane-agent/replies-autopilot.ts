import {
  SECTOR_ALL_MEANS,
  SECTOR_LABELS,
  SECTOR_LEVEL_LABELS,
  type Sector,
  type SectorLevel,
} from "@/config/autopilot-sectors";
import { formatCents } from "@/lib/money";
import type { SectorAutopilot } from "@/lib/sector-autopilot";
import type { SectorIntent } from "./autopilot-intents";
import type { Reply } from "./replies";
import type { MessageAction } from "./types";

// One autopilot, every sector (spec step 141): what Jane does by herself, area by area, and
// a change typed in the chat, set only on the person's tap.

const settings: MessageAction = {
  id: "open",
  label: "Area by area",
  kind: "link",
  href: "/settings#sectors",
};

export function sectorLine(
  s: Pick<SectorAutopilot, "sector" | "level" | "actionCapCents" | "monthlyCapCents">,
) {
  const label = SECTOR_LABELS[s.sector];
  if (s.level === "ask") return `${label}: always asks`;
  return `${label}: ${SECTOR_LEVEL_LABELS[s.level].toLowerCase()}, up to ${formatCents(s.actionCapCents)} each time and ${formatCents(s.monthlyCapCents)} a month`;
}

export function overviewReply(sectors: SectorAutopilot[], global: string | null): Reply {
  if (global === "ask" || global === null) {
    return {
      body: "Right now I ask you before doing anything. Pick how much I may do in Settings, then set each area.",
      actions: [{ id: "open", label: "Settings", kind: "link", href: "/settings#autopilot" }],
      refs: {},
    };
  }
  return {
    body: [
      "Here's what I do by myself, area by area. Over a cap, I ask; free checks run everywhere.",
      ...sectors.map((s) => `- ${sectorLine(s)}`),
    ].join("\n"),
    actions: [settings],
    refs: {},
  };
}

const levelWords = (sector: Sector, level: SectorLevel) =>
  level === "all"
    ? `everything allowed (${SECTOR_ALL_MEANS[sector]})`
    : SECTOR_LEVEL_LABELS[level].toLowerCase();

export function sectorChangeReply(
  intent: Extract<SectorIntent, { kind: "autopilot_sector" }>,
  current: SectorAutopilot,
  global: string | null,
): Reply {
  if (global === "ask" || global === null) {
    return overviewReply([], global);
  }
  // As setSectorAutopilot will set them.
  const action =
    intent.actionCapCents ??
    (intent.monthlyCapCents !== null && current.actionCapCents === 0
      ? intent.monthlyCapCents
      : current.actionCapCents);
  const monthly = Math.max(intent.monthlyCapCents ?? current.monthlyCapCents, action);
  const caps =
    intent.level === "ask"
      ? ""
      : `, up to ${formatCents(action)} each time and ${formatCents(monthly)} a month`;
  return {
    body: `${SECTOR_LABELS[intent.sector]} would be ${levelWords(intent.sector, intent.level)}${caps}. Now it's ${sectorLine(current).split(": ")[1]}. Tap to set it; it takes effect at once.`,
    actions: [{ id: "autopilot.sector_set", label: "Set it", kind: "primary" }, settings],
    refs: {
      sectorChange: {
        sector: intent.sector,
        level: intent.level,
        ...(intent.actionCapCents !== null ? { actionCapCents: intent.actionCapCents } : {}),
        ...(intent.monthlyCapCents !== null ? { monthlyCapCents: intent.monthlyCapCents } : {}),
      },
    },
  };
}
