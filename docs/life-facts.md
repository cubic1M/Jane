# The picture of a person's life

Jane paints a rough picture of a person from their payments (founder, 2026-10-26): kids, a pet,
school, a car, the commute, travel, the gym, how they eat, a side gig, health costs, a recent move,
a new baby. Each is a **profile fact** (`src/profile/facts.ts`), so it has a value, a source
(`seen`, `guessed` or `told`), a confidence percentage worked out from the evidence, the evidence in
words ("6 school and pediatric payments in 12 months of data"), and a place on `/profile` where the
person can correct it. A correction wins everywhere (it is a `told` fact at 100%).

- Code: `src/profile/life-facts.ts` (pure: payments in, readings out); `src/profile/build.ts`
  turns each reading into a fact. Thresholds and word lists: `src/config/life-facts.ts`.
- A single payment is never enough (childcare is the one exception, as before). Weaker signs need a
  count over months; one kind of weak sign is a `guessed` fact (under 50%, said "I'm not sure").
- A new baby and a recent move reuse the life-event guesses of step 100
  (`src/insights/life-signals.ts`), so the suggestion and the profile cannot disagree.

| Fact | Seen from | Guessed when |
| --- | --- | --- |
| `has_children` | childcare (1 payment), or two kinds of: school, pediatric, kids' stores, baby goods | one kind of weaker sign |
| `new_baby` | baby merchants plus a hospital bill (step 100) | baby goods lately and nothing for children before |
| `has_pet` | vet, pet food, grooming, pet insurance: 4+ payments over 2+ months | 3 payments |
| `is_student` | campus spending (bookstore, student fees, meal plan) across months | tuition alone (a parent can pay it) |
| `housing` (own) | mortgage; or 4+ HOA or property-tax payments | 2-3 such payments |
| `has_car` | car payments, gas, parking, tolls, cover, upkeep | always a guess |
| `work_style` | commuter: 6+ transit, parking or toll payments over 3+ months | remote: a salary and no commute or few fill-ups |
| `travels_often` | 3+ trips (a run of travel payments) in a year | fewer trips |
| `goes_to_gym` | 3+ gym or fitness payments over 2+ months | |
| `eating_style` | share of food spending eating out or delivery vs groceries | |
| `side_gig` | a salary and 3+ gig or contractor deposits over 2+ months | |
| `health_costs` | $250+ a month on average, 6+ payments over 3+ months (a cost, never a diagnosis) | |
| `moved_recently` | moving signs (step 100) | |

## What Jane never guesses

Health conditions, religion, politics, sexuality, immigration status. Health spending is only a
cost category (`health_costs`); a pharmacy's or a church's name is not read for what it might say
about someone. Veterinary bills are pets, not health. A student-loan payment is not read as "in
school": it points to someone who finished (the student-loan detector has that on its own).

## What the facts change in the suggestions

- **Cover for a pet** (`pet_insurance`, demo advice only): only when `has_pet` is true and no pet-insurance charge is seen. It names the vet and pet payments, takes the fact's confidence (a guess stays under 50%), and is capped at 70% because a $3,000 vet bill is typical, not quoted. The Reyes family's dog (Chewy every month, the vet a few times a year) is in the demo bank.
- **Student plans** (`student_discounts`): only when `is_student` is true, and only for a service the person already pays for in two or more months (Spotify, Amazon Prime, Apple Music, YouTube Premium, Adobe); the saving is the service's list-price difference, said as typical.
- **Renters' cover** is for `housing = rent` only, so a homeowner (a mortgage, or monthly HOA dues) is never pitched it. The child tax credit, the childcare tax break, the 529 and life cover for parents already read `has_children`, which is now seen from schools, pediatric visits and kids' stores as well as childcare.
- Correcting a fact on `/profile` changes all of these at the next scan: tell Jane "no dog" and the pet suggestion goes; take it back and it returns (`src/lib/life-facts.integration.test.ts`).
