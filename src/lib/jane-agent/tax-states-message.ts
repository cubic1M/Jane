import { formatWholeDollars } from "@/lib/money";
import { LOCAL_TAXES, STATE_SOURCES } from "@/config/tax-states";
import type { TaxEstimateView } from "@/lib/tax-estimate";
import type { ResidencyView } from "@/lib/tax-states";
import { stateName } from "@/planning/tax-profile";
import {
  localitiesIn,
  workStateTaxesRemoteWages,
  type Move,
  type StatePart,
} from "@/planning/tax-states";
import { snoozeButton } from "./sources/source";
import { type MessageAction, openLink, type MessageParts } from "./types";
import { dayLabel } from "@/lib/day-label";

// State and local taxes in the chat (spec step 165): a move Jane spotted (at the levels
// that let it act, already counted), a move on the life-events checklist, the city income
// tax question, and the answer to "what state taxes do I pay".

const STATES_HREF = "/taxes/profile#states";
const LOCAL_BUTTONS = ["tax.local_1", "tax.local_2"] as const;

const name = (code: string) => stateName(code) ?? code;

export const moveLine = (m: Move) => `from ${name(m.from)} to ${name(m.to)} on ${dayLabel(m.date)}`;

export function spottedMoveMessage(residency: ResidencyView): MessageParts | null {
  const m = residency.spotted;
  if (!m) return null;
  const why = `your payments to state agencies switched from ${name(m.from)} to ${name(m.to)} then`;
  const body = residency.usingSpotted
    ? `It looks like you moved ${moveLine(m)}: ${why}. I've counted your ${residency.year} state taxes that way, split between the two states. Is that right?`
    : `It looks like you moved ${moveLine(m)}: ${why}. Is that right? A move splits your ${residency.year} state taxes between the two states.`;
  return {
    body,
    refs: { taxMove: m, taxYear: residency.year },
    actions: [
      { id: "tax.move_yes", label: "Yes, I moved", kind: "primary" },
      { id: "tax.move_no", label: "No, same state", kind: "secondary" },
      openLink("Change the date", STATES_HREF),
    ],
  };
}

// A move started on the checklist, when Jane can't see where to.
export function movingEventMessage(residency: ResidencyView, state: string | null): MessageParts {
  const here = state ? ` from ${name(state)}` : "";
  return {
    body: `You started a move on ${dayLabel(residency.movingEvent!)}. Did you move${here} to another state? A move splits your ${residency.year} state taxes, so I'd like the date and the new state.`,
    refs: { taxYear: residency.year },
    actions: [
      openLink("Tell me where", STATES_HREF),
      { id: "tax.move_no", label: "Same state", kind: "secondary" },
    ],
  };
}

// "Do you live in New York City or Yonkers?", one button each, and "Neither".
export function localityMessage(state: string): MessageParts | null {
  // At most two a state (LOCAL_TAXES), one button each by position.
  const places = localitiesIn(state).slice(0, LOCAL_BUTTONS.length);
  if (places.length === 0) return null;
  const list = places.map((p) => p.label).join(" or ");
  const one = places.length === 1;
  return {
    body: `Do you live in ${list}? ${one ? "It has its" : "They have their"} own income tax on top of ${name(state)}'s, which I'd add to your estimate.`,
    refs: { taxLocals: places.map((p) => p.key) },
    actions: [
      ...places.map((p, i): MessageAction => ({
        id: LOCAL_BUTTONS[i],
        label: p.label,
        kind: "primary",
      })),
      { id: "tax.local_no", label: "Neither", kind: "secondary" },
      snoozeButton(),
    ],
  };
}

function partLine(p: StatePart, year: number): string {
  const where =
    p.residence === "nonresident"
      ? `as a nonresident, on wages from your employer there`
      : p.residence === "part_year"
        ? `lived there ${dayLabel(p.from!)} to ${dayLabel(p.to!)}`
        : `all of ${year}`;
  if (p.kind === "none") return `${name(p.code)} (${where}): no income tax.`;
  const credit =
    p.creditCents > 0
      ? `, after a credit of about ${formatWholeDollars(p.creditCents)} for tax paid to another state`
      : "";
  return `${name(p.code)} (${where}): about ${formatWholeDollars(p.taxCents)} on about ${formatWholeDollars(p.incomeCents)} of income${credit}.${p.rough ? " A rough rate: its own brackets aren't in Jane yet." : ""}`;
}

export function statesReply(view: TaxEstimateView): MessageParts {
  const state = view.estimate.state;
  if (!state) {
    return {
      body: "I don't know which state you file in yet. Tell me on your tax profile and I'll work out your state taxes.",
      refs: {},
      actions: [openLink("Set my state", STATES_HREF)],
    };
  }
  const lines = state.parts.map((p) => partLine(p, view.year));
  if (state.local) {
    lines.push(
      `${state.local.label}: about ${formatWholeDollars(state.local.taxCents)} of city tax.`,
    );
  }
  const sources = [
    ...state.parts.map((p) => STATE_SOURCES[p.code]?.agency).filter(Boolean),
    ...(state.local ? [LOCAL_TAXES[state.local.key]?.source] : []),
  ];
  const told =
    view.residency.inUse.length === 0 && !view.residency.workState
      ? " Moved or work for an employer in another state? Tell me and I'll split it."
      : "";
  return {
    body: `Your ${view.year} state taxes come to about ${formatWholeDollars(state.taxCents)}, estimated.\n${lines.map((l) => `• ${l}`).join("\n")}\nFigures from ${sources.join("; ")}, for review.${told}`,
    refs: {},
    actions: [openLink("Where I lived", STATES_HREF)],
  };
}

// "I moved from California to New York in June": the move, to save with one tap. A month
// later in the year than now means last year; a month without a day, the 1st.
export function moveReply(
  intent: { from: string | null; to: string; month: number | null; day: number | null },
  profileState: string | null,
  now: Date,
): MessageParts {
  const from = intent.from ?? profileState;
  const example = `"I moved from ${from ? name(from) : "California"} to ${name(intent.to)} on June 15"`;
  if (!from || from === intent.to) {
    return {
      body: `Which state did you move from? Say it like ${example}.`,
      refs: {},
      actions: [],
    };
  }
  if (intent.month === null) {
    return { body: `When did you move? Say it like ${example}.`, refs: {}, actions: [] };
  }
  const thisYear = now.getUTCFullYear();
  const year = intent.month > now.getUTCMonth() + 1 ? thisYear - 1 : thisYear;
  const last = new Date(Date.UTC(year, intent.month, 0)).getUTCDate();
  const day = Math.min(Math.max(intent.day ?? 1, 1), last);
  const date = `${year}-${String(intent.month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
  const move = { date, from, to: intent.to };
  const guessed = intent.day === null ? " (I've put the 1st; change it if you know the day)" : "";
  return {
    body: `You moved ${moveLine(move)}, ${year}${guessed}? I'll split your ${year} state taxes: wages by where you lived on each payday, other income by the days you lived in each state.`,
    refs: { taxMove: move, taxYear: year },
    actions: [
      { id: "tax.move_set", label: "Yes, save it", kind: "primary" },
      openLink("Change the date", STATES_HREF),
    ],
  };
}

// "I work remotely for a company in New York".
export function workStateReply(work: string, home: string | null): MessageParts {
  if (work === home) {
    return {
      body: `Your employer's in ${name(work)}, the same state you live in, so there's nothing to split.`,
      refs: {},
      actions: [],
    };
  }
  const where = home ? name(home) : "your home state";
  const rule = workStateTaxesRemoteWages(work, home ?? "")
    ? `${name(work)} taxes the wages of people who work from home for employers there, so it and ${where} both tax them; ${where} gives a credit for ${name(work)}'s tax, so you don't pay twice in full.`
    : `${name(work)} doesn't tax wages for work you do from home in ${where}, so they're taxed by ${where} (days you work in ${name(work)} itself can be taxed there).`;
  return {
    body: `${rule} Save ${name(work)} as your employer's state?`,
    refs: { taxWorkState: work },
    actions: [
      { id: "tax.work_set", label: "Yes, save it", kind: "primary" },
      openLink("Where I lived", STATES_HREF),
    ],
  };
}
