import {
  LIABILITY_TARGET_ACCIDENT_CENTS,
  LIABILITY_TARGET_CENTS,
  UMBRELLA_ASSETS_CENTS,
  type PolicyKind,
} from "@/config/insurance";
import { claimContact } from "@/lib/insurance/claim-rules";
import { PREMIUM_FREQUENCIES } from "@/config/documents";
import { formatCents } from "@/lib/money";
import type { Reply } from "../replies";
import type { MessageAction } from "../types";
import type { InsuranceSnapshot } from "./snapshot";

// Insurance decisions in the chat: "should I get umbrella insurance?", "do I need life
// insurance?", "should I switch car insurance?". Each is answered directly, in three sentences
// or fewer, from the person's own numbers. The verdict is demo advice, so it is given only in
// demo advice mode (and carries the label); otherwise the facts are given and the answer says
// it can't recommend. Pure: the snapshot in, the words out.

export type DecisionKind =
  | "umbrella"
  | "life_enough"
  | "switch"
  | "too_expensive"
  | "deductible"
  | "enough_car"
  | "renters"
  | "pay_yearly"
  | "accident"
  | "disability"
  | "pet"
  | "bundle"
  | "rideshare"
  | "home_enough"
  | "phone"
  | "employer_health"
  | "fsa_left"
  | "deductible_met"
  | "oop_max"
  | "why_up"
  | "cheapest"
  | "teen"
  | "business"
  | "switch_cost";

// Wording, most specific first. Run on the person's lowercased, normalised text.
const P = (...words: string[]) => new RegExp(words.join("|"));
export const DECISION_PATTERNS: readonly (readonly [DecisionKind, RegExp])[] = [
  ["fsa_left", P("\\b(?:fsa|flex(?:ible)? spending)\\b")],
  [
    "deductible_met",
    P(
      "\\b(?:hit|met|reach\\w*|meet) my (?:health )?deductible\\b",
      "\\bdeductible (?:met|so far|progress)\\b",
      "\\bhow much of my (?:health )?deductible\\b",
    ),
  ],
  ["oop_max", P("\\bout[- ]of[- ]pocket (?:max\\w*|limit)\\b")],
  ["umbrella", P("\\bumbrella\\b")],
  [
    "life_enough",
    P(
      "\\b(?:enough|adequate|right amount of) life (?:insurance|cover\\w*)\\b",
      "\\bis my life (?:insurance|cover\\w*) enough\\b",
    ),
  ],
  [
    "switch_cost",
    P(
      "\\b(?:cost|fee|price) (?:to|of) (?:switch\\w*|chang\\w*)\\b",
      "\\bwhat does it cost to switch\\b",
    ),
  ],
  [
    "switch",
    P(
      "\\bswitch (?:my )?(?:car|auto) (?:insurance|cover\\w*)\\b",
      "\\b(?:better|cheaper|lower) (?:price|rate|deal)\\b.*\\b(?:car|auto)\\b",
      "\\b(?:car|auto) insurance\\b.*\\b(?:better|cheaper|lower) (?:price|rate|deal)\\b",
    ),
  ],
  [
    "cheapest",
    P("\\bcheapest way\\b.*\\b(?:cover|insure)\\b", "\\bcheapest (?:car|auto) insurance\\b"),
  ],
  [
    "too_expensive",
    P(
      "\\b(?:car|auto|my)? ?insurance (?:is |too |way )?(?:too )?(?:expensive|high|much|pricey)\\b",
      "\\bam i overpaying\\b.*\\binsurance\\b",
    ),
  ],
  [
    "deductible",
    P(
      "\\b(?:raise|increase|lower|change) (?:my|the) (?:car |auto |home )?deductible\\b",
      "\\bhigher deductible\\b",
    ),
  ],
  [
    "pay_yearly",
    P(
      "\\bpay (?:my )?(?:car |auto |home )?(?:insurance|premium)\\b.*\\b(?:yearly|annually|once a year|in full)\\b",
      "\\b(?:yearly|annual) (?:insurance )?(?:payment|premium)\\b",
    ),
  ],
  [
    "enough_car",
    P(
      "\\b(?:enough|adequate) (?:car |auto )?(?:insurance|cover\\w*|liability)\\b",
      "\\bam i fully covered\\b.*\\b(?:car|auto|accident)\\b",
    ),
  ],
  ["renters", P("\\brenters?'? (?:insurance|cover\\w*)\\b")],
  [
    "accident",
    P(
      "\\bwhat (?:happens|do i do|should i do) (?:if|when) i (?:get in|have|am in) an? (?:car )?(?:accident|crash)\\b",
      "\\bi (?:just )?(?:got|was) in an? (?:car )?(?:accident|crash)\\b",
    ),
  ],
  ["disability", P("\\bdisability (?:insurance|cover\\w*)\\b")],
  ["pet", P("\\b(?:do i need|should i (?:get|buy)|is) (?:a )?pet (?:insurance|cover\\w*)\\b")],
  [
    "bundle",
    P(
      "\\bbundl\\w+ (?:my |our )?(?:car|auto|home|insurance|policies)\\b",
      "\\b(?:car|auto) and home\\b.*\\bbundl\\w+",
    ),
  ],
  [
    "rideshare",
    P(
      "\\b(?:uber|lyft|doordash|rideshare|deliver\\w*)\\b.*\\b(?:covered|insurance|cover)\\b",
      "\\b(?:covered|insurance)\\b.*\\b(?:uber|lyft|doordash|rideshare)\\b",
    ),
  ],
  [
    "home_enough",
    P(
      "\\bhome(?:owners?)?'? (?:insurance|cover\\w*)\\b.*\\b(?:enough|adequate|right)\\b",
      "\\bis my home (?:insurance|cover\\w*) enough\\b",
    ),
  ],
  ["phone", P("\\b(?:phone|device|gadget|mobile) (?:insurance|protection|plan)\\b")],
  [
    "employer_health",
    P(
      "\\b(?:employer|work|job)'?s? (?:health )?(?:plan|insurance)\\b.*\\b(?:keep|drop|switch|worth)\\b",
      "\\bkeep my (?:employer|work|job)'?s? (?:health )?(?:plan|insurance)\\b",
    ),
  ],
  [
    "why_up",
    P(
      "\\bwhy (?:is|has|did) my (?:car |auto |home )?(?:insurance|premium)\\b.*\\b(?:going up|gone up|increase\\w*|rais\\w*|higher)\\b",
    ),
  ],
  [
    "teen",
    P(
      "\\b(?:add|put) my (?:teen\\w*|son|daughter|kid|child)\\b.*\\b(?:policy|insurance)\\b",
      "\\bteen(?:ager)? driver\\b",
    ),
  ],
  [
    "business",
    P(
      "\\bbusiness (?:insurance|liability|cover\\w*)\\b",
      "\\bside (?:hustle|gig|business)\\b.*\\b(?:insurance|cover\\w*)\\b",
    ),
  ],
];

// Only a question that asks what to do or where they stand: "did you switch my car
// insurance?" and "what does my renters insurance cover?" are other questions.
const FRAME =
  /^(?:(?:so|and|ok|okay|also) )?(?:(?:hey )?jane,? )?(?:should i|do i (?:need|have|lose|want)|am i|is my|is it|are my|what(?:'s| is) my|what happens|what(?:'s| is) the cheapest|have i|how much (?:is|would|of|life|do i)|when will i|why is my|why has my|can you|could you|(?:get|find|give) me|what if)\b/;

export function decisionKindOf(text: string): DecisionKind | null {
  if (!FRAME.test(text.trim())) return null;
  return DECISION_PATTERNS.find(([, re]) => re.test(text))?.[0] ?? null;
}

const SEE = { id: "open", label: "Your insurance", kind: "link", href: "/insurance" } as const;
const QUOTES: MessageAction = { id: "insurance.quotes", label: "Get quotes", kind: "secondary" };

type Out = {
  // The person's numbers, said plainly: always given.
  facts: string;
  // The verdict, with its reason: demo advice only.
  advice?: string;
  // What to say when advice isn't allowed and there's nothing else to add.
  actions?: MessageAction[];
  refs?: Reply["refs"];
};

const sentences = (text: string) => text.split(/(?<=[.!?])\s+/).filter(Boolean).length;

function reply(out: Out, advice: boolean): Reply {
  const body =
    advice && out.advice
      ? `${out.advice} ${out.facts}`.trim()
      : out.advice
        ? `${out.facts} I can't tell you what to choose here, but those are your numbers.`
        : out.facts;
  return {
    body,
    actions: out.actions ?? [SEE],
    refs: { ...(out.refs ?? {}), ...(advice && out.advice ? { advice: true as const } : {}) },
  };
}

const active = (ins: InsuranceSnapshot, kind: PolicyKind) =>
  ins.policies.find((p) => p.kind === kind && p.status !== "removed" && p.status !== "cancelled");
const money = formatCents;
const yearly = (
  p: { premiumCents: number | null; premiumFrequency: string | null } | undefined,
): number | null =>
  p && p.premiumCents !== null && p.premiumFrequency && p.premiumFrequency in PREMIUM_FREQUENCIES
    ? p.premiumCents *
      PREMIUM_FREQUENCIES[p.premiumFrequency as keyof typeof PREMIUM_FREQUENCIES].perYear
    : null;

function carShop(ins: InsuranceSnapshot) {
  const car = active(ins, "auto");
  return car
    ? (ins.shops?.find((s) => s.policyId === car.id && s.status === "open" && s.pick) ?? null)
    : null;
}

function switchOut(ins: InsuranceSnapshot): Out {
  const car = active(ins, "auto");
  if (!car) {
    return {
      facts:
        "I don't have a car insurance policy on file, so there's nothing to switch yet. Add yours and I'll shop it for you.",
      actions: [SEE],
    };
  }
  const shop = carShop(ins);
  const now = yearly(car as never);
  if (shop?.pick && (shop.savingCents ?? 0) > 0) {
    return {
      advice: `Yes, it looks worth it.`,
      facts: `${shop.pick.carrier.name} is ${money(shop.savingCents!)} a year cheaper than your ${car.carrier} policy for the same cover, at ${money(shop.pick.annualPremiumCents)} a year. I only cancel ${car.carrier} after the first payment goes through.`,
      actions: [{ id: "insurance.shop_yes", label: "Switch for me", kind: "primary" }, SEE],
      refs: { insuranceShopId: shop.id },
    };
  }
  return {
    advice: `Not right now.`,
    facts: `I don't see a cheaper quote for the same cover as your ${car.carrier} policy${now ? ` (${money(now)} a year)` : ""}. I look again ${car.nextRenewal ? `before it renews on ${car.nextRenewal}` : "before each renewal"}.`,
    actions: [QUOTES, SEE],
  };
}

export function decide(
  kind: DecisionKind,
  ins: InsuranceSnapshot | undefined,
  asOf: string,
): Reply {
  if (!ins) {
    return reply(
      {
        facts:
          "I can't see your insurance yet. Add your policies and I'll answer from your own numbers.",
        actions: [SEE],
      },
      false,
    );
  }
  const advice = ins.advice === true;
  const out = build(kind, ins, asOf);
  return reply(out, advice);
}

function build(kind: DecisionKind, ins: InsuranceSnapshot, asOf: string): Out {
  const { household } = ins;
  const car = active(ins, "auto");
  const carYearly = yearly(car as never);
  switch (kind) {
    case "umbrella": {
      const assets = household.signals.assetsCents;
      const has = active(ins, "umbrella");
      if (has) return { facts: `You already have an umbrella policy with ${has.carrier}.` };
      if (assets === null) {
        return {
          facts:
            "I can't see your balances yet, so I can't size your risk. An umbrella pays above your car and home liability limits.",
          actions: [SEE],
        };
      }
      const big = assets >= UMBRELLA_ASSETS_CENTS;
      return {
        advice: big ? "Probably yes." : "Probably not yet.",
        facts: `You have about ${money(assets)} by your balances and values${big ? `, over the ${money(UMBRELLA_ASSETS_CENTS)} where a big claim against you starts to matter` : `, under the ${money(UMBRELLA_ASSETS_CENTS)} where it usually matters`}. An umbrella policy pays above your car and home liability limits${big ? " and usually costs a few hundred dollars a year" : ""}.`,
        actions: big ? [QUOTES, SEE] : [SEE],
      };
    }
    case "life_enough": {
      const has = active(ins, "life");
      const need = ins.life?.amountCents ?? null;
      const dep = household.dependants.value;
      if (!has) {
        return need
          ? {
              advice: "No.",
              facts: `I see no life policy, and by your income and debts I'd size your cover at ${money(need)}.`,
              actions: [
                { id: "open", label: "Your life cover", kind: "link", href: "/insurance/life" },
                SEE,
              ],
            }
          : dep && dep > 0
            ? {
                advice: "No.",
                facts: `You told me ${dep} ${dep === 1 ? "person depends" : "people depend"} on your income and I see no life policy. I can size the cover from your income and debts.`,
                actions: [
                  {
                    id: "open",
                    label: "Size my life cover",
                    kind: "link",
                    href: "/insurance/life",
                  },
                  SEE,
                ],
              }
            : {
                advice: "Not needed so far.",
                facts:
                  "I see no life policy, and you haven't told me anyone depends on your income. Tell me if someone does and I'll size the cover.",
                actions: [SEE],
              };
      }
      const benefit = Number(has.coverage.deathBenefit ?? 0);
      return benefit
        ? {
            advice: need && benefit < need ? "Probably not quite." : "It looks enough.",
            facts: `Your ${has.carrier} life policy pays ${money(benefit)}${need ? `, against the ${money(need)} I'd size for your income and debts` : ""}.`,
            actions: [
              { id: "open", label: "Your life cover", kind: "link", href: "/insurance/life" },
              SEE,
            ],
          }
        : {
            facts: `You have ${has.carrier} life insurance, but I don't have what it pays. Add that from your policy and I'll compare it with your income and debts.`,
          };
    }
    case "switch":
    case "cheapest":
      return switchOut(ins);
    case "switch_cost": {
      const shop = carShop(ins);
      return shop?.pick
        ? {
            facts: `Switching costs nothing: ${shop.pick.carrier.name} would be ${money(shop.pick.annualPremiumCents)} a year, with the same cover. I cancel ${active(ins, "auto")?.carrier ?? "your old policy"} only after the first payment goes through.`,
            actions: [{ id: "insurance.shop_yes", label: "Switch for me", kind: "primary" }, SEE],
            refs: { insuranceShopId: shop.id },
          }
        : {
            facts:
              "Switching costs nothing, but I don't have a cheaper quote for you right now. I check again before each renewal.",
          };
    }
    case "too_expensive": {
      if (!car || carYearly === null)
        return {
          facts: "I don't have the price of your car insurance yet. Add it and I'll compare it.",
        };
      const shop = carShop(ins);
      const less = shop?.savingCents ?? 0;
      return less > carYearly * 0.05
        ? {
            advice: "A bit, yes.",
            facts: `You pay ${money(carYearly)} a year and the same cover is ${money(less)} less with ${shop!.pick!.carrier.name}.`,
            actions: [{ id: "insurance.shop_yes", label: "Switch for me", kind: "primary" }, SEE],
            refs: { insuranceShopId: shop!.id },
          }
        : {
            advice: "Not by what I can see.",
            facts: `You pay ${money(carYearly)} a year and I don't find the same cover for much less.`,
          };
    }
    case "deductible": {
      const saving = ins.savings?.find((s) => s.kind === "higher_deductible");
      if (!car || car.deductibleCents === null)
        return {
          facts: "I don't have your deductible yet. Add it from your policy and I'll look.",
        };
      if (!saving)
        return {
          facts: `Your deductible is ${money(car.deductibleCents)} and I don't see a saving from raising it.`,
        };
      const to = saving.detail.toDeductibleCents ?? car.deductibleCents;
      return {
        advice: "Only if you could pay the difference on a claim.",
        facts: `Raising your deductible from ${money(car.deductibleCents)} to ${money(to)} saves about ${money(saving.yearlySavingCents)} a year, and you'd pay ${money(to - car.deductibleCents)} more if you claim.`,
        actions: [
          { id: "open", label: "See the saving", kind: "link", href: "/insurance#savings" },
          SEE,
        ],
      };
    }
    case "enough_car": {
      if (!car)
        return { facts: "I don't have a car insurance policy on file. Add it and I'll check it." };
      const per = Number(car.coverage.bodilyInjuryPerPerson ?? 0);
      const acc = Number(car.coverage.bodilyInjuryPerAccident ?? 0);
      if (!per)
        return {
          facts: `I don't have your injury liability limits yet. Add them from your ${car.carrier} policy and I'll check them.`,
        };
      const low = per < LIABILITY_TARGET_CENTS || acc < LIABILITY_TARGET_ACCIDENT_CENTS;
      return {
        advice: low ? "Probably not quite." : "Yes, it looks enough.",
        facts: `Your injury liability is ${money(per)} per person and ${money(acc)} per accident; many people carry at least ${money(LIABILITY_TARGET_CENTS)} and ${money(LIABILITY_TARGET_ACCIDENT_CENTS)}.${car.coverage.collision === true ? " You also have collision cover." : " You don't have collision cover."}`,
      };
    }
    case "renters": {
      const rent = household.housing.value === "rent";
      const home = active(ins, "home") ?? active(ins, "renters");
      if (home) return { facts: `You already have ${home.carrier} ${home.kind} insurance.` };
      return rent
        ? {
            advice: "Yes.",
            facts:
              "You rent and I see no renters policy. Your landlord's insurance covers the building, not your belongings, and renters cover usually costs under $20 a month.",
            actions: [QUOTES, SEE],
          }
        : {
            advice: "No, but you do need home insurance.",
            facts:
              household.housing.value === "own"
                ? "You own your home, so renters cover isn't the one, and I see no home policy on file. If your mortgage pays it from escrow, add it so I can track it."
                : "I don't know yet whether you rent or own: tell me on the insurance page.",
          };
    }
    case "pay_yearly": {
      const s = ins.savings?.find((x) => x.kind === "pay_in_full");
      return s
        ? {
            advice: "Yes, if you can spare the cash.",
            facts: `Paying ${car?.carrier ?? "your insurer"} once a year takes about ${money(s.yearlySavingCents)} off, for ${money(s.detail.payNowCents ?? 0)} up front.`,
            actions: [{ id: "saving.apply_all", label: "Do it", kind: "primary" }, SEE],
            refs: { savingGroup: "same" as never },
          }
        : { facts: "I don't see a saving from paying yearly, or I don't have your premium yet." };
    }
    case "accident": {
      const c = claimContact(car?.carrier ?? null);
      return {
        facts: `Check everyone is safe and call 911 if anyone is hurt, then photograph everything and don't admit fault. ${c.phone ? `Call ${car?.carrier ?? "your insurer"} on ${c.phone}` : "Call your insurer"} and tell me what happened, and I'll start your claim tracker.`,
        actions: [
          { id: "open", label: "Your claims", kind: "link", href: "/insurance/claims" },
          SEE,
        ],
      };
    }
    case "disability": {
      const has = active(ins, "disability");
      if (has) return { facts: `You already have ${has.carrier} disability cover.` };
      return household.signals.paycheck
        ? {
            advice: "Probably yes.",
            facts:
              "You get a paycheck and I see no disability cover. Many jobs include it, so check your benefits first; a policy pays about 60% of your pay after a 90-day wait.",
          }
        : {
            facts:
              "I don't see a paycheck in your accounts lately, so I can't say what disability cover would replace.",
          };
    }
    case "pet": {
      const pets = household.pets.value ?? 0;
      return pets > 0
        ? {
            advice: "Maybe.",
            facts: `You have ${pets} ${pets === 1 ? "pet" : "pets"} and no pet policy; it pays vet bills after a deductible.`,
            actions: [QUOTES, SEE],
          }
        : {
            advice: "Probably not.",
            facts: "You haven't told me about any pets. Tell me if that changes.",
          };
    }
    case "bundle": {
      const s = ins.savings?.find((x) => x.kind === "bundle");
      const home = active(ins, "home") ?? active(ins, "renters");
      return s
        ? {
            advice: "Yes.",
            facts: `Putting your car and ${s.detail.withCarrier ?? "home"} policy with one carrier saves about ${money(s.yearlySavingCents)} a year.`,
            actions: [{ id: "saving.apply_all", label: "Do it", kind: "primary" }, SEE],
            refs: { savingGroup: "same" as never },
          }
        : {
            facts: home
              ? "I don't see a bundle saving for your car and home policies."
              : "You have no home or renters policy on file, so there is nothing to bundle with yet.",
          };
    }
    case "rideshare": {
      const has = active(ins, "rideshare");
      if (has) return { facts: `You have ${has.carrier} rideshare cover.` };
      return {
        advice: "Probably not.",
        facts: `A personal car policy${car ? ` like your ${car.carrier} one` : ""} often excludes driving for pay, and I see no rideshare cover on file. Ask your insurer for a rideshare endorsement before your next trip.`,
        actions: [QUOTES, SEE],
      };
    }
    case "home_enough": {
      const home = active(ins, "home");
      return home
        ? {
            facts: `Your ${home.carrier} home policy is on file${home.coverage.dwelling ? ` with ${money(Number(home.coverage.dwelling))} to rebuild` : ""}; I compare that with your home's value at your yearly checkup.`,
          }
        : {
            facts:
              "I don't have a home policy on file, so I can't say. If your mortgage pays it from escrow, add it and I'll check it.",
          };
    }
    case "phone": {
      const dev = ins.policies.find(
        (p) => p.kind === "device" || /asurion|squaretrade|applecare/i.test(p.carrier),
      );
      return dev
        ? {
            advice: "Maybe, after one check.",
            facts: `You pay about ${money(yearly(dev as never) ?? 0)} a year for ${dev.carrier}; if you pay your phone bill with a card that covers phones, it may already be covered.`,
          }
        : {
            facts:
              "I don't see a phone protection plan on file. Many cards cover your phone when you pay the bill with them.",
          };
    }
    case "employer_health": {
      const h = ins.benefits?.find((b) => b.kind === "health" && b.status !== "declined");
      return h
        ? {
            advice: "Probably keep it.",
            facts: `Your pay stub shows ${money(h.perPayCents * (h.payFrequency === "semimonthly" ? 24 : h.payFrequency === "biweekly" ? 26 : h.payFrequency === "weekly" ? 52 : 12))} a year for work health cover, and employers usually pay a good share. I compare it with marketplace plans at open enrollment.`,
            actions: [
              { id: "open", label: "Your benefits", kind: "link", href: "/insurance/benefits" },
              SEE,
            ],
          }
        : {
            facts:
              "I don't see health cover through work in your pay stub. Tell me if you have it.",
          };
    }
    case "fsa_left":
    case "deductible_met":
    case "oop_max": {
      const hy = ins.healthYear;
      if (!hy)
        return {
          facts:
            "I don't have your health plan's terms yet. Add your plan on your insurance page and I'll track the year.",
        };
      if (kind === "fsa_left") {
        return hy.fsa
          ? {
              facts: `You have about ${money(hy.fsa.leftCents)} left in your FSA of ${money(hy.fsa.electionCents)}, and it's lost after Dec 31 (${hy.fsa.daysLeft} days), unless your employer allows a carryover.`,
              actions: [
                {
                  id: "open",
                  label: "Your health year",
                  kind: "link",
                  href: "/insurance#health-year",
                },
              ],
            }
          : { facts: "I don't see an FSA in your pay stub." };
      }
      if (kind === "deductible_met") {
        const p = hy.progress;
        return {
          facts: `You've met ${money(p.deductibleMetCents)} of your ${money(hy.plan.deductibleCents)} deductible${p.deductibleLeftCents > 0 ? `, ${money(p.deductibleLeftCents)} to go` : ", so your plan is paying its share now"}.`,
          actions: [
            { id: "open", label: "Your health year", kind: "link", href: "/insurance#health-year" },
          ],
        };
      }
      const max = hy.plan.outOfPocketMaxCents;
      return max === null
        ? { facts: "Your plan has no out-of-pocket maximum on file." }
        : {
            facts: `You've paid about ${money(hy.progress.oopSoFarCents)} toward your ${money(max)} out-of-pocket maximum${hy.progress.maxMonth === "reached" ? ", which you've reached" : "; at this pace you won't reach it this year"}.`,
            actions: [
              {
                id: "open",
                label: "Your health year",
                kind: "link",
                href: "/insurance#health-year",
              },
            ],
          };
    }
    case "why_up": {
      const n = ins.negotiations?.find((x) => x.status === "asked");
      return n
        ? {
            facts: `Your renewal goes from ${money(n.currentAnnualCents)} to ${money(n.renewalAnnualCents)} a year. I can call your insurer and ask for a better rate.`,
            actions: [{ id: "renewal.call", label: "Call them", kind: "primary" }, SEE],
            refs: { negotiationId: n.id } as never,
          }
        : {
            facts: `I don't see a rise: ${car ? `your ${car.carrier} policy is ${carYearly ? money(carYearly) + " a year" : "on file"}` : "I have no car policy on file"}, and I'd tell you when a renewal goes up.`,
          };
    }
    case "teen": {
      const gap = ins.gaps.find((g) => g.key === "teen_driver");
      return gap
        ? {
            advice: "Yes, add them.",
            facts: `${gap.title}. A new teen driver usually raises the price, and a driver who isn't listed can leave a claim in doubt.`,
          }
        : {
            advice: "Yes, once they drive.",
            facts:
              "A driver who isn't on the policy can leave a claim in doubt, though a teen usually raises the price. Add them on your insurance page and I'll price it.",
          };
    }
    case "business": {
      const gaps = ins.gaps.filter((g) =>
        [
          "business_liability",
          "professional_liability",
          "car_business_use",
          "business_equipment",
        ].includes(g.key),
      );
      return gaps.length > 0
        ? {
            advice: "Probably yes.",
            facts: `${gaps[0].title}. Your personal policies cover your personal life, not work.`,
          }
        : {
            advice: "Probably, if you earn on the side.",
            facts:
              "I don't see freelance or gig income in your accounts. Your home, renters and car policies cover your personal life, not work: mark yourself self-employed on your tax profile and I'll look again.",
          };
    }
  }
}

// Used by the tests: an answer is direct and short.
export const sentenceCount = sentences;

// How sure Jane is of a decision answer, from what it rests on: a quote against the premium
// on file, the policy's own limits, the plan's terms, or only a rule of thumb. The same
// evidence gives the same percentage.
export function decisionConfidence(
  kind: DecisionKind,
  ins: InsuranceSnapshot,
): { percent: number; reason: string } {
  const car = active(ins, "auto");
  const quoted = Boolean(carShop(ins));
  switch (kind) {
    case "switch":
    case "cheapest":
    case "too_expensive":
    case "switch_cost":
    case "why_up":
      return quoted
        ? { percent: 80, reason: "a same-cover quote against the premium on your policy" }
        : {
            percent: 60,
            reason: car ? "no cheaper same-cover quote found yet" : "no car policy on file",
          };
    case "pay_yearly":
    case "deductible":
    case "bundle":
      return {
        percent: 70,
        reason: "your premium and the carrier's typical discount, not a quote",
      };
    case "umbrella":
      return ins.household.signals.assetsCents === null
        ? { percent: 40, reason: "I can't see your balances yet" }
        : { percent: 80, reason: "your balances and the owned things you listed" };
    case "life_enough":
      return ins.life?.amountCents
        ? { percent: 80, reason: "your income and debts, sized by the life-cover method" }
        : { percent: 55, reason: "no life cover sized yet" };
    case "enough_car":
      return car?.coverage.bodilyInjuryPerPerson
        ? { percent: 85, reason: "the limits on your policy" }
        : { percent: 40, reason: "your policy's limits aren't on file" };
    case "fsa_left":
    case "deductible_met":
    case "oop_max":
      return ins.healthYear
        ? {
            percent: ins.healthYear.sample ? 60 : 85,
            reason: ins.healthYear.sample
              ? "the demo bank's sample plan"
              : "your plan's terms and your medical charges",
          }
        : { percent: 40, reason: "your health plan's terms aren't on file" };
    case "employer_health":
      return { percent: 65, reason: "a pay-stub line, not the plan's terms" };
    default:
      return { percent: 65, reason: "a rule of thumb on what you've told me, not a quote" };
  }
}
