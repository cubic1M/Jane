# The detector contract

Spec step 254. Jane has to understand each person's money and bring the right suggestion to
them, so every feature says who it is for. A **detector** is how: a pure function that,
given a person's profile, says whether the feature applies to them and what it is worth.

Read this before adding or changing a capability. Phase AS (steps 259–266) turns each
lane's features into detectors under this contract.

## The shape

`src/detectors/contract.ts`:

```ts
type Detector = {
  capability: string;        // the id of a capability in the chat registry
  topic: SuggestionTopic;    // what it is about (src/config/people.ts)
  needs: FactKey[];          // profile facts it relies on; a missing one becomes a question (step 257)
  detect(ctx: { profile: Profile; data: ProfileInput }): Suggestion | null;
};

type Suggestion = {
  id: string;                // "<capability>:<topic>", stable: never shown again after a no
  capability: string;
  topic: SuggestionTopic;
  title: string;             // one sentence: what Jane suggests
  worthCents: number;        // cents a year (or the risk avoided)
  worthKind: "saves" | "earns" | "risk";
  confidence: { percent: number; reason: string };
  urgency: "now" | "soon" | "later";
  why: string;               // why this person, in their own figures
  action: { label: string; href: string };   // the button
};
```

Rules:

1. **Pure.** No database, no network, no clock, no writing. The nightly scan (step 255)
   loads a person once (`loadProfileInput`, `src/lib/profile.ts`), builds the profile and
   calls every detector. The harness calls the same detectors on sample data.
2. **Return `null` when it does not apply.** Do not return a weak suggestion to be safe.
3. **Figures are theirs.** `why` quotes the person's own numbers (`formatCents`), and
   `worthCents` comes from a stated formula whose rates live in `src/config/detectors.ts`.
   Never inline a threshold or rate.
4. **Confidence is worked out, never made up.** See below.
5. **No advice for real accounts.** Suggestions that amount to investment, tax or legal
   advice go through `adviceMode` and the guardrails like any other text.
6. **One detector, one topic.** A capability can have several detectors.

## Confidence

Every suggestion carries a percentage and its reason, shown together: *"85% sure, based on
12 months of charges"*. It means how likely the suggestion is right for this person and worth
the stated amount. It is not a promise about markets or outcomes.

The recipe is `confidenceOf` in `src/profile/confidence.ts`, with its numbers in
`src/config/profile.ts`. The percentage has to help someone decide, so it **spreads with the
evidence**:

- a fact the person **told** Jane is 100%;
- a fact Jane **saw** starts at 45% and gains 3 points per month of data and 2 per clean match
  (up to 10), capped at 95%: a fact clearly counted over many months is 90–95%, one from a
  single month or one match is about 50–65%;
- a fact Jane **guessed** starts at 15%, gains the same way and is capped at 49%. Below 50% the
  chat says "I'm not sure (45%)" instead of "I'm 45% sure" (`sureWords`).

A detector builds its confidence from the evidence it used (`evidence(...)` for a count, or
`factEvidence(fact)` for a profile fact) and takes the **weakest** of them with `weakest(...)`.
So a suggestion is never surer than the least certain thing it rests on, and the same
evidence always gives the same percentage. The reason shown is the weakest piece's reason.

## Every capability needs a detector

`src/detectors/detectors.test.ts` fails for any capability in the chat registry that has no
detector (`src/detectors/index.ts`) and no written reason in `src/config/detector-exempt.ts`.
Capabilities that only answer or act (what Jane did, settings, the what-if tool) are exempt
with a reason; the suggestions come from the detectors behind them.

## The harness

`src/detectors/harness.ts` runs every detector on the eight sample people (step 252) and
compares what fired with each person's written list in `src/config/people.ts`
(`should` and `mustNot`). Per person it reports what fired, what should have, what was hit,
what was missed (and whether a detector exists for it yet) and what was wrong.

The tests fail when a detector fires something on a person's must-not list, or fails to fire
something on their should-list when a detector for that topic exists. A topic with no
detector yet is reported as *no detector yet*, not as a failure: that is Phase AS's work.
Print the report with `formatReport(runHarness())`.

Adding a detector means: write it, add it to its file's list, check the harness. If it fires
on someone it should not, fix the detector (or the written list, if the list was wrong, and
say why in the PR).

## Worked example 1: bank fees

Capability `cost`, topic `bank_fees` (`src/detectors/money.ts`).

- **Applies** when the year has at least `feesMin` (2) overdraft, insufficient-funds or ATM
  fees.
- **Worth:** what those fees added up to, saved if they stop (`saves`).
- **Confidence:** `evidence("seen", months, feeCount, "bank fees")`. Three fees over twelve
  months of data is 55 + 12×2 + 3×1 = **82%**, reason "3 bank fees in 12 months of data".
- **Why:** "You paid $105.00 in 3 bank fees in 12 months. A buffer in checking or a no-fee
  account avoids them."
- **Action:** "See the fees" → `/insights`.

On the sample people it fires for Maya (3 fees, 82%) and Chris (8 fees, 87%), and for no one
else; none of the others has two fees in a year.

## Worked example 2: PMI removal

Capability `debt`, topic `pmi_removal` (`src/detectors/home.ts`).

- **Needs** the fact `has_pmi` (from the lender's records) and a mortgage balance.
- **Applies** when `has_pmi` is true.
- **Worth:** the loan times `pmiBps` (0.5%) a year (`saves`).
- **Confidence:** `factEvidence(has_pmi)`: the fact itself was seen once in the lender's
  records over twelve months of data, 55 + 24 + 1 = **80%**. If the person had told Jane they
  have PMI it would be 100%; if Jane had only guessed, it would be capped at 75%.
- **Why:** "Your mortgage of $338,000.00 carries PMI, which usually costs about 0.5% of the
  loan a year. Once you own enough of the home, it can come off."
- **Action:** "See if PMI can go" → `/loans/equity`.

On the sample people it fires only for the Reyes family (the one with PMI); the harness
confirms it does not fire for the renter, the retiree or anyone else.

## Loss avoided is ranked by expected value

A suggestion that avoids a loss (`worthKind: "risk"`) shows the full loss ("$30,000") but is
ranked by its expected value in a year: the loss times how likely it is in a year
(`RISK_ANNUAL_PROBABILITY` in `src/config/suggestions.ts`, a topic not listed uses 2%). So a rare
big loss does not outrank a real saving. The chances are rough and only order suggestions; the
sector lanes agree them for their topics.

## The nightly scan (step 255)

The controller's `suggestions` step runs `scanSuggestions` (`src/lib/suggestions.ts`) for each
person: every detector, ranked by dollars x confidence x urgency (risk avoided counts for a
fraction of a saving), adjusted by what the person said yes and no to before and by step 207's
results. The top three (`SUGGESTIONS_PER_DAY`) are offered in the chat; the rest wait and are
ranked again tomorrow. Nothing is offered again after a no. Recommendations on investments,
taxes, insurance and loans (`ADVICE_TOPICS`) are only for demo advice mode.

## Claude as strategist (step 256)

Once a week `runStrategist` (`src/lib/strategist.ts`) lets Claude look at the profile and every
detector's result and propose combinations. An idea must rest on two to four real suggestions
(by key), every dollar figure must come from a tool result, it passes the guardrails (the
`demo_advice` profile in advice mode) and it ends in those suggestions' buttons. Its confidence
is the weakest part's. Ideas are tagged `capability: "strategist"`. Without a key nothing is
proposed; the run counts toward the same daily cost cap as the chat.

## The one question worth asking (step 257)

When a detector could fire but needs a fact the data cannot show (does the job match the
401(k)? how old are you?), `nextQuestion` (`src/lib/questions.ts`) scores each missing fact by
what an answer could unlock (`src/profile/questions.ts`, typical rates in
`src/config/questions.ts`; the figures only order the questions and are never shown as a claim)
and asks the best one in the chat, one at a time, with tap answers and a Skip. The answer goes
into the profile as a told fact (100%), the same path as a correction on `/profile`. A question
is asked once: answered, skipped, or already put to them, never again. To add one: a fact in
`src/profile/facts.ts`, an entry in `QUESTIONS`, an `unlockOf` case, and the detector that
needs it lists the fact in `needs`.

## The reach scoreboard (step 258)

`/admin/reach` shows, for each sample person, what fired and what it was worth, which
capabilities reach whom, and, in totals only, what real people and Try Jane people were offered
and said yes and no to. Confidence is checked for honesty: of the suggestions Jane was about 80%
sure of, about 80% should be said yes to (`src/planning/calibration.ts`); a detector that runs
high or low by 15 points over at least 10 answers is listed so it can be corrected.

The unit tests run on every CI run, the nightly one included: `src/detectors/reach.test.ts`
fails on a new wrong suggestion, or a person losing a right one (`src/detectors/baseline.ts`
is each person's suggestions today; update it on purpose and say why in the PR), and for a
capability that reaches no sample person and is not listed in `UNREACHABLE`
(`src/config/reach.ts`).

## Where it is going

- Step 255 runs every detector for everyone each night and ranks by
  dollars × confidence × urgency, adjusted by what the person said yes to.
- Step 256 lets Claude combine results from several detectors; a combined idea's confidence
  is the weakest detector it rests on.
- Step 257 asks the question whose answer would unlock the most (`needs` on a detector
  whose other conditions fit).
- Step 258 checks that "80% sure" proves right about 80% of the time.
