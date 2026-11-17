# Connectors

Jane's plan is to run a person's money for them through partners ("connectors") once the person
taps yes. The connector code (consent, the vault, the action pipeline, webhooks, sandbox adapters,
"Jane prepares, you pay", the credit-report and studentaid.gov readers) was built switched off and
removed while the beta is read-only (founder decision); it is in git history before that commit.
What's left here is the roadmap work that lives outside it.

## Insurance referrals: how Jane may be paid

Round 14 of the connectors roadmap, on the existing referral partners (`src/lib/referrals.ts`,
`/admin/partners`). Each partner has a `payModel` (`none`, `flat_click`, `flat_lead`, `per_quote`,
`per_policy`) and the insurance `lines` it compares. For insurance:

- Nothing is offered until counsel's answer is recorded (`COUNSEL_INSURANCE_REFERRALS.approved`).
- Unpaid partners then follow the state list as before. A flat fee or per-quote pay also needs
  that pay model approved for the person's state (`approvedStates`, empty today).
- Per policy sold is never allowed: refused at `/admin/partners`, and skipped if a row says so.
- The card shows the partner's disclosure and then how Jane is paid, word for word
  (`PAY_DISCLOSURES`), for example "Jane isn't an insurance agent and isn't paid for this."

Renewal reshops come by kind (`RESHOP_DAYS_BEFORE_RENEWAL_BY_KIND`): home and renters from 45 days
out, auto from 30 (California's renewal offers arrive 45 and 20 days ahead), never life, and never
within the last week (`RESHOP_LAST_CALL_DAYS`) unless the price already rose. The demo's auto
policy now renews in 25 days, inside its window.

Not built yet from round 14: the postback receiver and the banned-phrase check on card copy.

`src/lib/referral-links.ts` builds an affiliate-network link (Impact, CJ, Awin, FlexOffers) that
carries nothing about the person: the only thing added is a sub-ID, the first 16 hex of an HMAC of
the action's id; a template or deep link with a parameter that could carry the person (Impact's
`p.*`, `sharedid`, email, name, phone, zip, date of birth, VIN, user id, or a value that looks like
an email or phone number) is refused, and a deep link may only point at the partner's allowed
domain. Not wired to `/admin/partners` yet: partners don't record their network.

## Loan links

`src/config/loan-links.ts` (roadmap rounds 14 and 15) is the one list of links Jane gives for a
loan: studentaid.gov's own tools (reused from `STUDENT_STEPS`), the home pages of the private
student refinance lenders round 15 names (demo advice mode only: naming lenders is a pick, and
`REAL_ACCOUNT_ADVICE` stays false), and Engine's hosted page, empty until Engine gives its address.
Every one is unpaid (`paid: false`): the beta takes no pay for any loan product. A test holds every
link, and every URL written anywhere in `src/config`, to carrying no affiliate tag (`subid`,
`clickref`, `irclickid`, `utm_*`, Impact's `p.*` and the like) and nothing about the person.

## Card offers (mock)

`src/lib/connectors/card-offers/offer.ts` (roadmap round 15) reads card offers shaped like Engine's
marketplace and shows them the way Regulation Z wants a card's terms shown. Mock only: no partner,
no pay, and named offers stay in demo advice mode.

- `parseCardOffer`: tolerant of Engine's shapes (rates as numbers or "21.99%", both spellings of
  the credit-rating disclaimer, the balance-transfer fee as a bare percent with its minimum read
  from the fee's disclaimer). An offer with no name or no https Rates & Fees page is refused.
- `offerBlock`: one block of same-size lines. Every intro rate says "intro", with its end, the APR
  after and, for a transfer, the fee; the regular APR and whether it varies; the annual fee; the
  Rates & Fees link; "pre-approved" only when the issuer says so.
- `regZProblems`: what's wrong with a block under those rules, for any screen that shows an offer.
- `cardSuggestionExcluded`: no new-credit suggestion while overdue, after a late fee in 12 months,
  within 6 months of a new card, with hardship flagged, or under 21 without independent income; an
  age band is asked once, never a date of birth.

Not built yet: the disclosure component, balance-transfer and rewards-fit maths, the CFPB card-terms
importer, and wiring offers into a card.
