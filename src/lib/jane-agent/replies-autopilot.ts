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

// One autopilot, every sector (spec step 141): what Jane does on its own, area by area, and
// a change typed in the chat, set only on the person's tap.

const settings: MessageAction = {
  id: "open",
  label: "Area by area",
  kind: "link",
  href: "/settings#sectors",
};

type SectorSettingView = Pick<
  SectorAutopilot,
  "sector" | "level" | "actionCapCents" | "monthlyCapCents"
>;

export function sectorLine(s: SectorSettingView) {
  const label = SECTOR_LABELS[s.sector];
  if (s.level === "ask") return `${label}: always asks`;
  return `${label}: ${SECTOR_LEVEL_LABELS[s.level].toLowerCase()}, up to ${formatCents(s.actionCapCents)} each time and ${formatCents(s.monthlyCapCents)} a month`;
}

// What an area does by itself at its own level (spec step 141), as one sentence. Every sector's
// page and answer about its autopilot ends with it, so they always say what Jane really does:
// the same setting mayAct reads (docs/feature-audit.md, cluster 1).
export function byHerself(s: SectorSettingView): string {
  const label = SECTOR_LABELS[s.sector];
  const caps = `up to ${formatCents(s.actionCapCents)} each time and ${formatCents(s.monthlyCapCents)} a month`;
  if (s.level === "all") {
    return `${label} is set to everything allowed: I ${SECTOR_ALL_MEANS[s.sector]} by myself, ${caps}, and ask you about anything over that.`;
  }
  if (s.level === "safe") {
    return `${label} is set to the safe stuff, ${caps}: I only do by myself what can't cost you, and ask you about the rest.`;
  }
  return `${label} is set to always ask: I don't ${SECTOR_ALL_MEANS[s.sector]} or change anything else without your tap.`;
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
