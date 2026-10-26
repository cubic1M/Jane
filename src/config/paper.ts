import type { BoardStatus } from "@/lib/investments/strategy-board";

// The paper account (src/lib/paper/): simulated money run by the person's chosen strategy on
// real daily closes. Every number here is FOR REVIEW. Never a real order.

// The starting balance offered, and the range a person may pick.
export const PAPER_DEFAULT_START_CENTS = 1_000_000;
export const PAPER_MIN_START_CENTS = 10_000;
export const PAPER_MAX_START_CENTS = 100_000_000;

// The rule asks to trade a fund only when it is this share of the account off its target, and
// never for less than PAPER_MIN_TRADE_CENTS.
export const PAPER_BAND = 0.02;
export const PAPER_MIN_TRADE_CENTS = 2_500;

// How far back a strategy's closes are read (its longest look-back with room for holidays), and
// how stale a run may be before opening the investments page runs it again.
export const PAPER_HISTORY_DAYS = 560;
export const PAPER_RUN_EVERY_HOURS = 6;

// How sure the pop-up says Jane is that a rule's trade is worth making, by how the research rates
// the strategy at the person's level (src/config/catalog-evidence.ts). News ideas carry their own.
export const PAPER_RULE_CONFIDENCE: Readonly<Record<BoardStatus, number>> = {
  default: 70,
  recommended: 75,
  watch: 55,
  tested: 40,
  lost: 20,
};

// What a real account's pop-up says it is (CLAUDE.md: real accounts never get advice).
export const SIMULATED_LABEL = "Simulated, not advice";
