// Fully automatic investing (spec step 164): at "Everything allowed" for the investing
// sector (src/config/autopilot-sectors.ts), with the person's own caps, Jane rebalances,
// invests new cash and harvests losses by herself through the simulated brokerage. Every
// move needs the sector level AND to fit the action cap and the month's cap; anything
// above either asks first, as before. FOR REVIEW: automatic trading needs a registered
// adviser and a real brokerage before it goes near real accounts (REAL_ACCOUNT_ADVICE).

// New cash: brokerage cash beyond this stays as a cushion; invest only a move this big.
export const AUTO_CASH_BUFFER_CENTS = 100_000;
export const AUTO_MIN_INVEST_CENTS = 5_000;
// Harvest only a loss at least this big (step 124's HARVEST_MIN_LOSS_CENTS applies too),
// from this day of the year (MM-DD), never with a wash-sale risk.
export const AUTO_HARVEST_FROM = "10-01";
// The monthly summary covers this many days back and goes out once a month.
export const AUTO_SUMMARY_DAYS = 31;
export const AUTO_SECTOR = "investing" as const;
