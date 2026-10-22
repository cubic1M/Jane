import type { SuggestionTopic } from "@/config/people";

// The practice portfolio's cards in the chat (spec step 296, Phase AW, Stage A). Each card is
// short; More details holds the rule, the numbers, the caps and how sure Jane is. A card's
// button only opens the details or the pause switch: nothing real is ever bought.

// Cards show what the scan and the autopilot did in this many days.
export const PRACTICE_CARD_DAYS = 7;

// The pause switch, where a card's button goes.
export const PAUSE_HREF = "/investments/practice#pause";

// The autopilot's own trades (buying the model, rebalancing) follow a fixed rule.
export const AUTOPILOT_CONFIDENCE = {
  percent: 90,
  reason: "A fixed rule for your level: it keeps the mix on target, whatever prices do next.",
};

export const PRACTICE_NOTE = "Practice money: nothing real was bought or sold.";

// "Set up your practice portfolio" (the detector): who it is for. Someone still building up,
// not in debt trouble, without a taxable investment account of their own yet, and without a
// practice portfolio. Close to or in retirement, real money has a plan already.
export const PRACTICE_SUGGEST_STAGES: readonly string[] = ["starting", "raising", "peak"];
export const PRACTICE_TOPIC: SuggestionTopic = "practice_portfolio";
// Accounts that mean the person already invests on their own.
export const OWN_INVESTING_SUBTYPES: readonly string[] = ["brokerage"];
// What it's worth (a "risk" worth: a loss met on practice money instead of real money): a fall
// of this share of the practice starting money, about the 2022 slide for a Medium model in the
// sample market. FOR REVIEW.
export const PRACTICE_SUGGEST_FALL_SHARE = 0.25;
