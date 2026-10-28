// The cost of selling after a big drop (investing, a fact about the person's own trades): a sale
// counts as "after a drop" when the price had fallen at least this share from its highest close in
// the days before, and what it cost is what those shares would be worth today above what they
// were sold for. A fact, never a prediction: it looks only backward, at the person's own sales.
export const PANIC_DROP_SHARE = 0.15;
export const PANIC_LOOKBACK_DAYS = 90;
// Sales older than this aren't looked at (the price history asked for stays short).
export const PANIC_HISTORY_DAYS = 800;
// A sale under this is too small to be worth a line.
export const PANIC_MIN_SALE_CENTS = 10_000;
