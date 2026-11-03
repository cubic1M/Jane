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

export function madeUpChaseCsv(marker: string, now = new Date()): string {
  const header = "Details,Posting Date,Description,Amount,Type,Balance,Check or Slip #";
  let balance = 845_000;
  const lines = rows(marker, now).map((row) => {
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
