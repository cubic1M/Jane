// A made-up bank statement in Chase's CSV layout or as OFX, for trying Jane with your own
// statement in tests: four months of pay, rent, a few subscriptions and bank fees, with `marker`
// in a merchant's name so a test can tell whose statement a row came from. Nobody's real data.

type Row = { date: string; description: string; cents: number; type: string };

const iso = (at: Date) => at.toISOString().slice(0, 10);

function rows(marker: string, now: Date): Row[] {
  const out: Row[] = [];
  for (let back = 4; back >= 0; back -= 1) {
    const month = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - back, 1));
    const on = (day: number) =>
      new Date(Date.UTC(month.getUTCFullYear(), month.getUTCMonth(), day));
    const add = (day: number, description: string, cents: number, type = "DEBIT_CARD") => {
      if (on(day) <= now) out.push({ date: iso(on(day)), description, cents, type });
    };
    add(1, "ACME CORP PAYROLL PPD ID: 9876543210", 420_000, "ACH_CREDIT");
    add(2, "OAK STREET APARTMENTS RENT", -165_000, "ACH_DEBIT");
    add(3, "NETFLIX.COM NETFLIX.COM CA", -1_549);
    add(4, "SPOTIFY USA 877-778-1161 NY", -1_199);
    add(5, `${marker} FITNESS CLUB MEMBERSHIP`, -3_999);
    add(6, "PLANET FITNESS MONTHLY DUES", -2_499);
    add(8, "MONTHLY SERVICE FEE", -1_200, "FEE_TRANSACTION");
    add(11, "SAFEWAY #1234 OAKLAND CA", -8_450);
    add(15, "ACME CORP PAYROLL PPD ID: 9876543210", 420_000, "ACH_CREDIT");
    add(17, "SHELL OIL 57444 OAKLAND CA", -4_210);
    add(20, "OVERDRAFT FEE", -3_500, "FEE_TRANSACTION");
    add(22, "TRADER JOES #123 OAKLAND CA", -6_120);
  }
  return out.sort((a, b) => b.date.localeCompare(a.date));
}

const money = (cents: number) => (cents / 100).toFixed(2);

// `brokenBalance`: part way down, the balance column jumps by $500 with nothing behind it.
export function madeUpChaseCsv(
  marker: string,
  now = new Date(),
  { brokenBalance = false } = {},
): string {
  const header = "Details,Posting Date,Description,Amount,Type,Balance,Check or Slip #";
  let balance = 845_000;
  const lines = rows(marker, now).map((row, i) => {
    if (brokenBalance && i === 10) balance += 50_000;
    const [y, m, d] = row.date.split("-");
    const line = [
      row.cents < 0 ? "DEBIT" : "CREDIT",
      `${m}/${d}/${y}`,
      `"${row.description}"`,
      money(row.cents),
      row.type,
      money(balance),
      "",
      "",
    ].join(",");
    balance -= row.cents;
    return line;
  });
  return [header, ...lines, ""].join("\n");
}

export function madeUpOfx(marker: string, now = new Date()): string {
  const entries = rows(marker, now).map(
    (row, i) => `<STMTTRN>
<TRNTYPE>${row.cents < 0 ? "DEBIT" : "CREDIT"}
<DTPOSTED>${row.date.replaceAll("-", "")}120000
<TRNAMT>${money(row.cents)}
<FITID>MADEUP${i}
<NAME>${row.description.slice(0, 32)}
</STMTTRN>`,
  );
  return `OFXHEADER:100
DATA:OFXSGML
VERSION:102

<OFX>
<BANKMSGSRSV1>
<STMTTRNRS>
<STMTRS>
<CURDEF>USD
<BANKACCTFROM>
<BANKID>000000000
<ACCTID>000012345678
<ACCTTYPE>CHECKING
</BANKACCTFROM>
<BANKTRANLIST>
${entries.join("\n")}
</BANKTRANLIST>
<LEDGERBAL>
<BALAMT>8450.00
<DTASOF>${iso(now).replaceAll("-", "")}120000
</LEDGERBAL>
</STMTRS>
</STMTTRNRS>
</BANKMSGSRSV1>
</OFX>
`;
}

// A made-up Chase card file: spending, a monthly payment and interest, no balance column.
export function madeUpCardCsv(marker: string, now = new Date()): string {
  const header = "Transaction Date,Post Date,Description,Category,Type,Amount,Memo";
  const lines: string[] = [];
  for (let back = 4; back >= 0; back -= 1) {
    const month = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - back, 1));
    const add = (day: number, what: string, category: string, type: string, cents: number) => {
      const on = new Date(Date.UTC(month.getUTCFullYear(), month.getUTCMonth(), day));
      if (on > now) return;
      const [y, m, d] = iso(on).split("-");
      const date = `${m}/${d}/${y}`;
      lines.push(`${date},${date},${what},${category},${type},${money(cents)},`);
    };
    add(2, `AMAZON MKTPL*${marker}`, "Shopping", "Sale", -8_420);
    add(5, "CHIPOTLE 1234", "Food & Drink", "Sale", -1_475);
    add(12, "HULU 877-8244858", "Bills & Utilities", "Sale", -1_799);
    add(15, "PAYMENT THANK YOU-MOBILE", "", "Payment", 50_000);
    add(18, "WHOLEFDS OAK 10234", "Groceries", "Sale", -9_631);
    add(21, "INTEREST CHARGE ON PURCHASES", "Fees & Adjustments", "Fee", -4_122);
  }
  return [header, ...lines.reverse(), ""].join("\n");
}
