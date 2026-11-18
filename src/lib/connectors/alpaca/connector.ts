import { isCryptoTicker } from "@/config/crypto";
import { NoCryptoOrders } from "@/lib/brokerage/partner";
import { SIMULATED, cancelUntil, cents, dollars, sandboxRef, text } from "../sandbox/shared";
import { BadRequest, type ActionDraft, type Connector } from "../types";

// Alpaca's Broker API (read connectors, 11-18; docs.alpaca.markets, read 2026-11-17): opening an
// account in the person's name, a buy after their yes, and sweeping uninvested cash into Alpaca's
// FDIC bank sweep. SANDBOX ONLY: there is no real Alpaca connector, and none may be registered while
// REAL_TRADING, REAL_MONEY_MOVEMENT and REAL_ACCOUNT_ADVICE are false. Acting for a person needs a
// broker agreement with Alpaca, counsel on whether suggesting and placing an order needs a broker or
// adviser registration (connectors-final-A), and a reviewed recommendation (HUMAN_REVIEW_READY).
//
// What's reused: crypto is refused by the brokerage's own refuseCrypto (src/lib/brokerage/
// partner.ts) before anything, in the plan and again at the order (./api.ts). The order shape,
// a market buy by dollar amount for the day, matches the never-run mock in draft #1197, read again
// against Alpaca's reference. Kept apart: the paper account (src/lib/paper/) stays simulated money
// with its own pop-up and never reaches these; the brokerage stand-in (simulatedBrokerage) still
// fills the investing pages' taps.
//
// Opening an account needs the person's government id, date of birth and identity documents in
// Alpaca's request; that isn't built (counsel and a design of its own), so the twin only simulates
// it. Alpaca's sweep enrollment is described in its blog, not its reference: simulated too.

const ACCOUNT_TYPES = {
  individual: "Individual",
  roth_ira: "Roth IRA",
  traditional_ira: "Traditional IRA",
} as const;

// Opening an account or turning on the cash sweep: no pick, nothing bought.
export const sandboxAlpacaAccount: Connector = {
  id: "sandbox_alpaca_account",
  name: "An investment account in your name, through Alpaca (sandbox)",
  category: "investing",
  capabilities: ["prefill", "act"],
  scopes: ["open_accounts"],
  sandbox: true,
  movesMoney: true,
  prefill: (details): ActionDraft => {
    if (details.kind === "cash_sweep") {
      const account = text(details, "account");
      return {
        kind: "cash_sweep",
        amountCents: 0,
        summary: `Sweep the uninvested cash in ${account} into FDIC-insured program banks`,
        steps: [
          { label: "Account", value: account },
          {
            label: "Does",
            value: "Moves cash you haven't invested to program banks, where it earns interest",
          },
          { label: "Insured", value: "Up to $250,000 at each bank, $1,000,000 in all (FDIC)" },
          { label: "Rate", value: "Variable, set by the program" },
        ],
        details: { kind: "cash_sweep", account },
      };
    }
    const type = String(details.accountType ?? "");
    if (!Object.hasOwn(ACCOUNT_TYPES, type))
      throw new BadRequest("not an account type Alpaca opens here");
    const label = ACCOUNT_TYPES[type as keyof typeof ACCOUNT_TYPES];
    return {
      kind: "open_account",
      amountCents: 0,
      summary: `Open a ${label} account in your name at Alpaca`,
      steps: [
        { label: "Account", value: label },
        { label: "In the name of", value: "You" },
        { label: "Held at", value: "Alpaca Securities LLC" },
        { label: "Money in", value: "Nothing until you move some" },
      ],
      details: { kind: "open_account", accountType: type },
    };
  },
  act: async (draft, context) => ({
    externalRef: sandboxRef(
      draft.kind === "cash_sweep" ? "sbx_sweep" : "sbx_account",
      context.idempotencyKey,
    ),
    state: "done",
    cancelUntil: null,
    note: `${SIMULATED} ${draft.summary}.`,
  }),
};

// A buy: a pick, so it's held back from real people until a qualified person reviews each one
// (`recommends`), whatever else is switched on.
export const sandboxAlpacaOrder: Connector = {
  id: "sandbox_alpaca_order",
  name: "A buy in your investment account, through Alpaca (sandbox)",
  category: "investing",
  capabilities: ["prefill", "act"],
  scopes: ["place_orders"],
  sandbox: true,
  movesMoney: true,
  recommends: "investment",
  prefill: (details) => {
    const ticker = text(details, "ticker").toUpperCase();
    if (isCryptoTicker(ticker)) throw new NoCryptoOrders();
    if (!/^[A-Z][A-Z.]{0,9}$/.test(ticker)) throw new BadRequest("not a ticker");
    const amount = cents(details, "amountCents");
    const account = text(details, "account");
    return {
      kind: "buy",
      amountCents: amount,
      summary: `Buy ${dollars(amount)} of ${ticker} in ${account}`,
      steps: [
        { label: "Buy", value: ticker },
        { label: "Amount", value: dollars(amount) },
        { label: "In", value: account },
        { label: "Order", value: "At the market price, today" },
      ],
      details: { ticker, amountCents: amount, account },
    };
  },
  act: async (draft, context) => ({
    externalRef: sandboxRef("sbx_order", context.idempotencyKey),
    state: "done",
    cancelUntil: cancelUntil(context.now),
    note: `${SIMULATED} ${draft.summary}.`,
  }),
  cancel: async () => true,
};
