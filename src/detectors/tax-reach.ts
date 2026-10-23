import { TOOL_EXEMPT } from "@/config/detector-exempt";
import { PEOPLE, type PersonId } from "@/config/people";
import { buildProfile, type ProfileInput } from "@/profile/build";
import { inputFor } from "@/profile/sample";
import type { Detector } from "./contract";
import { DETECTORS, runDetectors } from "./index";

// The reach scoreboard for taxes (spec step 273): every tax tool, the detectors that bring it
// to people unasked, and which sample people it reaches through the year. A tax year has
// seasons (the IP PIN in January, filing in March, December's last chances), so the eight
// people's year of data is moved to each month in turn. A tool reaches no one only with a
// reason: it never suggests by itself (TOOL_EXEMPT), or it is raised from something the person
// has to give first (TAX_REACH_NEEDS_PERSON).

// Tax tools whose detector needs something only the person can give before it can fire: shown
// with the reason, and the tests attach that something.
export const TAX_REACH_NEEDS_PERSON: Readonly<Record<string, string>> = {
  tax_draft_check:
    "raised from a draft return the person uploads and confirms; the detector's tests attach a checked draft",
};

export type TaxToolReach = {
  tool: string;
  detectors: string[];
  // Who it reaches, and in which months ("Jan" ...).
  reached: { person: PersonId; months: string[] }[];
  exempt: string | null;
  needsPerson: string | null;
};

const MONTHS = [
  "Jan",
  "Feb",
  "Mar",
  "Apr",
  "May",
  "Jun",
  "Jul",
  "Aug",
  "Sep",
  "Oct",
  "Nov",
  "Dec",
] as const;

// A sample person's year moved whole to another date, so the same life is seen then.
export function movedTo(data: ProfileInput, today: string): ProfileInput {
  const days = Math.round((Date.parse(today) - Date.parse(data.today)) / 86_400_000);
  const move = (day: string) =>
    new Date(Date.parse(day) + days * 86_400_000).toISOString().slice(0, 10);
  return {
    ...data,
    today,
    transactions: data.transactions.map((t) => ({ ...t, date: move(t.date) })),
  };
}

// The 17th of each month of the sample's year, starting with the sample's own month.
export function yearOfDates(from: string): string[] {
  const y = Number(from.slice(0, 4));
  const m = Number(from.slice(5, 7));
  return Array.from({ length: 12 }, (_, i) => {
    const month = ((m - 1 + i) % 12) + 1;
    const year = y + Math.floor((m - 1 + i) / 12);
    return `${year}-${String(month).padStart(2, "0")}-17`;
  });
}

// tools: the taxes capability's tools (src/lib/jane-agent/capabilities), passed in so this stays
// free of the chat's modules.
export function taxReach(
  tools: readonly string[],
  detectors: readonly Detector[] = DETECTORS,
): TaxToolReach[] {
  // Who each tax topic reaches, month by month.
  const byTopic = new Map<string, Map<PersonId, Set<string>>>();
  for (const person of PEOPLE) {
    const base = inputFor(person.id);
    for (const day of yearOfDates(base.today)) {
      const data = movedTo(base, day);
      const fired = runDetectors({ profile: buildProfile(data), data }, detectors);
      for (const s of fired) {
        if (s.capability !== "taxes") continue;
        const people = byTopic.get(s.topic) ?? new Map<PersonId, Set<string>>();
        const months = people.get(person.id) ?? new Set<string>();
        months.add(MONTHS[Number(day.slice(5, 7)) - 1]);
        people.set(person.id, months);
        byTopic.set(s.topic, people);
      }
    }
  }
  return tools.map((tool) => {
    const covering = detectors.filter((d) => d.covers.includes(tool));
    const reached = new Map<PersonId, Set<string>>();
    for (const d of covering) {
      for (const [person, months] of byTopic.get(d.topic) ?? []) {
        const all = reached.get(person) ?? new Set<string>();
        for (const m of months) all.add(m);
        reached.set(person, all);
      }
    }
    return {
      tool,
      detectors: covering.map((d) => d.topic),
      reached: [...reached.entries()].map(([person, months]) => ({
        person,
        months: MONTHS.filter((m) => months.has(m)),
      })),
      exempt: TOOL_EXEMPT[tool] ?? null,
      needsPerson: TAX_REACH_NEEDS_PERSON[tool] ?? null,
    };
  });
}
