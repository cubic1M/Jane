// A made-up "Download My Aid Data" file in the layout's name:value form (connectors roadmap round
// 15). Everything here is fake. It carries the personal lines a real file has, which must never
// survive parsing, and is long (grants and enrolment padding first) so a reader that only looks at
// the start can't pass.

const PERSON = [
  "File Request Date:11/06/2026",
  "Student First Name:TESTY",
  "Student Last Name:SAMPLEPERSON",
  "Student Street Address Line 1:12 FAKE STREET",
  "Student City:SPRINGFIELD",
  "Student State Code:IL",
  "Student Zip Code:62702",
  "Student Email Address:testy.sample@example.com",
  "Student Phone Number:2175550100",
];

const PADDING = Array.from({ length: 300 }, (_, i) =>
  [
    `Grant Type Code:PL`,
    `Grant Type Description:Federal Pell Grant`,
    `Grant Attended School Name:EXAMPLE STATE UNIVERSITY ${i}`,
  ].join("\n"),
);

const LOAN_1 = [
  "Loan Type Code:D1",
  "Loan Type Description:DIRECT STAFFORD SUBSIDIZED",
  "Loan Date:08/15/2019",
  "Loan Disbursed Amount:$3,500.00",
  "Loan Outstanding Principal Balance:$3,412.18",
  "Loan Outstanding Interest Balance:$42.07",
  "Loan Interest Rate Type Code:F",
  "Loan Interest Rate:4.53%",
  "Loan Repayment Plan Type Code:IB",
  "Loan Repayment Plan Type Code Description:INCOME-BASED REPAYMENT",
  "Loan Repayment Plan Begin Date:01/01/2024",
  "Loan Repayment Plan Scheduled Amount:$61.00",
  "Loan Repayment Plan IDR Plan Anniversary Date:01/01/2027",
  "Loan Next Payment Due Date:12/01/2026",
  "Loan PSLF Cumulative Matched Months:22",
  "Current Loan Status:RP",
  "Loan Contact Type:Current ED Servicer",
  "Loan Contact Name:EXAMPLE LOAN SERVICING",
  "Loan Contact Street Address 1:PO BOX 0000",
  "Loan Contact Phone Number:8005550199",
];

const LOAN_2 = [
  "Loan Type Code:D2",
  "Loan Type Description:DIRECT STAFFORD UNSUBSIDIZED",
  "Loan Date:2020-08-14",
  "Loan Disbursed Amount:2000",
  "Loan Outstanding Principal Balance:1987.50",
  "Loan Outstanding Interest Balance:",
  "Loan Interest Rate Type Code:F",
  "Loan Interest Rate:2.75",
  "Loan Repayment Plan Type Code:ZZ",
  "Loan Repayment Plan Type Code Description:",
  "Loan Next Payment Due Date:not a date",
  "Loan PSLF Cumulative Matched Months:",
  "Current Loan Status:RP",
];

export const MY_AID_FILE = [...PERSON, ...PADDING, ...LOAN_1, ...LOAN_2].join("\n");
