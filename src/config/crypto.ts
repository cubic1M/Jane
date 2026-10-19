// Crypto (spec step 161): seen and sized, never traded. Jane reads balances from an
// exchange or wallet connection (a stand-in until a crypto data partner is connected),
// counts them in net worth and the mix, and flags two things in demo advice mode: too much
// of what's invested in crypto, and an exchange charging a lot on each trade. There is no
// order path for crypto anywhere in Jane, at any autopilot level. FOR REVIEW.

// The assets Jane recognises, with their names. Anything else shows by its symbol.
export const CRYPTO_ASSETS: Readonly<Record<string, string>> = {
  BTC: "Bitcoin",
  ETH: "Ether",
  SOL: "Solana",
  USDC: "USD Coin",
};

export const isCryptoTicker = (ticker: string | null | undefined) =>
  Boolean(ticker && Object.hasOwn(CRYPTO_ASSETS, ticker.toUpperCase()));

// Above this share of everything invested (crypto included), Jane says so. A rule of thumb
// planners use for a speculative holding; FOR REVIEW with counsel and an adviser.
export const CRYPTO_SHARE_FLAG = 0.05;
export const CRYPTO_SHARE_SOURCE =
  "A planners' rule of thumb for speculative holdings (no more than about 5%); FOR REVIEW";

// An exchange's fees, as a share of what was traded over the last year, above which Jane
// flags them; and what low-cost exchanges charge (published fee schedules, ESTIMATE TO
// VERIFY), in basis points.
export const CRYPTO_FEE_FLAG_BPS = 100;
export const LOW_COST_CRYPTO_FEE_BPS = { low: 10, high: 60 } as const;
export const CRYPTO_FEE_SOURCE =
  "Published fee schedules of large exchanges (0.1% to 0.6% a trade); ESTIMATE TO VERIFY";
export const CRYPTO_FEE_DAYS = 365;

// A balance older than this is labelled as out of date.
export const CRYPTO_STALE_HOURS = 36;

// The kinds of connection: an exchange account, or a public wallet address (read-only:
// Jane never holds keys).
export const CRYPTO_CONNECTION_KINDS = {
  exchange: "Exchange",
  wallet: "Wallet",
} as const;
export type CryptoConnectionKind = keyof typeof CRYPTO_CONNECTION_KINDS;
