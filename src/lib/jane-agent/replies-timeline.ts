import { formatCents } from "@/lib/money";
import type { TimelineEntry } from "@/lib/timeline";
import type { Reply } from "./replies";
import { dateAndDays } from "./sources/source";
import { DAY_MS } from "@/lib/dates";

// "Why did you do that?" and "show me everything you did" (spec step 187), from the same
// record as /jane: what Jane did, when, why, and the money involved.

const SHOWN = 5;

function when(entry: TimelineEntry, asOf: string): string {
  const day = entry.at.toISOString().slice(0, 10);
  const ago = Math.round(
    (Date.parse(`${asOf}T00:00:00Z`) - Date.parse(`${day}T00:00:00Z`)) / DAY_MS,
  );
  return ago <= 0
    ? "today"
    : ago === 1
      ? "yesterday"
      : dateAndDays(day, asOf).replace(/ \(.*\)$/, "");
}

const line = (e: TimelineEntry, asOf: string) =>
  `${when(e, asOf)}: ${e.what.replace(/[.]$/, "")}${e.cents ? ` (${formatCents(e.cents)})` : ""}`;

export function timelineReply(entries: TimelineEntry[], why: boolean, asOf: string): Reply {
  const open = {
    id: "open" as const,
    label: "Everything Jane did",
    kind: "link" as const,
    href: "/jane#activity",
  };
  if (entries.length === 0) {
    return {
      body: "I haven't done anything by myself yet. When I do, it will be listed here with why.",
      actions: [open],
      refs: {},
    };
  }
  if (why) {
    const [latest] = entries;
    return {
      body: `${line(latest, asOf)}. ${latest.why}`,
      actions: [
        ...(latest.undoHref
          ? [
              {
                id: "open" as const,
                label: "Undo it",
                kind: "link" as const,
                href: latest.undoHref,
              },
            ]
          : []),
        open,
      ],
      refs: {},
    };
  }
  const shown = entries.slice(0, SHOWN);
  return {
    body: [
      entries.length > SHOWN
        ? `Here are my latest ${SHOWN} of ${entries.length}, each with why on the page.`
        : `Here's everything I've done, newest first.`,
      ...shown.map((e) => `- ${line(e, asOf)}`),
    ].join("\n"),
    actions: [open],
    refs: {},
  };
}
