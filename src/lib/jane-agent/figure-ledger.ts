import { CALENDAR_DATES } from "@/config/figure-ledger";

// What Claude's chat answer may state as a number, and about what. The guardrails' flat list asks
// only "was this dollar amount given?", so Netflix's $15.49 said of Hulu, or May's total called
// June's, passes, and percents, counts and dates aren't looked at. Here every tool result is read
// into facts (value, kind, what it's about, which month, how often) from the keys it already has,
// and each number in the answer is checked against them.
//
// One wrong number fails the answer: there's no score. It fails only on what the facts contradict,
// though: a figure bound to nothing, or a name the facts have never heard of, isn't a contradiction.
// A dollar amount with no fact at all is the guardrails' to catch (unsupported_dollar_figure).

export type FigureKind = "money" | "percent" | "date" | "count";
type Cadence = "month" | "year";

type Fact = {
  kind: FigureKind;
  // Cents, a percent, a count, or for a date its month * 100 + day.
  value: number;
  // What it's about, from the object it sits in. Empty when it's about nothing in particular.
  names: string[];
  // A free-text fact: what it's about comes from the sentence, once all the names are known.
  context?: string;
  // Where in that sentence it sits, so "Comcast $165 and Verizon $145" keeps them apart.
  at?: number;
  // "2026-05", or "2026" for a year. Null when it isn't of one period.
  period: string | null;
  cadence: Cadence | null;
  // A count's noun ("subscription"): the key or word it was counted under.
  noun?: string;
  // A count that is a list's length, not a number a tool stated ("matched": 30).
  listed?: boolean;
};

export type FigureProblemKind =
  | "wrong_name"
  | "wrong_period"
  | "wrong_cadence"
  | "unsupported_percent"
  | "unsupported_date"
  | "wrong_count";

export type FigureProblem = { kind: FigureProblemKind; said: string; why: string };

// The keys that say what an object is about, most specific first. A transaction has a merchant, a
// category and an account, and an answer may call it by any of them.
const NAME_KEYS = [
  "merchant",
  "what",
  "name",
  "debt",
  "loan",
  "card",
  "goal",
  "policy",
  "plan",
  "lender",
  "carrier",
  "fund",
  "security",
  "ticker",
  "issuer",
  "employer",
  "benefit",
  "category",
  "account",
];
// The keys that date what an object says happened. A recurring charge's dates say when it last
// came and next comes, not that its price belongs to that month.
const PERIOD_KEYS = ["month", "date", "on", "chargedOn", "billedOn"];
const RECURRING_KEYS = ["billed", "nextDate", "paymentEvery"];

const YEARLY_KEY = /^(?:aYear|perYear|yearly|annual|annually)$|(?:AYear|PerYear|Yearly|Annual)$/;
const MONTHLY_KEY = /^(?:aMonth|perMonth|monthly)|(?:AMonth|PerMonth|Monthly)/;
const PERCENT_KEY = /percent|share|bracket/i;
// Numbers that are never a count of anything said in an answer.
const NOT_A_COUNT = /year|percent|score|cents|age|minutes|points|rate|confidence/i;

const MONEY_LEAF = /^[-−+]?\$[\d,]+(?:\.\d+)?$/;
const PERCENT_LEAF = /^[-+−]?\d+(?:\.\d+)?%$/;
const ISO_DATE = /^(\d{4})-(\d{2})-(\d{2})$/;
const ISO_MONTH = /^\d{4}-\d{2}$/;

// Words too general to say which thing is meant: "your credit card" isn't "Demo Credit Card".
const GENERIC_WORDS = new Set(
  "a an and at by card cards car credit debit demo fee fees for from home in into insurance loan loans monthly mortgage my of on or our pay payment payments plan policy renews return savings checking account student the to window with your you auto bill bills bank cash thank income interest service transfer deposit check payroll refund rent".split(
    " ",
  ),
);

const MONTHS = [
  "january",
  "february",
  "march",
  "april",
  "may",
  "june",
  "july",
  "august",
  "september",
  "october",
  "november",
  "december",
];
const MONTH_WORD = `(?:Jan(?:uary)?|Feb(?:ruary)?|Mar(?:ch)?|Apr(?:il)?|May|June?|July?|Aug(?:ust)?|Sept?(?:ember)?|Oct(?:ober)?|Nov(?:ember)?|Dec(?:ember)?)`;
const monthIndex = (word: string) =>
  MONTHS.findIndex((m) => m.startsWith(word.slice(0, 3).toLowerCase()));

const MONEY =
  /\$\s?((?:\d{1,3}(?:,\d{3})+|\d+)(?:\.\d+)?)(?!\s?(?:k|m|bn|thousand|million|billion)\b)/gi;
const PERCENT = /(?<![\d.,$])(\d+(?:\.\d+)?)\s?(?:%|percent\b)/gi;
const DATE = new RegExp(
  `\\b(${MONTH_WORD})\\.? (\\d{1,2})(?:st|nd|rd|th)?\\b(?!:)(?:,? (\\d{4}))?`,
  "g",
);
const NUMBER_WORDS: Record<string, number> = {
  two: 2,
  three: 3,
  four: 4,
  five: 5,
  six: 6,
  seven: 7,
  eight: 8,
  nine: 9,
  ten: 10,
  eleven: 11,
  twelve: 12,
};
const COUNTED =
  "subscriptions|charges|payments|transactions|bills|accounts|cards|loans|debts|policies|goals|holdings|funds|plans|offers|overdrafts|fees|findings|categories|paychecks|deposits|orders|trades|merchants";
// "3 subscriptions", "3 credit cards", "2 of your debts", "three open loans".
const COUNT = new RegExp(
  `(?<![\\d.,$])\\b(\\d{1,3}|${Object.keys(NUMBER_WORDS).join("|")})\\s+(?:of (?:your|the|those|these) )?(?:[a-z]+ )?(${COUNTED})\\b`,
  "gi",
);

const WHOLE_DOLLARS_CHECKED_FROM_CENTS = 10_000;

const TOTAL_CLAIM =
  /\b(?:you|they) (?:have|hold|pay for|are paying for) (?:\w+ )?\S+(?: \w+)? \w+$/i;

const stem = (noun: string) => noun.toLowerCase().replace(/ies$/, "y").replace(/s$/, "");

// The sentences of a text. A full stop inside a figure isn't followed by a space.
const sentencesOf = (text: string) =>
  text
    .split(/(?<=[.!?])\s+|\n+/)
    .map((s) => s.trim())
    .filter(Boolean);

const wordsOf = (name: string) =>
  name
    .replace(/[·.]{2,}\s*\d*/g, " ")
    .replace(/\(.*?\)/g, " ")
    .split(/[^\p{L}\p{N}&']+/u)
    .filter(Boolean);

// The words that say which thing a name means. Only a capitalized word or brand counts: "your
// target" isn't Target.
// A name's words without "Demo" and an account's last digits: "Demo Car Loan ····0006" is what
// "your car loan" means, though no one word in it says which debt.
const phraseOf = (name: string) =>
  wordsOf(name)
    .filter((w) => w.toLowerCase() !== "demo")
    .join(" ")
    .toLowerCase();

const significant = (name: string) =>
  wordsOf(name).filter(
    (w) => w.length > 2 && /^\p{Lu}/u.test(w) && !GENERIC_WORDS.has(w.toLowerCase()),
  );

// A `what` or `name` can be a whole sentence ("Go through your subscriptions and cancel..."), a
// code ("GENERAL_MERCHANDISE") or a kind ("autopay"): those say what to do or what sort of thing
// it is, not what a figure is about.
const isAName = (text: string) =>
  text.length <= 40 &&
  wordsOf(text).length <= 5 &&
  !/[.!?:]$|_/.test(text.trim()) &&
  /^[\p{Lu}\p{N}]/u.test(text.trim());

const cadenceAfter = (text: string): Cadence | null => {
  const after = text.slice(0, 24);
  if (
    /^\s*(?:a|per|each|every) year\b|^\s*\/\s?(?:yr|year)\b|^\s*(?:yearly|annually)\b/i.test(after)
  )
    return "year";
  if (/^\s*(?:a|per|each|every) month\b|^\s*\/\s?(?:mo|month)\b|^\s*monthly\b/i.test(after))
    return "month";
  return null;
};

const centsOf = (written: string) => Math.round(Number(written.replaceAll(",", "")) * 100);

export class FigureLedger {
  private readonly facts: Fact[] = [];
  private readonly names = new Set<string>();
  // What each piece of text mentions: the same sentences come round as an answer streams.
  private readonly mentioned = new Map<string, string[]>();
  // Names that are a category of spending: "Income" holds many payers, so a figure known only
  // under it says nothing against any one of them.
  private readonly categories = new Set<string>();

  // Names to know beyond what the tools return (the person's merchants and accounts), so "Hulu is
  // $15.49" is seen as naming something even when no tool has said Hulu yet.
  addNames(names: readonly string[]): void {
    for (const name of names) if (isAName(name)) this.names.add(name.trim());
    this.mentioned.clear();
  }

  // A tool's result: JSON from every chat tool, so what a figure is about is in the keys around it.
  addToolResult(content: string): void {
    let value: unknown;
    try {
      value = JSON.parse(content);
    } catch {
      this.addText(content);
      return;
    }
    this.walk(value, [], null, null, "");
  }

  // Numbers sent up front: a line of `name: {json}` per lookup, and some plain text.
  addLines(text: string): void {
    for (const line of text.split("\n")) {
      const json = /^[a-z_]+: (\{.*\}|\[.*\])$/.exec(line);
      if (json) this.addToolResult(json[1]);
      else if (line.trim()) this.addText(line);
    }
  }

  // Rules of thumb Jane's own instructions state ("a common target is 20%"): true of no one thing.
  addRulesOfThumb(text: string): void {
    for (const m of text.matchAll(PERCENT)) {
      this.facts.push({
        kind: "percent",
        value: Number(m[1]),
        names: [],
        period: null,
        cadence: null,
      });
    }
  }

  // Words with figures in them: bound to whatever each sentence names, once the names are known.
  addText(text: string, inherited: { names?: string[]; period?: string | null } = {}): void {
    const names = inherited.names ?? [];
    const period = inherited.period ?? null;
    for (const sentence of sentencesOf(text)) {
      const context = names.length > 0 ? undefined : sentence;
      for (const m of sentence.matchAll(MONEY)) {
        const rest = sentence.slice((m.index ?? 0) + m[0].length);
        this.facts.push({
          kind: "money",
          value: centsOf(m[1]),
          names,
          context,
          at: m.index,
          period,
          cadence: cadenceAfter(rest),
        });
      }
      for (const m of sentence.matchAll(PERCENT)) {
        this.facts.push({
          kind: "percent",
          value: Number(m[1]),
          names,
          context,
          at: m.index,
          period,
          cadence: null,
        });
      }
      for (const m of sentence.matchAll(DATE)) {
        this.facts.push({
          kind: "date",
          value: (monthIndex(m[1]) + 1) * 100 + Number(m[2]),
          names,
          context,
          at: m.index,
          period: null,
          cadence: null,
        });
      }
      for (const m of sentence.matchAll(COUNT)) {
        this.addCount(NUMBER_WORDS[m[1].toLowerCase()] ?? Number(m[1]), m[2]);
      }
    }
  }

  private addCount(value: number, noun: string, how: "listed" | "stated" = "stated"): void {
    this.facts.push({
      kind: "count",
      value,
      names: [],
      period: null,
      cadence: null,
      noun: stem(noun),
      listed: how === "listed",
    });
  }

  private walk(
    value: unknown,
    outerNames: string[],
    outerPeriod: string | null,
    outerCadence: Cadence | null,
    key: string,
  ): void {
    if (Array.isArray(value)) {
      if (key) this.addCount(value.length, key, "listed");
      this.tally(value);
      for (const item of value) this.walk(item, outerNames, outerPeriod, outerCadence, "");
      return;
    }
    if (value && typeof value === "object") {
      const object = value as Record<string, unknown>;
      const own = NAME_KEYS.flatMap((k) => {
        const name = object[k];
        return typeof name === "string" && isAName(name) ? [name] : [];
      });
      for (const name of own) {
        if (!this.names.has(name)) this.mentioned.clear();
        this.names.add(name);
      }
      if (typeof object.category === "string") this.categories.add(object.category);
      // A card's phone cover is about the card and the cover.
      const names = [...own, ...outerNames];
      const recurring = RECURRING_KEYS.some((k) => k in object);
      let period = recurring ? null : outerPeriod;
      if (!recurring) {
        for (const k of PERIOD_KEYS) {
          const v = object[k];
          if (typeof v === "string" && (ISO_MONTH.test(v) || ISO_DATE.test(v))) {
            period = v.slice(0, 7);
            break;
          }
        }
      }
      let cadence = outerCadence;
      if (object.billed === "monthly" || object.paid === "a month") cadence = "month";
      if (object.billed === "yearly" || object.paid === "a year") cadence = "year";
      for (const [k, v] of Object.entries(object)) this.walk(v, names, period, cadence, k);
      return;
    }
    if (typeof value === "number") {
      if (PERCENT_KEY.test(key)) {
        this.facts.push({
          kind: "percent",
          value,
          names: outerNames,
          period: outerPeriod,
          cadence: null,
        });
      } else if (Number.isInteger(value) && !NOT_A_COUNT.test(key)) {
        this.addCount(value, key);
      }
      return;
    }
    if (typeof value !== "string") return;
    const cadence = YEARLY_KEY.test(key)
      ? "year"
      : MONTHLY_KEY.test(key)
        ? "month"
        : outerCadence && /^(?:lastCharge|price|premium|amount|payment)$/.test(key)
          ? outerCadence
          : null;
    if (MONEY_LEAF.test(value)) {
      this.facts.push({
        kind: "money",
        value: centsOf(value.replace(/[-−+$]/g, "")),
        names: outerNames,
        period: outerPeriod,
        cadence,
      });
    } else if (PERCENT_LEAF.test(value)) {
      this.facts.push({
        kind: "percent",
        value: Math.abs(Number(value.replace(/[%+−]/g, ""))),
        names: outerNames,
        period: outerPeriod,
        cadence: null,
      });
    } else if (ISO_DATE.test(value)) {
      const [, , month, day] = ISO_DATE.exec(value) as RegExpExecArray;
      this.facts.push({
        kind: "date",
        value: Number(month) * 100 + Number(day),
        names: outerNames,
        period: null,
        cadence: null,
      });
    } else {
      this.addText(value, { names: outerNames, period: outerPeriod });
    }
  }

  // What can be counted from a list without arithmetic: how many of it are `subscription: true`,
  // how many are of `kind: "bill"`.
  private tally(items: readonly unknown[]): void {
    const counts = new Map<string, number>();
    for (const item of items) {
      if (!item || typeof item !== "object") continue;
      for (const [k, v] of Object.entries(item as Record<string, unknown>)) {
        if (v === true) counts.set(k, (counts.get(k) ?? 0) + 1);
        if (typeof v === "string" && v.length < 30 && !MONEY_LEAF.test(v)) {
          counts.set(v, (counts.get(v) ?? 0) + 1);
        }
      }
    }
    for (const [noun, count] of counts) this.addCount(count, noun, "listed");
  }

  // The names a piece of text mentions, as written in the facts. A capitalized word has to appear:
  // "your target" isn't Target, and "credit card" alone is too general to mean any one card.
  private mentions(text: string): string[] {
    const known = this.mentioned.get(text);
    if (known) return known;
    const found: string[] = [];
    for (const name of this.names) {
      const phrase = phraseOf(name);
      const hit =
        significant(name).some((word) => {
          const title = word[0] + word.slice(1).toLowerCase();
          return [word, word.toUpperCase(), title].some((form) =>
            new RegExp(`(?<![\\p{L}\\p{N}])${escapeRegExp(form)}(?![\\p{L}\\p{N}])`, "u").test(
              text,
            ),
          );
        }) ||
        (phrase.includes(" ") && text.toLowerCase().includes(phrase));
      if (hit) found.push(name);
    }
    this.mentioned.set(text, found);
    return found;
  }

  private namesOf(fact: Fact): string[] {
    if (fact.names.length > 0) return fact.names;
    if (!fact.context) return [];
    const inClause = this.mentions(clauseAt(fact.context, fact.at ?? 0));
    return inClause.length > 0 ? inClause : this.mentions(fact.context);
  }

  // Whether a fact says whose it is, against these names. A category holds many merchants, so a
  // merchant's figure says nothing against a category, nor a category's against a merchant.
  private isBound(fact: Fact, said: readonly string[]): boolean {
    const names = this.namesOf(fact);
    if (names.length === 0) return false;
    const saidCategories = said.every((n) => this.categories.has(n));
    return saidCategories
      ? names.every((n) => this.categories.has(n))
      : names.some((n) => !this.categories.has(n));
  }

  // Whether a fact is about one of the names said.
  private aboutThem(fact: Fact, said: readonly string[]): boolean {
    const names = this.namesOf(fact);
    const words = new Set(said.flatMap((s) => significant(s).map((w) => w.toLowerCase())));
    const phrases = new Set(said.map(phraseOf));
    return names.some(
      (name) =>
        phrases.has(phraseOf(name)) || significant(name).some((w) => words.has(w.toLowerCase())),
    );
  }

  // The first thing wrong with an answer's numbers, for each number that's wrong.
  problems(answer: string, now: Date): FigureProblem[] {
    const problems: FigureProblem[] = [];
    const moneySaid = [...answer.matchAll(MONEY)].map((m) => centsOf(m[1]));
    for (const sentence of sentencesOf(answer)) {
      const stated = statedPeriods(sentence, now);
      const allNames = this.mentions(sentence);
      const figures = [...sentence.matchAll(MONEY)];
      // "Netflix and Hulu cost $15.49 and $17.99": the names are listed ahead of the figures, so
      // no one clause holds both.
      const listed =
        figures.length > 1 &&
        allNames.length > 1 &&
        allNames.every((n) => firstMention(sentence, n) < (figures[0].index ?? 0));
      const namesAt = (index: number) => {
        if (listed) return allNames;
        const inClause = this.mentions(clauseAt(sentence, index));
        if (inClause.length > 0) return inClause;
        // "Netflix went up, now $15.49" has one figure, so the name is its. With two, one clause
        // with no name isn't about the other's: "a $420.00 card payment and Medicare at $174.70".
        return figures.length > 1 ? [] : allNames;
      };
      const check = (
        matches: Fact[],
        said: string,
        index: number,
        cadence: Cadence | null,
        kind: FigureKind,
      ): FigureProblem | null => {
        const names = namesAt(index);
        let left = matches;
        if (names.length > 0) {
          // Where anything says whose it is, that's what counts: "your mortgage of $312,400.00" in
          // a tool's sentence doesn't make it anyone's. With nothing saying whose, it can't disagree.
          // Dates are too few to go by that: many things fall on Nov 15.
          const bound = left.filter((f) => this.isBound(f, names));
          const anyoneMayHaveIt = kind === "date" && bound.length < left.length;
          if (bound.length > 0 && !anyoneMayHaveIt) {
            left = bound.filter((f) => this.aboutThem(f, names));
          }
          if (left.length === 0) {
            const whose = [...new Set(matches.flatMap((f) => this.namesOf(f)))].slice(0, 3);
            return {
              kind: "wrong_name",
              said,
              // Merchant names are other people's words: quoted, as names, in what Claude is told.
              why: `${said} isn't for ${quoted(names)}: the results have it for ${quoted(whose)}`,
            };
          }
        }
        if (stated.length > 0) {
          const inPeriod = left.filter((f) => periodFits(f.period, stated));
          if (inPeriod.length === 0) {
            const when = [...new Set(left.flatMap((f) => (f.period ? [f.period] : [])))].slice(
              0,
              3,
            );
            return {
              kind: "wrong_period",
              said,
              why: `${said} isn't from ${stated.join(" or ")}: the results have it for ${when.join(" and ")}`,
            };
          }
          left = inPeriod;
        }
        // A transaction's amount says nothing of how often; a subscription's price does.
        const cadences = left.flatMap((f) => (f.cadence ? [f.cadence] : []));
        if (cadence && cadences.length > 0 && !cadences.includes(cadence)) {
          return {
            kind: "wrong_cadence",
            said,
            why: `${said} isn't a ${cadence}'s amount: the results have it as a ${cadence === "year" ? "month" : "year"}'s`,
          };
        }
        return null;
      };

      for (const m of figures) {
        const cents = centsOf(m[1]);
        const whole = !m[1].includes(".");
        // Nothing is anyone's for being $0.00, and a small round figure ("a $24 overdraft") is
        // too likely to be near someone else's by chance.
        if (cents === 0 || (whole && cents < WHOLE_DOLLARS_CHECKED_FROM_CENTS)) continue;
        const matches = this.facts.filter(
          (f) =>
            f.kind === "money" && (whole ? Math.abs(f.value - cents) <= 50 : f.value === cents),
        );
        // None at all is the guardrails' unsupported_dollar_figure.
        if (matches.length === 0) continue;
        const after = sentence.slice((m.index ?? 0) + m[0].length);
        const problem = check(matches, m[0].trim(), m.index ?? 0, cadenceAfter(after), "money");
        if (problem) problems.push(problem);
      }

      for (const m of sentence.matchAll(PERCENT)) {
        const value = Number(m[1]);
        const said = m[0].trim();
        // As exact as it's written: 5.25% isn't 5.24%, and 23% can be 22.99%.
        const decimals = m[1].split(".")[1]?.length ?? 0;
        const tolerance = decimals === 0 ? 0.51 : 0.51 / 10 ** decimals;
        // A whole number on file may have more digits behind it.
        const matches = this.facts.filter(
          (f) =>
            f.kind === "percent" &&
            Math.abs(f.value - value) <= (Number.isInteger(f.value) ? 0.51 : tolerance),
        );
        if (value === 0 || value === 100 || isRatioOf(value, tolerance, moneySaid)) continue;
        if (matches.length === 0) {
          problems.push({
            kind: "unsupported_percent",
            said,
            why: `${said} isn't in their numbers or the tool results: use the calculate tool for a share of two amounts`,
          });
          continue;
        }
        const problem = check(matches, said, m.index ?? 0, null, "percent");
        if (problem) problems.push(problem);
      }

      for (const m of sentence.matchAll(DATE)) {
        const value = (monthIndex(m[1]) + 1) * 100 + Number(m[2]);
        const said = m[0].trim();
        if (isToday(value, now) || CALENDAR_DATES.includes(value)) continue;
        const matches = this.facts.filter((f) => f.kind === "date" && f.value === value);
        if (matches.length === 0) {
          problems.push({
            kind: "unsupported_date",
            said,
            why: `${said} isn't in their numbers or the tool results: state dates exactly as a tool gives them, and don't work one out`,
          });
          continue;
        }
        const problem = check(matches, said, m.index ?? 0, null, "date");
        if (problem?.kind === "wrong_name") problems.push(problem);
      }

      for (const m of sentence.matchAll(COUNT)) {
        const value = NUMBER_WORDS[m[1].toLowerCase()] ?? Number(m[1]);
        const noun = stem(m[2]);
        const counts = this.facts.filter((f) => f.kind === "count");
        // A number a tool stated counts for any noun: "matched": 30 is what "30 charges" says.
        if (counts.some((f) => !f.listed && f.value === value)) continue;
        const lists = counts.filter(
          (f) => f.noun && (f.noun === noun || f.noun.includes(noun) || noun.includes(f.noun)),
        );
        // Never counted, so nothing to disagree with.
        if (lists.length === 0) continue;
        const sizes = lists.map((f) => f.value);
        // "You have 3 subscriptions" says how many there are. "2 of your debts could cost less"
        // picks some out, so it only has to fit.
        const total = TOTAL_CLAIM.test(sentence.slice(0, (m.index ?? 0) + m[0].length));
        const fits = total
          ? sizes.includes(value) || sizes.reduce((a, b) => a + b, 0) === value
          : value <= sizes.reduce((a, b) => a + b, 0);
        if (!fits) {
          problems.push({
            kind: "wrong_count",
            said: m[0].trim(),
            why: `${m[0].trim()} isn't what the results count (they have ${[...new Set(sizes)].slice(0, 3).join(" or ")}): say the count a tool gives, or list them without a number`,
          });
        }
      }
    }
    return problems;
  }
}

const quoted = (names: readonly string[]) => names.map((n) => JSON.stringify(n)).join(" and ");

const escapeRegExp = (text: string) => text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

const firstMention = (sentence: string, name: string) => {
  const at = significant(name)
    .map((w) => sentence.toLowerCase().indexOf(w.toLowerCase()))
    .filter((i) => i >= 0);
  return at.length > 0 ? Math.min(...at) : Infinity;
};

// The clause a figure sits in: split at commas, "and", "but", "while" and semicolons.
function clauseAt(sentence: string, index: number): string {
  let start = 0;
  for (const m of sentence.matchAll(/;|,\s|\s(?:and|but|while|whereas)\s/g)) {
    const at = m.index ?? 0;
    if (at >= index) return sentence.slice(start, at);
    start = at + m[0].length;
  }
  return sentence.slice(start);
}

// The periods a sentence says it's about: "in May", "October 2026", "last month", "this year".
function statedPeriods(sentence: string, now: Date): string[] {
  const periods: string[] = [];
  const thisYear = now.getUTCFullYear();
  const shifted = (back: number) => {
    const d = new Date(Date.UTC(thisYear, now.getUTCMonth() - back, 1));
    return d.toISOString().slice(0, 7);
  };
  if (/\bthis month\b/i.test(sentence)) periods.push(shifted(0));
  if (/\blast month\b/i.test(sentence)) periods.push(shifted(1));
  if (/\bthis year\b/i.test(sentence)) periods.push(String(thisYear));
  if (/\blast year\b/i.test(sentence)) periods.push(String(thisYear - 1));
  // A month with a day is a date, not a period. A bare "may" isn't a month: it has to be
  // capitalized and said as one.
  const months = new RegExp(
    `\\b(?:[Ii]n|[Ff]or|[Oo]f|[Dd]uring|[Ff]rom) (${MONTH_WORD})\\b(?! \\d{1,2}\\b)(?:,? (\\d{4}))?|\\b(${MONTH_WORD})(?:'s| (\\d{4}))`,
    "g",
  );
  for (const m of sentence.matchAll(months)) {
    const word = m[1] ?? m[3];
    const year = m[2] ?? m[4];
    const month = String(monthIndex(word) + 1).padStart(2, "0");
    periods.push(year ? `${year}-${month}` : `*-${month}`);
  }
  return periods;
}

function periodFits(period: string | null, stated: readonly string[]): boolean {
  if (!period) return true;
  return stated.some((s) => {
    if (s.startsWith("*-")) return period.slice(4) === s.slice(1);
    if (s.length === 4) return period.startsWith(s);
    return period === s;
  });
}

const isToday = (value: number, now: Date) =>
  value === (now.getUTCMonth() + 1) * 100 + now.getUTCDate();

// A percent worked out from two amounts the answer itself states, with both on the page.
function isRatioOf(value: number, tolerance: number, cents: readonly number[]): boolean {
  return cents.some((part) =>
    cents.some(
      (whole) => whole > 0 && part !== whole && Math.abs((part / whole) * 100 - value) <= tolerance,
    ),
  );
}

// Every number the person typed, as cents, money sign or not: "pay off 5000 at 200 a month" is
// theirs to work with.
export const typedAmountsCents = (text: string): number[] =>
  [...text.matchAll(/\d[\d,]*(?:\.\d+)?/g)].map((m) => centsOf(m[0]));

// A calculation's amounts, in dollars, that nothing on file supports. The calculator's answer is
// only as good as what went in: a made-up amount would come back as a supported figure.
export function calculatorInputsNotOnFile(
  input: unknown,
  allowedCents: readonly number[],
): number[] {
  const given = (input ?? {}) as Record<string, unknown>;
  const dollars = [
    given.amount,
    given.other_amount,
    given.balance,
    given.monthly_payment,
    ...(Array.isArray(given.amounts) ? given.amounts : []),
  ].filter((v): v is number => typeof v === "number" && Number.isFinite(v));
  return dollars.filter((amount) => {
    const cents = Math.round(Math.abs(amount) * 100);
    return !allowedCents.some((a) => Math.abs(Math.abs(a) - cents) < 100);
  });
}
