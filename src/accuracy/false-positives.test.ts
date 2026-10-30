import { describe, expect, it, vi } from "vitest";
import { buildStreams } from "@/detection/streams";
import { renewalDeadlines, trialDeadlines } from "@/insights/deadlines";
import { evidenceRefs } from "@/lib/finding-accounts";
import { priceRises } from "@/planning/price-rises";
import { addDays, generateCsvPeople, type CsvPerson, type TrueRow } from "./csv/people";
import { runUpload } from "./csv/score";

// The false-positive bench (card-chat mismatch; design in the shared notes): one-off purchases
// that look like something they aren't (a movie ticket, a bookstore receipt, a concert, a flight
// and its hotel, a single Apple Store buy, one Venmo) mixed into the CSV bench's held-out people,
// through the real upload path. None of them may become a recurring charge, a renewal, a price
// rise, a trial or a finding (a fee, a subscription, a bill): those are claims about a pattern,
// and one charge is no pattern. A return window for a one-off is right, so it isn't scored. The
// founder's live /deadlines had a movie ticket and a bookstore receipt as "renews" cards.
vi.mock("@/categorize/llm", () => ({ classifyMerchants: async () => new Map() }));

// Made up, with amounts no bench row uses, at the ages that fooled Jane: about a year back (a
// "yearly plan"), half a year, and recent.
const ONE_OFFS: (Omit<TrueRow, "id" | "account" | "date"> & { daysAgo: number; card: boolean })[] =
  [
    {
      daysAgo: 327,
      card: true,
      amountCents: 1_068,
      descriptor: "AMC ONLINE -- KS 12/06",
      category: "ENTERTAINMENT_TV_AND_MOVIES",
      kind: "spending",
      flow: "purchase",
    },
    {
      daysAgo: 319,
      card: true,
      amountCents: 4_409,
      descriptor: "BBOOKSTORE ST839 CHICAGO IL 12/16",
      category: "GENERAL_MERCHANDISE_BOOKSTORES_AND_NEWSSTANDS",
      kind: "spending",
      flow: "purchase",
    },
    {
      daysAgo: 334,
      card: true,
      amountCents: 18_877,
      descriptor: "TICKETMASTER *TAYLOR SWIFT",
      category: "ENTERTAINMENT_MUSIC_AND_AUDIO",
      kind: "spending",
      flow: "purchase",
    },
    {
      daysAgo: 352,
      card: true,
      amountCents: 9_913,
      descriptor: "AUDIBLE GIFT MEMBERSHIP NOVA",
      category: "ENTERTAINMENT_MUSIC_AND_AUDIO",
      kind: "spending",
      flow: "purchase",
    },
    {
      daysAgo: 201,
      card: true,
      amountCents: 41_239,
      descriptor: "DELTA AIR 0062301234567",
      category: "TRAVEL_FLIGHTS",
      kind: "spending",
      flow: "purchase",
    },
    {
      daysAgo: 196,
      card: true,
      amountCents: 62_851,
      descriptor: "MARRIOTT HOTEL DENVER",
      category: "TRAVEL_LODGING",
      kind: "spending",
      flow: "purchase",
    },
    {
      daysAgo: 12,
      card: true,
      amountCents: 134_901,
      descriptor: "APPLE STORE R102",
      category: "GENERAL_MERCHANDISE_ELECTRONICS",
      kind: "spending",
      flow: "purchase",
    },
    {
      daysAgo: 44,
      card: false,
      amountCents: 7_317,
      descriptor: "VENMO PAYMENT JORDAN LEE",
      category: "TRANSFER_OUT_ACCOUNT_TRANSFER",
      alsoOk: ["TRANSFER_OUT"],
      kind: "moving",
      flow: "venmo_out",
    },
  ];

// The first people of a held-out set, each with every one-off.
function withOneOffs(person: CsvPerson): CsvPerson {
  const card = person.accounts.find((a) => a.kind === "credit_card") ?? person.accounts[0];
  const bank = person.accounts.find((a) => a.kind === "checking") ?? person.accounts[0];
  const rows = ONE_OFFS.map(({ daysAgo, card: onCard, ...row }, i): TrueRow => ({
    ...row,
    id: `one-off-${i}`,
    account: (onCard ? card : bank).id,
    date: addDays(person.asOf, -daysAgo),
  }));
  // Their history reaches back to the oldest one-off, as a year of statements would.
  const start = rows.reduce((d, r) => (r.date < d ? r.date : d), person.start);
  return { ...person, start, rows: [...person.rows, ...rows] };
}

const PEOPLE = 6;

describe("the false-positive bench: one-offs never become claims", () => {
  it.each(generateCsvPeople(PEOPLE, "held-out").map((p) => [p.id, p] as const))(
    "%s",
    async (_id, person) => {
      const up = await runUpload(withOneOffs(person));
      const oneOff = new Set(
        up.rows.filter((r) => r.truthId?.startsWith("one-off-")).map((r) => r.id),
      );
      expect(oneOff.size, "the one-offs made it through the upload").toBeGreaterThan(0);
      const input = up.input;
      const streams = buildStreams(input);
      const claims = [
        ...streams
          .filter((s) => s.active && s.charges.some((c) => oneOff.has(c.id)))
          .map((s) => `recurring: ${s.merchant}`),
        ...renewalDeadlines(input, streams)
          .filter((d) =>
            streams.some((s) => d.key.includes(s.key) && s.charges.some((c) => oneOff.has(c.id))),
          )
          .map((d) => `renewal: ${d.title}`),
        ...trialDeadlines(input)
          .filter((d) => oneOff.has(d.key.slice("trial:".length)))
          .map((d) => `trial: ${d.title}`),
        ...priceRises(
          input.transactions.map((t) => ({
            date: t.date,
            amountCents: t.amountCents,
            description: t.description,
            pfc: t.pfcDetailed,
            merchantName: t.merchantName,
          })),
          input.asOf,
        )
          .filter((r) =>
            input.transactions.some(
              (t) => oneOff.has(t.id) && t.date === r.chargedOn && t.amountCents === r.nowCents,
            ),
          )
          .map((r) => `price rise: ${r.name}`),
        ...up.findings
          .filter((f) => evidenceRefs(f.evidence).transactionIds.some((id) => oneOff.has(id)))
          .map((f) => `finding ${f.type}: ${f.title}`),
      ];
      expect(claims).toEqual([]);
    },
    120_000,
  );
});
