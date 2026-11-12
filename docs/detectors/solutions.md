# A specific solution and a prefilled step on every finding

The founder's bar: Jane watches 24/7, finds the money, finds the solution and prefills the step; the
person only taps yes or no. This scores every finding type against five questions, as of the 24/7
engine (phases 1–4, November 2026). Y is yes, P is partial, N is no.

1. **Option:** does it name one specific better option, with numbers?
2. **Link:** is there an exact deep link to where the step is taken?
3. **Values:** are the exact values to copy given (amounts, dates, plan names)?
4. **Message:** is the message pre-written where one is needed?
5. **Confirmed:** does Jane confirm it was done from bank data, without being told?

| Type | Option | Link | Values | Message | Confirmed |
|---|---|---|---|---|---|
| subscription_review | P: a cheaper tier when the catalog or a reviewed option has one; student plans from the catalog for students | Y when the company's in the merchant directory (`cancelUrl`) | P: last charge and amount in the email | Y: cancellation email | Y: `charge_stops` |
| duplicate_subscription | N: nothing to compare (keep one) | Y/P: `cancelUrl` per merchant | N | Y | Y: `charge_stops` per service |
| price_increase | P: a tier or plan pick when one matches; the catalog's prices are read again when the charge changes and they're over 6 hours old | P: support page | P: old and new price in the email | Y: keep-my-price email | Y: `bill_drops` |
| bank_fees | N | P: support page | Y: fee dates and amounts | Y: refund email, or a call script | Y: `fee_stops`, `confirmRefunds` |
| idle_cash | **Y (new):** the best live bank rate from the catalog (Barclays, CIT…), with its APY, minimum, sign-up link and "Checked 2:05 PM from barclaysus.com" | **Y (new):** the bank's own account page | P: the amount above the cushion | N: none needed | **Y (new):** `cash_moved`, a transfer out of that account of at least half the extra cash, held while it doesn't come back |
| insurance_reshop | N: insurance goes through licensed partners only | P: insurer support page | N | N | P: `bill_drops` |
| card_interest | N on the card (loan wording only) | P: support page | N | Y: lower-rate call script | P: `fee_stops` |
| low_balance_risk | N: it's a warning, not a switch | N | P: bill dates and amounts | N | N |
| duplicate_charge | N | P: support page | Y: dates, amounts, the refund asked for | Y: refund email | Y: `refund` |
| charge_after_cancel | N | P: support page | Y: cancel date and charges | Y: email | Y: `refund` |
| trial_conversion | N | P: support page | Y: trial and full charge | Y: email | Y: `confirmRefunds`; `charge_stops` |
| bill_negotiation | P: a phone or internet plan pick when one matches | P: support page | P: monthly cost in the script | Y: call script | Y: `bill_drops` |
| covered_by_card | N: names the person's own card cover | Y/P: `cancelUrl` | P: cover limits | Y: cancellation email | P: concierge receipt only |

## What the 24/7 engine filled

- **Idle cash** went from "around 4.00%", a hand-kept rate, to a named bank read today from its own
  page, chosen against the person's balance and the account's minimum. The finding's yes now records
  that switch like any other option. It's confirmed from the bank when the money leaves the account,
  and stays confirmed while it doesn't come back (`cash_moved`, `src/planning/outcomes.ts`).
- **Student plans** price the saving from each service's own page, not a typical list price. The
  suggestion says when and where the prices were checked. A service whose prices aren't live isn't
  suggested.
- **Every market figure** in a comparison says when and where it was checked. The catalog's figures
  give the hour and the source's host. The team's hand-checked options keep "Price checked {day}".
- **Fresh at the moment it matters:** a charge that changed re-reads the catalog's prices for that
  service first, and an offer that moves re-scans the people it helps (phase 3).

## Gaps left, and what closes them

- **Comparison options for more bills** (phone, internet, insurance): a provider's plans page per
  carrier, read like the banks', or a partner feed. Insurance stays partner-only by law.
- **YouTube Premium, Amazon Prime and Adobe student prices:** their pages need JavaScript, or refuse
  robots. Their hand-kept prices run out on 2026-11-15, and their student suggestion stops until a
  headless reader (see the founder notes) or a manual check adds them again.
- **Exact account values** (routing numbers and the like) are never prefilled: read-only Plaid, and
  Jane never handles credentials.
- **Low balance risk and card interest** have no switch to name for real accounts: lending options
  are advice until a licensed partner is connected (`REAL_ACCOUNT_ADVICE`).
