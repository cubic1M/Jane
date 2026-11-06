// A synthetic IRS account transcript's text layer, made up (no real person): the shape of the
// IRS's PDF, with its masked name, SSN and address, document numbers under each return, and page
// headers and footers that fall in the middle of the transaction table. Long on purpose, so a
// reader that only looks at the start would miss rows (memory: test past slices).

const header = (page: number, of: number) => `This Product Contains Sensitive Taxpayer Data
Account Transcript
Request Date: 11-06-2026
Response Date: 11-06-2026
Tracking Number: 108765432109
Page ${page} of ${of}`;

const filler = (n: number) =>
  Array.from(
    { length: n },
    (_, i) => `INTEREST COMPUTED TO: 04-15-2026 LINE ${i + 1} OF ACCRUED PENALTY NOTES`,
  ).join("\n");

export const TRANSCRIPT_TEXT = `${header(1, 3)}
FORM NUMBER: 1040
TAX PERIOD: Dec. 31, 2025
TAXPAYER IDENTIFICATION NUMBER: XXX-XX-4417
JOHN Q TESTPERSON
123 SAMPLE ST
ANYTOWN, ZZ 00000-0000
ACCOUNT BALANCE: $0.00
ACCRUED INTEREST: $0.00 AS OF: May 04, 2026
ACCRUED PENALTY: $0.00 AS OF: May 04, 2026
ACCOUNT BALANCE PLUS ACCRUALS (this is not a payoff amount): $0.00
** INFORMATION FROM THE RETURN OR AS ADJUSTED **
EXEMPTIONS: 00
FILING STATUS: Single
ADJUSTED GROSS INCOME: $61,240.00
${filler(40)}
TRANSACTIONS
CODE EXPLANATION OF TRANSACTION CYCLE DATE AMOUNT
150 Tax return filed 20261505 04-15-2026 $4,321.00
n/a 76221-105-12345-6
670 Payment 01-15-2026 -$1,000.00
${header(2, 3)}
CODE EXPLANATION OF TRANSACTION CYCLE DATE AMOUNT
${filler(30)}
806 W-2 or 1099 withholding 04-15-2026 -$4,800.00
766 Credit to your account 04-15-2026 -$500.00
570 Additional account action pending 04-15-2026 $0.00
846 Refund issued 20261805 05-04-2026 $1,979.00
${header(3, 3)}
971 Notice issued 05-04-2026 $0.00
This Product Contains Sensitive Taxpayer Data
`;
