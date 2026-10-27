import { ACTIVITY } from "@/config/activity";
import { SETTINGS_TAB, TABS } from "@/config/navigation";

// The founder view's words (/admin/activity): each recorded event as a short sentence, and a
// person's events grouped into visits. Pure, so the wording is tested.

export type ActivityItem = {
  at: Date;
  visitId: string;
  kind: string;
  path: string;
  role: string | null;
  label: string | null;
  data: unknown;
};

// A funnel event from analytics_events (decisions, links, uploads), shown in the same timeline.
export type FunnelItem = { at: Date; name: string; properties: unknown };

export type Line = { at: Date; text: string; warn: boolean };
export type Visit = { start: Date; end: Date; lines: Line[] };

const PAGE_NAMES: Record<string, string> = Object.fromEntries([
  ["/", "the landing page"],
  ...[...TABS, SETTINGS_TAB].map((t) => [t.href, t.label]),
]);

export function pageName(path: string): string {
  if (PAGE_NAMES[path]) return PAGE_NAMES[path];
  const last = path
    .split("/")
    .filter((s) => s && s !== ":id")
    .pop();
  if (!last) return path;
  const words = last.replaceAll("-", " ");
  return words.charAt(0).toUpperCase() + words.slice(1);
}

export function duration(ms: number): string {
  const s = Math.round(ms / 1000);
  if (s < 60) return `${s}s`;
  const m = Math.floor(s / 60);
  return m < 60 ? `${m}m ${s % 60}s` : `${Math.floor(m / 60)}h ${m % 60}m`;
}

const quoted = (label: string | null, fallback: string) => (label ? `'${label}'` : fallback);
const asData = (d: unknown) => (d && typeof d === "object" ? d : {}) as Record<string, unknown>;

// Null for what the view leaves out (focus alone, a blink of a page).
export function describeActivity(e: ActivityItem): Omit<Line, "at"> | null {
  const d = asData(e.data);
  const page = pageName(e.path);
  switch (e.kind) {
    case "page_view":
      return { text: `opened ${page}`, warn: false };
    case "page_time": {
      const ms = typeof d.ms === "number" ? d.ms : 0;
      return ms < 1000 ? null : { text: `spent ${duration(ms)} on ${page}`, warn: false };
    }
    case "click":
      return {
        text:
          e.role === "link"
            ? `tapped the link ${quoted(e.label, "with no label")}`
            : `clicked ${quoted(e.label, `a ${e.role ?? "button"} with no label`)}`,
        warn: false,
      };
    case "rage_click":
      return {
        text: `clicked ${quoted(e.label, "the same spot")} ${d.count ?? ACTIVITY.rageClicks} times fast (stuck?)`,
        warn: true,
      };
    case "submit": {
      const fields = Array.isArray(d.fields) ? d.fields.length : 0;
      const took = typeof d.ms === "number" ? `, after ${duration(d.ms)}` : "";
      const form = e.label ? `the '${e.label}' form` : "a form";
      return {
        text: `sent ${form} (${fields} field${fields === 1 ? "" : "s"} filled${took})`,
        warn: false,
      };
    }
    case "blur":
      if (d.typed !== true)
        return {
          text: `clicked into ${quoted(e.label, "a field")} and left it empty`,
          warn: false,
        };
      return {
        text: `typed in ${quoted(e.label, "a field")}${typeof d.length === "number" ? ` (${d.length} characters)` : ""}`,
        warn: false,
      };
    case "error":
      return { text: `saw an error: ${quoted(e.label, "no message")}`, warn: true };
    default:
      return null;
  }
}

// What a funnel event says, without amounts or anything typed (only its kind).
const FUNNEL_WORDS: Record<string, string> = {
  signup_completed: "signed up",
  signed_in: "signed in",
  link_started: "started linking a bank",
  link_succeeded: "linked a bank",
  link_failed: "couldn't link a bank",
  import_completed: "uploaded a statement",
  import_failed: "tried to upload a statement, and it failed",
  card_opened: "opened a card",
  decision_yes: "chose 'Yes' on a card",
  decision_no: "chose 'No' on a card",
  diy_started: "chose 'Do it myself' on a card",
  diy_done: "said they did it themselves",
  decision_undone: "undid an answer on a card",
  plan_yes_to_all: "said yes to the whole plan",
  digest_clicked: "came from the weekly email",
};
const SAFE_DETAILS = ["finding_type", "format", "rows", "row_count", "reason"];

export function describeFunnel(e: FunnelItem): Omit<Line, "at"> | null {
  // Page views are already in the activity log.
  if (e.name.endsWith("_viewed")) return null;
  const words = FUNNEL_WORDS[e.name] ?? e.name.replaceAll("_", " ");
  const p = asData(e.properties);
  const details = SAFE_DETAILS.filter((k) => typeof p[k] === "string" || typeof p[k] === "number")
    .map((k) => `${k.replaceAll("_", " ")}: ${String(p[k]).replaceAll("_", " ")}`)
    .join(", ");
  return {
    text: details ? `${words} (${details})` : words,
    warn: e.name.endsWith("_failed"),
  };
}

// Visits: a recorded tab visit, split where nothing happened for a long while. Funnel events
// join the visit they happened in, or stand as their own.
export function groupVisits(activity: ActivityItem[], funnel: FunnelItem[]): Visit[] {
  const lines = [
    ...activity.map((e) => ({ at: e.at, key: e.visitId, line: describeActivity(e) })),
    ...funnel.map((e) => ({ at: e.at, key: null, line: describeFunnel(e) })),
  ]
    .filter((x): x is { at: Date; key: string | null; line: Omit<Line, "at"> } => x.line !== null)
    .sort((a, b) => a.at.getTime() - b.at.getTime());

  const visits: (Visit & { key: string | null })[] = [];
  for (const { at, key, line } of lines) {
    const last = visits.at(-1);
    const gap = last ? at.getTime() - last.end.getTime() : Infinity;
    const same =
      last && gap < ACTIVITY.visitGapMs && (key === null || last.key === null || last.key === key);
    if (same) {
      last.end = at;
      last.key ??= key;
      last.lines.push({ at, ...line });
    } else {
      visits.push({ start: at, end: at, key, lines: [{ at, ...line }] });
    }
  }
  return visits.map(({ start, end, lines }) => ({ start, end, lines })).reverse();
}
