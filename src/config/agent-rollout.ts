import type { ActionType } from "@/generated/prisma/client";
import type { Sector } from "@/config/autopilot-sectors";

// How the email agent starts on real accounts (Stage 2 of the roadmap): low-risk requests first, one
// yes per action, then a one-tap standing permission per area, always with an undo window. None of
// this runs for a real account yet: CONCIERGE_ACTIONS.realAccounts is false. AGENT_REHEARSAL=1 makes
// the demo bank and the simulated company follow the same rules, so it can be walked end to end.

// The first requests: nothing lost if they go wrong.
export const AGENT_FIRST_TYPES: readonly ActionType[] = [
  "cancel_subscription",
  "recover_bank_fees",
];

export const agentRehearsal = () => process.env.AGENT_REHEARSAL === "1";

// A one-tap standing permission, per area. FOR REVIEW. What a tap sets, the person can change in
// Settings. Money a sector moves is held by the sector's own delay; what the agent does on a rule's
// yes waits AGENT_HOLD_HOURS, and can be taken back on /plan.
export const STANDING_AREAS: readonly {
  sector: Sector;
  label: string;
  covers: string;
  actionCapCents: number;
  monthlyCapCents: number;
  // The standing rules (src/config/rules.ts) a tap turns on.
  rules: readonly string[];
}[] = [
  {
    sector: "bills",
    label: "Fees and double charges",
    covers: "Ask for bank fees and double charges back",
    actionCapCents: 12_000,
    monthlyCapCents: 50_000,
    rules: ["recover_bank_fees", "refund_double_charges", "refund_unwanted_charges"],
  },
  {
    sector: "debt",
    label: "Cards and debt",
    covers: "Pay what's due toward a plan you set",
    actionCapCents: 10_000,
    monthlyCapCents: 30_000,
    rules: ["lower_card_interest"],
  },
  {
    sector: "insurance",
    label: "Insurance",
    covers: "Make the cover changes you've chosen",
    actionCapCents: 5_000,
    monthlyCapCents: 10_000,
    rules: [],
  },
  {
    sector: "taxes",
    label: "Taxes",
    covers: "Pay estimated tax on its date",
    actionCapCents: 50_000,
    monthlyCapCents: 100_000,
    rules: [],
  },
  {
    sector: "investing",
    label: "Investing",
    covers: "Invest new cash in your target mix",
    actionCapCents: 50_000,
    monthlyCapCents: 100_000,
    rules: [],
  },
  {
    sector: "goals",
    label: "Goals and savings",
    covers: "Move money to your own savings",
    actionCapCents: 50_000,
    monthlyCapCents: 100_000,
    rules: [],
  },
];
