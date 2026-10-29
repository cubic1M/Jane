// The demo video's bank statement: four months of a made-up person's Chase checking export,
// ending yesterday, as Chase writes it (newest first, with the running balance). Nobody real:
// the merchants are ordinary, the amounts are invented, and a fixed seed makes the same file
// every time. It's written to give Jane something to find on camera: a streaming price rise,
// two music services, a monthly fee, out-of-network ATM fees, a high internet bill, car
// insurance worth reshopping and more cash than the person spends sitting in checking.

const DAY_MS = 24 * 60 * 60 * 1000;
const DAYS = 122;

type Row = { date: Date; description: string; cents: number; kind: string };

// A small seeded random, so the groceries and dining differ row to row but not run to run.
function seeded(seed: number) {
  let s = seed;
  return () => {
    s = (s * 1_103_515_245 + 12_345) % 2_147_483_648;
    return s / 2_147_483_648;
  };
}

const usDate = (d: Date) =>
  `${String(d.getUTCMonth() + 1).padStart(2, "0")}/${String(d.getUTCDate()).padStart(2, "0")}/${d.getUTCFullYear()}`;

export function sampleStatement(today = new Date()): string {
  const random = seeded(20_261_028);
  const end = Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), today.getUTCDate()) - DAY_MS;
  const rows: Row[] = [];
  const add = (date: Date, description: string, cents: number, kind: string) =>
    rows.push({ date, description, cents, kind });

  for (let n = DAYS; n >= 0; n -= 1) {
    const date = new Date(end - n * DAY_MS);
    const day = date.getUTCDate();

    // Pay every other Friday, rent on the first.
    if (date.getUTCDay() === 5 && Math.floor(n / 7) % 2 === 0) {
      add(date, "ACME CORP PAYROLL PPD ID: 9876543210", 285_000, "ACH_CREDIT");
    }
    if (day === 1) add(date, "OAK RIDGE APTS RENT PPD ID: 5550001", -190_000, "ACH_DEBIT");

    // Everyday spending.
    if (n % 4 === 0) {
      add(
        date,
        "TRADER JOE S #552 OAKLAND CA",
        -Math.round(4_200 + random() * 5_800),
        "DEBIT_CARD",
      );
    }
    if (n % 3 === 1) {
      const places = ["CHIPOTLE 1234", "SWEETGREEN OAKLAND", "BLUE BOTTLE COFFEE", "SHAKE SHACK"];
      const place = places[Math.floor(random() * places.length)];
      add(date, place, -Math.round(900 + random() * 2_600), "DEBIT_CARD");
    }
    if (n % 9 === 2)
      add(date, "SHELL OIL 57444", -Math.round(3_800 + random() * 2_000), "DEBIT_CARD");

    // Bills and subscriptions.
    if (day === 3) add(date, "COMCAST XFINITY PPD ID: 0000312345", -11_499, "ACH_DEBIT");
    if (day === 5) add(date, "SPOTIFY USA", -1_199, "DEBIT_CARD");
    if (day === 8) add(date, "VERIZON WIRELESS PAYMENTS PPD ID: 1223344556", -8_500, "ACH_DEBIT");
    if (day === 11) add(date, "SIRIUSXM RADIO", -1_099, "DEBIT_CARD");
    if (day === 12) add(date, "GEICO AUTO PPD ID: 8005550100", -18_600, "ACH_DEBIT");
    if (day === 18) add(date, "PLANET FITNESS CLUB FEES", -2_499, "DEBIT_CARD");
    if (day === 20) {
      add(
        date,
        "PG&E WEB ONLINE PPD ID: 9471234567",
        -Math.round(8_200 + random() * 4_000),
        "ACH_DEBIT",
      );
    }
    if (day === 28) add(date, "MONTHLY SERVICE FEE", -1_200, "FEE_TRANSACTION");

    // Cash from other banks' machines now and then.
    if (n % 17 === 6) {
      add(date, "ATM WITHDRAWAL 000123 2026 BROADWAY OAKLAND", -6_000, "ATM");
      add(date, "NON-CHASE ATM FEE-WITH", -300, "FEE_TRANSACTION");
    }
  }

  // Netflix: the same price three months running, then up three days ago (recent enough for
  // a change alert).
  const latest = new Date(end - 2 * DAY_MS);
  for (let k = 3; k >= 0; k -= 1) {
    const day = Math.min(latest.getUTCDate(), 28);
    const date = new Date(Date.UTC(latest.getUTCFullYear(), latest.getUTCMonth() - k, day));
    add(date, "NETFLIX.COM", k === 0 ? -1_799 : -1_549, "DEBIT_CARD");
  }

  // Newest first, with the running balance after each row.
  rows.sort(
    (a, b) => b.date.getTime() - a.date.getTime() || a.description.localeCompare(b.description),
  );
  let balance = 2_184_233;
  const lines = rows.map((r) => {
    const line = `${r.cents < 0 ? "DEBIT" : "CREDIT"},${usDate(r.date)},"${r.description}",${(r.cents / 100).toFixed(2)},${r.kind},${(balance / 100).toFixed(2)},,`;
    balance -= r.cents;
    return line;
  });
  return ["Details,Posting Date,Description,Amount,Type,Balance,Check or Slip #", ...lines].join(
    "\n",
  );
}
