# Turn on Plaid's read products: Investments and Liabilities

Jane reads banks through Plaid. Transactions is always on. Two more products are read-only and
bill on their own:

- **Liabilities** (loans and cards: rate, minimum, due date, a student loan's plan and status). On
  now: Link asks for it on every new bank.
- **Investments** (what a brokerage or retirement account holds, and its trades and fees). Off
  until you switch it on with one setting, `PLAID_INVESTMENTS=1`.

Both were walked end to end in Plaid's sandbox on 2026-11-17 (link, the Investing, Loans and student
loan pages, the chat, the suggestions, sign-out and in, and delete). Nothing here moves money.

## What each costs

Plaid bills Liabilities and Investments as **monthly subscriptions per Item** (one bank login),
until the Item is removed. A month is a calendar month in UTC and isn't pro-rated, so an Item removed
on the 2nd still pays for that month (<https://plaid.com/docs/account/billing/>). Investments has two
subscriptions: holdings, and investment transactions.

**When the bill starts depends on how Link asks** (<https://plaid.com/docs/link/initializing-products/>):

- A product in Link's **`optional_products`**, where Jane puts Liabilities and Investments today
  (`src/lib/plaid/link.ts`), is billed **when the link is made**, at every bank that supports it,
  whether or not the person has a loan, a card or a brokerage there.
- A product in **`additional_consented_products`** is billed only from **the first time Jane reads
  it**. Plaid recommends exactly this for personal-finance apps: Transactions as the product,
  Liabilities and Investments as consented ones, read only for accounts of that type.

Moving both to `additional_consented_products` (and reading Liabilities only when a link has a card
or loan, Investments only when it has an investment account) would stop paying for links that have
none. It changes what every new link costs, so it's your call; it isn't built. One thing to check
first, in the sandbox through Link itself: whether a link made that way reads Liabilities without
sending the person back through Link.

> **PRICE GAP:** the price per Item for each product, and which banks and brokerages each covers,
> are being checked at the source by the connector-roadmap session. Fill this in from its answer;
> don't guess. The questions to ask Plaid are in its notes.

Two things learned in the sandbox that change the bill:

- **Reading a product adds it.** When Jane reads holdings or loans from an Item that didn't get
  that product at Link, and the bank supports it, Plaid adds it and starts billing it (in the
  sandbox, a link made with Transactions only came back billed for both). Where the person didn't
  consent to it in Link, Plaid's docs say the read fails instead and needs Link's update mode.
  Turning the setting on doesn't touch banks linked before: only banks linked while it's on are read.
- **A product can't be taken off an Item.** Only removing the Item stops its subscriptions.
- **Recurring Transactions shows up as billed** on every Item, because Jane reads recurring
  charges. It isn't asked for in Link. It's in the admin view below, so you can see it.

## Switch Investments on

1. **In the Plaid dashboard**, open Products and request Investments for Production. If Fidelity
   matters, press its "Request access" button too. Wait for Plaid to say it's on.
2. **In Vercel**, open the project's Settings, then Environment Variables. Add
   `PLAID_INVESTMENTS` with the value `1` for Production. Leave Preview and Development as they
   are unless you want them too.
3. **Redeploy.** Settings only reach the site on the next deploy: the green-deploy script ships the
   next green main commit on its own, or redeploy the latest one from Vercel's Deployments page.

From then on, each new bank link asks Plaid for Investments as well, and its sync reads the
holdings, the trades of the last two years and the fees. People see their holdings on the
Investing page, in the chat and in Jane's suggestions, as facts only: real accounts never get a
pick or a recommendation.

A bank that doesn't support Investments still links and syncs. Its person just sees no holdings
from it, and no error. People who linked before the switch keep what they had: their brokerage
balances still show, without holdings. Linking the same bank again is refused while its accounts are
linked, so they'd disconnect it in Settings and link it anew. Reading holdings for those older links
automatically is possible, but it would add the subscription to every one of them at once. That's
your call, and it isn't built.

## Check it worked

Open **`/admin/costs`** and look at **What Plaid granted**. It asks Plaid about every real bank
link and shows, per product, how many links:

- **Asked for** it (what Jane put in Link),
- were **Granted** it (what Plaid actually turned on), and
- are **Billed** for it.

Counts only: no names, no banks, no tokens. After the first new link at a brokerage, Investments
should read 1 under each column. Asked above Granted means banks that don't offer it, or a plan that
doesn't include it: Plaid drops an optional product without saying so. Links Plaid didn't answer for are
counted apart.

## Switch it off again

1. In Vercel, delete `PLAID_INVESTMENTS` (or set it to anything but `1`), then redeploy.
2. New links stop asking for Investments, and syncs stop reading holdings for every link.

**Switching off doesn't stop the bill** for links that already have Investments: Plaid bills
those until each Item is removed. To stop it for good, the person disconnects that bank in
Settings (or deletes their account), which removes the Item at Plaid. Holdings already read stay on
the person's pages until then, no longer updated.

## Liabilities

Liabilities is already on and has no setting of its own. Because it's in `optional_products`, every
new link at a bank that supports it is billed for it (see What each costs). It's checked the same
way, in the same table. In the sandbox a student loan, a card, a car loan and a mortgage all came through to the
Loans page and the student loan page, with their rates, minimums and the student loan's plan and
status. Plaid doesn't read federal Direct Loans from Aidvantage, EdFinancial, MOHELA or Nelnet: it
dropped those servicers in August 2024 (<https://plaid.com/docs/changelog/>).

> **COVERAGE GAP:** which card issuers and private lenders Liabilities covers today waits on the
> connector-roadmap session's answer.
